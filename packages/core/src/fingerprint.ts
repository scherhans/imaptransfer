import { createHash } from 'node:crypto';
import libmime from 'libmime';

/** Header fields a fingerprint is built from; fetch exactly these from the server. */
export const FINGERPRINT_HEADERS = ['message-id', 'date', 'from', 'subject'];

export interface HeaderSummary {
  messageId: string | null;
  subject: string | null;
  from: string | null;
  /** Value of the Date header as an ISO string, if it can be parsed. */
  date: string | null;
}

/** Unfolds a header block and returns the first value of every field, keyed by lowercase name. */
export function parseHeaders(raw: Buffer | string): Map<string, string> {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  const end = text.search(/\r?\n\r?\n/);
  const head = (end === -1 ? text : text.slice(0, end)).replace(/\r?\n[ \t]+/g, ' ');
  const headers = new Map<string, string>();
  for (const line of head.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (!headers.has(key)) headers.set(key, line.slice(colon + 1).trim());
  }
  return headers;
}

function collapse(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function decode(value: string): string {
  try {
    return libmime.decodeWords(value);
  } catch {
    return value;
  }
}

function normalizeMessageId(value: string | undefined): string {
  if (!value) return '';
  const bracketed = /<([^>]*)>/.exec(value);
  return collapse(bracketed?.[1] ?? value).toLowerCase();
}

const TIME_ZONE = /(?:[+-]\d{2}:?\d{2}|\b(?:UT|UTC|GMT|Z|[ECMP][SD]T))$/i;

function parseDate(value: string | undefined): number | null {
  if (!value) return null;
  let text = value.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  // Without a zone JavaScript reads local time, which differs between the computer that made
  // the backup and the one that restores it. Mail without a zone is taken as UTC.
  if (!TIME_ZONE.test(text)) text += ' GMT';
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
}

function normalizeDate(value: string | undefined): string {
  const time = parseDate(value);
  return time === null ? collapse(value ?? '') : String(time);
}

function extractAddress(value: string | undefined): string {
  if (!value) return '';
  const decoded = decode(value);
  const address = /<([^>]+)>/.exec(decoded)?.[1] ?? /[^\s<>"',;]+@[^\s<>"',;]+/.exec(decoded)?.[0];
  return collapse(address ?? decoded).toLowerCase();
}

function normalizeSubject(value: string | undefined): string {
  return value ? collapse(decode(value)) : '';
}

/** Arrival time in whole seconds: what every server keeps of an APPEND date. */
function arrivalSecond(value: Date | string | undefined): string {
  if (value === undefined) return '';
  const time = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isNaN(time) ? String(value) : String(Math.floor(time / 1000));
}

/**
 * Identifies a message independently of the server and folder it lives in. Server UIDs are
 * only valid inside one folder on one server, so they cannot recognize a message after a move.
 * The fingerprint survives re-encoding of headers, line folding and different date notations.
 *
 * Without a Message-ID, two different messages from a script or a device can share sender,
 * subject and even the Date header; the arrival time keeps them apart. A restore sets that
 * time explicitly, so it is the same on the target server.
 */
export function fingerprint(input: {
  headers: Buffer | string;
  size?: number | undefined;
  internalDate?: Date | string | undefined;
}): string {
  const headers = parseHeaders(input.headers);
  const messageId = normalizeMessageId(headers.get('message-id'));
  const parts = [messageId, normalizeDate(headers.get('date')), extractAddress(headers.get('from')), normalizeSubject(headers.get('subject'))];
  const identified = parts.join('') !== '';
  if (!messageId) parts.push(arrivalSecond(input.internalDate));
  // Not even a sender or subject: the size is all that is left to tell messages apart.
  if (!identified) parts.push(String(input.size ?? ''));
  return createHash('sha256').update(`v1\n${parts.join('\n')}`).digest('hex');
}

export function summarizeHeaders(raw: Buffer | string): HeaderSummary {
  const headers = parseHeaders(raw);
  const subject = headers.get('subject');
  const from = headers.get('from');
  const time = parseDate(headers.get('date'));
  return {
    messageId: headers.get('message-id') ?? null,
    subject: subject ? collapse(decode(subject)) : null,
    from: from ? collapse(decode(from)) : null,
    date: time === null ? null : new Date(time).toISOString(),
  };
}
