import { mkdtempSync } from 'node:fs';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImapFlow } from 'imapflow';
import type { AccountConfig } from '../../src/types.ts';

// GreenMail runs with authentication disabled: every new user name is a fresh, empty account.
let counter = 0;
export function uniqueUser(name: string): string {
  counter++;
  return `${name}-${process.pid}-${Date.now()}-${counter}`;
}

export function account(user: string): AccountConfig {
  return {
    host: '127.0.0.1',
    port: Number(process.env.GREENMAIL_IMAPS_PORT ?? 3993),
    secure: true,
    allowSelfSigned: true,
    user,
    auth: { type: 'password', password: 'secret' },
  };
}

/** The test server without TLS, so a proxy can read the conversation. */
export function plainAccount(user: string, port: number): AccountConfig {
  return { ...account(user), port, secure: false, allowPlaintext: true };
}

const PLAIN_PORT = Number(process.env.GREENMAIL_IMAP_PORT ?? 3143);

export interface TestProxy {
  port: number;
  drops: () => number;
  close: () => void;
}

/**
 * A TCP proxy in front of the test server. `delayMs` slows every server answer down,
 * `uploadBytesPerMs` caps what the client can send; `drop` cuts the first connection once it
 * carried that many bytes in one direction, or once a chunk matches (that chunk never arrives).
 * Matching needs to read the conversation: the proxy then talks to the server without TLS, and
 * the client connects with `plainAccount`.
 */
export async function startProxy(
  options: {
    delayMs?: number;
    uploadBytesPerMs?: number;
    /**
     * `skipMatches` lets that many matching chunks through before the cut; `afterForwarding`
     * delivers the matching chunk and cuts right after it, like a connection that dies between
     * two commands.
     */
    drop?: { direction: 'download' | 'upload'; afterBytes?: number; matching?: RegExp; skipMatches?: number; afterForwarding?: boolean };
  } = {},
): Promise<TestProxy> {
  let drops = 0;
  const sockets = new Set<Socket>();
  const upstreamPort = options.drop?.matching ? PLAIN_PORT : account('x').port;
  const server = createServer((client) => {
    const upstream = connect(upstreamPort, '127.0.0.1');
    sockets.add(client).add(upstream);
    const mayDrop = drops === 0;
    let bytes = 0;
    let matches = 0;
    const cut = () => {
      drops++;
      client.destroy();
      upstream.destroy();
    };
    /** Whether this chunk is the one to cut at; with `afterForwarding` the caller cuts after writing it. */
    const reaches = (chunk: Buffer): boolean => {
      bytes += chunk.length;
      const matched = options.drop?.matching ? options.drop.matching.test(chunk.toString('latin1')) : false;
      if (matched) matches++;
      const reached = options.drop?.matching ? matched && matches > (options.drop.skipMatches ?? 0) : bytes > (options.drop?.afterBytes ?? Infinity);
      return Boolean(options.drop) && mayDrop && drops === 0 && reached;
    };
    upstream.on('data', (chunk: Buffer) => {
      const cutHere = options.drop?.direction === 'download' && reaches(chunk);
      if (cutHere && !options.drop?.afterForwarding) {
        cut();
        return;
      }
      const deliver = () => {
        client.write(chunk, () => {
          if (cutHere) cut();
        });
      };
      if (!options.delayMs) {
        deliver();
        return;
      }
      upstream.pause();
      setTimeout(() => {
        deliver();
        upstream.resume();
      }, options.delayMs);
    });
    client.on('data', (chunk: Buffer) => {
      if (options.drop?.direction === 'upload' && reaches(chunk)) {
        cut();
        return;
      }
      upstream.write(chunk);
      if (options.uploadBytesPerMs) {
        client.pause();
        setTimeout(() => client.resume(), Math.ceil(chunk.length / options.uploadBytesPerMs!));
      }
    });
    for (const [a, b] of [[client, upstream], [upstream, client]] as const) {
      a.on('error', () => b.destroy());
      a.on('close', () => b.destroy());
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    drops: () => drops,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

export function tempDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'imaptransfer-it-'));
}

export async function withClient<T>(user: string, work: (client: ImapFlow) => Promise<T>): Promise<T> {
  const config = account(user);
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    tls: { rejectUnauthorized: false },
    auth: { user, pass: 'secret' },
    logger: false,
  });
  client.on('error', () => {});
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.logout();
  }
}

export function mail(input: { id: string; subject: string; from?: string; date?: string; body?: string }): string {
  return [
    `Message-ID: <${input.id}@test.imaptransfer>`,
    `Date: ${input.date ?? 'Mon, 03 Jun 2024 10:00:00 +0200'}`,
    `From: ${input.from ?? 'Anna Beispiel <anna@example.com>'}`,
    'To: bert@example.com',
    `Subject: ${input.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.body ?? `Text of ${input.subject}`,
    '',
  ].join('\r\n');
}

export interface SeedMessage {
  raw: string;
  flags?: string[];
  internalDate?: Date;
}

export async function seed(user: string, folders: Record<string, SeedMessage[]>): Promise<void> {
  await withClient(user, async (client) => {
    for (const [path, messages] of Object.entries(folders)) {
      if (path !== 'INBOX') await client.mailboxCreate(path);
      for (const message of messages) {
        await client.append(path, message.raw, message.flags ?? [], message.internalDate);
      }
    }
  });
}

export interface SnapshotMessage {
  subject: string;
  flags: string[];
  internalDate: string;
}

/** Every folder with its messages, sorted, without flags the server sets on its own. */
export async function snapshot(user: string): Promise<Record<string, SnapshotMessage[]>> {
  return withClient(user, async (client) => {
    const result: Record<string, SnapshotMessage[]> = {};
    for (const folder of await client.list()) {
      if (folder.flags.has('\\Noselect')) continue;
      const lock = await client.getMailboxLock(folder.path, { readOnly: true });
      try {
        const messages: SnapshotMessage[] = [];
        if (client.mailbox && client.mailbox.exists > 0) {
          for await (const message of client.fetch('1:*', { envelope: true, flags: true, internalDate: true })) {
            messages.push({
              subject: message.envelope?.subject ?? '',
              flags: [...(message.flags ?? [])].filter((flag) => flag !== '\\Recent').sort(),
              internalDate: new Date(message.internalDate ?? 0).toISOString(),
            });
          }
        }
        result[folder.path] = messages.sort((a, b) => a.subject.localeCompare(b.subject));
      } finally {
        lock.release();
      }
    }
    return result;
  });
}
