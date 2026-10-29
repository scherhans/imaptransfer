import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { backupAccount } from '../../src/backup.ts';
import { findDuplicates, removeDuplicates } from '../../src/dedupe.ts';
import { migrateAccount, planRestore, restoreBackup } from '../../src/transfer.ts';
import type { ProgressEvent, Report } from '../../src/types.ts';
import { account, mail, plainAccount, seed, snapshot, startProxy, tempDirectory, uniqueUser, type SeedMessage } from './helpers.ts';

const directories: string[] = [];
after(() => {
  for (const path of directories) rmSync(path, { recursive: true, force: true });
});

function directory(): string {
  const path = tempDirectory();
  directories.push(path);
  return path;
}

function assertCompleted(report: Report): void {
  assert.equal(report.status, 'completed', JSON.stringify(report.error ?? report.failures));
  assert.equal(report.totals.failed, 0, JSON.stringify(report.failures));
}

const folderReport = (report: Report, path: string) => report.folders.find((folder) => folder.path === path);
const at = (day: string) => new Date(`${day}T08:00:00Z`);
const times = (count: number, message: SeedMessage) => Array.from({ length: count }, () => message);

// Like a folder that a migration run several times filled with copies of the same mail.
const triple: SeedMessage = { raw: mail({ id: 'triple', subject: 'Finanzierungsanfrage' }), flags: ['\\Seen'], internalDate: at('2018-04-09') };
const double: SeedMessage = { raw: mail({ id: 'double', subject: 'Anfrage Kontaktformular' }), flags: ['\\Seen', '\\Flagged'], internalDate: at('2018-09-03') };
const single: SeedMessage = { raw: mail({ id: 'single', subject: 'Einmal' }), internalDate: at('2019-01-01') };

function mailboxWithCopies(): Record<string, SeedMessage[]> {
  return {
    INBOX: [single],
    Wichtig: [...times(3, triple), ...times(2, double), single],
    Hochzeitsplanung: [triple],
  };
}

async function backedUp(): Promise<{ source: string; backup: string }> {
  const source = uniqueUser('copies');
  await seed(source, mailboxWithCopies());
  const backup = directory();
  const report = await backupAccount(account(source), backup);
  assertCompleted(report);
  assert.equal(folderReport(report, 'Wichtig')?.targetCount, 6);
  return { source, backup };
}

describe('copies of a message in one folder', () => {
  it('a restore puts back every copy, also when the connection drops while copying', async () => {
    const { source, backup } = await backedUp();
    const target = uniqueUser('copies-restore');
    const plan = await planRestore(backup, account(target));
    assert.equal(plan.mappings.find((mapping) => mapping.source === 'Wichtig')?.messages, 6);

    // The server makes the copy, but its answer never arrives: the retry must count it as done.
    const proxy = await startProxy({ drop: { direction: 'download', matching: /\[COPYUID / } });
    try {
      const report = await restoreBackup(backup, plainAccount(target, proxy.port));
      assertCompleted(report);
      assert.equal(proxy.drops(), 1);
      assert.deepEqual(
        [folderReport(report, 'Wichtig')?.sourceCount, folderReport(report, 'Wichtig')?.transferred],
        [6, 6],
      );
    } finally {
      proxy.close();
    }
    assert.deepEqual(await snapshot(target), await snapshot(source));

    const again = await restoreBackup(backup, account(target));
    assertCompleted(again);
    assert.equal(again.totals.transferred, 0);
    assert.equal(again.totals.skipped, 8);
    assert.deepEqual(await snapshot(target), await snapshot(source));
  });

  it('a restore adds only the copies a folder still lacks', async () => {
    const { source, backup } = await backedUp();
    const target = uniqueUser('copies-partial');
    await seed(target, { Wichtig: [triple] });
    const report = await restoreBackup(backup, account(target));
    assertCompleted(report);
    assert.deepEqual(
      [folderReport(report, 'Wichtig')?.transferred, folderReport(report, 'Wichtig')?.skipped],
      [5, 1],
    );
    assert.deepEqual(await snapshot(target), await snapshot(source));
  });

  it('a migration takes every copy along', async () => {
    const source = uniqueUser('copies-from');
    await seed(source, mailboxWithCopies());
    const target = uniqueUser('copies-to');
    const report = await migrateAccount(account(source), account(target));
    assertCompleted(report);
    assert.deepEqual(await snapshot(target), await snapshot(source));
    const again = await migrateAccount(account(source), account(target));
    assertCompleted(again);
    assert.equal(again.totals.transferred, 0);
  });
});

describe('cleaning up copies in the account', () => {
  // Three copies with different flags, two plain copies, two versions of one mail that differ
  // in size, and copies in the trash that stay where they are.
  function messy(): Record<string, SeedMessage[]> {
    const version = (body: string): SeedMessage => ({ raw: mail({ id: 'version', subject: 'Mit Anhang', body }), internalDate: at('2020-05-07') });
    return {
      INBOX: [single],
      Wichtig: [
        { ...triple, flags: ['\\Seen'] },
        { ...triple, flags: ['\\Seen', '\\Flagged'] },
        { ...triple, flags: ['\\Seen', '\\Answered'] },
        ...times(2, double),
        single,
        version('Anhang: 1234567890'),
        version('Anhang entfernt'),
      ],
      Hochzeitsplanung: [triple],
      Trash: times(2, double),
    };
  }

  it('finds exact copies, keeps one with all flags and puts the others into the trash', async () => {
    const user = uniqueUser('cleanup');
    await seed(user, messy());

    // The test run lists what a cleanup would do, changes nothing, and says how far it is.
    const before = await snapshot(user);
    const events: ProgressEvent[] = [];
    const plan = await findDuplicates(account(user), { onProgress: (event) => events.push(event) });
    assert.deepEqual(
      events.filter((event) => event.type === 'phase').map((event) => event.phase),
      ['connect', 'scan', 'finish'],
    );
    assert.deepEqual(
      events.flatMap((event) => (event.type === 'folder' ? [event.path] : [])),
      ['INBOX', 'Hochzeitsplanung', 'Wichtig'],
    );
    const last = events.filter((event) => event.type === 'progress').at(-1);
    assert.deepEqual(last && [last.done, last.total], [10, 10]);
    assert.equal(plan.problem, null);
    assert.equal(plan.trash, 'Trash');
    const affected = plan.folders.filter((folder) => folder.duplicates > 0 || folder.similar > 0);
    assert.deepEqual(
      affected.map(({ path, messages, duplicates, similar }) => ({ path, messages, duplicates, similar })),
      [{ path: 'Wichtig', messages: 8, duplicates: 3, similar: 1 }],
    );
    assert.deepEqual(
      affected[0]?.duplicated.map(({ subject, copies }) => [subject, copies]),
      [
        ['Finanzierungsanfrage', 3],
        ['Anfrage Kontaktformular', 2],
      ],
    );
    assert.deepEqual(await snapshot(user), before);

    // The server moves the copies, but its answer never arrives: the retry must not count wrong.
    const proxy = await startProxy({ drop: { direction: 'download', matching: /\[COPYUID / } });
    try {
      const report = await removeDuplicates(plainAccount(user, proxy.port));
      assertCompleted(report);
      assert.equal(proxy.drops(), 1);
      const important = folderReport(report, 'Wichtig');
      assert.deepEqual([important?.sourceCount, important?.transferred, important?.skipped, important?.target], [8, 3, 5, 'Trash']);
    } finally {
      proxy.close();
    }

    const after = await snapshot(user);
    assert.deepEqual(
      after['Wichtig']?.map((message) => [message.subject, message.flags.join(' ')]),
      [
        ['Anfrage Kontaktformular', '\\Flagged \\Seen'],
        ['Einmal', ''],
        ['Finanzierungsanfrage', '\\Answered \\Flagged \\Seen'],
        ['Mit Anhang', ''],
        ['Mit Anhang', ''],
      ],
    );
    assert.equal(after['Hochzeitsplanung']?.length, 1);
    assert.equal(after['Trash']?.length, 5);

    const again = await removeDuplicates(account(user));
    assertCompleted(again);
    assert.equal(again.totals.transferred, 0);
  });

  it('refuses to clean up an account without a trash folder', async () => {
    const user = uniqueUser('cleanup-notrash');
    await seed(user, { INBOX: times(2, single) });
    assert.equal((await findDuplicates(account(user))).problem, 'no-trash');
    const report = await removeDuplicates(account(user));
    assert.equal(report.status, 'failed');
    assert.equal(report.error?.kind, 'conflict');
    assert.equal(report.error?.conflict?.code, 'no-trash');
    assert.equal((await snapshot(user))['INBOX']?.length, 2);
  });
});
