import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { backupAccount } from '../../src/backup.ts';
import { BackupStore, MAIL_DIRECTORY } from '../../src/store/store.ts';
import { migrateAccount, restoreBackup } from '../../src/transfer.ts';
import type { Report } from '../../src/types.ts';
import { account, mail, seed, snapshot, tempDirectory, uniqueUser, withClient, type SeedMessage } from './helpers.ts';

const directories: string[] = [];
after(() => {
  for (const path of directories) rmSync(path, { recursive: true, force: true });
});

function assertCompleted(report: Report): void {
  assert.equal(report.status, 'completed', JSON.stringify(report.error ?? report.failures));
  assert.equal(report.totals.failed, 0, JSON.stringify(report.failures));
  assert.deepEqual(
    report.folders.filter((folder) => folder.error !== null),
    [],
  );
}

let day = 0;
function message(id: string, subject: string, flags: string[] = []): SeedMessage {
  day++;
  return { raw: mail({ id, subject }), flags, internalDate: new Date(Date.UTC(2021, 0, day, 9, 30)) };
}

interface TreeEntry {
  path: string;
  selectable: boolean;
  subscribed: boolean;
}

/** Every folder of an account, including containers, and whether mail programs show it. */
async function folderTree(user: string): Promise<TreeEntry[]> {
  return withClient(user, async (client) =>
    (await client.list())
      .map((folder) => ({ path: folder.path, selectable: !folder.flags.has('\\Noselect'), subscribed: folder.subscribed }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  );
}

async function assertSameTree(user: string, expected: TreeEntry[]): Promise<void> {
  const tree = await folderTree(user);
  assert.deepEqual(
    tree.map((folder) => folder.path),
    expected.map((folder) => folder.path),
  );
  // A folder that is not subscribed stays hidden in Thunderbird, Outlook and others.
  assert.deepEqual(
    tree.filter((folder) => folder.selectable && !folder.subscribed).map((folder) => folder.path),
    [],
  );
}

// A tree like a real one: three levels below "Archiv", a parent that only exists because of
// its subfolder, empty folders, a mail in two folders, and names with umlauts, "&", "+", "/"
// and characters Windows does not allow in file names.
function realisticTree(): Record<string, SeedMessage[]> {
  const shared = mail({ id: 'shared', subject: 'Angebot Küche' });
  return {
    INBOX: [message('in1', 'Willkommen'), message('in2', 'Rechnung', ['\\Seen'])],
    Archiv: [message('ar1', 'Oben im Archiv', ['\\Seen'])],
    'Archiv.Haus': [message('h1', 'Kaufvertrag', ['\\Seen', '\\Answered'])],
    'Archiv.Haus.Küche': [{ raw: shared, flags: ['\\Seen'], internalDate: new Date('2021-03-01T09:30:00Z') }, message('k2', 'Montage Küche')],
    'Archiv.Haus.R+V': [message('rv', 'Police', ['\\Flagged'])],
    'Archiv.Haus.Maler Ulrich': [],
    'Archiv.Wichtig': [{ raw: shared, flags: ['\\Seen', '\\Flagged'], internalDate: new Date('2021-03-01T09:30:00Z') }],
    'Archiv.Urlaub und Reisen.Urlaub Südafrika': [message('za', 'Safari')],
    'Projekte & Kunden': [message('pk', 'Projektstart', ['$Wichtig'])],
    'Kunde: Müller? *dringend*': [message('km', 'Rückfrage')],
    'Belege 2023/2024': [message('bl', 'Quittung')],
    'Tief.Ebene 2.Ebene 3.Ebene 4': [message('t4', 'Ganz unten')],
    Leer: [],
    'Sent Items': [message('se', 'Antwort an Bert', ['\\Seen'])],
    Drafts: [],
    Spam: [],
    Trash: [message('tr', 'Weggeworfen', ['\\Seen'])],
  };
}

describe('folder structure', () => {
  it('keeps every folder through backup, restore and migration', async () => {
    const source = uniqueUser('tree');
    await seed(source, realisticTree());
    // Hidden in mail programs, but still part of the account: the backup must not depend on it.
    await withClient(source, (client) => client.mailboxUnsubscribe('Leer'));
    const sourceTree = await folderTree(source);
    const sourceMail = await snapshot(source);

    const backup = tempDirectory();
    directories.push(backup);
    assertCompleted(await backupAccount(account(source), backup));
    const store = BackupStore.open(backup, { readOnly: true });
    try {
      const stored = store.folders();
      assert.deepEqual(
        stored.map((folder) => folder.path).sort((a, b) => a.localeCompare(b)),
        sourceTree.filter((folder) => folder.selectable).map((folder) => folder.path),
      );
      // On disk, too: someone browsing the backup sees every folder, even an empty one.
      for (const folder of stored) assert.ok(existsSync(join(backup, MAIL_DIRECTORY, folder.dir)), `no directory for ${folder.path}`);
    } finally {
      store.close();
    }

    const restored = uniqueUser('tree-restore');
    assertCompleted(await restoreBackup(backup, account(restored)));
    assert.deepEqual(await snapshot(restored), sourceMail);
    await assertSameTree(restored, sourceTree);

    const again = await restoreBackup(backup, account(restored));
    assertCompleted(again);
    assert.equal(again.totals.transferred, 0);
    assert.deepEqual(await snapshot(restored), sourceMail);

    const migrated = uniqueUser('tree-migrate');
    assertCompleted(await migrateAccount(account(source), account(migrated)));
    assert.deepEqual(await snapshot(migrated), sourceMail);
    await assertSameTree(migrated, sourceTree);
  });
});
