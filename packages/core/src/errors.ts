import type { Conflict, ErrorKind } from './types.ts';

export class CancelledError extends Error {
  readonly kind = 'cancelled';
  constructor() {
    super('The job was cancelled');
    this.name = 'CancelledError';
  }
}

/** A backup folder that belongs to a different account, or a target that is not usable. */
export class ConflictError extends Error {
  readonly kind = 'conflict';
  /** Which conflict it is, for a window that says it in the user's language. */
  readonly conflict: Conflict;

  constructor(message: string, conflict: Conflict) {
    super(message);
    this.name = 'ConflictError';
    this.conflict = conflict;
  }
}

export function conflictOf(error: unknown): Conflict | null {
  return error instanceof ConflictError ? error.conflict : null;
}

const CONNECTION_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'NoConnection',
  'EConnectionClosed',
  'ClosedAfterConnectText',
  'ClosedAfterConnectTLS',
  'CONNECT_TIMEOUT',
  'GREETING_TIMEOUT',
  'UPGRADE_TIMEOUT',
  'ETIMEOUT',
  'StateLogout',
  'DownloadIncomplete',
]);

// `[LIMIT]` (RFC 5530) is not in here: it is a limit of one operation (a message too large,
// too many keywords), so only that message fails, not the whole run.
const QUOTA_PATTERN = /OVERQUOTA|bandwidth limits|exceeded (?:the )?(?:command|bandwidth|daily)|quota exceeded/i;
// After a dropped connection Gmail still counts the dead one for a while: wait and try again.
// A server that says it is busy or temporarily unavailable gets the same pauses.
const THROTTLE_PATTERN = /\[THROTTLED\]|too many (?:simultaneous )?connections|\[UNAVAILABLE\]|\[INUSE\]|\btemporar(?:y|ily)\b|try again/i;

/** The file system or the backup database can take no more; going on would fail every message. */
const STORAGE_CODES = new Set(['ENOSPC', 'EDQUOT', 'EROFS', 'EIO', 'EMFILE', 'ENFILE', 'EACCES', 'EPERM']);
// Primary SQLite result codes: READONLY, IOERR, CORRUPT, FULL, CANTOPEN, NOTADB.
const SQLITE_STORAGE_CODES = new Set([8, 10, 11, 13, 14, 26]);

interface ErrorLike {
  code?: unknown;
  errcode?: unknown;
  authenticationFailed?: unknown;
  tlsFailed?: unknown;
  responseText?: unknown;
  serverResponseCode?: unknown;
  message?: unknown;
}

export function classifyError(error: unknown): ErrorKind {
  if (error instanceof CancelledError) return 'cancelled';
  if (error instanceof ConflictError) return 'conflict';
  if (typeof error !== 'object' || error === null) return 'other';
  const err = error as ErrorLike;
  const code = typeof err.code === 'string' ? err.code : '';
  if (STORAGE_CODES.has(code)) return 'storage';
  if (code === 'ERR_SQLITE_ERROR' && typeof err.errcode === 'number' && SQLITE_STORAGE_CODES.has(err.errcode & 0xff)) return 'storage';
  const text = [err.responseText, err.serverResponseCode, err.message]
    .filter((part) => typeof part === 'string')
    .join(' ');
  // Before the login flag: imapflow sets `authenticationFailed` on any NO to LOGIN, and Gmail
  // answers the login after a dropped connection with "too many simultaneous connections".
  if (QUOTA_PATTERN.test(text)) return 'quota';
  if (code === 'ETHROTTLE' || THROTTLE_PATTERN.test(text)) return 'throttle';
  if (err.authenticationFailed) return 'auth';
  if (err.tlsFailed || code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL') || /CERT|SELF_SIGNED/.test(code)) return 'tls';
  if (CONNECTION_CODES.has(code)) return 'connection';
  return 'other';
}

/** imapflow answers a failed COPY or STORE with `false`; this tells a lost connection apart. */
export function connectionLost(command: string): Error {
  return Object.assign(new Error(`The connection was lost during ${command}`), { code: 'NoConnection' });
}

export function isRetryable(kind: ErrorKind): boolean {
  return kind === 'connection' || kind === 'throttle';
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const responseText = (error as ErrorLike).responseText;
    if (typeof responseText === 'string' && responseText.length > 0) {
      return `${error.message}: ${responseText}`;
    }
    return error.message;
  }
  return String(error);
}
