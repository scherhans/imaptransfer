/** Compresses UIDs into an IMAP sequence set: [1, 2, 3, 7, 9, 10] → "1:3,7,9:10". */
export function toSequenceSet(uids: number[]): string {
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let previous = start;
  for (const uid of sorted.slice(1)) {
    if (previous !== undefined && uid === previous + 1) {
      previous = uid;
      continue;
    }
    if (start !== undefined) ranges.push(start === previous ? String(start) : `${start}:${previous}`);
    start = uid;
    previous = uid;
  }
  if (start !== undefined) ranges.push(start === previous ? String(start) : `${start}:${previous}`);
  return ranges.join(',');
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
