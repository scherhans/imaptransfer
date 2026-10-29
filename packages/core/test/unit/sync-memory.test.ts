import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { SyncMemory } from '../../src/sync-memory.ts';

const pair = { source: { user: 'anna@firma.de', host: 'mail.agenturserver.de' }, target: { user: 'anna@firma.de', host: 'imap.ionos.de' } };

describe('SyncMemory', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'imaptransfer-memory-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('remembers what each folder held, folder by folder, also after reopening', () => {
    const file = join(directory, 'nested', 'pair.db');
    assert.equal(SyncMemory.knows(file, pair), false);
    const memory = SyncMemory.open(file, pair);
    assert.equal(memory.remembers, false);
    assert.equal(memory.reset, false);
    memory.remember(new Map([['INBOX', new Set(['a', 'b'])], ['Archiv', new Set()]]));
    memory.remember(new Map([['INBOX', new Set(['b', 'c'])]]));
    memory.close();

    // Case does not make another pair of accounts.
    const upper = { source: { user: 'Anna@Firma.de', host: 'MAIL.agenturserver.de' }, target: pair.target };
    assert.equal(SyncMemory.knows(file, upper), true);
    const again = SyncMemory.open(file, upper);
    assert.equal(again.remembers, true);
    assert.deepEqual([...again.seen('INBOX')].sort(), ['b', 'c']);
    assert.deepEqual([...again.seen('Archiv')], []);
    again.close();
  });

  it('starts afresh for another pair of accounts, and says so', () => {
    const file = join(directory, 'pair.db');
    const memory = SyncMemory.open(file, pair);
    memory.remember(new Map([['INBOX', new Set(['a'])]]));
    memory.close();

    const other = { source: { user: 'bob@firma.de', host: 'mail.agenturserver.de' }, target: pair.target };
    assert.equal(SyncMemory.knows(file, other), false);
    const fresh = SyncMemory.open(file, other);
    assert.equal(fresh.reset, true);
    assert.equal(fresh.remembers, false);
    assert.deepEqual([...fresh.seen('INBOX')], []);
    fresh.close();
    // The first pair's memory is gone with it: it no longer belongs to the file.
    assert.equal(SyncMemory.knows(file, pair), false);
  });
});
