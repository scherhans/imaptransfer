import type { Writable } from 'node:stream';
import type { ImapFlow } from 'imapflow';

const SLICE = 256 * 1024;

type WriteCallback = (error?: Error | null) => void;

interface QueuedWrite {
  data: Buffer;
  offset: number;
  callback: WriteCallback | undefined;
}

function isWritable(value: unknown): value is Writable {
  return typeof value === 'object' && value !== null && typeof (value as Writable).write === 'function' && typeof (value as Writable).on === 'function';
}

/**
 * Reports how far a large upload got. imapflow writes a whole message to the connection in one
 * go and Node hands it to the network as one block, so every byte counter jumps to the end at
 * once. While an APPEND runs, this passes its writes on in 256 KB slices, each one only after
 * the previous one reached the network stack, and counts every slice as sent. Measured against
 * an unpaced upload of 20 MB: same speed, bytes unchanged.
 *
 * It wraps imapflow's internal write stream (with COMPRESS active, the stream in front of the
 * compressor, so the count is in uncompressed bytes). Without that stream, for example after a
 * change in imapflow, uploads simply run without progress. Returns a function that detaches.
 */
export function meterUpload(client: ImapFlow, onSent: (bytes: number) => void): () => void {
  const target = (client as unknown as { writeSocket?: unknown }).writeSocket;
  if (!isWritable(target)) return () => {};
  const stream = target;
  const original = stream.write;
  const writeSlice = original as unknown as (this: Writable, chunk: Buffer, callback: WriteCallback) => boolean;
  const queue: QueuedWrite[] = [];
  let writing = false;
  let detached = false;
  let sent = 0;

  const restore = () => {
    if (stream.write === paced) stream.write = original;
  };

  const pump = (): void => {
    if (writing) return;
    const item = queue[0];
    if (!item) {
      if (detached) restore();
      return;
    }
    writing = true;
    const slice = item.data.subarray(item.offset, item.offset + SLICE);
    writeSlice.call(stream, slice, (error?: Error | null) => {
      writing = false;
      if (error) {
        // The connection broke; imapflow learns that from the stream's own error event.
        for (const entry of queue.splice(0)) entry.callback?.(error);
        restore();
        return;
      }
      item.offset += slice.length;
      sent += slice.length;
      if (!detached) onSent(sent);
      if (item.offset >= item.data.length) {
        queue.shift();
        item.callback?.();
      }
      pump();
    });
  };

  function paced(chunk: unknown, encoding?: unknown, callback?: unknown): boolean {
    const done = (typeof encoding === 'function' ? encoding : typeof callback === 'function' ? callback : undefined) as WriteCallback | undefined;
    const data = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === 'string'
        ? Buffer.from(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8')
        : Buffer.from(chunk as Uint8Array);
    queue.push({ data, offset: 0, callback: done });
    pump();
    // Order is kept by the queue; imapflow does not wait for backpressure on its writes.
    return true;
  }

  stream.write = paced as Writable['write'];
  return () => {
    detached = true;
    if (queue.length === 0 && !writing) restore();
  };
}
