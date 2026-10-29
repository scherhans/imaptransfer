import { ImapFlow } from 'imapflow';
import { CancelledError, classifyError, describeError, isRetryable } from './errors.ts';
import { listFolders, readLayout, type AccountLayout } from './folders.ts';
import { Job, sleep } from './job.ts';
import type { AccountConfig, ErrorKind } from './types.ts';
import { VERSION } from './version.ts';

const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const MAX_THROTTLE_PAUSE_MS = 5 * 60_000;

export async function createClient(account: AccountConfig): Promise<ImapFlow> {
  const auth =
    account.auth.type === 'password'
      ? { user: account.user, pass: account.auth.password }
      : { user: account.user, accessToken: await account.auth.getAccessToken() };
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    // Never send credentials in clear text, unless a local test server asks for it.
    doSTARTTLS: account.secure || account.allowPlaintext ? undefined : true,
    auth,
    logger: false,
    clientInfo: { name: 'imaptransfer', version: VERSION },
    disableAutoIdle: true,
    tls: account.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
  });
  // Errors surface through the command that fails; without a listener they would crash the process.
  client.on('error', () => {});
  await client.connect();
  return client;
}

/**
 * One IMAP connection that survives network trouble. The first connect fails fast (wrong host,
 * wrong password); after that, connection and throttling errors reconnect with a growing pause.
 */
export class Session {
  private readonly account: AccountConfig;
  private readonly job: Job;
  private client: ImapFlow | null = null;
  private connectedOnce = false;

  constructor(account: AccountConfig, job: Job) {
    this.account = account;
    this.job = job;
    job.signal?.addEventListener('abort', () => this.drop(), { once: true });
  }

  async connect(): Promise<ImapFlow> {
    this.job.throwIfAborted();
    if (this.client?.usable) return this.client;
    this.drop();
    const client = await createClient(this.account);
    try {
      // Cancelled while connecting: the abort listener found no client to drop yet.
      this.job.throwIfAborted();
      // imapflow opens a folder it has not listed yet by sending its name as a LIST pattern, where
      // "*" and "%" are wildcards: a folder called "*wichtig*" could not be opened after a reconnect.
      await client.list();
    } catch (error) {
      client.close();
      throw error;
    }
    this.client = client;
    this.connectedOnce = true;
    return client;
  }

  /** Runs a task that is safe to repeat; reconnects and repeats it after a connection error. */
  async run<T>(task: (client: ImapFlow, attempt: number) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await task(await this.connect(), attempt);
      } catch (error) {
        if (this.job.aborted) throw new CancelledError();
        const kind = classifyError(error);
        if (!this.connectedOnce || !isRetryable(kind) || attempt >= MAX_ATTEMPTS) throw error;
        // A server may ask for a long pause; more than five minutes is not worth sitting out.
        const throttleReset = Math.min((error as { throttleReset?: number }).throttleReset ?? 0, MAX_THROTTLE_PAUSE_MS);
        const delayMs = Math.max(BACKOFF_MS[attempt - 1] ?? 60_000, throttleReset);
        this.job.emit({ type: 'retry', attempt, delayMs, reason: describeError(error) });
        this.drop();
        await sleep(delayMs, this.job.signal);
      }
    }
  }

  drop(): void {
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      client.close();
    } catch {
      // Already closed.
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

/** Folders of an account with message counts, plus what the server supports. */
export async function inspectAccount(account: AccountConfig): Promise<AccountLayout> {
  const client = await createClient(account);
  try {
    return await readLayout(client, { counts: true });
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

export type ConnectionTestResult =
  | { ok: true; folders: number; gmail: boolean; uidplus: boolean }
  | { ok: false; kind: ErrorKind; message: string };

export async function testConnection(account: AccountConfig): Promise<ConnectionTestResult> {
  let client: ImapFlow | null = null;
  try {
    client = await createClient(account);
    const folders = await listFolders(client);
    return {
      ok: true,
      folders: folders.length,
      gmail: client.capabilities.has('X-GM-EXT-1'),
      uidplus: client.capabilities.has('UIDPLUS'),
    };
  } catch (error) {
    return { ok: false, kind: classifyError(error), message: describeError(error) };
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  }
}
