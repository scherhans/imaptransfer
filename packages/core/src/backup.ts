import type { Readable } from 'node:stream';
import type { FetchMessageObject, ImapFlow, MailboxObject } from 'imapflow';
import { classifyError, connectionLost, describeError } from './errors.ts';
import { downloadChunkSize, fetchAnswers, isFetchAnswer } from './fetching.ts';
import { sameFlags } from './flags.ts';
import { FINGERPRINT_HEADERS, fingerprint, summarizeHeaders, type HeaderSummary } from './fingerprint.ts';
import { readLayout, transferableFolders, type ListedFolder } from './folders.ts';
import { Job, RepeatableProgress } from './job.ts';
import { chunk, toSequenceSet } from './sequence.ts';
import { Session } from './session.ts';
import { BackupStore, type StoredFolder } from './store/store.ts';
import type { AccountConfig, JobOptions, Report } from './types.ts';

const FETCH_BATCH = 250;

export interface BackupOptions extends JobOptions {
  /** Source folder paths to leave out. */
  excludeFolders?: string[];
}

/** New messages of one folder that still have to be downloaded, as planned before the transfer. */
interface PlannedWork {
  messages: number;
  bytes: number;
}

/** What happened to one folder across all attempts; a reconnect repeats the folder. */
interface FolderTally {
  progress: RepeatableProgress;
  downloaded: Set<number>;
  failed: Map<number, { reason: string; summary: HeaderSummary }>;
  planned: PlannedWork;
}

/**
 * Backs up an account into a folder. The first run downloads everything, every later run only
 * what is new, and it picks up changed flags. Mail deleted on the server stays in the backup.
 * A cancelled or broken run simply continues the next time.
 */
export async function backupAccount(account: AccountConfig, directory: string, options: BackupOptions = {}): Promise<Report> {
  const job = new Job('backup', options);
  const session = new Session(account, job);
  let store: BackupStore | null = null;
  // Set once the backup belongs to this account; a run refused by `claimAccount` must not
  // leave a "failed" entry in somebody else's backup.
  let claimed = false;
  let failure: unknown;
  try {
    // Connect first: a typo in host or user must not leave a backup folder behind.
    job.emit({ type: 'phase', phase: 'connect' });
    const client = await session.connect();
    store = BackupStore.open(directory, { create: true });
    store.claimAccount({ host: account.host, user: account.user });
    claimed = true;
    // Until the run is recorded, the backup may be half way through linking a folder again.
    store.beginRun();
    const activeStore = store;

    job.emit({ type: 'phase', phase: 'scan' });
    const layout = await readLayout(client, { counts: true });
    store.setMeta('source.prefix', layout.prefix);
    store.setMeta('source.gmail', String(layout.gmail));
    const folders = transferableFolders(layout.folders, options.excludeFolders);
    job.setTotal(folders.reduce((sum, folder) => sum + (folder.messages ?? 0), 0));

    // A folder that was deleted or renamed in the account: its mail stays in the backup, but a
    // restore no longer recreates the old folder next to the new one.
    const listed = new Set(layout.folders.map((folder) => folder.path));
    for (const stored of store.folders()) {
      if (!listed.has(stored.path) && store.closeFolder(stored.id) > 0) {
        job.warn('This folder no longer exists in the account; its mail stays in the backup', { folder: stored.path });
      }
    }

    const plan = await planBackup(session, activeStore, folders, job);
    job.addWork(
      [...plan.values()].reduce((sum, work) => sum + work.messages, 0),
      [...plan.values()].reduce((sum, work) => sum + work.bytes, 0),
    );

    job.emit({ type: 'phase', phase: 'transfer' });
    job.startTransferClock();
    for (const [index, folder] of folders.entries()) {
      job.throwIfAborted();
      job.emit({ type: 'folder', path: folder.path, index, count: folders.length });
      const tally: FolderTally = {
        progress: new RepeatableProgress(job),
        downloaded: new Set(),
        failed: new Map(),
        planned: plan.get(folder.path) ?? { messages: 0, bytes: 0 },
      };
      try {
        await session.run((imap) => backupFolder(imap, activeStore, folder, job, tally));
      } catch (error) {
        // One folder the server refuses (no permission, deleted meanwhile, broken message)
        // must not keep every later folder from being backed up, night after night.
        if (classifyError(error) !== 'other') throw error;
        const report = job.folder(folder.path);
        report.sourceCount = folder.messages ?? report.sourceCount;
        report.transferred = tally.downloaded.size;
        job.folderFailed(folder.path, `The folder could not be backed up: ${describeError(error)}`, Math.max(0, report.sourceCount - report.transferred));
        tally.progress.complete(folder.messages ?? 0);
      } finally {
        // Whatever the plan expected and did not happen (messages stored once for several
        // folders, failures) no longer counts as work still to do.
        job.reduceWork(tally.planned.messages, tally.planned.bytes);
        tally.planned.messages = 0;
        tally.planned.bytes = 0;
      }
    }
    job.emit({ type: 'phase', phase: 'finish' });
  } catch (error) {
    failure = error;
  }
  const report = job.finish(failure);
  await session.close();
  if (store) {
    try {
      if (claimed) store.recordRun(report);
    } catch (error) {
      // A full disk must not keep the lock: the next run would be refused until the app restarts.
      job.warn(`The run could not be recorded in the backup: ${describeError(error)}`);
    } finally {
      store.close();
    }
  }
  return report;
}

/**
 * Counts what is new before anything is downloaded, as the base of the time estimate. A folder
 * whose UIDNEXT did not move since its last complete backup holds nothing new and is not even
 * opened. In Gmail the same message under several labels counts once (X-GM-MSGID).
 */
async function planBackup(session: Session, store: BackupStore, folders: ListedFolder[], job: Job): Promise<Map<string, PlannedWork>> {
  const plan = new Map<string, PlannedWork>();
  const counted = new Set<string>();
  for (const [index, folder] of folders.entries()) {
    job.throwIfAborted();
    const work: PlannedWork = { messages: 0, bytes: 0 };
    plan.set(folder.path, work);
    const stored = store.folderByPath(folder.path);
    const sameNumbering = stored !== undefined && stored.uidValidity !== null && stored.uidValidity === folder.uidValidity;
    const knownUntil = sameNumbering ? (stored.uidNext ?? 1) : 1;
    if (folder.messages === 0 || (sameNumbering && folder.uidNext !== null && folder.uidNext <= knownUntil)) continue;
    job.emit({ type: 'folder', path: folder.path, index, count: folders.length });
    const known = sameNumbering ? store.activeUids(stored.id) : new Map<number, unknown>();
    try {
      const found = await session.run(async (client) => {
        const result = { messages: 0, bytes: 0, emailIds: new Set<string>() };
        const lock = await client.getMailboxLock(folder.path, { readOnly: true });
        try {
          if ((client.mailbox as MailboxObject).exists === 0) return result;
          // "n:*" also returns the last message when n is beyond it, hence the check below.
          for await (const message of client.fetch(`${knownUntil}:*`, { uid: true, size: true, emailId: true }, { uid: true })) {
            if (!isFetchAnswer(message) || message.uid < knownUntil || known.has(message.uid)) continue;
            if (message.emailId) {
              if (counted.has(message.emailId) || result.emailIds.has(message.emailId) || store.hasEmailId(message.emailId)) continue;
              result.emailIds.add(message.emailId);
            }
            result.messages++;
            result.bytes += message.size ?? 0;
          }
          return result;
        } finally {
          lock.release();
        }
      });
      work.messages = found.messages;
      work.bytes = found.bytes;
      for (const id of found.emailIds) counted.add(id);
    } catch (error) {
      // The backup of this folder reports the problem; the estimate just does without it.
      if (classifyError(error) !== 'other') throw error;
    }
  }
  return plan;
}

/** One planned download is done (or failed): it no longer counts as work still to do. */
function consumePlanned(job: Job, planned: PlannedWork, size: number): void {
  if (planned.messages <= 0) return;
  const bytes = Math.min(planned.bytes, size);
  planned.messages--;
  planned.bytes -= bytes;
  job.reduceWork(1, bytes);
}

async function backupFolder(client: ImapFlow, store: BackupStore, folder: ListedFolder, job: Job, tally: FolderTally): Promise<void> {
  tally.progress.restart();
  const setupStarted = Date.now();
  const lock = await client.getMailboxLock(folder.path, { readOnly: true });
  try {
    const mailbox = client.mailbox as MailboxObject;
    // Everything below this UID is handled by this run; mail arriving meanwhile is next time's.
    const uidNext = mailbox.uidNext;
    const stored = store.upsertFolder(folder);
    const uidValidity = mailbox.uidValidity.toString();
    if (stored.uidValidity !== null && stored.uidValidity !== uidValidity) {
      job.warn('The server renumbered this folder; its messages are matched again by content', { folder: folder.path });
      store.resetUids(stored.id);
    }
    store.setUidValidity(stored.id, uidValidity);

    const onServer = new Map<number, string[]>();
    if (mailbox.exists > 0) {
      for await (const message of client.fetch('1:*', { uid: true, flags: true }, { uid: true })) {
        if (isFetchAnswer(message)) onServer.set(message.uid, [...(message.flags ?? [])]);
      }
    }
    if (folder.messages !== null && folder.messages !== onServer.size) {
      job.addToTotal(onServer.size - folder.messages);
      folder.messages = onServer.size;
    }

    const known = store.activeUids(stored.id);
    store.transaction(() => {
      for (const [uid, membership] of known) {
        const flags = onServer.get(uid);
        if (!flags) store.markRemoved(membership.id);
        else if (!sameFlags(flags, membership.flags)) store.updateFlags(membership.id, flags);
      }
    });

    const fresh = [...onServer.keys()].filter((uid) => !known.has(uid)).sort((a, b) => a - b);
    // Opening the folder and comparing flags belongs to its new messages, not to the next one.
    job.spreadOverhead((Date.now() - setupStarted) / 1000, fresh.length);
    tally.progress.advance(onServer.size - fresh.length);
    for (const uids of chunk(fresh, FETCH_BATCH)) {
      job.throwIfAborted();
      await backupBatch(client, store, stored, uids, job, tally);
    }
    store.closeUnmatched(stored.id);
    // A message that failed is tried again next time: the plan must not skip the folder then.
    const retry = [...tally.failed.keys()].filter((uid) => onServer.has(uid));
    store.setUidNext(stored.id, retry.length > 0 ? Math.min(uidNext, ...retry) : uidNext);

    const report = job.folder(folder.path);
    const failed = [...tally.failed.keys()].filter((uid) => onServer.has(uid)).length;
    report.sourceCount = onServer.size;
    report.transferred = [...tally.downloaded].filter((uid) => onServer.has(uid)).length;
    report.failed = failed;
    report.skipped = onServer.size - report.transferred - failed;
    report.targetCount = store.activeCount(stored.id);
    for (const { reason, summary } of tally.failed.values()) {
      job.recordFailure({ folder: folder.path, subject: summary.subject, date: summary.date, reason });
    }
  } finally {
    lock.release();
  }
}

const HEADER_QUERY = { uid: true, flags: true, size: true, internalDate: true, emailId: true, headers: FINGERPRINT_HEADERS };
const NO_SUMMARY: HeaderSummary = { messageId: null, subject: null, from: null, date: null };

/**
 * Fetches the headers of a batch. When the server refuses the FETCH because of one broken
 * message (Dovecot "[SERVERBUG]", Exchange "BAD"), the batch is halved until that message
 * stands alone and fails alone, instead of taking the whole folder down night after night.
 */
export async function fetchHeaders(client: ImapFlow, uids: number[]): Promise<{ rows: FetchMessageObject[]; broken: { uid: number; reason: string }[] }> {
  try {
    const rows = await client.fetchAll(toSequenceSet(uids), HEADER_QUERY, { uid: true });
    return { rows: fetchAnswers(rows, { headers: true, uids: new Set(uids) }), broken: [] };
  } catch (error) {
    if (classifyError(error) !== 'other') throw error;
    const [single] = uids;
    if (uids.length === 1 && single !== undefined) return { rows: [], broken: [{ uid: single, reason: describeError(error) }] };
    const half = Math.ceil(uids.length / 2);
    const first = await fetchHeaders(client, uids.slice(0, half));
    const second = await fetchHeaders(client, uids.slice(half));
    return { rows: [...first.rows, ...second.rows], broken: [...first.broken, ...second.broken] };
  }
}

async function backupBatch(
  client: ImapFlow,
  store: BackupStore,
  folder: StoredFolder,
  uids: number[],
  job: Job,
  tally: FolderTally,
): Promise<void> {
  const fetchStarted = Date.now();
  const { rows: messages, broken } = await fetchHeaders(client, uids);
  const fail = (uid: number, reason: string, summary: HeaderSummary) => {
    tally.failed.set(uid, { reason, summary });
    job.warn(reason, { folder: folder.path, subject: summary.subject });
    consumePlanned(job, tally.planned, 0);
    tally.progress.advance();
  };
  for (const { uid, reason } of broken) fail(uid, `The server could not deliver this message: ${reason}`, NO_SUMMARY);

  // A message the server listed but did not answer with headers: deleted meanwhile, or an
  // item the server cannot serve. Counted as present it would never show up in any report.
  const answered = new Set([...messages.map((message) => message.uid), ...broken.map((entry) => entry.uid)]);
  for (const uid of uids.filter((candidate) => !answered.has(candidate))) {
    const still = await client.fetchOne(String(uid), { uid: true, flags: true }, { uid: true });
    if (!still || !isFetchAnswer(still)) {
      consumePlanned(job, tally.planned, 0);
      tally.progress.advance();
    } else fail(uid, 'The server returned no headers for this message', NO_SUMMARY);
  }

  // Messages the backup already holds from another folder (Gmail labels): only link them.
  const pending = store.transaction(() =>
    messages.flatMap((message) => {
      const headers = message.headers ?? Buffer.alloc(0);
      const id = fingerprint({ headers, size: message.size, internalDate: message.internalDate });
      const flags = [...(message.flags ?? [])];
      const existing = store.findMessage(id);
      if (!existing) return [{ message, headers, id, flags }];
      store.attach(folder.id, existing.id, message.uid, flags);
      job.countDeduplicated();
      tally.progress.advance();
      return [];
    }),
  );
  // One FETCH brought the headers of the whole batch: its time belongs to all downloads in it.
  job.spreadOverhead((Date.now() - fetchStarted) / 1000, pending.length);

  for (const { message, headers, id, flags } of pending) {
    job.throwIfAborted();
    const duplicate = store.findMessage(id);
    if (duplicate) {
      store.attach(folder.id, duplicate.id, message.uid, flags);
      job.countDeduplicated();
      tally.progress.advance();
      continue;
    }
    const summary = summarizeHeaders(headers);
    const size = message.size ?? 0;
    const progress = job.trackMessage('download', summary.subject, size);
    let content: Readable | undefined;
    try {
      const download = await client.download(String(message.uid), undefined, { uid: true, chunkSize: downloadChunkSize(size) });
      if (!download.content) {
        // imapflow answers with nothing once the connection is gone, too: that must repeat the
        // folder, not count the rest of the batch as deleted meanwhile.
        if (!client.usable || !client.mailbox) throw connectionLost('FETCH');
        // Deleted in the account while the backup ran: nothing lost, nothing to do.
        consumePlanned(job, tally.planned, size);
        tally.progress.advance();
        continue;
      }
      content = download.content;
      const internalDate = message.internalDate ? new Date(message.internalDate) : null;
      const saved = await store.writeMessage({
        fingerprint: id,
        folder,
        uid: message.uid,
        flags,
        content,
        internalDate,
        summary,
        emailId: message.emailId ?? null,
        onProgress: (bytes) => progress?.update(bytes),
      });
      tally.downloaded.add(message.uid);
      tally.failed.delete(message.uid);
      job.recordTransfer(saved.size);
      consumePlanned(job, tally.planned, saved.size);
      tally.progress.advance(1, saved.size);
    } catch (error) {
      // A download nobody read to the end would keep imapflow waiting for a reader.
      content?.destroy();
      const kind = classifyError(error);
      // Connection trouble repeats the whole folder, a full disk ends the run; anything else
      // only loses this message.
      if (kind !== 'other') throw error;
      fail(message.uid, describeError(error), summary);
    } finally {
      progress?.finish();
    }
  }
}
