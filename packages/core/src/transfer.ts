import { createHash } from 'node:crypto';
import type { ImapFlow, MailboxObject } from 'imapflow';
import { isTrashOrSpam, removalFor, type DuplicateProblem } from './dedupe.ts';
import { ConflictError, classifyError, connectionLost, describeError } from './errors.ts';
import { downloadChunkSize, fetchAnswers, isFetchAnswer } from './fetching.ts';
import { filterFlags, followFlags, mergeFlags, sameFlags, type FlagChange } from './flags.ts';
import { FINGERPRINT_HEADERS, fingerprint, summarizeHeaders } from './fingerprint.ts';
import { folderKey, listFolders, mapFolders, readLayout, transferableFolders, type AccountLayout, type FolderMapping } from './folders.ts';
import { Job, type MessageProgress } from './job.ts';
import { chunk } from './sequence.ts';
import { Session } from './session.ts';
import { BackupStore } from './store/store.ts';
import { SyncMemory } from './sync-memory.ts';
import type { AccountConfig, FolderInfo, JobOptions, Report } from './types.ts';
import { meterUpload } from './upload-meter.ts';

const COPY_FLUSH_SIZE = 200;

type Locator = { kind: 'file'; file: string; sha256: string } | { kind: 'imap'; folder: string; uid: number; uidValidity: string };

/** A source folder that holds a message, and how often: an interrupted sync can leave copies. */
export interface SourcePlacement {
  folder: string;
  flags: string[];
  copies: number;
}

export interface TransferMessage {
  fingerprint: string;
  placements: SourcePlacement[];
  internalDate: Date | null;
  size: number;
  subject: string | null;
  date: string | null;
  locator: Locator;
}

interface TransferSource {
  prefix: string;
  gmail: boolean;
  folders: FolderInfo[];
  messages: TransferMessage[];
  /** Whether loading a message means downloading it, worth showing for large ones. */
  remote: boolean;
  /**
   * Per source folder, the fingerprints of messages that were in it and are not any more:
   * deleted or moved elsewhere. Only a sync uses it; empty when nothing is known.
   */
  departed: Map<string, Set<string>>;
  /**
   * Source folders whose content this run does not know for sure: a folder that could not be
   * read, or one the last backup run did not get through. A sync leaves their target folders as
   * they are, because a folder it cannot see must never look empty.
   */
  uncertain: FolderInfo[];
  load(message: TransferMessage, onProgress?: (bytes: number) => void): Promise<Buffer>;
  close(): Promise<void>;
}

export interface TargetPlacement {
  path: string;
  flags: string[];
  /** Source folders whose copies of the message end up here. */
  sources: { folder: string; copies: number }[];
  /** Copies the target folder should hold: as many as the fullest source folder. */
  copies: number;
}

interface PresentMessage {
  uid: number;
  flags: string[];
}

/** Copies one target folder still lacks, and what became of them so far. */
interface Need {
  placement: TargetPlacement;
  /** Copies the target already held before. */
  present: number;
  missing: number;
  created: number;
}

interface CopyRequest {
  from: string;
  uid: number;
  anchorFlags: string[];
  need: Need;
  /** How many copies of the message this request makes in the target folder. */
  count: number;
  message: TransferMessage;
}

export interface RestoreOptions extends JobOptions {
  /** Backup folders to leave out. */
  excludeFolders?: string[];
  /** Also restore mail that was deleted in the account after it had been backed up. */
  includeRemoved?: boolean;
  /**
   * Sync the account with the backup, in one direction: what was deleted or moved in the backed-up
   * account after it had been backed up leaves the target too, and read/flagged state follows the
   * backup. Mail the backup never held stays. Not together with `includeRemoved`.
   */
  sync?: boolean;
}

export interface MigrateOptions extends JobOptions {
  /** Source folders to leave out. */
  excludeFolders?: string[];
  /**
   * Sync the target with the source, in one direction: what left the source since an earlier run
   * leaves the target too, and read/flagged state follows the source. Needs `memory`.
   */
  sync?: boolean;
  /**
   * File in which migrations of this pair of accounts remember what each source folder held, so
   * that a sync can tell what left it. A run without sync only adds to the memory.
   */
  memory?: string;
}

/** Why a sync into an account, or from a backup, is not possible. */
export type SyncProblem = DuplicateProblem | 'sync-gmail' | 'backup-incomplete';

/** Why a sync cannot run, for people. */
export const SYNC_PROBLEMS: Record<SyncProblem, string> = {
  'no-trash': 'The target account has no trash folder; a sync puts the mail it takes out there.',
  'no-safe-delete':
    'The target server can neither move nor delete single messages (no MOVE, no UIDPLUS): taking mail out could also remove other messages marked as deleted.',
  'sync-gmail': 'The target is Gmail, where a folder is a label: a sync could take a message out of labels it still has.',
  'backup-incomplete':
    'The last backup did not run to the end. A sync needs a complete backup, or it would take mail for deleted that is still in the account; run the backup once to the end.',
};

export interface TransferPlan {
  mappings: (FolderMapping & { messages: number })[];
  messages: number;
  /** Restore only: messages deleted in the account since the backup, left out unless asked for. */
  removed: number;
  /** `syncProblem`: why a sync into the target is not possible, if it is not. */
  target: { gmail: boolean; uidplus: boolean; syncProblem: SyncProblem | null };
  /**
   * Whether a sync can tell what left the source: a backup always can, a migration once an
   * earlier run of the same two accounts left its memory.
   */
  history: boolean;
}

/** The fingerprints each source folder holds. */
function heldBy(messages: TransferMessage[]): Map<string, Set<string>> {
  const held = new Map<string, Set<string>>();
  for (const message of messages) {
    for (const placement of message.placements) {
      let fingerprints = held.get(placement.folder);
      if (!fingerprints) {
        fingerprints = new Set();
        held.set(placement.folder, fingerprints);
      }
      fingerprints.add(message.fingerprint);
    }
  }
  return held;
}

/**
 * What a sync takes out of each target folder: the messages that left a source folder mapped
 * there, unless another source folder mapped there still holds them. Target folders in
 * `untouched` (trash, spam) keep everything.
 */
export function plannedRemovals(
  mappings: Pick<FolderMapping, 'source' | 'target'>[],
  held: Map<string, Set<string>>,
  departed: Map<string, Set<string>>,
  untouched: Set<string>,
): Map<string, { fingerprints: Set<string>; sources: string[] }> {
  const sourcesOf = new Map<string, string[]>();
  for (const mapping of mappings) sourcesOf.set(mapping.target, [...(sourcesOf.get(mapping.target) ?? []), mapping.source]);
  const removals = new Map<string, { fingerprints: Set<string>; sources: string[] }>();
  for (const [target, sources] of sourcesOf) {
    if (untouched.has(target)) continue;
    const stillHeld = new Set(sources.flatMap((source) => [...(held.get(source) ?? [])]));
    const leaving = new Set<string>();
    for (const source of sources) for (const id of departed.get(source) ?? []) if (!stillHeld.has(id)) leaving.add(id);
    if (leaving.size > 0) removals.set(target, { fingerprints: leaving, sources });
  }
  return removals;
}

/** Uploads a backup into an account. Mail that is already there is skipped. */
export async function restoreBackup(directory: string, target: AccountConfig, options: RestoreOptions = {}): Promise<Report> {
  const job = new Job('restore', options);
  let source: TransferSource | null = null;
  let failure: unknown;
  const targetSession = new Session(target, job);
  try {
    if (options.sync && options.includeRemoved) throw new Error('A sync takes deleted mail out of the account, so it cannot restore deleted mail at the same time');
    source = openBackupSource(directory, options);
    await transfer(source, targetSession, job, options.sync ?? false);
  } catch (error) {
    failure = error;
  }
  await source?.close();
  await targetSession.close();
  return job.finish(failure);
}

/** Copies every folder of one account into another, directly from server to server. */
export async function migrateAccount(from: AccountConfig, to: AccountConfig, options: MigrateOptions = {}): Promise<Report> {
  const job = new Job('migrate', options);
  const sourceSession = new Session(from, job);
  const targetSession = new Session(to, job);
  let source: TransferSource | null = null;
  let memory: SyncMemory | null = null;
  let failure: unknown;
  try {
    if (options.sync && !options.memory) throw new Error('A sync needs the memory of earlier runs (the memory option)');
    if (options.memory) {
      memory = SyncMemory.open(options.memory, { source: from, target: to });
      if (memory.reset) job.warn('The sync memory belonged to other accounts and starts afresh: this run takes nothing out of the target');
    }
    job.emit({ type: 'phase', phase: 'connect' });
    await sourceSession.connect();
    await targetSession.connect();
    source = await scanAccount(sourceSession, job, options.excludeFolders);
    const held = heldBy(source.messages);
    // Only folders that could be read count: a folder missing from the scan is not empty.
    const seen = new Map(source.folders.map((folder) => [folder.path, memory?.seen(folder.path) ?? new Set<string>()]));
    for (const [folder, before] of seen) source.departed.set(folder, new Set([...before].filter((id) => !held.get(folder)?.has(id))));
    const { settled } = await transfer(source, targetSession, job, options.sync ?? false);
    if (memory) {
      // What the target has caught up with is forgotten; what a sync could not take out of the
      // target yet, or what a run without sync left there, stays known for the next sync.
      const remembered = new Map<string, Set<string>>();
      for (const [folder, before] of seen) {
        const now = held.get(folder) ?? new Set<string>();
        remembered.set(folder, settled.has(folder) ? now : new Set([...before, ...now]));
      }
      memory.remember(remembered);
    }
  } catch (error) {
    failure = error;
  }
  memory?.close();
  await source?.close();
  await Promise.all([sourceSession.close(), targetSession.close()]);
  return job.finish(failure);
}

/** Shows where every folder of a backup would go, without changing anything. */
export async function planRestore(
  directory: string,
  target: AccountConfig,
  options: Pick<RestoreOptions, 'excludeFolders' | 'includeRemoved'> = {},
): Promise<TransferPlan> {
  const source = openBackupSource(directory, options);
  try {
    // After an account was emptied, the next backup counts all of its mail as deleted there. The
    // plan must say how much a restore leaves out, or the backup looks empty.
    let removed = 0;
    if (!options.includeRemoved) {
      const everything = openBackupSource(directory, { ...options, includeRemoved: true });
      removed = everything.messages.length - source.messages.length;
      await everything.close();
    }
    const plan = await planFor(source.folders, source, countPlacements(source.messages), target);
    if (!lastBackupCompleted(directory)) plan.target.syncProblem = 'backup-incomplete';
    return { ...plan, removed, history: true };
  } finally {
    await source.close();
  }
}

/** Shows where every folder of an account would go, without changing anything. */
export async function planMigration(
  from: AccountConfig,
  to: AccountConfig,
  options: Pick<MigrateOptions, 'excludeFolders' | 'memory'> = {},
): Promise<TransferPlan> {
  const job = new Job('migrate', {});
  const session = new Session(from, job);
  try {
    const layout = await readLayout(await session.connect(), { counts: true });
    const folders = transferableFolders(layout.folders, options.excludeFolders);
    const counts = new Map(folders.map((folder) => [folder.path, folder.messages ?? 0]));
    const history = options.memory ? SyncMemory.knows(options.memory, { source: from, target: to }) : false;
    return { ...(await planFor(folders, layout, counts, to)), removed: 0, history };
  } finally {
    await session.close();
  }
}

async function planFor(
  folders: FolderInfo[],
  source: Pick<AccountLayout, 'prefix' | 'gmail'>,
  counts: Map<string, number>,
  target: AccountConfig,
): Promise<Omit<TransferPlan, 'removed' | 'history'>> {
  const session = new Session(target, new Job('restore', {}));
  try {
    const client = await session.connect();
    const layout = await readLayout(client);
    const mappings = mapFolders(folders, source, layout).map((mapping) => ({ ...mapping, messages: counts.get(mapping.source) ?? 0 }));
    // A trash the transfer creates (from the source's trash) counts: the run checks again once it is there.
    const createsTrash = mappings.some((mapping) => !mapping.exists && folders.find((folder) => folder.path === mapping.source)?.specialUse === '\\Trash');
    let syncProblem = syncProblemOf(layout, client);
    if (syncProblem === 'no-trash' && createsTrash) syncProblem = null;
    return {
      mappings,
      messages: mappings.reduce((sum, mapping) => sum + mapping.messages, 0),
      target: { gmail: layout.gmail, uidplus: layout.uidplus, syncProblem },
    };
  } finally {
    await session.close();
  }
}

/** Why a sync into this account cannot run, or null. */
function syncProblemOf(layout: AccountLayout, client: Pick<ImapFlow, 'capabilities'>): SyncProblem | null {
  if (layout.gmail) return 'sync-gmail';
  return removalFor(layout, client).problem;
}

/** Whether the last run into the backup got through, so the backup knows what left the account. */
function lastBackupCompleted(directory: string): boolean {
  const store = BackupStore.open(directory, { readOnly: true });
  try {
    return store.lastRunCompleted();
  } finally {
    store.close();
  }
}

const syncRefused = (problem: SyncProblem) => new ConflictError(SYNC_PROBLEMS[problem], { code: problem, details: {} });

/** Messages per source folder, every copy counted. */
function countPlacements(messages: TransferMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    for (const placement of message.placements) counts.set(placement.folder, (counts.get(placement.folder) ?? 0) + placement.copies);
  }
  return counts;
}

function openBackupSource(directory: string, options: Pick<RestoreOptions, 'excludeFolders' | 'includeRemoved' | 'sync'>): TransferSource {
  const store = BackupStore.open(directory, { readOnly: true });
  try {
    const excluded = new Set(options.excludeFolders ?? []);
    const includeRemoved = options.includeRemoved ?? false;
    const candidates = store.folders().filter((folder) => folder.role !== 'view' && !excluded.has(folder.path));
    const included = new Set(candidates.map((folder) => folder.path));
    const messages = store
      .restorableMessages({ includeRemoved })
      .map((message): TransferMessage => ({
        fingerprint: message.fingerprint,
        placements: message.placements
          .filter((placement) => included.has(placement.folder))
          .map(({ folder, flags, copies }) => ({ folder, flags, copies })),
        internalDate: message.internalDate ? new Date(message.internalDate) : null,
        size: message.size,
        subject: message.subject,
        date: message.headerDate,
        locator: { kind: 'file', file: message.file, sha256: message.sha256 },
      }))
      .filter((message) => message.placements.length > 0);
    // A folder that is gone from the account is only recreated when its old mail is wanted.
    const withMail = countPlacements(messages);
    const folders = candidates.filter((folder) => !folder.removed || (includeRemoved && withMail.has(folder.path)));
    // What left a folder that the source still has. A folder gone from the account is not part
    // of the transfer, and its target folder stays as it is.
    const kept = new Set(folders.map((folder) => folder.path));
    let departed = new Map<string, Set<string>>();
    let uncertain: FolderInfo[] = [];
    if (options.sync) {
      // An interrupted backup has not linked every message again yet: what it did not get to
      // would count as deleted. A folder the last run did not get through counts as unknown.
      const last = store.lastRunReport();
      if (!last || !store.lastRunCompleted()) throw syncRefused('backup-incomplete');
      const unsure = new Set(last.folders.filter((folder) => folder.error !== null || folder.failed > 0).map((folder) => folder.path));
      uncertain = folders.filter((folder) => unsure.has(folder.path));
      departed = new Map([...store.removedFrom()].filter(([folder]) => kept.has(folder) && !unsure.has(folder)));
    }
    return {
      prefix: store.getMeta('source.prefix') ?? '',
      gmail: store.getMeta('source.gmail') === 'true',
      folders,
      messages,
      remote: false,
      departed,
      uncertain,
      async load(message) {
        if (message.locator.kind !== 'file') throw new Error('Unexpected message locator');
        const content = await store.readMessage(message.locator);
        if (createHash('sha256').update(content).digest('hex') !== message.locator.sha256) {
          throw new Error('The file in the backup is damaged (checksum mismatch)');
        }
        return content;
      },
      async close() {
        store.close();
      },
    };
  } catch (error) {
    store.close();
    throw error;
  }
}

interface ScannedMessage {
  id: string;
  uid: number;
  flags: string[];
  internalDate: Date | null;
  size: number;
  subject: string | null;
  date: string | null;
}

/** Reads the headers of every message in the source account and groups them by fingerprint. */
async function scanAccount(session: Session, job: Job, excludeFolders: string[] = []): Promise<TransferSource> {
  job.emit({ type: 'phase', phase: 'scan' });
  const layout = await readLayout(await session.connect(), { counts: true });
  const candidates = transferableFolders(layout.folders, excludeFolders);
  const folders: FolderInfo[] = [];
  const unreadable: FolderInfo[] = [];
  const byFingerprint = new Map<string, TransferMessage>();

  for (const [index, folder] of candidates.entries()) {
    job.throwIfAborted();
    job.emit({ type: 'folder', path: folder.path, index, count: candidates.length });
    let found: { rows: ScannedMessage[]; uidValidity: string };
    try {
      found = await session.run(async (client) => {
        const lock = await client.getMailboxLock(folder.path, { readOnly: true });
        try {
          const mailbox = client.mailbox as MailboxObject;
          const rows: ScannedMessage[] = [];
          const result = { rows, uidValidity: mailbox.uidValidity.toString() };
          if (mailbox.exists === 0) return result;
          const seen = new Set<number>();
          // Streamed and reduced to what is needed: folders can hold a million messages.
          for await (const message of client.fetch('1:*', { uid: true, flags: true, size: true, internalDate: true, headers: FINGERPRINT_HEADERS }, { uid: true })) {
            if (!isFetchAnswer(message, { headers: true }) || seen.has(message.uid)) continue;
            seen.add(message.uid);
            const headers = message.headers ?? Buffer.alloc(0);
            const summary = summarizeHeaders(headers);
            rows.push({
              id: fingerprint({ headers, size: message.size, internalDate: message.internalDate }),
              uid: message.uid,
              flags: [...(message.flags ?? [])],
              internalDate: message.internalDate ? new Date(message.internalDate) : null,
              size: message.size ?? 0,
              subject: summary.subject,
              date: summary.date,
            });
          }
          return result;
        } finally {
          lock.release();
        }
      });
    } catch (error) {
      if (classifyError(error) !== 'other') throw error;
      job.folderFailed(folder.path, `The folder could not be read: ${describeError(error)}`, folder.messages ?? 0);
      unreadable.push(folder);
      continue;
    }
    folders.push(folder);
    for (const row of found.rows) {
      const existing = byFingerprint.get(row.id);
      if (existing) {
        // Another copy in the same folder counts as such; in another folder it is a placement.
        const placement = existing.placements.find((candidate) => candidate.folder === folder.path);
        if (placement) {
          placement.copies++;
          placement.flags = mergeFlags(placement.flags, row.flags);
        } else {
          existing.placements.push({ folder: folder.path, flags: row.flags, copies: 1 });
        }
        continue;
      }
      byFingerprint.set(row.id, {
        fingerprint: row.id,
        placements: [{ folder: folder.path, flags: row.flags, copies: 1 }],
        internalDate: row.internalDate,
        size: row.size,
        subject: row.subject,
        date: row.date,
        locator: { kind: 'imap', folder: folder.path, uid: row.uid, uidValidity: found.uidValidity },
      });
    }
  }

  // Reading message by message keeps one folder open until the next one is needed.
  let open: { client: ImapFlow; path: string; release: () => void } | null = null;
  return {
    prefix: layout.prefix,
    gmail: layout.gmail,
    folders,
    messages: [...byFingerprint.values()],
    remote: true,
    departed: new Map(),
    uncertain: unreadable,
    load: (message, onProgress) =>
      session.run(async (client) => {
        const locator = message.locator;
        if (locator.kind !== 'imap') throw new Error('Unexpected message locator');
        if (!open || open.client !== client || open.path !== locator.folder) {
          if (open?.client === client) open.release();
          const lock = await client.getMailboxLock(locator.folder, { readOnly: true });
          open = { client, path: locator.folder, release: () => lock.release() };
        }
        // A server that renumbered the folder since it was read says so with a new UIDVALIDITY:
        // the same UID may now be another message, and that must never be uploaded.
        if ((client.mailbox as MailboxObject).uidValidity.toString() !== locator.uidValidity) throw sourceChanged();
        const download = await client.download(String(locator.uid), undefined, { uid: true, chunkSize: downloadChunkSize(message.size) });
        if (!download.content) {
          // imapflow answers with nothing once the connection is gone, too: retry, not fail.
          if (!client.usable || !client.mailbox) throw connectionLost('FETCH');
          throw new Error('The message disappeared from the source account');
        }
        const chunks: Buffer[] = [];
        let received = 0;
        for await (const chunk of download.content) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          chunks.push(buffer);
          received += buffer.length;
          onProgress?.(received);
        }
        const content = Buffer.concat(chunks);
        if (!(await isScannedMessage(client, locator.uid, message, content))) throw sourceChanged();
        return content;
      }),
    async close() {
      open?.release();
      open = null;
    },
  };
}

const sourceChanged = () => new Error('The message changed in the source account after it was read; run the migration again');

/**
 * Whether a downloaded message is the one the scan saw under its UID. Not every server changes
 * UIDVALIDITY when a folder is recreated (GreenMail keeps it within the same second), so the
 * content is checked too. Some servers send the requested header fields re-encoded (GreenMail
 * turns UTF-8 into Latin-1) while the full message keeps its bytes: on a mismatch, the header
 * fields are read again the way the scan read them.
 */
async function isScannedMessage(client: ImapFlow, uid: number, message: TransferMessage, content: Buffer): Promise<boolean> {
  // Size and date as the scan saw them: some servers report a size that differs from the bytes.
  const known = { size: message.size, internalDate: message.internalDate ?? undefined };
  if (fingerprint({ headers: content, ...known }) === message.fingerprint) return true;
  const rows = await client.fetchAll(String(uid), { uid: true, size: true, headers: FINGERPRINT_HEADERS }, { uid: true });
  const [again] = fetchAnswers(rows, { headers: true, uids: new Set([uid]) });
  return again !== undefined && fingerprint({ headers: again.headers ?? Buffer.alloc(0), ...known }) === message.fingerprint;
}

/** Every message of the open folder with its fingerprint, oldest first. */
async function readFolder(client: ImapFlow): Promise<(PresentMessage & { id: string })[]> {
  const rows: (PresentMessage & { id: string })[] = [];
  if ((client.mailbox as MailboxObject).exists === 0) return rows;
  const seen = new Set<number>();
  for await (const message of client.fetch('1:*', { uid: true, flags: true, size: true, internalDate: true, headers: FINGERPRINT_HEADERS }, { uid: true })) {
    if (!isFetchAnswer(message, { headers: true }) || seen.has(message.uid)) continue;
    seen.add(message.uid);
    const id = fingerprint({ headers: message.headers ?? Buffer.alloc(0), size: message.size, internalDate: message.internalDate });
    rows.push({ id, uid: message.uid, flags: [...(message.flags ?? [])] });
  }
  return rows;
}

/** What the target account already holds, per folder: every copy of a message, keyed by fingerprint. */
class TargetIndex {
  private readonly present = new Map<string, Map<string, PresentMessage[]>>();
  private readonly permanentFlags = new Map<string, Set<string> | undefined>();

  async scan(client: ImapFlow, path: string): Promise<void> {
    // SELECT, not EXAMINE: only a writable folder reports the flags it accepts.
    const lock = await client.getMailboxLock(path);
    try {
      this.permanentFlags.set(path, (client.mailbox as MailboxObject).permanentFlags);
      const messages = new Map<string, PresentMessage[]>();
      for (const { id, uid, flags } of await readFolder(client)) messages.set(id, [...(messages.get(id) ?? []), { uid, flags }]);
      this.present.set(path, messages);
    } finally {
      lock.release();
    }
  }

  /** Every copy of the message in the folder, oldest first. */
  all(path: string, fingerprintValue: string): PresentMessage[] {
    return this.present.get(path)?.get(fingerprintValue) ?? [];
  }

  count(path: string, fingerprintValue: string): number {
    return this.all(path, fingerprintValue).length;
  }

  /** A copy this run made. */
  add(path: string, fingerprintValue: string, entry: PresentMessage): void {
    let messages = this.present.get(path);
    if (!messages) {
      messages = new Map();
      this.present.set(path, messages);
    }
    messages.set(fingerprintValue, [...(messages.get(fingerprintValue) ?? []), entry]);
  }

  flagsFor(path: string, flags: string[]): string[] {
    return filterFlags(flags, this.permanentFlags.get(path));
  }
}

/**
 * Where one message goes in the target. `exclusive` are target folders a message cannot share
 * with others: in Gmail, putting a message into Trash or Spam takes it out of every other
 * label, so a copy that lives on elsewhere must not land there too.
 */
export function targetPlacementsOf(
  message: Pick<TransferMessage, 'placements'>,
  mappings: Map<string, FolderMapping>,
  exclusive: Set<string> = new Set(),
  /** Gmail: a folder is a label, and a label cannot hold a message twice. */
  onePerFolder = false,
): { targets: TargetPlacement[]; covered: SourcePlacement[] } {
  const mapped = message.placements.flatMap((placement) => {
    const mapping = mappings.get(placement.folder);
    return mapping ? [{ placement, mapping }] : [];
  });
  // "All Mail" only matters for messages that are in no other folder (archived in Gmail).
  const inRealFolder = mapped.some(({ mapping }) => mapping.role !== 'all');
  const inSharedFolder = mapped.some(({ mapping }) => mapping.role !== 'all' && !exclusive.has(mapping.target));
  const targets = new Map<string, TargetPlacement>();
  const covered: SourcePlacement[] = [];
  for (const { placement, mapping } of mapped) {
    const isExclusive = exclusive.has(mapping.target);
    const redundant =
      (inRealFolder && mapping.role === 'all') ||
      (isExclusive && inSharedFolder) ||
      (isExclusive && [...targets.keys()].some((path) => exclusive.has(path) && path !== mapping.target));
    if (redundant) {
      covered.push(placement);
      continue;
    }
    const source = { folder: placement.folder, copies: placement.copies };
    const copies = onePerFolder ? 1 : placement.copies;
    const existing = targets.get(mapping.target);
    if (existing) {
      // Two source folders that become one: their copies are the same ones, not more, and
      // what is read or flagged in either counts.
      existing.sources.push(source);
      existing.copies = Math.max(existing.copies, copies);
      existing.flags = mergeFlags(existing.flags, placement.flags);
    } else {
      targets.set(mapping.target, { path: mapping.target, flags: placement.flags, sources: [source], copies });
    }
  }
  return { targets: [...targets.values()], covered };
}

/** Errors that stop the whole job; anything else only loses the one message or folder. */
function isFatal(error: unknown): boolean {
  return classifyError(error) !== 'other';
}

/** Parent folders of a path, outermost first: "A.B.C" → "A", "A.B". */
function parentsOf(path: string, delimiter: string): string[] {
  if (!delimiter) return [];
  const segments = path.split(delimiter);
  return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join(delimiter));
}

/**
 * Creates a folder (imapflow subscribes it). Most servers create missing parents on their own;
 * for the others, the parents are created first and the folder is tried again.
 */
export async function ensureFolder(client: Pick<ImapFlow, 'mailboxCreate' | 'list'>, path: string, delimiter: string): Promise<void> {
  try {
    await client.mailboxCreate(path);
  } catch (error) {
    const listed = new Set((await client.list()).map((folder) => folder.path));
    // Not every server answers "already exists" with the standard response code.
    if (listed.has(path)) return;
    const parents = parentsOf(path, delimiter).filter((parent) => !listed.has(parent));
    if (parents.length === 0) throw error;
    for (const parent of parents) await client.mailboxCreate(parent);
    await client.mailboxCreate(path);
  }
}

/**
 * Restore and migration. With `sync`, the target also loses what left the source (see
 * `syncTarget`); the answer names the source folders whose departures the target has caught
 * up with, so a migration's memory can forget them.
 */
async function transfer(source: TransferSource, session: Session, job: Job, sync: boolean): Promise<{ settled: Set<string> }> {
  job.emit({ type: 'phase', phase: 'connect' });
  const client = await session.connect();
  const layout = await readLayout(client);
  // Refused before anything changes. A missing trash is checked once the folders exist: the
  // transfer may bring the source's trash along.
  const problem = sync ? syncProblemOf(layout, client) : null;
  if (problem && problem !== 'no-trash') throw syncRefused(problem);
  const mappingList = mapFolders(source.folders, source, layout);
  const mappings = new Map(mappingList.map((mapping) => [mapping.source, mapping]));
  const exclusive = new Set(
    layout.gmail ? layout.folders.filter((folder) => folder.specialUse === '\\Trash' || folder.specialUse === '\\Junk').map((folder) => folder.path) : [],
  );

  for (const [folder, count] of countPlacements(source.messages)) {
    const mapping = mappings.get(folder);
    if (mapping) job.folder(folder, mapping.target).sourceCount = count;
  }

  // A target folder the server refuses (name not allowed, no permission) fails only the
  // messages meant for it; the other folders go on.
  const broken = new Map<string, string>();
  const breakTarget = (path: string, error: unknown) => {
    const reason = `The target folder ${path} cannot be used: ${describeError(error)}`;
    broken.set(path, reason);
    for (const mapping of mappingList) if (mapping.target === path) job.folder(mapping.source, path).error = reason;
    job.warn(reason, { folder: path });
  };

  // Shorter paths first: creating "A/B" makes many servers create "A" on their own.
  const missingFolders = [...new Set(mappingList.filter((mapping) => !mapping.exists).map((mapping) => mapping.target))].sort(
    (a, b) => a.length - b.length,
  );
  for (const path of missingFolders) {
    job.throwIfAborted();
    try {
      await session.run((client) => ensureFolder(client, path, layout.delimiter));
    } catch (error) {
      if (isFatal(error)) throw error;
      breakTarget(path, error);
    }
  }

  // Every target folder must be there now, and subscribed: Thunderbird, Outlook and others hide
  // a folder that is not. The fresh listing also lets imapflow open the new folders. A server
  // that lists a folder in its own spelling ("projects" for "Projects") gets its spelling used.
  const listed = new Map((await session.run((client) => client.list())).map((folder) => [folderKey(folder.path), folder]));
  for (const path of new Set(mappingList.map((mapping) => mapping.target))) {
    if (broken.has(path)) continue;
    const folder = listed.get(folderKey(path));
    if (!folder) {
      breakTarget(path, new Error('the server does not list it'));
      continue;
    }
    if (folder.path !== path) {
      for (const mapping of mappingList) {
        if (mapping.target !== path) continue;
        mapping.target = folder.path;
        job.folder(mapping.source).target = folder.path;
      }
    }
    if (!folder.subscribed && folder.path !== 'INBOX') {
      const subscribed = await session.run((client) => client.mailboxSubscribe(folder.path));
      if (!subscribed) job.warn('The folder could not be subscribed; some mail programs hide it until you subscribe it yourself', { folder: folder.path });
    }
  }

  let trash: string | null = null;
  if (sync) {
    const removal = await session.run(async (imap) => removalFor({ ...layout, folders: await listFolders(imap) }, imap));
    if (removal.problem || !removal.trash) throw syncRefused(removal.problem ?? 'no-trash');
    trash = removal.trash;
  }
  /** How a sync changes read/flagged state of copies that are already there, per folder and UID. */
  const flagChanges = new Map<string, Map<number, FlagChange>>();

  // In Gmail, putting a message into Trash or Spam takes it out of every other label. A message
  // that lives on in the account ("All Mail" lists it) must therefore not be restored there.
  const allMail = layout.gmail ? (layout.folders.find((folder) => folder.selectable && folder.role === 'all')?.path ?? null) : null;
  const placementsOf = (message: TransferMessage) => targetPlacementsOf(message, mappings, exclusive, layout.gmail);
  const livesOn = (placement: TargetPlacement, fingerprintValue: string): boolean =>
    allMail !== null && exclusive.has(placement.path) && index.count(allMail, fingerprintValue) > 0;

  job.emit({ type: 'phase', phase: 'scan' });
  const index = new TargetIndex();
  const targetPaths = [...new Set(mappingList.map((mapping) => mapping.target))].filter((path) => !broken.has(path));
  const scanPaths = allMail !== null && exclusive.size > 0 && !targetPaths.includes(allMail) ? [...targetPaths, allMail] : targetPaths;
  for (const [position, path] of scanPaths.entries()) {
    job.throwIfAborted();
    job.emit({ type: 'folder', path, index: position, count: scanPaths.length });
    try {
      await session.run((client) => index.scan(client, path));
    } catch (error) {
      if (isFatal(error)) throw error;
      breakTarget(path, error);
    }
  }

  // What has to be uploaded is known now, as the base of the time estimate. Messages that are
  // already in the target, or only need a server-side copy, take next to no time.
  const needsUpload = (message: TransferMessage): boolean => {
    const usable = placementsOf(message).targets.filter((placement) => !broken.has(placement.path) && !livesOn(placement, message.fingerprint));
    const lacking = usable.some((placement) => index.count(placement.path, message.fingerprint) < placement.copies);
    const anchored = usable.some((placement) => index.all(placement.path, message.fingerprint).some((entry) => entry.uid > 0));
    return lacking && !anchored;
  };
  const uploads = source.messages.filter(needsUpload);
  job.addWork(uploads.length, uploads.reduce((sum, message) => sum + message.size, 0));

  job.emit({ type: 'phase', phase: 'transfer' });
  job.setTotal(source.messages.length);
  job.startTransferClock();
  const order = new Map(mappingList.map((mapping, position) => [mapping.source, position]));
  const messages = [...source.messages].sort(
    (a, b) => (order.get(a.placements[0]?.folder ?? '') ?? 0) - (order.get(b.placements[0]?.folder ?? '') ?? 0),
  );
  const copies: CopyRequest[] = [];
  let currentFolder: string | null = null;

  for (const message of messages) {
    job.throwIfAborted();
    const firstFolder = message.placements[0]?.folder ?? null;
    if (firstFolder !== currentFolder && firstFolder !== null) {
      currentFolder = firstFolder;
      job.emit({ type: 'folder', path: firstFolder, index: order.get(firstFolder) ?? 0, count: mappingList.length });
    }
    const { targets, covered } = placementsOf(message);
    for (const placement of covered) job.folder(placement.folder).skipped += placement.copies;
    const needs: Need[] = [];
    let anchor: { path: string; entry: PresentMessage } | null = null;
    for (const placement of targets) {
      if (broken.has(placement.path)) {
        for (const source of placement.sources) job.folder(source.folder).failed += source.copies;
        continue;
      }
      if (livesOn(placement, message.fingerprint)) {
        for (const source of placement.sources) job.folder(source.folder).skipped += source.copies;
        continue;
      }
      const present = index.all(placement.path, message.fingerprint);
      if (sync) {
        for (const entry of present) {
          const change = entry.uid > 0 ? followFlags(placement.flags, entry.flags) : null;
          if (!change) continue;
          let changes = flagChanges.get(placement.path);
          if (!changes) {
            changes = new Map();
            flagChanges.set(placement.path, changes);
          }
          changes.set(entry.uid, change);
        }
      }
      for (const source of placement.sources) {
        // Copies a label cannot hold (Gmail) count as present; so do those already there.
        job.folder(source.folder).skipped += Math.max(0, source.copies - placement.copies) + Math.min(source.copies, placement.copies, present.length);
      }
      const entry = present.find((candidate) => candidate.uid > 0);
      if (entry && !anchor) anchor = { path: placement.path, entry };
      if (present.length < placement.copies) needs.push({ placement, present: present.length, missing: placement.copies - present.length, created: 0 });
    }
    if (needs.length === 0) {
      job.advance();
      continue;
    }

    if (anchor) {
      // Already in the target: server-side copies save the upload, also for further copies in
      // the same folder.
      const from = anchor;
      for (const need of needs) copies.push({ from: from.path, uid: from.entry.uid, anchorFlags: from.entry.flags, need, count: need.missing, message });
    } else {
      await uploadMessage(source, session, index, message, needs, copies, job, layout.uidplus);
      job.reduceWork(1, message.size);
    }
    job.advance();
    if (copies.length >= COPY_FLUSH_SIZE) await flushCopies(copies, session, index, job);
  }
  job.emit({ type: 'phase', phase: 'copy' });
  await flushCopies(copies, session, index, job);
  const settled = trash === null ? new Set<string>() : await syncTarget({ source, session, index, job, layout, mappingList, broken, trash, flagChanges, placementsOf });
  job.emit({ type: 'phase', phase: 'finish' });
  return { settled };
}

/**
 * How the messages that left a source folder leave its target folder: into the trash, from
 * where they can be brought back. One the source no longer holds anywhere goes at once. One that
 * only moved goes once it has arrived at its new place, in a real folder: a view such as "All
 * Mail" may only show the very copy that is about to go. Until then it waits, and the next sync
 * tries again. Nothing is ever expunged: a folder the server does not mark as a view can still
 * be one, and taking a message out of it for good would delete the real message.
 */
export function waysOut(
  leaving: Iterable<string>,
  /** Target folders, other than this one, where the source wants the message now. */
  elsewhere: (id: string) => string[],
  /** Whether the message is in that target folder now, as a real copy. */
  arrived: (folder: string, id: string) => boolean,
): { toTrash: Set<string>; waiting: Set<string> } {
  const ways = { toTrash: new Set<string>(), waiting: new Set<string>() };
  for (const id of leaving) {
    const places = elsewhere(id);
    if (places.length === 0 || places.some((folder) => arrived(folder, id))) ways.toTrash.add(id);
    else ways.waiting.add(id);
  }
  return ways;
}

/**
 * The second half of a sync, after everything new is in the target: read and flagged follow the
 * source, and what left a source folder leaves its target folder for the trash (see `waysOut`). Trash and spam
 * folders of the target keep their mail, so do views, every folder no source folder maps to, and
 * the target folders of source folders whose content is uncertain. Returns the source folders
 * whose departures the target has caught up with.
 */
async function syncTarget(context: {
  source: TransferSource;
  session: Session;
  index: TargetIndex;
  job: Job;
  layout: AccountLayout;
  mappingList: FolderMapping[];
  broken: Map<string, string>;
  trash: string;
  flagChanges: Map<string, Map<number, FlagChange>>;
  placementsOf: (message: TransferMessage) => { targets: TargetPlacement[] };
}): Promise<Set<string>> {
  const { source, session, index, job, layout, mappingList, broken, trash } = context;
  job.emit({ type: 'phase', phase: 'sync' });
  for (const [path, changes] of context.flagChanges) {
    job.throwIfAborted();
    await followSourceFlags(session, path, changes, job);
  }

  const listed = (path: string) => layout.folders.find((folder) => folderKey(folder.path) === folderKey(path));
  const kind = (path: string) => ({ path, delimiter: layout.delimiter, specialUse: listed(path)?.specialUse ?? null });
  // A view in the target, by its own mark: what it shows lives elsewhere. Folders the run
  // created are real folders.
  const isView = (path: string) => (listed(path)?.role ?? 'normal') !== 'normal';
  const unsure = new Set(source.uncertain.map((folder) => folder.path));
  const unsureTargets = new Set(
    [
      ...mappingList.filter((mapping) => unsure.has(mapping.source)),
      ...mapFolders(
        source.uncertain.filter((folder) => !mappingList.some((mapping) => mapping.source === folder.path)),
        source,
        layout,
      ),
    ].map((mapping) => folderKey(mapping.target)),
  );
  const untouched = new Set(
    mappingList
      .filter((mapping) => {
        return (
          mapping.role !== 'normal' ||
          isView(mapping.target) ||
          unsureTargets.has(folderKey(mapping.target)) ||
          mapping.target === trash ||
          isTrashOrSpam(kind(mapping.target))
        );
      })
      .map((mapping) => mapping.target),
  );
  const removals = plannedRemovals(mappingList, heldBy(source.messages), source.departed, untouched);
  // A target folder of an uncertain source folder is left as it is; what left the other source
  // folders mapped there stays remembered for a later sync.
  const settled = new Set(
    mappingList
      .filter((mapping) => !broken.has(mapping.target) && !removals.has(mapping.target) && !unsureTargets.has(folderKey(mapping.target)))
      .map((mapping) => mapping.source),
  );

  const messages = new Map(source.messages.map((message) => [message.fingerprint, message]));
  let position = 0;
  for (const [path, removal] of removals) {
    job.throwIfAborted();
    job.emit({ type: 'folder', path, index: position++, count: removals.size });
    if (broken.has(path)) continue;
    const ways = waysOut(
      removal.fingerprints,
      (id) => {
        const message = messages.get(id);
        return message ? context.placementsOf(message).targets.map((placement) => placement.path).filter((folder) => folder !== path) : [];
      },
      (folder, id) => !broken.has(folder) && !isView(folder) && index.count(folder, id) > 0,
    );
    try {
      const removed = ways.toTrash.size > 0 ? await removeDeparted(session, path, ways.toTrash, trash, job) : 0;
      const first = removal.sources[0];
      if (first) job.folder(first).removed += removed;
      if (ways.waiting.size === 0) for (const folder of removal.sources) settled.add(folder);
    } catch (error) {
      if (isFatal(error)) throw error;
      const reason = `Mail that left the source could not be taken out of ${path}: ${describeError(error)}`;
      for (const folder of removal.sources) job.folder(folder).error ??= reason;
      job.warn(reason, { folder: path });
    }
  }
  return settled;
}

/**
 * Moves messages out of one target folder into the trash. The folder is read again first, and the
 * step is safe to repeat after a reconnect: what is gone stays gone, the rest is found again.
 * Returns how many it moved.
 */
async function removeDeparted(session: Session, path: string, leaving: Set<string>, trash: string, job: Job): Promise<number> {
  // What the first attempt found: a repeat after a reconnect no longer sees what it moved.
  let found: number | null = null;
  await session.run(async (client) => {
    const lock = await client.getMailboxLock(path);
    try {
      const uids = (await readFolder(client)).filter((row) => leaving.has(row.id)).map((row) => row.uid);
      found ??= uids.length;
      for (const part of chunk(uids, 500)) {
        job.throwIfAborted();
        if (!(await client.messageMove(part, trash, { uid: true }))) {
          if (!client.usable) throw connectionLost('MOVE');
          throw new Error('The server refused to move the messages to the trash');
        }
      }
    } finally {
      lock.release();
    }
  });
  return found ?? 0;
}

/** Sets and clears read and flagged on copies already in a target folder; safe to repeat. */
async function followSourceFlags(session: Session, path: string, changes: Map<number, FlagChange>, job: Job): Promise<void> {
  const groups = new Map<string, { change: FlagChange; uids: number[] }>();
  for (const [uid, change] of changes) {
    const key = JSON.stringify([change.add, change.remove]);
    const group = groups.get(key) ?? { change, uids: [] };
    group.uids.push(uid);
    groups.set(key, group);
  }
  try {
    await session.run(async (client) => {
      const lock = await client.getMailboxLock(path);
      try {
        for (const { change, uids } of groups.values()) {
          for (const part of chunk(uids, 500)) {
            const added = change.add.length === 0 || (await client.messageFlagsAdd(part, change.add, { uid: true }));
            const cleared = change.remove.length === 0 || (await client.messageFlagsRemove(part, change.remove, { uid: true }));
            if (added && cleared) continue;
            if (!client.usable) throw connectionLost('STORE');
            throw new Error(`the server did not accept the flags for ${part.length} messages`);
          }
        }
      } finally {
        lock.release();
      }
    });
  } catch (error) {
    if (isFatal(error)) throw error;
    job.warn(`Could not set read/flagged state in ${path}: ${describeError(error)}`, { folder: path });
  }
}

/** Copies a source folder still waits for in this target folder, after what was there before. */
function openCopies(need: Need, source: { copies: number }): number {
  const wanted = Math.min(source.copies, need.placement.copies);
  return wanted - Math.min(wanted, need.present);
}

/** Copies arrived in the target folder: each source folder counts those it was waiting for. */
function credit(job: Job, need: Need, count: number): void {
  for (const source of need.placement.sources) {
    const open = openCopies(need, source);
    job.folder(source.folder).transferred += Math.min(open, need.created + count) - Math.min(open, need.created);
  }
  need.created += count;
}

/** The copies still missing in these target folders will not arrive. */
function failNeeds(job: Job, message: TransferMessage, needs: Need[], reason: string): void {
  for (const need of needs) {
    for (const source of need.placement.sources) {
      const lost = openCopies(need, source) - Math.min(openCopies(need, source), need.created);
      if (lost <= 0) continue;
      job.folder(source.folder).failed += lost;
      job.recordFailure({ folder: source.folder, subject: message.subject, date: message.date, reason });
    }
  }
  job.warn(reason, { folder: needs[0]?.placement.sources[0]?.folder, subject: message.subject });
}

async function uploadMessage(
  source: TransferSource,
  session: Session,
  index: TargetIndex,
  message: TransferMessage,
  needs: Need[],
  copies: CopyRequest[],
  job: Job,
  uidplus: boolean,
): Promise<void> {
  let content: Buffer;
  const downloading = source.remote ? job.trackMessage('download', message.subject, message.size) : null;
  try {
    content = await source.load(message, (bytes) => downloading?.update(bytes));
  } catch (error) {
    if (isFatal(error)) throw error;
    failNeeds(job, message, needs, describeError(error));
    return;
  } finally {
    downloading?.finish();
  }

  // The first folder that takes the message anchors the copies for the others. One folder that
  // refuses it (no right to add mail there) must not cost the message its other folders.
  let first: Need | null = null;
  let firstUid = 0;
  const rest: Need[] = [];
  for (const need of needs) {
    if (first) {
      rest.push(need);
      continue;
    }
    const uid = await appendOnce(session, index, message, need.placement, content, job);
    if (uid === null) {
      failNeeds(job, message, [need], 'The target account rejected the message');
      continue;
    }
    first = need;
    firstUid = uid;
  }
  if (!first) return;
  job.recordTransfer(content.length);
  job.advance(0, content.length);
  credit(job, first, 1);

  // Further copies, in the same folder or in others: server-side where the server says where
  // the upload went, uploaded again where it does not.
  const further = [{ need: first, count: first.missing - 1 }, ...rest.map((need) => ({ need, count: need.missing }))];
  for (const { need, count } of further) {
    if (count <= 0) continue;
    if (uidplus && firstUid > 0) {
      const anchorFlags = index.flagsFor(first.placement.path, first.placement.flags);
      copies.push({ from: first.placement.path, uid: firstUid, anchorFlags, need, count, message });
      continue;
    }
    for (let copy = 0; copy < count; copy++) {
      const uid = await appendOnce(session, index, message, need.placement, content, job);
      if (uid === null) {
        failNeeds(job, message, [need], 'The target account rejected the message');
        break;
      }
      job.advance(0, content.length);
      credit(job, need, 1);
    }
  }
}

/**
 * Appends one copy of a message to a target folder. After a reconnect it first checks whether
 * the interrupted attempt already arrived (the folder holds one copy more than before), so a
 * dropped connection never leaves an extra copy. Returns the new UID (0 when the server does
 * not report it) or null when it was rejected.
 */
async function appendOnce(
  session: Session,
  index: TargetIndex,
  message: TransferMessage,
  placement: TargetPlacement,
  content: Buffer,
  job: Job,
): Promise<number | null> {
  const flags = index.flagsFor(placement.path, placement.flags);
  const before = index.count(placement.path, message.fingerprint);
  const uploading: MessageProgress | null = job.trackMessage('upload', message.subject, content.length);
  try {
    let arrived = false;
    const uid = await session.run(async (client, attempt) => {
      if (attempt > 1) {
        await index.scan(client, placement.path);
        const present = index.all(placement.path, message.fingerprint);
        if (present.length > before) {
          arrived = true;
          return present.at(-1)?.uid ?? 0;
        }
      }
      const detach = uploading ? meterUpload(client, (sent) => uploading.update(sent)) : null;
      let result: Awaited<ReturnType<ImapFlow['append']>>;
      try {
        result = await client.append(placement.path, content, flags, message.internalDate ?? undefined);
      } finally {
        detach?.();
      }
      if (!result) {
        if (!client.usable) throw connectionLost('APPEND');
        throw new Error('The target account rejected the message');
      }
      return result.uid ?? 0;
    });
    // A copy found after a reconnect is in the index already, from the scan.
    if (!arrived) index.add(placement.path, message.fingerprint, { uid, flags });
    return uid;
  } catch (error) {
    if (isFatal(error)) throw error;
    job.warn(describeError(error), { folder: placement.sources[0]?.folder, subject: message.subject });
    return null;
  } finally {
    uploading?.finish();
  }
}

/** Runs the queued server-side copies, grouped by folder, and fixes flags where they differ. */
async function flushCopies(copies: CopyRequest[], session: Session, index: TargetIndex, job: Job): Promise<void> {
  const started = Date.now();
  try {
    await runCopies(copies, session, index, job);
  } finally {
    // Server-side copies are not uploads: their time does not slow down the estimate.
    job.spreadOverhead((Date.now() - started) / 1000, 0);
  }
}

async function runCopies(copies: CopyRequest[], session: Session, index: TargetIndex, job: Job): Promise<void> {
  const pending = copies.splice(0, copies.length);
  const byRoute = new Map<string, CopyRequest[]>();
  for (const request of pending) {
    const key = JSON.stringify([request.from, request.need.placement.path]);
    byRoute.set(key, [...(byRoute.get(key) ?? []), request]);
  }

  for (const group of byRoute.values()) {
    job.throwIfAborted();
    const from = group[0]?.from;
    const to = group[0]?.need.placement.path;
    if (!from || !to) continue;
    // What the target folder held before, to tell this run's copies from older ones.
    const before = new Map(group.map((request) => [request.message.fingerprint, index.all(to, request.message.fingerprint).map((entry) => entry.uid)]));
    // Copies made per request so far: a group that fails half-way still made some.
    const made = new Map<CopyRequest, number>();
    let fixes: { uid: number; flags: string[] }[];
    try {
      fixes = await session.run((client, attempt) => copyGroup(client, attempt, index, from, to, group, before, made));
    } catch (error) {
      if (isFatal(error)) throw error;
      for (const request of group) {
        const count = made.get(request) ?? 0;
        if (count > 0) credit(job, request.need, count);
        failNeeds(job, request.message, [request.need], describeError(error));
      }
      continue;
    }
    for (const request of group) credit(job, request.need, made.get(request) ?? 0);
    if (fixes.length > 0) await fixFlags(session, to, fixes, job);
  }
}

/**
 * One COPY route; returns the copies whose read/flagged state still has to be set. A message
 * that needs several copies in the folder is copied once per round: a UID set names a message
 * only once. `before` holds the UIDs each message had in the target folder before.
 */
async function copyGroup(
  client: ImapFlow,
  attempt: number,
  index: TargetIndex,
  from: string,
  to: string,
  group: CopyRequest[],
  before: Map<string, number[]>,
  made: Map<CopyRequest, number>,
): Promise<{ uid: number; flags: string[] }[]> {
  const fixes = new Map<number, string[]>();
  const wanted = (request: CopyRequest) => index.flagsFor(to, request.need.placement.flags);
  const isNew = (request: CopyRequest, entry: PresentMessage) => entry.uid > 0 && !before.get(request.message.fingerprint)?.includes(entry.uid);
  const count = (request: CopyRequest, copies: number) => made.set(request, copies);
  let todo = group.map((request) => ({ request, remaining: request.count }));
  if (attempt > 1) {
    // The interrupted attempt may have made some of the copies already: count them by content.
    await index.scan(client, to);
    for (const item of todo) {
      const present = index.all(to, item.request.message.fingerprint);
      item.remaining = Math.max(0, item.request.count - (present.length - (before.get(item.request.message.fingerprint)?.length ?? 0)));
      count(item.request, item.request.count - item.remaining);
      for (const entry of present) {
        if (isNew(item.request, entry) && !sameFlags(entry.flags, wanted(item.request))) fixes.set(entry.uid, wanted(item.request));
      }
    }
    todo = todo.filter((item) => item.remaining > 0);
  }

  const unresolved = new Set<CopyRequest>();
  // Copies into the folder itself need it writable; otherwise reading is enough.
  const lock = await client.getMailboxLock(from, { readOnly: from !== to });
  try {
    for (let round = 0; todo.some((item) => item.remaining > round); round++) {
      for (const part of chunk(todo.filter((item) => item.remaining > round), 500)) {
        const result = await client.messageCopy(
          part.map((item) => item.request.uid),
          to,
          { uid: true },
        );
        if (!result) {
          if (!client.usable) throw connectionLost('COPY');
          throw new Error('The target account refused to copy the messages');
        }
        for (const { request } of part) {
          count(request, (made.get(request) ?? 0) + 1);
          const uid = result.uidMap?.get(request.uid);
          if (!uid) {
            unresolved.add(request);
            continue;
          }
          index.add(to, request.message.fingerprint, { uid, flags: wanted(request) });
          if (!sameFlags(wanted(request), request.anchorFlags)) fixes.set(uid, wanted(request));
        }
      }
    }
  } finally {
    lock.release();
  }

  if (unresolved.size > 0) {
    // Without UIDPLUS the server does not say where the copies went: look them up by content.
    await index.scan(client, to);
    for (const request of unresolved) {
      for (const entry of index.all(to, request.message.fingerprint)) {
        if (isNew(request, entry) && !sameFlags(entry.flags, wanted(request))) fixes.set(entry.uid, wanted(request));
      }
    }
  }
  return [...fixes].map(([uid, flags]) => ({ uid, flags }));
}

async function fixFlags(session: Session, path: string, fixes: { uid: number; flags: string[] }[], job: Job): Promise<void> {
  const byFlags = new Map<string, number[]>();
  for (const fix of fixes) {
    const key = JSON.stringify([...fix.flags].sort());
    byFlags.set(key, [...(byFlags.get(key) ?? []), fix.uid]);
  }
  try {
    await session.run(async (client) => {
      const lock = await client.getMailboxLock(path);
      try {
        for (const [key, uids] of byFlags) {
          const done = await client.messageFlagsSet(uids, JSON.parse(key) as string[], { uid: true });
          if (!done) {
            if (!client.usable) throw connectionLost('STORE');
            throw new Error(`the server did not accept the flags for ${uids.length} messages`);
          }
        }
      } finally {
        lock.release();
      }
    });
  } catch (error) {
    if (isFatal(error)) throw error;
    job.warn(`Could not set read/flagged state in ${path}: ${describeError(error)}`, { folder: path });
  }
}
