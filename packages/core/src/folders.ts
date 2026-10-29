import type { ImapFlow, ListResponse } from 'imapflow';
import type { FolderInfo, FolderRole } from './types.ts';

export interface ListedFolder extends FolderInfo {
  selectable: boolean;
  /** Number of messages, when the listing asked for it. */
  messages: number | null;
  /** Server status, when the listing asked for counts: tells unchanged folders apart cheaply. */
  uidNext: number | null;
  uidValidity: string | null;
}

/** Account-wide facts that folder mapping depends on. */
export interface AccountLayout {
  folders: ListedFolder[];
  /** Personal namespace prefix, e.g. `INBOX.` on Courier or Cyrus servers. */
  prefix: string;
  delimiter: string;
  gmail: boolean;
  uidplus: boolean;
}

export interface FolderMapping {
  source: string;
  target: string;
  /** The target folder already exists; otherwise it is created. */
  exists: boolean;
  role: FolderRole;
}

const MAPPED_SPECIAL_USES = new Set(['\\Sent', '\\Drafts', '\\Trash', '\\Junk', '\\Archive']);
const SORT_ORDER = ['\\Inbox', null, '\\Sent', '\\Drafts', '\\Archive', '\\Junk', '\\Trash'];

export function folderFromListEntry(entry: ListResponse): ListedFolder {
  const flags = new Set([...entry.flags].map((flag) => flag.toLowerCase()));
  // Only trust the server, never a guess from the folder name: a user folder called
  // "Starred" or "All" holds real messages and must not be skipped.
  const markedByServer = entry.specialUseSource === 'extension';
  let specialUse = entry.specialUse ?? null;
  let role: FolderRole = 'normal';
  if (entry.path.toUpperCase() === 'INBOX') {
    specialUse = '\\Inbox';
  } else if (flags.has('\\important')) {
    specialUse = '\\Important';
    role = 'view';
  } else if (markedByServer && specialUse === '\\Flagged') {
    role = 'view';
  } else if (markedByServer && specialUse === '\\All') {
    role = 'all';
  }
  return {
    path: entry.path,
    delimiter: entry.delimiter ?? '',
    specialUse,
    role,
    selectable: !flags.has('\\noselect') && !flags.has('\\nonexistent'),
    messages: entry.status?.messages ?? null,
    uidNext: entry.status?.uidNext ?? null,
    uidValidity: entry.status?.uidValidity?.toString() ?? null,
  };
}

export async function readLayout(client: ImapFlow, options: { counts?: boolean } = {}): Promise<AccountLayout> {
  const entries = await client.list(options.counts ? { statusQuery: { messages: true, uidNext: true, uidValidity: true } } : undefined);
  const folders = entries.map(folderFromListEntry);
  return {
    folders,
    prefix: client.namespace?.prefix ?? '',
    delimiter: client.namespace?.delimiter || folders.find((folder) => folder.delimiter)?.delimiter || '/',
    gmail: client.capabilities.has('X-GM-EXT-1'),
    uidplus: client.capabilities.has('UIDPLUS'),
  };
}

export async function listFolders(client: ImapFlow): Promise<ListedFolder[]> {
  return (await client.list()).map(folderFromListEntry);
}

function sortRank(folder: FolderInfo): number {
  if (folder.role === 'all') return SORT_ORDER.length;
  const index = folder.specialUse ? SORT_ORDER.indexOf(folder.specialUse) : -1;
  return index === -1 ? SORT_ORDER.indexOf(null) : index;
}

/**
 * Inbox first, then the user's folders, then the special folders and finally "All Mail". A
 * message that is in several folders gets stored under the first one, so its file lands in a
 * real folder and not in the "All Mail" view.
 */
export function sortFolders<T extends FolderInfo>(folders: T[]): T[] {
  return [...folders].sort((a, b) => sortRank(a) - sortRank(b) || a.path.localeCompare(b.path));
}

/** Folders whose messages are transferred: selectable and not a mere view of other folders. */
export function transferableFolders<T extends FolderInfo & { selectable?: boolean }>(folders: T[], exclude: string[] = []): T[] {
  const excluded = new Set(exclude);
  return sortFolders(folders.filter((folder) => folder.selectable !== false && folder.role !== 'view' && !excluded.has(folder.path)));
}

function relativeSegments(folder: FolderInfo, source: Pick<AccountLayout, 'prefix' | 'gmail'>): string[] {
  let path = folder.path;
  if (source.prefix && path.startsWith(source.prefix)) path = path.slice(source.prefix.length);
  let segments = (folder.delimiter ? path.split(folder.delimiter) : [path]).filter((segment) => segment.length > 0);
  if (source.gmail && segments.length > 1 && /^\[(gmail|google mail)\]$/i.test(segments[0] ?? '')) {
    segments = segments.slice(1);
  }
  return segments;
}

function joinTargetPath(segments: string[], target: Pick<AccountLayout, 'prefix' | 'delimiter'>): string {
  const delimiter = target.delimiter;
  let parts = segments.map((segment) => (delimiter ? segment.split(delimiter).join('_') : segment));
  // Avoid "INBOX.INBOX.x" when the target nests everything below the inbox anyway.
  if (target.prefix && parts.length > 1 && target.prefix.toUpperCase() === `INBOX${delimiter}` && parts[0]?.toUpperCase() === 'INBOX') {
    parts = parts.slice(1);
  }
  return target.prefix + parts.join(delimiter || '/');
}

/**
 * Folder names as a server compares them: many (Exchange, Gmail, Dovecot on a case-insensitive
 * disk) treat "Projects" and "projects" as the same folder, and some normalize Unicode.
 */
export function folderKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

/** Decides for every source folder where its messages go in the target account. */
export function mapFolders(
  sourceFolders: FolderInfo[],
  source: Pick<AccountLayout, 'prefix' | 'gmail'>,
  target: AccountLayout,
): FolderMapping[] {
  const existing = new Map(target.folders.filter((folder) => folder.selectable).map((folder) => [folderKey(folder.path), folder.path]));
  const findSpecial = (specialUse: string) =>
    target.folders.find((folder) => folder.selectable && folder.specialUse === specialUse);
  const folders = sortFolders(sourceFolders).filter((folder) => folder.role !== 'view');

  // Special folders go to their counterpart in the target, whatever it is called there.
  const usedSpecialUses = new Set<string>();
  const remapped = new Map<string, string>();
  for (const folder of folders) {
    if (folder.role === 'all') {
      const all = target.folders.find((candidate) => candidate.selectable && candidate.role === 'all');
      remapped.set(folder.path, all?.path ?? findSpecial('\\Archive')?.path ?? joinTargetPath(['Archive'], target));
    } else if (folder.specialUse && MAPPED_SPECIAL_USES.has(folder.specialUse) && !usedSpecialUses.has(folder.specialUse)) {
      usedSpecialUses.add(folder.specialUse);
      const counterpart = findSpecial(folder.specialUse);
      if (counterpart) remapped.set(folder.path, counterpart.path);
    }
  }

  // Subfolders move along with their parent: "Sent/2023" becomes "Gesendet/2023".
  const fromRemappedParent = (folder: FolderInfo): string | null => {
    let best: string | null = null;
    for (const parent of remapped.keys()) {
      if (folder.delimiter && folder.path.startsWith(parent + folder.delimiter) && (!best || parent.length > best.length)) best = parent;
    }
    if (!best) return null;
    const rest = folder.path.slice(best.length + folder.delimiter.length).split(folder.delimiter);
    const delimiter = target.delimiter || '/';
    return [remapped.get(best), ...rest.map((segment) => segment.split(delimiter).join('_'))].join(delimiter);
  };

  return folders.map((folder) => {
    const targetPath =
      folder.specialUse === '\\Inbox'
        ? 'INBOX'
        : (remapped.get(folder.path) ?? fromRemappedParent(folder) ?? joinTargetPath(relativeSegments(folder, source), target));
    // A folder the target has in another spelling is that folder, in the target's spelling.
    const listed = targetPath.toUpperCase() === 'INBOX' ? 'INBOX' : existing.get(folderKey(targetPath));
    return { source: folder.path, target: listed ?? targetPath, exists: listed !== undefined, role: folder.role };
  });
}
