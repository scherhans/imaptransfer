import assert from 'node:assert/strict';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { backupAccount } from '../../src/backup.ts';
import { restoreBackup } from '../../src/transfer.ts';
import type { ProgressEvent } from '../../src/types.ts';
import { account, mail, plainAccount, seed, snapshot, startProxy, tempDirectory, uniqueUser } from './helpers.ts';

const directories: string[] = [];
after(() => {
  for (const path of directories) rmSync(path, { recursive: true, force: true });
});

const messages = Array.from({ length: 60 }, (_, index) => ({
  raw: mail({ id: `flaky${index}`, subject: `Nachricht ${index}`, body: 'x'.repeat(2_000) }),
  flags: index % 2 === 0 ? ['\\Seen'] : [],
}));

describe('connection loss', () => {
  it('a backup reconnects and finishes without duplicates', async () => {
    const user = uniqueUser('flaky-backup');
    await seed(user, { INBOX: messages });
    const proxy = await startProxy({ drop: { direction: 'download', afterBytes: 40_000 } });
    const target = tempDirectory();
    directories.push(target);
    const events: ProgressEvent[] = [];
    try {
      const report = await backupAccount({ ...account(user), port: proxy.port }, target, { onProgress: (event) => events.push(event) });
      assert.equal(report.status, 'completed', JSON.stringify(report.error));
      assert.equal(proxy.drops(), 1);
      assert.ok(events.some((event) => event.type === 'retry'));
      assert.equal(readdirSync(join(target, 'mail', 'INBOX')).length, 60);
      const inbox = report.folders.find((folder) => folder.path === 'INBOX');
      assert.equal(inbox?.transferred, 60);
      assert.equal(inbox?.skipped, 0);
      const last = events.filter((event) => event.type === 'progress').at(-1);
      assert.deepEqual(last && { done: last.done, total: last.total }, { done: 60, total: 60 });
    } finally {
      proxy.close();
    }
  });

  it('a backup that loses the connection between two downloads fetches the rest, not counts it as deleted', async () => {
    const user = uniqueUser('flaky-between');
    await seed(user, { INBOX: messages });
    // The cut comes right after the server finished answering a download: the next download
    // finds no open folder, which imapflow answers with nothing, like for a deleted message.
    // Earlier matches: the plan's size listing, the folder's flag listing, the batch headers.
    const proxy = await startProxy({ drop: { direction: 'download', matching: /OK FETCH completed/, skipMatches: 4, afterForwarding: true } });
    const target = tempDirectory();
    directories.push(target);
    try {
      const report = await backupAccount(plainAccount(user, proxy.port), target);
      assert.equal(report.status, 'completed', JSON.stringify(report.error));
      assert.equal(proxy.drops(), 1);
      const inbox = report.folders.find((folder) => folder.path === 'INBOX');
      assert.deepEqual([inbox?.transferred, inbox?.skipped, inbox?.failed], [60, 0, 0]);
      assert.equal(readdirSync(join(target, 'mail', 'INBOX')).length, 60);
    } finally {
      proxy.close();
    }
  });

  it('a restore reconnects without uploading a message twice', async () => {
    const source = uniqueUser('flaky-source');
    const target = uniqueUser('flaky-target');
    await seed(source, { INBOX: messages });
    const backup = tempDirectory();
    directories.push(backup);
    assert.equal((await backupAccount(account(source), backup)).status, 'completed');

    const proxy = await startProxy({ drop: { direction: 'upload', afterBytes: 50_000 } });
    try {
      const report = await restoreBackup(backup, { ...account(target), port: proxy.port });
      assert.equal(report.status, 'completed', JSON.stringify(report.error));
      assert.equal(proxy.drops(), 1);
      assert.deepEqual(await snapshot(target), await snapshot(source));
    } finally {
      proxy.close();
    }
  });
});
