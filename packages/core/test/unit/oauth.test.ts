import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { authorizeInteractive, OAuthTokenSource, type OAuthProvider } from '../../src/oauth.ts';

/** A stand-in for Microsoft's token endpoint that checks the PKCE verifier. */
let server: Server;
let base = '';
const challenges = new Map<string, string>();
const requests: URLSearchParams[] = [];

function idToken(email: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ email })}.`;
}

before(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      const params = new URLSearchParams(body);
      requests.push(params);
      const reply = (status: number, json: object) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(json));
      };
      if (params.get('grant_type') === 'refresh_token') {
        reply(200, { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 });
        return;
      }
      const verifier = params.get('code_verifier') ?? '';
      const expected = challenges.get(params.get('code') ?? '');
      if (createHash('sha256').update(verifier).digest('base64url') !== expected) {
        reply(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        return;
      }
      reply(200, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, id_token: idToken('anna@outlook.com') });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

function provider(): OAuthProvider {
  return { id: 'microsoft', authorizeUrl: `${base}/authorize`, tokenUrl: `${base}/token`, scopes: ['imap', 'offline_access'], clientId: 'client', redirectHost: '127.0.0.1' };
}

/** Plays the browser: reads the authorization URL and calls the loopback redirect. */
function browser(answer: (url: URL) => string) {
  return async (authorizeUrl: string) => {
    const url = new URL(authorizeUrl);
    const redirect = url.searchParams.get('redirect_uri') ?? '';
    const code = `code-${Math.random()}`;
    challenges.set(code, url.searchParams.get('code_challenge') ?? '');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('login_hint'), 'anna@outlook.com');
    void fetch(`${redirect}/?${answer(url).replace('{code}', code)}`).catch(() => undefined);
  };
}

describe('authorizeInteractive', () => {
  it('signs in with PKCE through the loopback redirect', async () => {
    const tokens = await authorizeInteractive(provider(), {
      loginHint: 'anna@outlook.com',
      openBrowser: browser((url) => `code={code}&state=${url.searchParams.get('state')}`),
    });
    assert.equal(tokens.accessToken, 'access-1');
    assert.equal(tokens.refreshToken, 'refresh-1');
    assert.equal(tokens.email, 'anna@outlook.com');
    assert.ok(tokens.expiresAt > Date.now());
    const exchange = requests.at(-1);
    assert.equal(exchange?.get('grant_type'), 'authorization_code');
    assert.match(exchange?.get('redirect_uri') ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('ignores a redirect with a foreign state and reports a refusal', async () => {
    const result = authorizeInteractive(provider(), {
      loginHint: 'anna@outlook.com',
      timeoutMs: 3_000,
      openBrowser: async (authorizeUrl) => {
        const url = new URL(authorizeUrl);
        const redirect = url.searchParams.get('redirect_uri') ?? '';
        // A page from elsewhere guessing the port must not complete the sign-in.
        await fetch(`${redirect}/?code=stolen&state=wrong`).catch(() => undefined);
        await fetch(`${redirect}/?error=access_denied&error_description=User%20cancelled&state=${url.searchParams.get('state')}`).catch(() => undefined);
      },
    });
    await assert.rejects(result, /User cancelled/);
  });

  it('gives up after the timeout', async () => {
    await assert.rejects(authorizeInteractive(provider(), { loginHint: 'anna@outlook.com', timeoutMs: 200, openBrowser: () => undefined }), /timed out/);
  });
});

describe('OAuthTokenSource', () => {
  it('refreshes an expiring token and keeps the new refresh token', async () => {
    const saved: string[] = [];
    const source = new OAuthTokenSource(
      provider(),
      { accessToken: 'old', refreshToken: 'refresh-1', expiresAt: Date.now() + 30_000, email: 'anna@outlook.com' },
      (tokens) => saved.push(tokens.refreshToken ?? ''),
    );
    assert.equal(await source.getAccessToken(), 'access-2');
    assert.deepEqual(saved, ['refresh-2']);
    assert.equal(requests.at(-1)?.get('refresh_token'), 'refresh-1');
    assert.equal(await source.getAccessToken(), 'access-2');
    assert.equal(saved.length, 1, 'a valid token is not refreshed again');
  });

  it('asks for a new sign-in when there is no refresh token', async () => {
    const source = new OAuthTokenSource(provider(), { accessToken: 'old', refreshToken: null, expiresAt: 0, email: null });
    await assert.rejects(source.getAccessToken(), /sign in again/);
  });
});
