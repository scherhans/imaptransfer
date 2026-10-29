import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import type { ImapFlow } from 'imapflow';
import { backupAccount } from '../../src/backup.ts';
import { migrateAccount, planMigration, planRestore, restoreBackup } from '../../src/transfer.ts';
import type { Report } from '../../src/types.ts';
import { account, mail, plainAccount, seed, snapshot, startProxy, tempDirectory, uniqueUser, withClient, type SnapshotMessage } from './helpers.ts';

const directories: string[] = [];
function directory(): string {
  const path = tempDirectory();
  directories.push(path);
  return path;
}

after(() => {
  for (const path of directories) rmSync(path, { recursive: true, force: true });
});

function assertCompleted(report: Report): void {
  assert.equal(report.status, 'completed', JSON.stringify(report.error ?? report.failures));
  assert.equal(report.totals.failed, 0, JSON.stringify(report.failures));
}

const day = (value: string) => new Date(`${value}T09:30:00Z`);
const message = (id: string, subject: string, date: string, flags: string[] = []) => ({ raw: mail({ id, subject }), flags, internalDate: day(date) });

/** Subjects and flags per folder, the way a person compares two mailboxes. */
async function contents(user: string): Promise<Record<string, string[]>> {
  const describe = (item: SnapshotMessage) => (item.flags.length ? `${item.subject} ${item.flags.join(' ')}` : item.subject);
  return Object.fromEntries(Object.entries(await snapshot(user)).map(([folder, messages]) => [folder, messages.map(describe)]));
}

/** Changes the account the way a mail program would: in one folder, by subject. */
async function change(user: string, folder: string, work: (client: ImapFlow, uidOf: (subject: string) => Promise<number>) => Promise<unknown>): Promise<void> {
  await withClient(user, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const uidOf = async (subject: string) => {
        const [uid] = (await client.search({ subject }, { uid: true })) || [];
        assert.ok(uid, `${subject} in ${folder}`);
        return uid;
      };
      await work(client, uidOf);
    } finally {
      lock.release();
    }
  });
}

/** Deletes one message, moves another to Archiv and marks a third as read, in INBOX. */
async function tidyUp(user: string, subjects: { deleted: string; moved: string; read?: string }): Promise<void> {
  await change(user, 'INBOX', async (client, uidOf) => {
    await client.messageDelete(String(await uidOf(subjects.deleted)), { uid: true });
    await client.messageMove(String(await uidOf(subjects.moved)), 'Archiv', { uid: true });
    if (subjects.read) await client.messageFlagsAdd(String(await uidOf(subjects.read)), ['\\Seen'], { uid: true });
  });
}

describe('sync', () => {
  it('a restore with sync takes out what was deleted or moved after the backup and keeps mail the backup never held', async () => {
    const source = uniqueUser('sync-src');
    const target = uniqueUser('sync-dst');
    await seed(source, {
      INBOX: [message('a', 'Angebot', '2024-01-02', ['\\Seen']), message('b', 'Bestellung', '2024-02-03'), message('c', 'Commit', '2024-03-04')],
      Archiv: [message('d', 'Dokument', '2023-05-06')],
    });
    await seed(target, { INBOX: [message('own', 'Nur im Ziel', '2024-06-01')], Trash: [] });
    const backup = directory();
    assertCompleted(await backupAccount(account(source), backup));
    assertCompleted(await restoreBackup(backup, account(target)));

    await tidyUp(source, { deleted: 'Bestellung', moved: 'Commit' });
    await change(source, 'INBOX', async (client, uidOf) => client.messageFlagsSet(String(await uidOf('Angebot')), ['\\Flagged'], { uid: true }));
    assertCompleted(await backupAccount(account(source), backup));

    const plan = await planRestore(backup, account(target));
    assert.deepEqual([plan.history, plan.target.syncProblem], [true, null]);
    const report = await restoreBackup(backup, account(target), { sync: true });
    assertCompleted(report);
    assert.equal(report.totals.removed, 2);
    assert.equal(report.folders.find((folder) => folder.path === 'INBOX')?.removed, 2);
    // The moved message is in Archiv now; its old copy went to the trash with the deleted one.
    assert.deepEqual(await contents(target), {
      INBOX: ['Angebot \\Flagged', 'Nur im Ziel'],
      Archiv: ['Commit', 'Dokument'],
      Trash: ['Bestellung', 'Commit'],
    });

    const again = await restoreBackup(backup, account(target), { sync: true });
    assertCompleted(again);
    assert.deepEqual([again.totals.transferred, again.totals.removed], [0, 0]);
    assert.deepEqual((await contents(target))['INBOX'], ['Angebot \\Flagged', 'Nur im Ziel']);
  });

  it('a migration with sync remembers the source first, then takes out what left it, and keeps what arrived in the target', async () => {
    const source = uniqueUser('mirror-src');
    const target = uniqueUser('mirror-dst');
    const memory = join(directory(), 'memory', 'pair.db');
    await seed(source, { INBOX: [message('a', 'Alt', '2024-01-02'), message('b', 'Bleibt', '2024-02-03')], Archiv: [message('c', 'Chronik', '2023-03-04')] });
    await seed(target, { INBOX: [message('own', 'Vorher im Ziel', '2024-01-01')], Trash: [] });

    assert.equal((await planMigration(account(source), account(target), { memory })).history, false);
    const first = await migrateAccount(account(source), account(target), { sync: true, memory });
    assertCompleted(first);
    assert.deepEqual([first.totals.transferred, first.totals.removed], [3, 0]);
    assert.equal((await planMigration(account(source), account(target), { memory })).history, true);

    await change(source, 'Archiv', async (client, uidOf) => client.messageFlagsAdd(String(await uidOf('Chronik')), ['\\Seen'], { uid: true }));
    await tidyUp(source, { deleted: 'Alt', moved: 'Bleibt' });
    // Mail that arrives in the target itself, as after switching the address over.
    await seed(target, { INBOX: [message('new', 'Neu im Ziel', '2024-07-01')] });

    const second = await migrateAccount(account(source), account(target), { sync: true, memory });
    assertCompleted(second);
    assert.equal(second.totals.removed, 2);
    assert.deepEqual(await contents(target), {
      INBOX: ['Neu im Ziel', 'Vorher im Ziel'],
      Archiv: ['Bleibt', 'Chronik \\Seen'],
      Trash: ['Alt', 'Bleibt'],
    });

    const third = await migrateAccount(account(source), account(target), { sync: true, memory });
    assertCompleted(third);
    assert.deepEqual([third.totals.transferred, third.totals.removed], [0, 0]);
  });

  it('a migration without sync keeps adding to the memory, so a later sync still takes out what left the source', async () => {
    const source = uniqueUser('later-src');
    const target = uniqueUser('later-dst');
    const memory = join(directory(), 'pair.db');
    await seed(source, { INBOX: [message('x', 'Weg', '2024-01-02'), message('y', 'Da', '2024-02-03')] });
    await seed(target, { Trash: [] });
    assertCompleted(await migrateAccount(account(source), account(target), { memory }));
    await change(source, 'INBOX', async (client, uidOf) => client.messageDelete(String(await uidOf('Weg')), { uid: true }));
    assertCompleted(await migrateAccount(account(source), account(target), { memory }));
    assert.deepEqual((await contents(target))['INBOX'], ['Da', 'Weg']);

    const sync = await migrateAccount(account(source), account(target), { sync: true, memory });
    assertCompleted(sync);
    assert.equal(sync.totals.removed, 1);
    assert.deepEqual(await contents(target), { INBOX: ['Da'], Trash: ['Weg'] });
  });

  it('is refused before any mail changes when the target has no trash', async () => {
    const source = uniqueUser('notrash-src');
    const target = uniqueUser('notrash-dst');
    await seed(source, { INBOX: [message('n', 'Nachricht', '2024-01-02')] });
    const backup = directory();
    assertCompleted(await backupAccount(account(source), backup));

    assert.equal((await planRestore(backup, account(target))).target.syncProblem, 'no-trash');
    const report = await restoreBackup(backup, account(target), { sync: true });
    assert.equal(report.status, 'failed');
    assert.equal(report.error?.conflict?.code, 'no-trash');
    assert.deepEqual(await contents(target), { INBOX: [] });
  });

  it('a restore sync waits for a backup that ran to the end', async () => {
    const source = uniqueUser('partial-src');
    const target = uniqueUser('partial-dst');
    await seed(source, { INBOX: Array.from({ length: 40 }, (_, index) => message(`p${index}`, `Teil ${index}`, '2024-01-02')) });
    await seed(target, { Trash: [] });
    const backup = directory();
    // Slow answers keep the backup running when the progress reaches ten messages.
    const proxy = await startProxy({ delayMs: 10 });
    const controller = new AbortController();
    try {
      const cancelled = await backupAccount({ ...account(source), port: proxy.port }, backup, {
        signal: controller.signal,
        onProgress: (event) => {
          if (event.type === 'progress' && event.done >= 10) controller.abort();
        },
      });
      assert.equal(cancelled.status, 'cancelled');
    } finally {
      proxy.close();
    }
    assert.equal((await planRestore(backup, account(target))).target.syncProblem, 'backup-incomplete');
    const refused = await restoreBackup(backup, account(target), { sync: true });
    assert.equal(refused.error?.conflict?.code, 'backup-incomplete');
    assert.deepEqual(await contents(target), { INBOX: [], Trash: [] });

    assertCompleted(await backupAccount(account(source), backup));
    assertCompleted(await restoreBackup(backup, account(target), { sync: true }));
    assert.equal((await contents(target))['INBOX']?.length, 40);
  });

  it('a sync that loses the connection while taking mail out finishes on the next attempt, losing and doubling nothing', async () => {
    const source = uniqueUser('cut-src');
    const target = uniqueUser('cut-dst');
    const many = Array.from({ length: 12 }, (_, index) => message(`k${index}`, `Kurz ${String(index).padStart(2, '0')}`, '2024-01-02'));
    await seed(source, { INBOX: many });
    await seed(target, { Trash: [] });
    const backup = directory();
    assertCompleted(await backupAccount(account(source), backup));
    assertCompleted(await restoreBackup(backup, account(target)));
    await change(source, 'INBOX', async (client) => {
      for (const index of [0, 3, 7, 11]) {
        const [uid] = (await client.search({ subject: `Kurz ${String(index).padStart(2, '0')}` }, { uid: true })) || [];
        assert.ok(uid);
        await client.messageDelete(String(uid), { uid: true });
      }
    });
    assertCompleted(await backupAccount(account(source), backup));

    // The command that moves the messages to the trash never reaches the server.
    const proxy = await startProxy({ drop: { direction: 'upload', matching: /UID (?:MOVE|COPY) [^\r\n]*Trash/ } });
    try {
      const report = await restoreBackup(backup, plainAccount(target, proxy.port), { sync: true });
      assertCompleted(report);
      assert.equal(proxy.drops(), 1);
      assert.equal(report.totals.removed, 4);
    } finally {
      proxy.close();
    }
    const after = await contents(target);
    assert.deepEqual(after['Trash'], ['Kurz 00', 'Kurz 03', 'Kurz 07', 'Kurz 11']);
    assert.equal(after['INBOX']?.length, 8);
    assert.deepEqual((await contents(source))['INBOX'], after['INBOX']);
  });
});
