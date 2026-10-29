import type { FetchMessageObject } from 'imapflow';

/**
 * Whether a FETCH row answers the request. When another mail program changes flags at the same
 * moment, servers slip unsolicited FETCH responses into any command, and imapflow hands them on
 * like answers. They carry flags only; counted as messages, they would turn into a phantom mail
 * without headers that takes over the identity of real ones.
 */
export function isFetchAnswer(message: FetchMessageObject, expected: { headers?: boolean; uids?: Set<number> } = {}): boolean {
  if (!Number.isInteger(message.uid) || message.uid <= 0) return false;
  if (expected.uids && !expected.uids.has(message.uid)) return false;
  if (expected.headers && (message.headers === undefined || typeof message.size !== 'number')) return false;
  return true;
}

/**
 * How much of a message one FETCH asks for. imapflow's default of 64 KB costs one round trip
 * per 64 KB: 800 for a 50 MB attachment. Smaller messages come in one piece, larger ones in
 * 1 MB parts, which also gives the progress of a large message its steps.
 */
export function downloadChunkSize(size: number | undefined): number {
  const minimum = 64 * 1024;
  const maximum = 1024 * 1024;
  if (!size || size <= 0) return minimum;
  return Math.min(maximum, Math.max(minimum, size + 4096));
}

/** Keeps the first answer per UID and drops everything that is not an answer. */
export function fetchAnswers(messages: FetchMessageObject[], expected: { headers?: boolean; uids?: Set<number> }): FetchMessageObject[] {
  const seen = new Set<number>();
  return messages.filter((message) => {
    if (!isFetchAnswer(message, expected) || seen.has(message.uid)) return false;
    seen.add(message.uid);
    return true;
  });
}
