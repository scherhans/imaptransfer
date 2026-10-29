const SYSTEM_FLAGS = new Set(['\\seen', '\\answered', '\\flagged', '\\draft']);
/** `\Recent` cannot be set by a client, `\Deleted` would get the message expunged. */
const DROPPED_FLAGS = new Set(['\\recent', '\\deleted']);

/**
 * Keeps the flags a target folder accepts. Without `permanentFlags` the server did not say
 * what it supports, so everything except the dropped flags is passed on.
 */
export function filterFlags(flags: Iterable<string>, permanentFlags?: Set<string>): string[] {
  const permanent = permanentFlags ? new Set([...permanentFlags].map((flag) => flag.toLowerCase())) : null;
  const keywordsAllowed = !permanent || permanent.has('\\*');
  const result: string[] = [];
  for (const flag of flags) {
    const lower = flag.toLowerCase();
    if (DROPPED_FLAGS.has(lower)) continue;
    if (lower.startsWith('\\')) {
      if (SYSTEM_FLAGS.has(lower) || permanent?.has(lower)) result.push(flag);
    } else if (keywordsAllowed || permanent?.has(lower)) {
      result.push(flag);
    }
  }
  return result;
}

/** All flags of several copies of a message, each once: read, answered or flagged on one counts for all. */
export function mergeFlags(...lists: Iterable<string>[]): string[] {
  const merged = new Map<string, string>();
  for (const list of lists) for (const flag of list) if (!merged.has(flag.toLowerCase())) merged.set(flag.toLowerCase(), flag);
  return [...merged.values()];
}

/** What a sync takes over from the source: read and flagged. Every other flag of the target stays. */
const FOLLOWED = ['\\Seen', '\\Flagged'];

export interface FlagChange {
  add: string[];
  remove: string[];
}

/** How a copy in the target has to change to be read and flagged like the source; null when it is. */
export function followFlags(source: Iterable<string>, target: Iterable<string>): FlagChange | null {
  const wanted = new Set([...source].map((flag) => flag.toLowerCase()));
  const present = new Set([...target].map((flag) => flag.toLowerCase()));
  const add = FOLLOWED.filter((flag) => wanted.has(flag.toLowerCase()) && !present.has(flag.toLowerCase()));
  const remove = FOLLOWED.filter((flag) => !wanted.has(flag.toLowerCase()) && present.has(flag.toLowerCase()));
  return add.length > 0 || remove.length > 0 ? { add, remove } : null;
}

export function sameFlags(a: Iterable<string>, b: Iterable<string>): boolean {
  const left = new Set([...a].map((flag) => flag.toLowerCase()));
  const right = new Set([...b].map((flag) => flag.toLowerCase()));
  return left.size === right.size && [...left].every((flag) => right.has(flag));
}
