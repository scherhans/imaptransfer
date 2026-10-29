import type { ImapFlow, MailboxObject } from 'imapflow';
import { ConflictError, classifyError, connectionLost, describeError } from './errors.ts';
import { isFetchAnswer } from './fetching.ts';
import { filterFlags, mergeFlags } from './flags.ts';
import { FINGERPRINT_HEADERS, fingerprint, summarizeHeaders, type HeaderSummary } from './fingerprint.ts';
import { readLayout, transferableFolders, type AccountLayout, type ListedFolder } from './folders.ts';
import { Job, RepeatableProgress } from './job.ts';
import { chunk } from './sequence.ts';
import { Session } from './session.ts';
import type { AccountConfig, FolderInfo, JobOptions, Report } from './types.ts';

/** Trash and spam: their mail is on its way out, a cleanup or a sync leaves it be. */
const TRASH_AND_SPAM = new Set(['\\Trash', '\\Junk']);
/**
 * The same by name. A server without SPECIAL-USE marks at most one folder per kind, and an
 * account can hold two ("Deleted Items" from Outlook, "Trash" from Thunderbird): leaving a
 * folder alone by mistake costs nothing, cleaning up a trash folder would surprise.
 */
const TRASH_AND_SPAM_NAMES =
  /^(?:trash|deleted(?: items| messages)?|papierkorb|gelöscht(?:e)?(?: elemente| objekte)?|corbeille|poubelle|éléments supprimés|cestino|papelera|elementos eliminados|prullenbak|verwijderde items|lixeira|itens excluídos|junk(?: e-?mail)?|spam|unerwünscht|courrier indésirable|posta indesiderata|correo no deseado|ongewenste e-?mail|lixo eletrônico|bulk mail)$/i;
/** Drafts change all the time; a cleanup leaves their copies alone. */
const DRAFT_NAMES = /^(?:drafts?|entwürfe|brouillons|bozze|borradores|concepten|rascunhos)$/i;

const lastName = (folder: Pick<FolderInfo, 'path' | 'delimiter'>) =>
  (folder.delimiter ? (folder.path.split(folder.delimiter).at(-1) ?? folder.path) : folder.path).trim();

/** A trash or spam folder, marked by the server or only named so. */
export function isTrashOrSpam(folder: Pick<FolderInfo, 'path' | 'delimiter' | 'specialUse'>): boolean {
  return TRASH_AND_SPAM.has(folder.specialUse ?? '') || TRASH_AND_SPAM_NAMES.test(lastName(folder));
}

function isDrafts(folder: Pick<FolderInfo, 'path' | 'delimiter' | 'specialUse'>): boolean {
  return folder.specialUse === '\\Drafts' || DRAFT_NAMES.test(lastName(folder));
}

/** A message a folder holds several times, as a test run lists it. */
export interface DuplicateMessage {
  subject: string | null;
  from: string | null;
  /** Value of the Date header as an ISO string, if it can be read. */
  date: string | null;
  size: number;
  /** Copies in the folder, the one that stays included. */
  copies: number;
}

export interface DuplicateFolder {
  path: string;
  messages: number;
  /** Copies that would be removed; one of each stays. */
  duplicates: number;
  /** Further versions of a message: the same headers, but another size. They are left alone. */
  similar: number;
  /** Every message with copies, oldest first. */
  duplicated: DuplicateMessage[];
}

export type DuplicateProblem = 'no-trash' | 'no-safe-delete';

export interface DuplicatePlan {
  folders: DuplicateFolder[];
  duplicates: number;
  similar: number;
  /** Where removed copies go; null only with a `problem`. */
  trash: string | null;
  gmail: boolean;
  /** Why the account cannot be cleaned up safely, if it cannot. */
  problem: DuplicateProblem | null;
}

export interface DedupeOptions extends JobOptions {
  /** Folders to leave as they are. */
  excludeFolders?: string[];
}

/** Why a cleanup cannot run, for people. */
export const DUPLICATE_PROBLEMS: Record<DuplicateProblem, string> = {
  'no-trash': 'The account has no trash folder to put the copies into.',
  'no-safe-delete':
    'The server can neither move nor delete single messages (no MOVE, no UIDPLUS): removing copies could also remove other messages marked as deleted.',
};

interface Copy {
  uid: number;
  flags: string[];
  size: number;
}

interface CopyGroup<T extends Copy = Copy> {
  keep: T;
  remove: T[];
}

/** A message of the folder as read for the search; the headers themselves are not kept. */
interface Row extends Copy {
  id: string;
  summary: HeaderSummary;
}

interface FolderCopies {
  messages: number;
  groups: CopyGroup<Row>[];
  similar: number;
}

export interface Removal {
  trash: string | null;
  problem: DuplicateProblem | null;
}

/**
 * Where removed copies go: into the trash, from where they can be brought back for a while.
 * That holds in Gmail too; deleting from a label instead could be final there, depending on
 * the account's settings.
 */
export function removalFor(layout: AccountLayout, client: Pick<ImapFlow, 'capabilities'>): Removal {
  const trash = layout.folders.find((folder) => folder.selectable && folder.specialUse === '\\Trash')?.path ?? null;
  if (!trash) return { trash: null, problem: 'no-trash' };
  // Without MOVE, imapflow copies, flags as deleted and expunges; without UIDPLUS that expunge
  // would also remove other messages someone marked as deleted.
  const safe = client.capabilities.has('MOVE') || client.capabilities.has('UIDPLUS');
  return { trash, problem: safe ? null : 'no-safe-delete' };
}

export function cleanableFolders(layout: Pick<AccountLayout, 'folders'>, exclude: string[] = []): ListedFolder[] {
  return transferableFolders(layout.folders, exclude).filter((folder) => folder.role === 'normal' && !isTrashOrSpam(folder) && !isDrafts(folder));
}

/**
 * Exact copies among the messages of a folder: the same fingerprint and the same size. The
 * oldest copy of each stays. A message with the same headers but another size is another
 * version (an attachment removed, a footer added) and is never touched.
 */
export function findCopies<T extends Copy & { id: string }>(rows: T[]): { groups: CopyGroup<T>[]; similar: number } {
  const byId = new Map<string, T[]>();
  for (const row of rows) byId.set(row.id, [...(byId.get(row.id) ?? []), row]);
  const groups: CopyGroup<T>[] = [];
  let similar = 0;
  for (const same of byId.values()) {
    if (same.length < 2) continue;
    const bySize = new Map<number, T[]>();
    for (const copy of same) bySize.set(copy.size, [...(bySize.get(copy.size) ?? []), copy]);
    similar += bySize.size - 1;
    for (const copies of bySize.values()) {
      const [keep, ...remove] = [...copies].sort((a, b) => a.uid - b.uid);
      if (keep && remove.length > 0) groups.push({ keep, remove });
    }
  }
  return { groups, similar };
}

/** Reads the open folder and finds its copies. */
async function readCopies(client: ImapFlow, progress?: RepeatableProgress): Promise<FolderCopies> {
  if ((client.mailbox as MailboxObject).exists === 0) return { messages: 0, groups: [], similar: 0 };
  const rows: Row[] = [];
  const seen = new Set<number>();
  for await (const message of client.fetch('1:*', { uid: true, flags: true, size: true, internalDate: true, headers: FINGERPRINT_HEADERS }, { uid: true })) {
    if (!isFetchAnswer(message, { headers: true }) || seen.has(message.uid)) continue;
    seen.add(message.uid);
    const headers = message.headers ?? Buffer.alloc(0);
    rows.push({
      id: fingerprint({ headers, size: message.size, internalDate: message.internalDate }),
      uid: message.uid,
      flags: [...(message.flags ?? [])],
      size: message.size ?? 0,
      summary: summarizeHeaders(headers),
    });
    progress?.advance();
  }
  return { messages: rows.length, ...findCopies(rows) };
}

const copiesIn = (found: FolderCopies) => found.groups.reduce((sum, group) => sum + group.remove.length, 0);

/** The messages with copies, readable for a person checking the test run. */
function describeCopies(found: FolderCopies): DuplicateMessage[] {
  return found.groups
    .map((group) => {
      const { summary } = group.keep;
      return { subject: summary.subject, from: summary.from, date: summary.date, size: group.keep.size, copies: group.remove.length + 1 };
    })
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

/**
 * The test run: finds copies of the same message within one folder and lists them, without
 * changing anything in the account. It reports its progress folder by folder and message by
 * message, and stops when the signal says so.
 */
export async function findDuplicates(account: AccountConfig, options: DedupeOptions = {}): Promise<DuplicatePlan> {
  const job = new Job('dedupe', options);
  const session = new Session(account, job);
  try {
    job.emit({ type: 'phase', phase: 'connect' });
    const client = await session.connect();
    const layout = await readLayout(client, { counts: true });
    const { trash, problem } = removalFor(layout, client);
    const candidates = cleanableFolders(layout, options.excludeFolders).filter((folder) => folder.messages !== 0);
    job.emit({ type: 'phase', phase: 'scan' });
    job.setTotal(candidates.reduce((sum, folder) => sum + (folder.messages ?? 0), 0));
    const folders: DuplicateFolder[] = [];
    for (const [index, folder] of candidates.entries()) {
      job.throwIfAborted();
      job.emit({ type: 'folder', path: folder.path, index, count: candidates.length });
      const progress = new RepeatableProgress(job);
      try {
        const found = await session.run(async (imap) => {
          progress.restart();
          const lock = await imap.getMailboxLock(folder.path, { readOnly: true });
          try {
            return await readCopies(imap, progress);
          } finally {
            lock.release();
          }
        });
        folders.push({ path: folder.path, messages: found.messages, duplicates: copiesIn(found), similar: found.similar, duplicated: describeCopies(found) });
      } catch (error) {
        // A folder the server refuses is left out here; a cleanup reports it.
        if (classifyError(error) !== 'other') throw error;
      } finally {
        // The listing's count may differ from what the folder held by now.
        progress.complete(folder.messages ?? 0);
      }
    }
    job.emit({ type: 'phase', phase: 'finish' });
    return {
      folders,
      duplicates: folders.reduce((sum, folder) => sum + folder.duplicates, 0),
      similar: folders.reduce((sum, folder) => sum + folder.similar, 0),
      trash,
      gmail: layout.gmail,
      problem,
    };
  } finally {
    await session.close();
  }
}

/**
 * Removes copies of the same message within one folder, as an interrupted sync or a migration
 * run twice leaves them behind. Only exact copies go, one of each stays and gets the read,
 * answered and flagged state of all of them. Copies go to the trash (in Gmail: lose the label
 * of the folder), so they can be brought back.
 */
export async function removeDuplicates(account: AccountConfig, options: DedupeOptions = {}): Promise<Report> {
  const job = new Job('dedupe', options);
  const session = new Session(account, job);
  let failure: unknown;
  try {
    job.emit({ type: 'phase', phase: 'connect' });
    const client = await session.connect();
    const layout = await readLayout(client, { counts: true });
    const removal = removalFor(layout, client);
    if (removal.problem || removal.trash === null) throw new ConflictError(DUPLICATE_PROBLEMS[removal.problem ?? 'no-trash'], { code: removal.problem ?? 'no-trash', details: {} });
    const trash = removal.trash;
    const folders = cleanableFolders(layout, options.excludeFolders);
    job.setTotal(folders.reduce((sum, folder) => sum + (folder.messages ?? 0), 0));

    job.emit({ type: 'phase', phase: 'clean' });
    for (const [index, folder] of folders.entries()) {
      job.throwIfAborted();
      job.emit({ type: 'folder', path: folder.path, index, count: folders.length });
      const progress = new RepeatableProgress(job);
      const first = { messages: null as number | null };
      try {
        await session.run((imap) => cleanFolder(imap, folder.path, trash, job, progress, first));
      } catch (error) {
        // One folder the server refuses must not keep the others from being cleaned up.
        if (classifyError(error) !== 'other') throw error;
        job.folderFailed(folder.path, `The folder could not be cleaned up: ${describeError(error)}`, 0);
        progress.complete(folder.messages ?? 0);
      }
    }
    job.emit({ type: 'phase', phase: 'finish' });
  } catch (error) {
    failure = error;
  }
  const report = job.finish(failure);
  await session.close();
  return report;
}

/**
 * Cleans up one folder. Safe to repeat after a reconnect: the copies the interrupted attempt
 * already removed are gone, the rest is found again. `first` keeps what the first attempt saw.
 */
async function cleanFolder(
  client: ImapFlow,
  path: string,
  trash: string,
  job: Job,
  progress: RepeatableProgress,
  first: { messages: number | null },
): Promise<void> {
  progress.restart();
  const lock = await client.getMailboxLock(path);
  try {
    const found = await readCopies(client, progress);
    first.messages ??= found.messages;
    const total = first.messages;
    // What an interrupted attempt already removed is no longer in the folder.
    const gone = Math.max(0, total - found.messages);
    let removed = 0;
    const report = job.folder(path, trash);
    report.sourceCount = total;
    const count = () => {
      report.transferred = gone + removed;
      report.skipped = Math.max(0, total - report.transferred);
    };
    count();

    // The copy that stays first gets the flags of all of them: nothing read, answered or
    // flagged gets lost when the others go.
    const permanent = (client.mailbox as MailboxObject).permanentFlags;
    const additions = new Map<string, number[]>();
    for (const group of found.groups) {
      const kept = new Set(group.keep.flags.map((flag) => flag.toLowerCase()));
      const missing = filterFlags(mergeFlags(...group.remove.map((copy) => copy.flags)), permanent).filter((flag) => !kept.has(flag.toLowerCase()));
      if (missing.length === 0) continue;
      const key = JSON.stringify(missing.sort());
      additions.set(key, [...(additions.get(key) ?? []), group.keep.uid]);
    }
    for (const [key, uids] of additions) {
      const done = await client.messageFlagsAdd(uids, JSON.parse(key) as string[], { uid: true });
      if (!done) {
        if (!client.usable) throw connectionLost('STORE');
        throw new Error('The server did not accept the flags for the copies that stay');
      }
    }

    for (const part of chunk(found.groups.flatMap((group) => group.remove.map((copy) => copy.uid)), 500)) {
      job.throwIfAborted();
      const done = await client.messageMove(part, trash, { uid: true });
      if (!done) {
        if (!client.usable) throw connectionLost('MOVE');
        throw new Error('The server refused to move the copies to the trash');
      }
      removed += part.length;
      count();
    }
    progress.complete(total);
  } finally {
    lock.release();
  }
}
