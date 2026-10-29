import assert from 'node:assert/strict';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { backupAccount } from '../../src/backup.ts';
import { exportMbox } from '../../src/mbox.ts';
import { BackupStore } from '../../src/store/store.ts';
import { migrateAccount, planRestore, restoreBackup } from '../../src/transfer.ts';
import { testConnection } from '../../src/session.ts';
import type { Report } from '../../src/types.ts';
import { verifyBackup } from '../../src/verify.ts';
import { account, mail, seed, snapshot, startProxy, tempDirectory, uniqueUser, withClient, type SeedMessage } from './helpers.ts';

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

function standardMailbox(): Record<string, SeedMessage[]> {
  return {
    INBOX: [
      { raw: mail({ id: 'm1', subject: 'Willkommen' }), flags: ['\\Seen'], internalDate: day('2023-01-10') },
      { raw: mail({ id: 'm2', subject: 'Rechnung Mai' }), internalDate: day('2024-05-02') },
    ],
    Archiv: [{ raw: mail({ id: 'm3', subject: 'Altes Projekt' }), flags: ['\\Seen', '\\Answered'], internalDate: day('2021-03-04') }],
    'Archiv.2024': [
      { raw: mail({ id: 'm4', subject: '=?UTF-8?Q?Gr=C3=BC=C3=9Fe?=' }), flags: ['\\Flagged', '$Wichtig'], internalDate: day('2024-02-29') },
    ],
    Sent: [{ raw: mail({ id: 'm5', subject: 'Antwort an Bert', from: 'me@example.com' }), flags: ['\\Seen'], internalDate: day('2024-06-01') }],
  };
}

describe('connection', () => {
  it('reports a working account and a wrong host', async () => {
    const ok = await testConnection(account(uniqueUser('probe')));
    assert.equal(ok.ok, true);
    const broken = await testConnection({ ...account('x'), host: '127.0.0.1', port: 1 });
    assert.equal(broken.ok, false);
    assert.equal(broken.ok === false && broken.kind, 'connection');
  });
});

describe('backup', () => {
  it('backs up every folder and continues incrementally', async () => {
    const user = uniqueUser('alice');
    await seed(user, standardMailbox());
    const target = directory();

    const first = await backupAccount(account(user), target);
    assertCompleted(first);
    assert.equal(first.totals.transferred, 5);
    const nested = readdirSync(join(target, 'mail', 'Archiv', '2024'));
    assert.equal(nested.length, 1);
    assert.match(nested[0] ?? '', /^2024-02-29_Grüße_[0-9a-f]{10}\.eml$/);
    assert.ok(existsSync(join(target, 'imaptransfer.db')));

    const second = await backupAccount(account(user), target);
    assertCompleted(second);
    assert.equal(second.totals.transferred, 0);
    assert.equal(second.totals.skipped, 5);

    await withClient(user, async (client) => {
      await client.append('INBOX', mail({ id: 'm6', subject: 'Neu' }), [], day('2024-07-01'));
      const lock = await client.getMailboxLock('INBOX');
      try {
        const [rechnung] = (await client.search({ subject: 'Rechnung' }, { uid: true })) || [];
        const [willkommen] = (await client.search({ subject: 'Willkommen' }, { uid: true })) || [];
        assert.ok(rechnung && willkommen);
        await client.messageDelete(String(rechnung), { uid: true });
        await client.messageFlagsAdd(String(willkommen), ['\\Flagged'], { uid: true });
      } finally {
        lock.release();
      }
    });

    const third = await backupAccount(account(user), target);
    assertCompleted(third);
    assert.equal(third.totals.transferred, 1);
    const inbox = third.folders.find((folder) => folder.path === 'INBOX');
    assert.equal(inbox?.sourceCount, 2);
    assert.equal(inbox?.targetCount, 2);

    const store = BackupStore.open(target, { readOnly: true });
    try {
      assert.equal(store.restorableMessages().length, 5);
      assert.equal(store.restorableMessages({ includeRemoved: true }).length, 6);
      const willkommen = store.restorableMessages().find((message) => message.subject === 'Willkommen');
      assert.deepEqual(willkommen?.placements[0]?.flags.sort(), ['\\Flagged', '\\Seen']);
    } finally {
      store.close();
    }

    const verify = await verifyBackup(target);
    assert.equal(verify.ok, 6);
    const mbox = await exportMbox(target, join(target, 'export'));
    assert.equal(mbox.messages, 5);
  });

  it('stores a message that lives in two folders only once', async () => {
    const user = uniqueUser('labels');
    const shared = mail({ id: 'shared', subject: 'Mit zwei Labels' });
    await seed(user, { INBOX: [{ raw: shared }], Arbeit: [{ raw: shared, flags: ['\\Seen'] }] });
    const target = directory();
    const report = await backupAccount(account(user), target);
    assertCompleted(report);
    assert.equal(report.totals.transferred, 1);
    assert.equal(report.totals.deduplicated, 1);
    assert.equal(readdirSync(join(target, 'mail', 'INBOX')).length, 1);
    // The folder is there, like in the account; its message is stored under INBOX.
    assert.deepEqual(readdirSync(join(target, 'mail', 'Arbeit')), []);
  });

  it('continues a cancelled backup without duplicates', async () => {
    const user = uniqueUser('resume');
    const messages = Array.from({ length: 40 }, (_, index) => ({ raw: mail({ id: `r${index}`, subject: `Nachricht ${index}` }) }));
    await seed(user, { INBOX: messages });
    const target = directory();

    // Slow answers make sure the job is still running when the progress reports 10 messages.
    const proxy = await startProxy({ delayMs: 10 });
    const controller = new AbortController();
    try {
      const cancelled = await backupAccount({ ...account(user), port: proxy.port }, target, {
        signal: controller.signal,
        onProgress: (event) => {
          if (event.type === 'progress' && event.done >= 10) controller.abort();
        },
      });
      assert.equal(cancelled.status, 'cancelled');
    } finally {
      proxy.close();
    }

    const resumed = await backupAccount(account(user), target);
    assertCompleted(resumed);
    assert.ok(resumed.totals.transferred < 40, 'the second run must not start from zero');
    assert.equal(readdirSync(join(target, 'mail', 'INBOX')).length, 40);
  });

  it('goes on when a folder disappears during the backup and closes it afterwards', async () => {
    const user = uniqueUser('vanish');
    const many = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({ raw: mail({ id: `${prefix}${index}`, subject: `${prefix} ${index}` }) }));
    await seed(user, { INBOX: many('in', 5), Akten: many('akte', 30), Belege: many('beleg', 5), Notizen: many('notiz', 5) });
    const target = directory();
    const proxy = await startProxy({ delayMs: 5 });
    let deletion: Promise<unknown> | null = null;
    try {
      const report = await backupAccount({ ...account(user), port: proxy.port }, target, {
        onProgress: (event) => {
          if (event.type === 'folder' && event.path === 'Akten' && !deletion) deletion = withClient(user, (client) => client.mailboxDelete('Belege'));
        },
      });
      await deletion;
      assert.equal(report.status, 'completed', JSON.stringify(report.error));
      const belege = report.folders.find((folder) => folder.path === 'Belege');
      assert.match(belege?.error ?? '', /could not be backed up/);
      assert.equal(report.folders.find((folder) => folder.path === 'Notizen')?.transferred, 5);
      assert.ok(report.totals.failed > 0);
    } finally {
      proxy.close();
    }
  });

  it('closes a backed-up folder that was deleted in the account', async () => {
    const user = uniqueUser('closed');
    await seed(user, { INBOX: [{ raw: mail({ id: 'c1', subject: 'Bleibt' }) }], Alt: [{ raw: mail({ id: 'c2', subject: 'Im alten Ordner' }) }] });
    const target = directory();
    assertCompleted(await backupAccount(account(user), target));
    await withClient(user, (client) => client.mailboxDelete('Alt'));

    const warnings: string[] = [];
    const second = await backupAccount(account(user), target, { onProgress: (event) => event.type === 'warning' && warnings.push(event.folder ?? '') });
    assertCompleted(second);
    assert.ok(warnings.includes('Alt'));

    // A restore does not bring the folder back, unless deleted mail is asked for.
    const fresh = account(uniqueUser('fresh'));
    const plan = await planRestore(target, fresh);
    assert.deepEqual(plan.mappings.map((mapping) => mapping.source), ['INBOX']);
    // The plan says what it leaves out, so a backup of an emptied account never looks empty.
    assert.equal(plan.removed, 1);
    const everything = await planRestore(target, fresh, { includeRemoved: true });
    assert.deepEqual(everything.mappings.map((mapping) => mapping.source).sort(), ['Alt', 'INBOX']);
    assert.equal(everything.removed, 0);
  });

  it('refuses to mix two accounts in one folder', async () => {
    const first = uniqueUser('one');
    const second = uniqueUser('two');
    await seed(first, { INBOX: [{ raw: mail({ id: 'a', subject: 'A' }) }] });
    const target = directory();
    assertCompleted(await backupAccount(account(first), target));
    const report = await backupAccount(account(second), target);
    assert.equal(report.status, 'failed');
    assert.equal(report.error?.kind, 'conflict');
    assert.equal(report.error?.conflict?.code, 'other-account');
  });
});

describe('restore', () => {
  it('restores folders, flags and dates and skips what is already there', async () => {
    const source = uniqueUser('source');
    const target = uniqueUser('target');
    await seed(source, standardMailbox());
    const backup = directory();
    assertCompleted(await backupAccount(account(source), backup));

    const plan = await planRestore(backup, account(target));
    assert.equal(plan.messages, 5);
    assert.deepEqual(plan.mappings.filter((mapping) => !mapping.exists).map((mapping) => mapping.target).sort(), ['Archiv', 'Archiv.2024', 'Sent']);

    const first = await restoreBackup(backup, account(target));
    assertCompleted(first);
    assert.equal(first.totals.transferred, 5);
    assert.deepEqual(await snapshot(target), await snapshot(source));

    const again = await restoreBackup(backup, account(target));
    assertCompleted(again);
    assert.equal(again.totals.transferred, 0);
    assert.equal(again.totals.skipped, 5);
    assert.deepEqual(await snapshot(target), await snapshot(source));
  });

  it('puts a message that lived in two folders back into both', async () => {
    const source = uniqueUser('src2');
    const target = uniqueUser('dst2');
    const shared = mail({ id: 'both', subject: 'Zweimal' });
    await seed(source, { INBOX: [{ raw: shared, flags: ['\\Seen'] }], Projekte: [{ raw: shared }] });
    const backup = directory();
    assertCompleted(await backupAccount(account(source), backup));
    const report = await restoreBackup(backup, account(target));
    assertCompleted(report);
    assert.equal(report.totals.transferred, 2);
    assert.deepEqual(await snapshot(target), await snapshot(source));
  });
});

describe('migrate', () => {
  it('copies one account into another and can be repeated', async () => {
    const source = uniqueUser('from');
    const target = uniqueUser('to');
    await seed(source, standardMailbox());
    await seed(target, { INBOX: [{ raw: mail({ id: 'existing', subject: 'Schon da' }) }] });

    const first = await migrateAccount(account(source), account(target));
    assertCompleted(first);
    assert.equal(first.totals.transferred, 5);
    const after = await snapshot(target);
    const expected = await snapshot(source);
    for (const [path, messages] of Object.entries(expected)) {
      const present = after[path] ?? [];
      for (const message of messages) assert.ok(present.some((item) => JSON.stringify(item) === JSON.stringify(message)), `${path}: ${message.subject}`);
    }
    assert.equal(after['INBOX']?.length, 3);

    const again = await migrateAccount(account(source), account(target));
    assertCompleted(again);
    assert.equal(again.totals.transferred, 0);
    assert.deepEqual(await snapshot(target), after);
  });

  it('never uploads another message when the source folder is renumbered during the migration', async () => {
    const source = uniqueUser('renumber');
    const target = uniqueUser('renumber-to');
    const first = Array.from({ length: 30 }, (_, index) => ({ raw: mail({ id: `rn${index}`, subject: `Zuerst ${index}` }) }));
    await seed(source, { INBOX: first, Zweit: [{ raw: mail({ id: 'scanned', subject: 'Beim Lesen da' }) }] });

    // Slow answers keep the migration busy with INBOX while "Zweit" is replaced.
    const proxy = await startProxy({ delayMs: 10 });
    let replaced: Promise<unknown> | null = null;
    try {
      const report = await migrateAccount({ ...account(source), port: proxy.port }, account(target), {
        onProgress: (event) => {
          if (event.type === 'phase' && event.phase === 'transfer' && !replaced) {
            // Same name, new numbering: UID 1 is now a message the scan never saw.
            replaced = withClient(source, async (client) => {
              await client.mailboxDelete('Zweit');
              await client.mailboxCreate('Zweit');
              await client.append('Zweit', mail({ id: 'later', subject: 'Erst danach da' }));
            });
          }
        },
      });
      await replaced;
      assert.equal(report.status, 'completed', JSON.stringify(report.error));
      assert.equal(report.folders.find((folder) => folder.path === 'INBOX')?.transferred, 30);
      assert.equal(report.folders.find((folder) => folder.path === 'Zweit')?.failed, 1);
      assert.match(report.failures[0]?.reason ?? '', /changed in the source account/);
      assert.deepEqual((await snapshot(target))['Zweit'], []);
    } finally {
      proxy.close();
    }
  });
});
