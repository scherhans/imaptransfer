import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { describe, it } from 'node:test';
import { createDeflateRaw } from 'node:zlib';
import type { ImapFlow } from 'imapflow';
import { TimeEstimate } from '../../src/estimate.ts';
import { Job, LARGE_MESSAGE_BYTES } from '../../src/job.ts';
import type { ProgressEvent } from '../../src/types.ts';
import { meterUpload } from '../../src/upload-meter.ts';

describe('TimeEstimate', () => {
  it('waits for enough samples before it guesses', () => {
    const estimate = new TimeEstimate();
    assert.equal(estimate.remaining(10, 1_000), null);
    estimate.record(1_000, 5);
    assert.equal(estimate.remaining(10, 1_000), null);
    assert.equal(estimate.remaining(0, 0), 0);
  });

  it('tells round trips and bandwidth apart', () => {
    // 50 ms per message plus 5 MB per second.
    const seconds = (size: number) => 0.05 + size / 5_000_000;
    const estimate = new TimeEstimate();
    const sizes = [30_000, 12_000, 80_000, 4_000_000, 25_000, 60_000, 9_000_000, 15_000, 40_000, 2_500_000];
    for (let round = 0; round < 5; round++) for (const size of sizes) estimate.record(size, seconds(size));
    const { perMessage, perByte } = estimate.model();
    assert.ok(Math.abs(perMessage - 0.05) < 0.005, `perMessage ${perMessage}`);
    assert.ok(Math.abs(perByte - 1 / 5_000_000) < 1e-8, `perByte ${perByte}`);
    // 1 000 small messages and one of 50 MB: counting only messages or only bytes is far off.
    const expected = 1_000 * seconds(20_000) + seconds(50_000_000) - 0.05 * 0;
    const guess = estimate.remaining(1_001, 1_000 * 20_000 + 50_000_000) ?? 0;
    assert.ok(Math.abs(guess - expected) / expected < 0.05, `${guess} vs ${expected}`);
  });

  it('does not take a large message pending after many small ones for thousands of small ones', () => {
    // Only small messages so far, 0.16 s each: almost all of it is round trips.
    const estimate = new TimeEstimate();
    for (let index = 0; index < 40; index++) estimate.record(3_000, 0.16);
    const withDefault = estimate.remaining(1, 4_200_000) ?? 0;
    assert.ok(withDefault > 1.5 && withDefault < 3, `with the default bandwidth: ${withDefault}`);
    // A large message showed 4 MB/s.
    estimate.recordStream(4_000_000, 1);
    const measured = estimate.remaining(121, 120 * 3_000 + 4_200_000) ?? 0;
    const expected = 121 * 0.16 + 4_200_000 / 4_000_000;
    assert.ok(Math.abs(measured - expected) / expected < 0.05, `${measured} vs ${expected}`);
  });

  it('counts slow small messages fully when the bandwidth cannot explain them', () => {
    const estimate = new TimeEstimate();
    for (let index = 0; index < 20; index++) estimate.record(10_000_000, 2);
    // 10 MB in 2 s is slower than the 2 MB/s default: all time goes to bandwidth.
    assert.ok(Math.abs((estimate.remaining(10, 100_000_000) ?? 0) - 20) < 0.01);
  });
});

/** A connection that takes 2 ms for every chunk it is handed. */
function slowSink(): { stream: Writable; received: Buffer[] } {
  const received: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      received.push(chunk);
      setTimeout(callback, 2);
    },
  });
  return { stream, received };
}

describe('meterUpload', () => {
  it('reports a large write slice by slice and keeps the order of all writes', async () => {
    const sink = slowSink();
    const original = sink.stream.write;
    const client = { writeSocket: sink.stream } as unknown as ImapFlow;
    const sent: number[] = [];
    const detach = meterUpload(client, (bytes) => sent.push(bytes));
    const body = Buffer.alloc(2 * 1024 * 1024, 'x');
    sink.stream.write('A001 APPEND INBOX {2097152}\r\n');
    sink.stream.write(body);
    await new Promise<void>((resolve) => sink.stream.write('\r\n', () => resolve()));
    detach();
    assert.ok(sent.length >= 8, `only ${sent.length} updates`);
    assert.deepEqual([...sent].sort((a, b) => a - b), sent, 'progress only goes forward');
    assert.equal(sent.at(-1), 29 + body.length + 2);
    assert.equal(Buffer.concat(sink.received).toString(), `A001 APPEND INBOX {2097152}\r\n${body.toString()}\r\n`);
    assert.equal(sink.stream.write, original, 'detached after the queue drained');
  });

  it('also measures in front of a compressor, as with COMPRESS=DEFLATE', async () => {
    const sink = slowSink();
    const front = new PassThrough();
    front.pipe(createDeflateRaw()).pipe(sink.stream);
    const sent: number[] = [];
    const detach = meterUpload({ writeSocket: front } as unknown as ImapFlow, (bytes) => sent.push(bytes));
    // Random data does not compress, so the compressor cannot swallow it at once.
    const body = Buffer.from(Array.from({ length: 2 * 1024 * 1024 }, () => Math.floor(Math.random() * 256)));
    await new Promise<void>((resolve) => front.write(body, () => resolve()));
    detach();
    assert.ok(sent.length >= 4, `only ${sent.length} updates`);
    assert.equal(sent.at(-1), body.length);
  });

  it('does nothing without imapflow write stream', () => {
    const detach = meterUpload({} as ImapFlow, () => assert.fail('no progress expected'));
    detach();
  });
});

describe('Job', () => {
  it('reports progress of large messages only, and their end', () => {
    const events: ProgressEvent[] = [];
    const job = new Job('backup', { onProgress: (event) => events.push(event) });
    assert.equal(job.trackMessage('download', 'small', LARGE_MESSAGE_BYTES - 1), null);
    const progress = job.trackMessage('upload', 'big', 5 * LARGE_MESSAGE_BYTES);
    progress?.update(LARGE_MESSAGE_BYTES);
    progress?.finish();
    progress?.finish();
    const messages = events.filter((event) => event.type === 'message');
    assert.deepEqual(
      messages.map((event) => [event.transferred, event.finished]),
      [
        [0, false],
        [5 * LARGE_MESSAGE_BYTES, true],
      ],
      'updates within 100 ms are left out, the end always comes once',
    );
  });

  it('counts down the planned work', () => {
    const events: ProgressEvent[] = [];
    const job = new Job('restore', { onProgress: (event) => events.push(event) });
    job.setTotal(3);
    job.addWork(3, 3_000);
    job.reduceWork(1, 1_000);
    job.reduceWork(5, 5_000);
    job.advance(3);
    const last = events.filter((event) => event.type === 'progress').at(-1);
    assert.deepEqual(last && [last.remainingMessages, last.remainingBytes, last.remainingSeconds], [0, 0, 0]);
  });
});
