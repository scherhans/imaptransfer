import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CancelledError } from './errors.ts';

/** A token endpoint that does not answer must not hold up a reconnect for minutes. */
const TOKEN_REQUEST_TIMEOUT_MS = 30_000;

export interface OAuthProvider {
  id: 'microsoft' | 'google';
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: string;
  /** Google issues one even to desktop apps; it is not secret there. */
  clientSecret?: string;
  /** Host name in the redirect URI, as registered with the provider. */
  redirectHost: 'localhost' | '127.0.0.1';
  extraAuthorizeParams?: Record<string, string>;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** The signed-in address, taken from the ID token. */
  email: string | null;
}

export class OAuthError extends Error {
  /** Lets the job report treat an expired or revoked sign-in like a wrong password. */
  readonly authenticationFailed = true;
  constructor(message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}

/** Outlook.com, Hotmail and Microsoft 365. Register the app as "Mobile and desktop" with redirect URI http://localhost. */
export function microsoftProvider(clientId: string, tenant = 'common'): OAuthProvider {
  return {
    id: 'microsoft',
    authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scopes: ['https://outlook.office.com/IMAP.AccessAsUser.All', 'offline_access', 'openid', 'email'],
    clientId,
    redirectHost: 'localhost',
    extraAuthorizeParams: { prompt: 'select_account' },
  };
}

/** Gmail. Full IMAP access is a restricted scope: Google requires a yearly security assessment. */
export function googleProvider(clientId: string, clientSecret: string): OAuthProvider {
  return {
    id: 'google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://mail.google.com/', 'openid', 'email'],
    clientId,
    clientSecret,
    redirectHost: '127.0.0.1',
    extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' },
  };
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const email = claims.email ?? claims.preferred_username;
    return typeof email === 'string' ? email : null;
  } catch {
    return null;
  }
}

async function requestTokens(provider: OAuthProvider, params: Record<string, string>): Promise<OAuthTokens> {
  const body = new URLSearchParams({ client_id: provider.clientId, ...params });
  if (provider.clientSecret) body.set('client_secret', provider.clientSecret);
  let response: Response;
  try {
    response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // No answer from the token endpoint is a network problem, not a bad sign-in: a run that
    // reconnects after a dropped connection must retry it like any other connection error.
    throw Object.assign(new Error(`The sign-in server could not be reached: ${error instanceof Error ? error.message : String(error)}`), { code: 'ECONNRESET' });
  }
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof json.access_token !== 'string') {
    const reason = json.error_description ?? json.error ?? `HTTP ${response.status}`;
    // The endpoint itself is overloaded or down: the stored sign-in is still good.
    if (response.status === 429 || response.status >= 500) {
      throw Object.assign(new Error(`The sign-in server is not available right now: ${String(reason)}`), { code: 'ETHROTTLE' });
    }
    throw new OAuthError(`Sign-in failed: ${String(reason)}`);
  }
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : Number(json.expires_in ?? 3600);
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
    email: emailFromIdToken(json.id_token),
  };
}

export function refreshTokens(provider: OAuthProvider, refreshToken: string): Promise<OAuthTokens> {
  return requestTokens(provider, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: provider.scopes.join(' '),
  });
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

const DEFAULT_PAGE = (title: string) =>
  `<!doctype html><meta charset="utf-8"><title>imaptransfer</title><body style="font:16px system-ui;margin:4rem auto;max-width:32rem">${title}</body>`;

/**
 * Signs in through the system browser (authorization code flow with PKCE and a loopback
 * redirect). The password never passes through imaptransfer.
 */
export async function authorizeInteractive(
  provider: OAuthProvider,
  options: {
    openBrowser: (url: string) => void | Promise<void>;
    signal?: AbortSignal;
    timeoutMs?: number;
    loginHint?: string;
    successPage?: string;
    failurePage?: string;
  },
): Promise<OAuthTokens> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));
  const received = Promise.withResolvers<string>();
  // The browser may answer before anyone awaits the promise; that must not count as unhandled.
  received.promise.catch(() => undefined);

  const handle = (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/') {
      response.writeHead(404).end();
      return;
    }
    const returnedState = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error_description') ?? url.searchParams.get('error');
    const ok = returnedState === state && code !== null && !error;
    response.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(ok ? (options.successPage ?? DEFAULT_PAGE('Signed in. You can close this window.')) : (options.failurePage ?? DEFAULT_PAGE('Sign-in failed.')));
    if (ok) received.resolve(code);
    else if (returnedState === state) received.reject(new OAuthError(`Sign-in failed: ${error ?? 'no code returned'}`));
  };

  const timer = setTimeout(() => received.reject(new OAuthError('Sign-in timed out')), options.timeoutMs ?? 5 * 60_000);
  const onAbort = () => received.reject(new CancelledError());
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const servers: Server[] = [];
  try {
    const primary = createServer(handle);
    servers.push(primary);
    const port = await listen(primary, '127.0.0.1', 0);
    if (provider.redirectHost === 'localhost') {
      // Browsers may resolve "localhost" to IPv6 first.
      const secondary = createServer(handle);
      servers.push(secondary);
      await listen(secondary, '::1', port).catch(() => undefined);
    }
    const redirectUri = `http://${provider.redirectHost}:${port}`;
    const url = new URL(provider.authorizeUrl);
    url.search = new URLSearchParams({
      client_id: provider.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: provider.scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...(options.loginHint ? { login_hint: options.loginHint } : {}),
      ...provider.extraAuthorizeParams,
    }).toString();
    await options.openBrowser(url.toString());
    const code = await received.promise;
    return await requestTokens(provider, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    for (const server of servers) server.close();
  }
}

/** Hands out a valid access token and refreshes it shortly before it expires. */
export class OAuthTokenSource {
  private readonly provider: OAuthProvider;
  private tokens: OAuthTokens;
  private readonly onRefresh: ((tokens: OAuthTokens) => void) | undefined;

  constructor(provider: OAuthProvider, tokens: OAuthTokens, onRefresh?: (tokens: OAuthTokens) => void) {
    this.provider = provider;
    this.tokens = tokens;
    this.onRefresh = onRefresh;
  }

  async getAccessToken(): Promise<string> {
    if (this.tokens.expiresAt - Date.now() > 2 * 60_000) return this.tokens.accessToken;
    if (!this.tokens.refreshToken) throw new OAuthError('The sign-in has expired. Please sign in again.');
    const refreshed = await refreshTokens(this.provider, this.tokens.refreshToken);
    this.tokens = {
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? this.tokens.refreshToken,
      email: refreshed.email ?? this.tokens.email,
    };
    this.onRefresh?.(this.tokens);
    return this.tokens.accessToken;
  }
}
