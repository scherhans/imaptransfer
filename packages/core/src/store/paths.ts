/** Characters Windows, macOS or Linux do not allow in file names. */
const INVALID_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** Linux and macOS limit a file name to 255 bytes, not characters: 60 emoji are already more. */
function truncateBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

/** Turns any string into a file or folder name that is valid on Windows, macOS and Linux. */
export function safeName(value: string, maxBytes = 200): string {
  let name = value.normalize('NFC').replace(INVALID_CHARACTERS, '_').replace(/\s+/g, ' ').trim();
  name = truncateBytes(name, maxBytes).replace(/[. ]+$/, '');
  if (name === '' || /^\.+$/.test(name)) name = '_';
  if (RESERVED_NAMES.test(name)) name = `_${name}`;
  return name;
}

/** Relative directory for an IMAP folder, one directory level per folder level. */
export function folderDirectory(path: string, delimiter: string): string {
  const segments = (delimiter ? path.split(delimiter) : [path]).filter((segment) => segment.length > 0);
  return (segments.length > 0 ? segments : ['_']).map((segment) => safeName(segment)).join('/');
}

function datePart(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return '0000-00-00';
  return date.toISOString().slice(0, 10);
}

/** `2024-05-03_Subject of the mail_3f2a9c01b4.eml`: sorted by date, readable, unique. */
export function messageFileName(input: { date: Date | null; subject: string | null; fingerprint: string; hashLength?: number }): string {
  // At most 120 bytes of subject: with date, hash and extension the name stays far below 255.
  const subject = safeName(input.subject ?? '', 120);
  const hash = input.fingerprint.slice(0, input.hashLength ?? 10);
  return `${datePart(input.date)}_${subject === '_' ? 'no-subject' : subject}_${hash}.eml`;
}

/** Adds " (2)", " (3)" … to the last path segment until `isTaken` says the name is free. */
export function uniquePath(candidate: string, isTaken: (path: string) => boolean): string {
  if (!isTaken(candidate)) return candidate;
  for (let counter = 2; ; counter++) {
    const next = `${candidate} (${counter})`;
    if (!isTaken(next)) return next;
  }
}
