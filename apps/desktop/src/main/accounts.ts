import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { safeStorage } from 'electron';
import { BackupStore, microsoftProvider, OAuthTokenSource, type AccountConfig, type OAuthTokens } from '@imaptransfer/core';
import type { AccountDraft, AccountSummary, LastBackup } from '../shared/api';

export type AccountSecret =
  | { type: 'password'; password: string }
  | { type: 'oauth-microsoft'; tokens: OAuthTokens; clientId: string; tenant: string };

interface StoredAccount extends AccountSummary {
  /** Encrypted with the operating system's key store (Keychain, DPAPI, libsecret). */
  secret: string;
}

interface AccountsFile {
  version: 1;
  accounts: StoredAccount[];
}

const PLAIN_PREFIX = 'plain:';

export async function secretStorageStrength(): Promise<'os' | 'weak'> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return 'weak';
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return 'weak';
  return 'os';
}

async function encrypt(secret: AccountSecret): Promise<string> {
  const json = JSON.stringify(secret);
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return PLAIN_PREFIX + Buffer.from(json, 'utf8').toString('base64');
  return (await safeStorage.encryptStringAsync(json)).toString('base64');
}

/**
 * Accounts saved before the last backup knew its folder: it is the chosen folder if a backup
 * lies there, and unknown otherwise.
 */
function withBackupFolder(account: StoredAccount): StoredAccount {
  const last = account.lastBackup;
  if (!last || 'directory' in last) return account;
  const directory = account.backupDirectory && BackupStore.exists(account.backupDirectory) ? account.backupDirectory : null;
  return { ...account, lastBackup: { ...(last as Omit<LastBackup, 'directory'>), directory } };
}

function summary(account: StoredAccount): AccountSummary {
  const { secret: _secret, ...rest } = account;
  return rest;
}

/** Accounts live in one JSON file in the app's data folder; secrets are encrypted per account. */
export class AccountStore {
  private readonly file: string;
  private accounts: StoredAccount[];
  /** What went wrong reading the file, for the window to show; the accounts are not lost. */
  readonly problem: string | null;
  /** The file could not be read at all: saving would overwrite accounts that still exist. */
  private readonly locked: boolean;

  constructor(file: string) {
    this.file = file;
    const loaded = this.load();
    this.accounts = loaded.accounts;
    this.problem = loaded.problem;
    this.locked = loaded.locked;
  }

  private load(): { accounts: StoredAccount[]; problem: string | null; locked: boolean } {
    let raw: string;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch (error) {
      // No file yet is the normal first start; anything else must not look like it.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { accounts: [], problem: null, locked: false };
      return { accounts: [], problem: `The account file cannot be read (${(error as Error).message}). Accounts cannot be saved until this is fixed.`, locked: true };
    }
    try {
      const content = JSON.parse(raw) as AccountsFile;
      if (!Array.isArray(content.accounts)) throw new Error('no account list');
      return { accounts: content.accounts.map(withBackupFolder), problem: null, locked: false };
    } catch (error) {
      // Damaged (a power cut, a sync tool): kept aside, never overwritten with an empty list.
      const kept = `${this.file}.broken-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try {
        renameSync(this.file, kept);
      } catch {
        return { accounts: [], problem: `The account file is damaged (${(error as Error).message}) and could not be moved aside.`, locked: true };
      }
      return { accounts: [], problem: `The account file was damaged (${(error as Error).message}). It was kept as ${kept}; the accounts have to be added again.`, locked: false };
    }
  }

  private persist(): void {
    if (this.locked) throw new Error(this.problem ?? 'The account file cannot be written.');
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    const content: AccountsFile = { version: 1, accounts: this.accounts };
    // On disk before the rename: a power cut must not leave an empty account file behind.
    const handle = openSync(temporary, 'w', 0o600);
    try {
      writeSync(handle, JSON.stringify(content, null, 2));
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(temporary, this.file);
  }

  list(): AccountSummary[] {
    return this.accounts.map(summary);
  }

  private find(id: string): StoredAccount {
    const account = this.accounts.find((candidate) => candidate.id === id);
    if (!account) throw new Error('This account no longer exists.');
    return account;
  }

  /** Decrypts a secret; re-encrypts it when the operating system rotated its key. */
  private async secretOf(account: StoredAccount): Promise<AccountSecret> {
    if (account.secret.startsWith(PLAIN_PREFIX)) {
      return JSON.parse(Buffer.from(account.secret.slice(PLAIN_PREFIX.length), 'base64').toString('utf8')) as AccountSecret;
    }
    let result: string;
    let shouldReEncrypt: boolean;
    try {
      ({ result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(account.secret, 'base64')));
    } catch {
      // The key in the operating system's key store is gone or belongs to another app name
      // (the app was renamed, the keychain was reset): only the user can supply the secret again.
      throw new Error(`The stored password of ${account.user} cannot be read any more. Please edit the account and enter the password again.`);
    }
    const secret = JSON.parse(result) as AccountSecret;
    if (shouldReEncrypt) {
      account.secret = await encrypt(secret);
      this.persist();
    }
    return secret;
  }

  /** Creates or updates an account. Without a new secret, an existing account keeps its old one. */
  async save(draft: AccountDraft, secret: AccountSecret | null): Promise<AccountSummary> {
    const fields = {
      user: draft.user.trim(),
      host: draft.host.trim(),
      port: draft.port,
      secure: draft.secure,
      allowSelfSigned: draft.allowSelfSigned,
      providerId: draft.providerId,
      auth: draft.auth,
    };
    if (draft.id) {
      const existing = this.find(draft.id);
      if (!secret && (await this.secretOf(existing)).type !== draft.auth) throw new Error('Please enter the password or sign in again.');
      const encrypted = secret ? await encrypt(secret) : existing.secret;
      Object.assign(existing, fields, { secret: encrypted });
      this.persist();
      return summary(existing);
    }
    if (!secret) throw new Error('Please enter the password or sign in.');
    const account: StoredAccount = { id: randomUUID(), ...fields, backupDirectory: null, lastBackup: null, secret: await encrypt(secret) };
    this.accounts.push(account);
    this.persist();
    return summary(account);
  }

  update(id: string, patch: Partial<Pick<AccountSummary, 'backupDirectory' | 'lastBackup'>>): AccountSummary {
    const account = this.find(id);
    Object.assign(account, patch);
    this.persist();
    return summary(account);
  }

  remove(id: string): void {
    this.accounts = this.accounts.filter((account) => account.id !== id);
    this.persist();
  }

  /** Connection settings for the engine; a refreshed sign-in is written back right away. */
  async config(id: string): Promise<AccountConfig> {
    const account = this.find(id);
    const secret = await this.secretOf(account);
    return toConfig(account, secret, (tokens) => {
      if (secret.type !== 'oauth-microsoft') return;
      void encrypt({ ...secret, tokens })
        .then((encrypted) => {
          account.secret = encrypted;
          this.persist();
        })
        .catch((error: unknown) => {
          // The run goes on with the token it has; the next refresh tries to store it again.
          console.error('Could not store the refreshed sign-in:', error);
        });
    });
  }

  /**
   * Settings from the editor, before saving: uses the new secret or the stored one. The stored
   * one is only read when nothing new was entered: it may be unreadable (the key store changed),
   * and entering a new password is exactly the way out of that.
   */
  async draftConfig(draft: AccountDraft, secret: AccountSecret | null): Promise<AccountConfig> {
    const stored = secret === null && draft.id ? await this.secretOf(this.find(draft.id)) : null;
    const effective = secret ?? (stored?.type === draft.auth ? stored : null);
    if (!effective) throw new Error('Please enter the password or sign in.');
    return toConfig({ ...draft, user: draft.user.trim(), host: draft.host.trim() }, effective);
  }
}

function toConfig(
  account: Pick<AccountSummary, 'user' | 'host' | 'port' | 'secure' | 'allowSelfSigned'>,
  secret: AccountSecret,
  onRefresh?: (tokens: OAuthTokens) => void,
): AccountConfig {
  const base = { host: account.host, port: account.port, secure: account.secure, user: account.user, allowSelfSigned: account.allowSelfSigned };
  if (secret.type === 'password') return { ...base, auth: { type: 'password', password: secret.password } };
  const source = new OAuthTokenSource(microsoftProvider(secret.clientId, secret.tenant), secret.tokens, onRefresh);
  return { ...base, auth: { type: 'oauth2', getAccessToken: () => source.getAccessToken() } };
}
