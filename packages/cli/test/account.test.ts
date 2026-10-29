import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { resolveAccount, writeTokenFile } from '../src/account.ts';
import { exitCode, formatBytes, formatDuration, formatRemaining } from '../src/output.ts';
import type { Report } from '@imaptransfer/core';

describe('resolveAccount', () => {
  it('fills host and port from the provider of the address', async () => {
    process.env.TEST_PASSWORD_GMX = 'pw';
    const account = await resolveAccount({ user: 'anna@gmx.de', passwordEnv: 'TEST_PASSWORD_GMX' }, '');
    assert.equal(account.host, 'imap.gmx.net');
    assert.equal(account.port, 993);
    assert.equal(account.secure, true);
  });

  it('reads source and target options by prefix', async () => {
    process.env.TEST_FROM_PASSWORD = 'secret';
    const account = await resolveAccount({ fromUser: 'x@own.example', fromHost: 'mail.own.example', fromStarttls: true, fromPasswordEnv: 'TEST_FROM_PASSWORD' }, 'from');
    assert.equal(account.port, 143);
    assert.equal(account.secure, false);
    assert.deepEqual(account.auth, { type: 'password', password: 'secret' });
  });

  it('reads the password from a file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'imaptransfer-cli-'));
    try {
      writeFileSync(join(directory, 'pw'), 'from-file\nignored\n');
      const account = await resolveAccount({ user: 'x@own.example', host: 'h', passwordFile: join(directory, 'pw') });
      assert.deepEqual(account.auth, { type: 'password', password: 'from-file' });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('asks for a Microsoft sign-in instead of a password', async () => {
    await assert.rejects(resolveAccount({ user: 'anna@outlook.com' }), /Microsoft sign-in/);
  });

  it('rejects unknown hosts and providers', async () => {
    await assert.rejects(resolveAccount({ user: 'anna@own.example' }), /--host or --provider/);
    await assert.rejects(resolveAccount({ user: 'anna@own.example', provider: 'nope' }), /Unknown provider/);
  });

  it('uses a saved Microsoft sign-in and keeps the token file private', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'imaptransfer-cli-'));
    const path = join(directory, 'token.json');
    try {
      writeTokenFile(path, {
        provider: 'microsoft',
        clientId: 'client',
        tenant: 'common',
        email: 'anna@outlook.com',
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3_600_000,
      });
      if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
      const account = await resolveAccount({ tokenFile: path });
      assert.equal(account.user, 'anna@outlook.com');
      assert.equal(account.host, 'outlook.office365.com');
      assert.equal(account.auth.type, 'oauth2');
      assert.equal(account.auth.type === 'oauth2' && (await account.auth.getAccessToken()), 'access');
      assert.match(readFileSync(path, 'utf8'), /"refreshToken": "refresh"/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('output', () => {
  it('formats sizes and durations', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1_500_000), '1.5 MB');
    assert.equal(formatDuration(75_000), '1m 15s');
    assert.equal(formatDuration(3_900_000), '1h 5m');
  });

  it('rounds the remaining time the way people say it', () => {
    assert.equal(formatRemaining(null), 'estimating time left');
    assert.equal(formatRemaining(42), 'less than a minute left');
    assert.equal(formatRemaining(7 * 60 + 20), 'about 7 min left');
    assert.equal(formatRemaining(23 * 60), 'about 25 min left');
    assert.equal(formatRemaining(2 * 3600 + 17 * 60), 'about 2 h 20 min left');
    assert.equal(formatRemaining(2 * 3600 + 57 * 60), 'about 3 h left');
  });

  it('maps report states to exit codes', () => {
    const report = (status: Report['status'], failed: number) => ({ status, totals: { failed } }) as Report;
    assert.equal(exitCode(report('completed', 0)), 0);
    assert.equal(exitCode(report('completed', 3)), 2);
    assert.equal(exitCode(report('failed', 0)), 1);
    assert.equal(exitCode(report('cancelled', 0)), 130);
  });
});
