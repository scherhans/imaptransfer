import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { backupAccount } from '../../src/backup.ts';
import { migrateAccount, restoreBackup } from '../../src/transfer.ts';
import type { ProgressEvent } from '../../src/types.ts';
import { account, mail, seed, snapshot, startProxy, tempDirectory, uniqueUser } from './helpers.ts';

const directories: string[] = [];
after(() => {
  for (const path of directories) rmSync(path, { recursive: true, force: true });
});

function directory(): string {
  const path = tempDirectory();
  directories.push(path);
  return path;
}

/** A message with a 3 MB attachment-like body, plus a few ordinary ones. */
function mailbox() {
  const big = mail({ id: 'big', subject: 'Fotos vom Urlaub', body: 'A'.repeat(3 * 1024 * 1024) });
  const small = Array.from({ length: 12 }, (_, index) => ({ raw: mail({ id: `s${index}`, subject: `Kurz ${index}` }) }));
  return { INBOX: [...small, { raw: big }] };
}

type MessageEvent = Extract<ProgressEvent, { type: 'message' }>;
type ProgressUpdate = Extract<ProgressEvent, { type: 'progress' }>;

function collect() {
  const events: ProgressEvent[] = [];
  return {
    onProgress: (event: ProgressEvent) => events.push(event),
    messages: (direction: 'download' | 'upload') =>
      events.filter((event): event is MessageEvent => event.type === 'message' && event.direction === direction),
    progress: () => events.filter((event): event is ProgressUpdate => event.type === 'progress'),
  };
}

describe('progress of large messages and remaining time', () => {
  it('shows a large download step by step and plans only what is new', async () => {
    const user = uniqueUser('progress-down');
    await seed(user, mailbox());
    const target = directory();
    const proxy = await startProxy({ delayMs: 20 });
    const first = collect();
    try {
      const report = await backupAccount({ ...account(user), port: proxy.port }, target, { onProgress: first.onProgress });
      assert.equal(report.status, 'completed', JSON.stringify(report.error));
    } finally {
      proxy.close();
    }

    const download = first.messages('download');
    assert.equal(download[0]?.subject, 'Fotos vom Urlaub');
    assert.ok(download.some((event) => event.transferred > 0 && event.transferred < event.size), 'intermediate steps');
    assert.deepEqual(download.at(-1) && [download.at(-1)?.finished, download.at(-1)?.transferred], [true, download[0]?.size]);
    const planned = first.progress().find((event) => event.remainingMessages > 0);
    assert.equal(planned?.remainingMessages, 13);
    assert.ok((planned?.remainingBytes ?? 0) > 3 * 1024 * 1024);
    assert.deepEqual(first.progress().at(-1) && [first.progress().at(-1)?.remainingMessages, first.progress().at(-1)?.remainingSeconds], [0, 0]);

    // The second run has nothing new to plan: no folder needs to be opened for it.
    const second = collect();
    await backupAccount(account(user), target, { onProgress: second.onProgress });
    assert.ok(second.progress().every((event) => event.remainingMessages === 0));
    assert.equal(second.messages('download').length, 0);
  });

  it('shows a large upload step by step', async () => {
    const source = uniqueUser('progress-src');
    const restored = uniqueUser('progress-up');
    // Larger than what the socket buffers take in at once (up to 4 MB each way on macOS): at
    // least a third of it has to pass the slowed-down proxy, step by step.
    const huge = mail({ id: 'huge', subject: 'Fotos vom Urlaub', body: `${'A'.repeat(998)}\r\n`.repeat(12 * 1024) });
    await seed(source, { INBOX: [...mailbox().INBOX.slice(0, 3), { raw: huge }] });
    const backup = directory();
    assert.equal((await backupAccount(account(source), backup)).status, 'completed');

    const proxy = await startProxy({ uploadBytesPerMs: 4_000 });
    const events = collect();
    try {
      const report = await restoreBackup(backup, { ...account(restored), port: proxy.port }, { onProgress: events.onProgress });
      assert.equal(report.status, 'completed', JSON.stringify(report.error));
    } finally {
      proxy.close();
    }
    const upload = events.messages('upload');
    assert.ok(upload.filter((event) => event.transferred > 0 && event.transferred < event.size).length >= 3, `only ${upload.length} upload events`);
    assert.equal(upload.at(-1)?.finished, true);
    assert.deepEqual(await snapshot(restored), await snapshot(source));
  });

  it('shows download and upload of a large message during a migration', async () => {
    const source = uniqueUser('progress-from');
    const target = uniqueUser('progress-to');
    await seed(source, mailbox());
    const events = collect();
    const report = await migrateAccount(account(source), account(target), { onProgress: events.onProgress });
    assert.equal(report.status, 'completed', JSON.stringify(report.error));
    assert.equal(events.messages('download').at(-1)?.finished, true);
    assert.equal(events.messages('upload').at(-1)?.finished, true);
    assert.equal(events.progress().find((event) => event.remainingMessages > 0)?.remainingMessages, 13);
  });

  it('estimates the remaining time once enough messages went through', async () => {
    const user = uniqueUser('progress-eta');
    await seed(user, { INBOX: Array.from({ length: 40 }, (_, index) => ({ raw: mail({ id: `e${index}`, subject: `Mail ${index}`, body: 'x'.repeat(2_000 * (1 + (index % 7))) }) })) });
    const proxy = await startProxy({ delayMs: 25 });
    const events = collect();
    try {
      await backupAccount({ ...account(user), port: proxy.port }, directory(), { onProgress: events.onProgress });
    } finally {
      proxy.close();
    }
    const estimates = events.progress().filter((event) => event.remainingSeconds !== null && event.remainingMessages > 0);
    assert.ok(estimates.length > 0, 'an estimate appeared while messages were still open');
    assert.ok(estimates.every((event) => (event.remainingSeconds ?? -1) >= 0));
  });
});
