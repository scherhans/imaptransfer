import { readFileSync, writeFileSync } from 'node:fs';
import {
  detectProvider,
  findProvider,
  microsoftProvider,
  OAuthTokenSource,
  type AccountConfig,
  type OAuthTokens,
} from '@imaptransfer/core';
import type { Command } from 'commander';
import { promptHidden } from './prompt.ts';

export interface TokenFile {
  provider: 'microsoft';
  clientId: string;
  tenant: string;
  email: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

export class UsageError extends Error {}

function flagName(prefix: string, name: string): string {
  return prefix ? `${prefix}-${name}` : name;
}

function optionKey(prefix: string, name: string): string {
  return flagName(prefix, name).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** Adds the options that describe one account; `prefix` tells source and target apart. */
export function addAccountOptions(command: Command, prefix = '', label = 'the account'): Command {
  const flag = (name: string) => `--${flagName(prefix, name)}`;
  const envName = `IMAPTRANSFER_${prefix ? `${prefix.toUpperCase()}_` : ''}PASSWORD`;
  return command
    .option(`${flag('user')} <login>`, `login of ${label}, usually the email address`)
    .option(`${flag('provider')} <id>`, 'known provider, e.g. gmail, microsoft, gmx (see "imaptransfer providers")')
    .option(`${flag('host')} <host>`, 'IMAP server, if the provider is not known')
    .option(`${flag('port')} <port>`, 'IMAP port (default 993, or 143 with --starttls)')
    .option(flag('starttls'), 'connect without TLS first and upgrade with STARTTLS')
    .option(`${flag('password-env')} <variable>`, 'environment variable holding the password', envName)
    .option(`${flag('password-file')} <path>`, 'file whose first line is the password')
    .option(`${flag('token-file')} <path>`, 'Microsoft sign-in saved by "imaptransfer login microsoft"')
    .option(flag('insecure'), 'accept self-signed certificates (own servers only)');
}

function readTokenFile(path: string): TokenFile {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as TokenFile;
  } catch (error) {
    throw new UsageError(`Cannot read token file ${path}: ${(error as Error).message}`);
  }
}

/** The first line of the file, without a byte order mark an editor may have added. */
function readPasswordFile(path: string): string | undefined {
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    throw new UsageError(`Cannot read password file ${path}: ${(error as Error).message}`);
  }
  return content.replace(/^﻿/, '').split(/\r?\n/)[0];
}

export function writeTokenFile(path: string, content: TokenFile): void {
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
}

export async function resolveAccount(options: Record<string, unknown>, prefix = ''): Promise<AccountConfig> {
  const value = (name: string) => options[optionKey(prefix, name)];
  const text = (name: string) => {
    const raw = value(name);
    return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
  };

  const tokenPath = text('token-file');
  const token = tokenPath ? readTokenFile(tokenPath) : undefined;
  const user = text('user') ?? token?.email ?? undefined;
  if (!user) throw new UsageError(`Missing --${flagName(prefix, 'user')}`);

  const providerId = text('provider') ?? (token ? 'microsoft' : undefined);
  const preset = providerId ? findProvider(providerId) : text('host') ? undefined : detectProvider(user);
  if (providerId && !preset) throw new UsageError(`Unknown provider "${providerId}". See "imaptransfer providers".`);
  const host = text('host') ?? preset?.host;
  if (!host) throw new UsageError(`Unknown provider for ${user}: give --${flagName(prefix, 'host')} or --${flagName(prefix, 'provider')}`);
  const secure = value('starttls') ? false : (preset?.secure ?? true);
  const port = text('port') ? Number(text('port')) : (preset?.port && secure === preset.secure ? preset.port : secure ? 993 : 143);
  if (!Number.isInteger(port) || port <= 0) throw new UsageError(`Invalid port ${text('port')}`);
  const base = { host, port, secure, user, allowSelfSigned: Boolean(value('insecure')) };

  if (token && tokenPath) {
    const tokens: OAuthTokens = { accessToken: token.accessToken, refreshToken: token.refreshToken, expiresAt: token.expiresAt, email: token.email };
    const source = new OAuthTokenSource(microsoftProvider(token.clientId, token.tenant), tokens, (updated) =>
      writeTokenFile(tokenPath, { ...token, ...updated, refreshToken: updated.refreshToken ?? token.refreshToken }),
    );
    return { ...base, auth: { type: 'oauth2', getAccessToken: () => source.getAccessToken() } };
  }
  if (preset?.auth === 'oauth-microsoft') {
    throw new UsageError(`${preset.name} needs a Microsoft sign-in: run "imaptransfer login microsoft --token-file <path>" and pass --${flagName(prefix, 'token-file')}.`);
  }

  const passwordFile = text('password-file');
  const passwordEnv = text('password-env');
  let password = passwordFile ? readPasswordFile(passwordFile) : passwordEnv ? process.env[passwordEnv] : undefined;
  if (!password) {
    const hint = preset?.auth === 'app-password' ? ` (${preset.name} needs an app password${preset.helpUrl ? `: ${preset.helpUrl}` : ''})` : '';
    password = await promptHidden(`Password for ${user}${hint}: `);
  }
  return { ...base, auth: { type: 'password', password } };
}
