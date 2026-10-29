import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { conflictOf } from '../../src/errors.ts';
import { exportMbox, toMboxEntry } from '../../src/mbox.ts';
import { BackupStore } from '../../src/store/store.ts';
import type { Report } from '../../src/types.ts';
import { verifyBackup } from '../../src/verify.ts';

const summary = { messageId: '<1@x>', subject: 'Hallo Welt', from: 'a@x', date: '2024-01-02T00:00:00.000Z' };

/** Matches a conflict by its code, the way the window tells conflicts apart. */
const conflict = (code: string, details?: Record<string, string>) => (error: unknown) => {
  const found = conflictOf(error);
  assert.equal(found?.code, code, String(error));
  if (details) assert.deepEqual(found?.details, { ...found?.details, ...details });
  return true;
};

describe('BackupStore', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'imaptransfer-store-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('writes one file per message and links it to several folders', async () => {
    const store = BackupStore.open(directory, { create: true });
    const inbox = store.upsertFolder({ path: 'INBOX', delimiter: '/', specialUse: '\\Inbox', role: 'normal' });
    const work = store.upsertFolder({ path: 'Arbeit', delimiter: '/', specialUse: null, role: 'normal' });
    const saved = await store.writeMessage({
      fingerprint: 'a'.repeat(64),
      folder: inbox,
      uid: 1,
      flags: ['\\Seen'],
      content: Readable.from([Buffer.from('Subject: Hallo Welt\r\n\r\nText\r\n')]),
      internalDate: new Date('2024-01-02T10:00:00Z'),
      summary,
    });
    store.attach(work.id, saved.id, 7, []);
    assert.equal(saved.file, 'INBOX/2024-01-02_Hallo Welt_aaaaaaaaaa.eml');
    assert.equal(readFileSync(store.messagePath(saved), 'utf8'), 'Subject: Hallo Welt\r\n\r\nText\r\n');
    const [message] = store.restorableMessages();
    assert.deepEqual(message?.placements.map((placement) => placement.folder), ['INBOX', 'Arbeit']);
    assert.equal(existsSync(join(directory, 'README.txt')), true);
    store.close();
  });

  it('counts copies of a message in one folder and merges their flags', async () => {
    const store = BackupStore.open(directory, { create: true });
    const important = store.upsertFolder({ path: 'Wichtig', delimiter: '/', specialUse: null, role: 'normal' });
    const saved = await store.writeMessage({ fingerprint: 'c'.repeat(64), folder: important, uid: 1, flags: ['\\Seen'], content: Buffer.from('x'), internalDate: null, summary });
    store.attach(important.id, saved.id, 2, ['\\Flagged']);
    store.attach(important.id, saved.id, 3, ['\\Seen', '\\Answered']);
    const placement = () => store.restorableMessages({ includeRemoved: true })[0]?.placements[0];
    assert.deepEqual([placement()?.copies, placement()?.flags], [3, ['\\Seen', '\\Flagged', '\\Answered']]);

    // A copy deleted in the account only comes back on request, and its flags never override
    // those of the copies that are still there.
    const third = store.activeUids(important.id).get(3);
    assert.ok(third);
    store.markRemoved(third.id);
    assert.deepEqual(store.restorableMessages()[0]?.placements[0]?.copies, 2);
    assert.deepEqual([placement()?.copies, placement()?.flags], [3, ['\\Seen', '\\Flagged']]);
    store.close();
  });

  it('refuses a second writer, takes over a lock nobody touches, and keeps its own lock to itself', () => {
    const first = BackupStore.open(directory, { create: true });
    assert.throws(() => BackupStore.open(directory), conflict('in-use'));
    // A lock from a process that died on another computer: its file stops being touched.
    const lockPath = join(directory, 'imaptransfer.lock');
    writeFileSync(lockPath, JSON.stringify({ pid: 1, host: 'elsewhere', token: 'old' }));
    const stale = new Date(Date.now() - 10 * 60_000);
    utimesSync(lockPath, stale, stale);
    const second = BackupStore.open(directory);
    // The first store must not remove the lock the second one holds now.
    first.close();
    assert.equal(existsSync(lockPath), true);
    second.close();
    assert.equal(existsSync(lockPath), false);
  });

  it('does not create the folders above the backup folder', () => {
    // An external drive that is not plugged in must not get a new full backup on the system disk.
    assert.throws(() => BackupStore.open(join(directory, 'missing', 'backup'), { create: true }), conflict('drive-missing'));
    assert.throws(() => BackupStore.open(join(directory, 'empty')), conflict('no-backup', { directory: join(directory, 'empty') }));
    assert.equal(existsSync(join(directory, 'missing')), false);
    const store = BackupStore.open(join(directory, 'backup'), { create: true });
    store.close();
    assert.equal(existsSync(join(directory, 'backup', 'imaptransfer.db')), true);
  });

  it('keeps removed messages and re-links them after a UID reset', async () => {
    const store = BackupStore.open(directory, { create: true });
    const inbox = store.upsertFolder({ path: 'INBOX', delimiter: '/', specialUse: '\\Inbox', role: 'normal' });
    const saved = await store.writeMessage({ fingerprint: 'b'.repeat(64), folder: inbox, uid: 5, flags: [], content: Buffer.from('x'), internalDate: null, summary });
    store.resetUids(inbox.id);
    store.attach(inbox.id, saved.id, 42, ['\\Seen']);
    assert.equal(store.closeUnmatched(inbox.id), 0);
    assert.deepEqual([...store.activeUids(inbox.id).keys()], [42]);

    const membership = store.activeUids(inbox.id).get(42);
    assert.ok(membership);
    store.markRemoved(membership.id);
    assert.equal(store.restorableMessages().length, 0);
    assert.equal(store.restorableMessages({ includeRemoved: true }).length, 1);
    store.close();
  });

  it('tells what left each folder: deleted or moved, with no copy left there', async () => {
    const store = BackupStore.open(directory, { create: true });
    const inbox = store.upsertFolder({ path: 'INBOX', delimiter: '/', specialUse: '\\Inbox', role: 'normal' });
    const archive = store.upsertFolder({ path: 'Archiv', delimiter: '/', specialUse: null, role: 'normal' });
    const write = (char: string, uid: number) =>
      store.writeMessage({ fingerprint: char.repeat(64), folder: inbox, uid, flags: [], content: Buffer.from(char), internalDate: null, summary });
    const deleted = await write('d', 1);
    const moved = await write('m', 2);
    const copied = await write('k', 3);
    store.attach(inbox.id, copied.id, 4, []);
    store.attach(archive.id, moved.id, 1, []);

    const inboxUids = store.activeUids(inbox.id);
    for (const uid of [1, 2, 3]) {
      const membership = inboxUids.get(uid);
      assert.ok(membership);
      store.markRemoved(membership.id);
    }
    // One of two copies left: the message is still in the folder.
    assert.deepEqual(Object.fromEntries([...store.removedFrom()].map(([folder, ids]) => [folder, [...ids].sort()])), {
      INBOX: [deleted.fingerprint, moved.fingerprint].sort(),
    });
    store.close();
  });

  it('counts a backup run as got through only once it is recorded as completed', () => {
    const store = BackupStore.open(directory, { create: true });
    const run = (status: Report['status']) =>
      ({ kind: 'backup', status, error: null, startedAt: '', finishedAt: '', folders: [], totals: {}, failures: [] }) as unknown as Report;
    assert.equal(store.lastRunCompleted(), false);
    store.beginRun();
    store.recordRun(run('completed'));
    assert.equal(store.lastRunCompleted(), true);
    // A run that crashed before it was recorded leaves its mark.
    store.beginRun();
    assert.equal(store.lastRunCompleted(), false);
    store.recordRun(run('cancelled'));
    assert.equal(store.lastRunCompleted(), false);
    store.close();
  });

  it('closes a folder that disappeared from the account and reopens it when it returns', async () => {
    const store = BackupStore.open(directory, { create: true });
    const old = store.upsertFolder({ path: 'Alt', delimiter: '/', specialUse: null, role: 'normal' });
    await store.writeMessage({ fingerprint: '9'.repeat(64), folder: old, uid: 3, flags: [], content: Buffer.from('x'), internalDate: null, summary });
    assert.equal(store.closeFolder(old.id), 1);
    assert.equal(store.folders()[0]?.removed, true);
    assert.equal(store.restorableMessages().length, 0);
    assert.equal(store.restorableMessages({ includeRemoved: true }).length, 1);
    store.upsertFolder({ path: 'Alt', delimiter: '/', specialUse: null, role: 'normal' });
    assert.equal(store.folders()[0]?.removed, false);
    store.close();
  });

  it('gives folders that only differ in case their own directory', () => {
    const store = BackupStore.open(directory, { create: true });
    const a = store.upsertFolder({ path: 'Work', delimiter: '/', specialUse: null, role: 'normal' });
    const b = store.upsertFolder({ path: 'work', delimiter: '/', specialUse: null, role: 'normal' });
    assert.equal(a.dir, 'Work');
    assert.equal(b.dir, 'work (2)');
    store.close();
  });

  it('refuses a second account once it holds mail, and a second writer', async () => {
    const store = BackupStore.open(directory, { create: true });
    store.claimAccount({ host: 'imap.example.com', user: 'anna@exampel.com' });
    // A typo in the first run must not lock the folder while it is still empty.
    store.claimAccount({ host: 'imap.example.com', user: 'anna@example.com' });
    const inbox = store.upsertFolder({ path: 'INBOX', delimiter: '/', specialUse: '\\Inbox', role: 'normal' });
    await store.writeMessage({ fingerprint: 'f'.repeat(64), folder: inbox, uid: 1, flags: [], content: Buffer.from('x'), internalDate: null, summary });
    assert.throws(
      () => store.claimAccount({ host: 'imap.example.com', user: 'bert@example.com' }),
      conflict('other-account', { user: 'anna@example.com', account: 'bert@example.com' }),
    );
    writeFileSync(join(directory, 'imaptransfer.lock'), JSON.stringify({ pid: 1, host: 'other-machine' }), { flag: 'w' });
    assert.throws(() => BackupStore.open(directory), conflict('in-use'));
    store.close();
  });

  it('finds damaged and missing files', async () => {
    const store = BackupStore.open(directory, { create: true });
    const inbox = store.upsertFolder({ path: 'INBOX', delimiter: '/', specialUse: '\\Inbox', role: 'normal' });
    const one = await store.writeMessage({ fingerprint: 'c'.repeat(64), folder: inbox, uid: 1, flags: [], content: Buffer.from('one'), internalDate: null, summary });
    const two = await store.writeMessage({ fingerprint: 'd'.repeat(64), folder: inbox, uid: 2, flags: [], content: Buffer.from('two'), internalDate: null, summary: { ...summary, subject: 'Zwei' } });
    store.close();
    writeFileSync(join(directory, 'mail', one.file), 'changed');
    rmSync(join(directory, 'mail', two.file));
    const report = await verifyBackup(directory);
    assert.deepEqual(report.damaged, [one.file]);
    assert.deepEqual(report.missing, [two.file]);
  });

  it('exports folders as mbox files', async () => {
    const store = BackupStore.open(directory, { create: true });
    const inbox = store.upsertFolder({ path: 'INBOX', delimiter: '/', specialUse: '\\Inbox', role: 'normal' });
    await store.writeMessage({ fingerprint: 'e'.repeat(64), folder: inbox, uid: 1, flags: ['\\Seen'], content: Buffer.from('Subject: a\r\n\r\nFrom here\r\n'), internalDate: new Date('2024-01-02T03:04:05Z'), summary });
    store.close();
    const out = join(directory, 'export');
    const report = await exportMbox(directory, out);
    assert.equal(report.messages, 1);
    assert.equal(readFileSync(join(out, 'INBOX.mbox'), 'latin1'), 'From MAILER-DAEMON Tue Jan  2 03:04:05 2024\nStatus: RO\nSubject: a\n\n>From here\n\n');
  });
});

describe('toMboxEntry', () => {
  it('keeps 8-bit content byte for byte', () => {
    const content = Buffer.from('Subject: ü\r\n\r\n>From x\r\n', 'utf8');
    const entry = toMboxEntry(content, { date: null, seen: false });
    assert.equal(Buffer.from(entry, 'latin1').toString('utf8'), 'From MAILER-DAEMON Thu Jan  1 00:00:00 1970\nSubject: ü\n\n>>From x\n\n');
  });
});
