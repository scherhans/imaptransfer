import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ImapFlow } from 'imapflow';
import { fetchHeaders } from '../../src/backup.ts';
import { filterFlags, followFlags, sameFlags } from '../../src/flags.ts';
import { chunk, toSequenceSet } from '../../src/sequence.ts';
import { classifyError, CancelledError } from '../../src/errors.ts';

describe('filterFlags', () => {
  it('drops flags a client cannot or must not set', () => {
    assert.deepEqual(filterFlags(['\\Seen', '\\Recent', '\\Deleted', '$Forwarded']), ['\\Seen', '$Forwarded']);
  });

  it('keeps keywords only when the folder accepts them', () => {
    assert.deepEqual(filterFlags(['\\Seen', '$Label1'], new Set(['\\Seen', '\\Flagged'])), ['\\Seen']);
    assert.deepEqual(filterFlags(['\\Seen', '$Label1'], new Set(['\\Seen', '\\*'])), ['\\Seen', '$Label1']);
    assert.deepEqual(filterFlags(['\\Answered', '\\Custom'], new Set(['\\*'])), ['\\Answered']);
  });
});

describe('followFlags', () => {
  it('takes over read and flagged and leaves every other flag of the target', () => {
    assert.deepEqual(followFlags(['\\Flagged'], ['\\seen', '\\Answered', '$Forwarded', '$label1']), { add: ['\\Flagged'], remove: ['\\Seen'] });
    assert.equal(followFlags(['\\Seen', '\\Answered'], ['\\Seen', '$Junk']), null);
  });
});

describe('sameFlags', () => {
  it('ignores order and case', () => {
    assert.equal(sameFlags(['\\Seen', '$a'], ['$A', '\\seen']), true);
    assert.equal(sameFlags(['\\Seen'], ['\\Seen', '\\Flagged']), false);
  });
});

describe('toSequenceSet', () => {
  it('compresses UID lists into ranges', () => {
    assert.equal(toSequenceSet([9, 1, 2, 3, 7, 10, 3]), '1:3,7,9:10');
    assert.equal(toSequenceSet([5]), '5');
    assert.equal(toSequenceSet([]), '');
  });

  it('chunks lists', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });
});

describe('classifyError', () => {
  it('recognizes the kinds of trouble a job reacts to', () => {
    assert.equal(classifyError(Object.assign(new Error('x'), { authenticationFailed: true })), 'auth');
    assert.equal(classifyError(Object.assign(new Error('x'), { code: 'ECONNRESET' })), 'connection');
    assert.equal(classifyError(Object.assign(new Error('x'), { code: 'ETHROTTLE' })), 'throttle');
    assert.equal(classifyError(Object.assign(new Error('x'), { responseText: 'Account exceeded command or bandwidth limits' })), 'quota');
    assert.equal(classifyError(Object.assign(new Error('x'), { responseText: '[ALERT] Too many simultaneous connections. (Failure)' })), 'throttle');
    assert.equal(classifyError(new CancelledError()), 'cancelled');
    assert.equal(classifyError(new Error('NO message too large')), 'other');
  });

  it('tells a throttled login apart from a wrong password', () => {
    // imapflow flags every NO to LOGIN as a failed authentication; after a dropped connection
    // Gmail answers the login with its connection limit, which is a reason to wait, not to stop.
    const login = (responseText: string) => classifyError(Object.assign(new Error('Command failed'), { authenticationFailed: true, responseText }));
    assert.equal(login('[ALERT] Too many simultaneous connections. (Failure)'), 'throttle');
    assert.equal(login('[UNAVAILABLE] Temporary System Error'), 'throttle');
    assert.equal(login('[AUTHENTICATIONFAILED] Invalid credentials (Failure)'), 'auth');
  });

  it('retries a server that is temporarily busy and stops for a full disk', () => {
    assert.equal(classifyError(Object.assign(new Error('x'), { responseText: '[INUSE] Mailbox is in use, try again later' })), 'throttle');
    assert.equal(classifyError(Object.assign(new Error('x'), { responseText: '[LIMIT] Message too large' })), 'other');
    assert.equal(classifyError(Object.assign(new Error('x'), { code: 'ENOSPC' })), 'storage');
    assert.equal(classifyError(Object.assign(new Error('x'), { code: 'ERR_SQLITE_ERROR', errcode: 13 })), 'storage');
    // Extended result codes carry the primary code in the low byte: SQLITE_IOERR_WRITE.
    assert.equal(classifyError(Object.assign(new Error('x'), { code: 'ERR_SQLITE_ERROR', errcode: 778 })), 'storage');
    assert.equal(classifyError(Object.assign(new Error('x'), { code: 'ERR_SQLITE_ERROR', errcode: 5 })), 'other');
    assert.equal(classifyError(Object.assign(new Error('x'), { code: 'ERR_SSL_WRONG_VERSION_NUMBER' })), 'tls');
  });
});

describe('fetchHeaders', () => {
  /** Expands "1:3,7" the way the test server would read it. */
  const expand = (range: string): number[] =>
    range.split(',').flatMap((part) => {
      const [from, to] = part.split(':').map(Number);
      return to === undefined ? [from!] : Array.from({ length: to - from! + 1 }, (_, index) => from! + index);
    });

  it('cuts a message the server refuses out of the batch instead of failing the folder', async () => {
    const calls: number[][] = [];
    const client = {
      async fetchAll(range: string) {
        const uids = expand(range);
        calls.push(uids);
        if (uids.includes(7)) throw new Error('Command failed: NO [SERVERBUG] Internal error');
        return uids.map((uid) => ({ seq: uid, uid, size: 10, headers: Buffer.from('Subject: a\r\n\r\n') }));
      },
    } as unknown as ImapFlow;
    const { rows, broken } = await fetchHeaders(client, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(rows.map((row) => row.uid), [1, 2, 3, 4, 5, 6, 8, 9, 10]);
    assert.deepEqual(broken.map((entry) => entry.uid), [7]);
    assert.match(broken[0]?.reason ?? '', /SERVERBUG/);
    // Halving: 10 → 5+5 → the half with 7 is split again, the others pass in one go.
    assert.ok(calls.length <= 9, `${calls.length} fetches`);
  });

  it('lets a lost connection through, so the folder is repeated', async () => {
    const client = {
      async fetchAll() {
        throw Object.assign(new Error('Connection not available'), { code: 'NoConnection' });
      },
    } as unknown as ImapFlow;
    await assert.rejects(fetchHeaders(client, [1, 2, 3]), { code: 'NoConnection' });
  });
});
