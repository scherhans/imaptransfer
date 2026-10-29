export type AccountAuth =
  | { type: 'password'; password: string }
  | { type: 'oauth2'; getAccessToken: () => Promise<string> };

export interface AccountConfig {
  host: string;
  port: number;
  /** TLS from the first byte (usually port 993). When false, STARTTLS is required. */
  secure: boolean;
  user: string;
  auth: AccountAuth;
  /** Local test servers only: accept self-signed certificates. */
  allowSelfSigned?: boolean;
  /** Local test servers only: allow a connection without any encryption. */
  allowPlaintext?: boolean;
}

/**
 * How a folder takes part in a transfer.
 * - `normal`: an ordinary folder.
 * - `all`: a server-side view of every message (Gmail "All Mail"). Backed up, but on restore
 *   only used for messages that live in no other folder.
 * - `view`: a server-side view of messages that live elsewhere (Gmail "Starred", "Important").
 *   Skipped, the information is kept as a flag on the message.
 */
export type FolderRole = 'normal' | 'all' | 'view';

export interface FolderInfo {
  path: string;
  delimiter: string;
  /** `\Inbox`, `\Sent`, `\Drafts`, `\Trash`, `\Junk`, `\Archive`, `\All`, `\Flagged`, `\Important` */
  specialUse: string | null;
  role: FolderRole;
}

/** `sync`: a sync brings read/flagged state in line and takes out of the target what left the source. */
export type Phase = 'connect' | 'scan' | 'transfer' | 'copy' | 'sync' | 'clean' | 'finish';

export type ProgressEvent =
  | { type: 'phase'; phase: Phase }
  | { type: 'folder'; path: string; index: number; count: number }
  | {
      type: 'progress';
      /** Messages handled so far, including those that were already there. */
      done: number;
      total: number;
      /** Bytes that crossed the network. */
      bytes: number;
      /** Messages and bytes that still have to cross the network. */
      remainingMessages: number;
      remainingBytes: number;
      /** Estimated seconds until the end; null while there is too little to go on. */
      remainingSeconds: number | null;
    }
  | {
      /** One large message (1 MB or more) on its way; `finished` once it is through or failed. */
      type: 'message';
      direction: 'download' | 'upload';
      subject: string | null;
      size: number;
      transferred: number;
      finished: boolean;
    }
  | { type: 'warning'; message: string; folder?: string; subject?: string }
  | { type: 'retry'; attempt: number; delayMs: number; reason: string };

export interface JobOptions {
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

export type ErrorKind =
  | 'auth'
  | 'tls'
  | 'connection'
  | 'throttle'
  | 'quota'
  /** The disk or the backup's database refuses to take more (full, read-only, I/O error). */
  | 'storage'
  | 'cancelled'
  | 'conflict'
  | 'other';

/**
 * A known reason why a backup folder or an account cannot be used. The message of the error
 * says it in English; a window can say it in its own language from the code and the details.
 */
export type ConflictCode =
  /** The folder holds no backup (a restore or a check needs one). */
  | 'no-backup'
  /** The folder above the backup folder is missing: a drive not plugged in. */
  | 'drive-missing'
  /** The folder held the account's backup before and holds none now; the app decides that. */
  | 'backup-missing'
  | 'newer-version'
  | 'older-version'
  /** Another process is writing to the backup. */
  | 'in-use'
  /** The folder holds the backup of another account. */
  | 'other-account'
  /** The account has no trash for the cleanup. */
  | 'no-trash'
  /** The server can neither move nor delete single messages safely. */
  | 'no-safe-delete'
  /** A sync into Gmail: there a folder is a label, and taking a message out of one could take it out of all. */
  | 'sync-gmail'
  /** A restore sync from a backup whose last run did not get through: it would take mail for deleted that is still there. */
  | 'backup-incomplete';

export interface Conflict {
  code: ConflictCode;
  details: Record<string, string>;
}

/** Why a run ended early; `conflict` is set for a known conflict. */
export interface RunError {
  kind: ErrorKind;
  message: string;
  conflict: Conflict | null;
}

export interface FolderReport {
  /**
   * Folder in the source (the IMAP account for a backup, the backup or account for a transfer,
   * the cleaned-up folder for a duplicate cleanup).
   */
  path: string;
  /** Folder in the target account; empty for a backup. For a cleanup: where the copies went. */
  target: string | null;
  /** Messages in the source folder. */
  sourceCount: number;
  /** Messages the target holds for this folder after the run (backup only). */
  targetCount: number | null;
  /** Messages transferred; for a cleanup: copies removed. */
  transferred: number;
  skipped: number;
  failed: number;
  /**
   * Sync only: messages that left this source folder and were taken out of its target folder,
   * into the trash or, when they live on in another folder there, out of this one only.
   */
  removed: number;
  /** Set when the folder as a whole could not be processed; the rest of the run went on. */
  error: string | null;
}

export interface Failure {
  folder: string;
  subject: string | null;
  date: string | null;
  reason: string;
}

export interface Report {
  kind: 'backup' | 'restore' | 'migrate' | 'dedupe';
  status: 'completed' | 'cancelled' | 'failed';
  error: RunError | null;
  startedAt: string;
  finishedAt: string;
  folders: FolderReport[];
  totals: {
    messages: number;
    transferred: number;
    skipped: number;
    failed: number;
    /** Sync only: messages taken out of the target, see `FolderReport.removed`. */
    removed: number;
    bytes: number;
    /** Messages found in more than one folder that were stored or uploaded only once. */
    deduplicated: number;
  };
  failures: Failure[];
}
