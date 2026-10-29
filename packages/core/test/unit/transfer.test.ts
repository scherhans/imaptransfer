import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FetchMessageObject, ListResponse, MailboxCreateResponse } from 'imapflow';
import { cleanableFolders, findCopies, isTrashOrSpam } from '../../src/dedupe.ts';
import { fetchAnswers, isFetchAnswer } from '../../src/fetching.ts';
import type { FolderMapping, ListedFolder } from '../../src/folders.ts';
import { ensureFolder, migrateAccount, plannedRemovals, restoreBackup, targetPlacementsOf, waysOut } from '../../src/transfer.ts';
import type { AccountConfig } from '../../src/types.ts';

function mappings(entries: [string, string, FolderMapping['role']?][]): Map<string, FolderMapping> {
  return new Map(entries.map(([source, target, role]) => [source, { source, target, exists: true, role: role ?? 'normal' }]));
}

const place = (...folders: string[]) => ({ placements: folders.map((folder) => ({ folder, flags: [], copies: 1 })) });

describe('targetPlacementsOf', () => {
  const map = mappings([
    ['INBOX', 'INBOX'],
    ['Trash', '[Gmail]/Trash'],
    ['Junk', '[Gmail]/Spam'],
    ['Work', 'Work'],
    ['[Gmail]/All Mail', 'Archive', 'all'],
  ]);
  const gmailExclusive = new Set(['[Gmail]/Trash', '[Gmail]/Spam']);

  it('keeps All Mail only for messages in no other folder', () => {
    assert.deepEqual(targetPlacementsOf(place('INBOX', '[Gmail]/All Mail'), map).targets.map((target) => target.path), ['INBOX']);
    assert.deepEqual(targetPlacementsOf(place('[Gmail]/All Mail'), map).targets.map((target) => target.path), ['Archive']);
  });

  it('never puts a living message into the Gmail trash or spam folder', () => {
    const result = targetPlacementsOf(place('INBOX', 'Trash', 'Work'), map, gmailExclusive);
    assert.deepEqual(result.targets.map((target) => target.path), ['INBOX', 'Work']);
    assert.deepEqual(result.covered.map((placement) => placement.folder), ['Trash']);
  });

  it('still restores a message that only lives in the trash, once', () => {
    const result = targetPlacementsOf(place('Trash', 'Junk'), map, gmailExclusive);
    assert.deepEqual(result.targets.map((target) => target.path), ['[Gmail]/Trash']);
  });

  it('keeps separate copies on servers where folders are real copies', () => {
    assert.deepEqual(targetPlacementsOf(place('INBOX', 'Trash'), map).targets.map((target) => target.path), ['INBOX', '[Gmail]/Trash']);
  });

  it('puts back as many copies as the fullest of two folders that become one, with the flags of both', () => {
    const merged = mappings([
      ['Archive', 'Archiv'],
      ['Archiv', 'Archiv'],
    ]);
    const message = {
      placements: [
        { folder: 'Archive', flags: ['\\Seen'], copies: 1 },
        { folder: 'Archiv', flags: ['\\Seen', '\\Flagged'], copies: 3 },
      ],
    };
    const [target] = targetPlacementsOf(message, merged).targets;
    assert.equal(target?.copies, 3);
    assert.deepEqual(target?.flags, ['\\Seen', '\\Flagged']);
    assert.deepEqual(target?.sources, [
      { folder: 'Archive', copies: 1 },
      { folder: 'Archiv', copies: 3 },
    ]);
    // Gmail: a label cannot hold a message twice.
    assert.equal(targetPlacementsOf(message, merged, new Set(), true).targets[0]?.copies, 1);
  });
});

describe('cleanableFolders', () => {
  const listed = (path: string, specialUse: string | null = null): ListedFolder => ({
    path,
    delimiter: '/',
    specialUse,
    role: 'normal',
    selectable: true,
    messages: 1,
    uidNext: null,
    uidValidity: null,
  });

  it('leaves every trash, spam and drafts folder alone, marked or only named so', () => {
    // A server without SPECIAL-USE marks at most one folder per kind; the account holds two.
    const folders = [
      listed('INBOX', '\\Inbox'),
      listed('Deleted Items', '\\Trash'),
      listed('Trash'),
      listed('Archiv/Papierkorb'),
      listed('Junk E-mail'),
      listed('Entwürfe'),
      listed('Projekte/Spam Beschwerden'),
      listed('Wichtig'),
    ];
    assert.deepEqual(
      cleanableFolders({ folders }).map((folder) => folder.path),
      ['INBOX', 'Projekte/Spam Beschwerden', 'Wichtig'],
    );
  });
});

describe('isTrashOrSpam', () => {
  it('knows trash and spam by mark and by name, but not drafts or a folder that only mentions spam', () => {
    const kind = (path: string, specialUse: string | null = null) => isTrashOrSpam({ path, delimiter: '/', specialUse });
    assert.deepEqual(
      [kind('Gelöschte Elemente'), kind('Archiv/Papierkorb'), kind('Bulk Mail'), kind('X', '\\Junk'), kind('Entwürfe'), kind('Projekte/Spam Beschwerden')],
      [true, true, true, true, false, false],
    );
  });
});

describe('plannedRemovals', () => {
  const set = (...ids: string[]) => new Set(ids);
  const map = (entries: [string, string[]][]) => new Map(entries.map(([key, ids]) => [key, set(...ids)]));
  const plain = (removals: ReturnType<typeof plannedRemovals>) =>
    Object.fromEntries([...removals].map(([target, removal]) => [target, { ids: [...removal.fingerprints].sort(), sources: removal.sources }]));

  it('takes out of each target folder what left the source folders mapped there', () => {
    const removals = plannedRemovals(
      [
        { source: 'INBOX', target: 'INBOX' },
        { source: 'Archiv', target: 'Archiv' },
      ],
      map([['INBOX', ['kept']], ['Archiv', ['moved']]]),
      map([['INBOX', ['deleted', 'moved']], ['Archiv', []]]),
      new Set(),
    );
    assert.deepEqual(plain(removals), { INBOX: { ids: ['deleted', 'moved'], sources: ['INBOX'] } });
  });

  it('keeps what another source folder of the same target still holds', () => {
    // "Sent" and "Sent Items" both become the target's Sent folder.
    const removals = plannedRemovals(
      [
        { source: 'Sent', target: 'Gesendet' },
        { source: 'Sent Items', target: 'Gesendet' },
      ],
      map([['Sent', []], ['Sent Items', ['both']]]),
      map([['Sent', ['both', 'gone']]]),
      new Set(),
    );
    assert.deepEqual(plain(removals), { Gesendet: { ids: ['gone'], sources: ['Sent', 'Sent Items'] } });
  });

  it('never takes anything out of an untouched folder, and knows nothing of folders without history', () => {
    const removals = plannedRemovals(
      [
        { source: 'Trash', target: 'Papierkorb' },
        { source: 'Neu', target: 'Neu' },
      ],
      map([]),
      map([['Trash', ['emptied']]]),
      new Set(['Papierkorb']),
    );
    assert.deepEqual(plain(removals), {});
  });
});

describe('waysOut', () => {
  // deleted: gone from the source. moved: now in Archiv, copied there. waiting: now in a folder
  // the copy did not reach. viewed: now only shown by All Mail, which may be a view of this copy.
  const elsewhere = (id: string) => ({ deleted: [], moved: ['Archiv'], waiting: ['Kaputt'], viewed: ['Alle'] })[id] ?? [];
  const arrived = (folder: string) => folder === 'Archiv';

  it('sends deleted mail to the trash, moved mail once it arrived, and lets the rest wait', () => {
    const ways = waysOut(['deleted', 'moved', 'waiting', 'viewed'], elsewhere, arrived);
    assert.deepEqual([[...ways.toTrash].sort(), [...ways.waiting].sort()], [['deleted', 'moved'], ['viewed', 'waiting']]);
  });
});

describe('sync options', () => {
  // Port 1: nothing listens there, and both runs must stop before they try to connect.
  const nowhere: AccountConfig = { host: '127.0.0.1', port: 1, secure: true, user: 'x', auth: { type: 'password', password: 'x' } };

  it('a migration only syncs with the memory of earlier runs', async () => {
    const report = await migrateAccount(nowhere, nowhere, { sync: true });
    assert.equal(report.status, 'failed');
    assert.match(report.error?.message ?? '', /memory/);
  });

  it('a restore cannot sync and bring back deleted mail at once', async () => {
    const report = await restoreBackup('/does/not/exist', nowhere, { sync: true, includeRemoved: true });
    assert.equal(report.status, 'failed');
    assert.match(report.error?.message ?? '', /cannot restore deleted mail/);
  });
});

describe('ensureFolder', () => {
  /** A server that, unlike most, refuses a folder whose parent does not exist yet. */
  function strictServer(existing: string[]) {
    const folders = new Set(existing);
    const created: string[] = [];
    const client = {
      async mailboxCreate(path: string): Promise<MailboxCreateResponse> {
        const parent = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : null;
        if (folders.has(path)) return { path, created: false };
        if (parent && !folders.has(parent)) throw new Error(`NO Parent of ${path} does not exist`);
        folders.add(path);
        created.push(path);
        return { path, created: true };
      },
      async list(): Promise<ListResponse[]> {
        return [...folders].map((path) => ({ path }) as ListResponse);
      },
    };
    return { client, created };
  }

  it('creates missing parents first when the server does not', async () => {
    const { client, created } = strictServer(['INBOX', 'Archiv']);
    await ensureFolder(client, 'Archiv.Urlaub und Reisen.Südafrika', '.');
    assert.deepEqual(created, ['Archiv.Urlaub und Reisen', 'Archiv.Urlaub und Reisen.Südafrika']);
  });

  it('passes on a refusal that has nothing to do with parents', async () => {
    const { client } = strictServer(['INBOX']);
    client.mailboxCreate = async () => {
      throw new Error('NO Invalid mailbox name');
    };
    await assert.rejects(ensureFolder(client, 'Kunde*', '.'), /Invalid mailbox name/);
  });
});

describe('findCopies', () => {
  const row = (id: string, uid: number, size: number) => ({ id, uid, size, flags: [] });

  it('keeps the oldest of exact copies and leaves other versions alone', () => {
    const { groups, similar } = findCopies([
      row('a', 9, 100),
      row('a', 3, 100),
      row('a', 5, 100),
      // Same headers, other size: an attachment removed, a footer added. Not a copy.
      row('a', 7, 140),
      row('b', 1, 50),
      row('c', 2, 80),
      row('c', 4, 80),
    ]);
    assert.deepEqual(
      groups.map((group) => [group.keep.uid, group.remove.map((copy) => copy.uid)]),
      [
        [3, [5, 9]],
        [2, [4]],
      ],
    );
    assert.equal(similar, 1);
  });
});

describe('fetch answers', () => {
  const row = (uid: number, extra: Partial<FetchMessageObject> = {}) => ({ seq: uid, uid, ...extra }) as FetchMessageObject;

  it('drops unsolicited flag updates and rows for other messages', () => {
    const headers = Buffer.from('Subject: a\r\n\r\n');
    const rows = [
      row(5, { headers, size: 10 }),
      row(9, { flags: new Set(['\\Seen']) }),
      row(7, { headers, size: 10 }),
      row(5, { headers, size: 10 }),
      row(0, { headers, size: 10 }),
    ];
    assert.deepEqual(
      fetchAnswers(rows, { headers: true, uids: new Set([5, 6]) }).map((message) => message.uid),
      [5],
    );
    assert.equal(isFetchAnswer(row(9, { flags: new Set() })), true);
    assert.equal(isFetchAnswer({ seq: 3, flags: new Set() } as unknown as FetchMessageObject), false);
  });
});
