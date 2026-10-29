import { randomUUID } from 'node:crypto';
import { shell } from 'electron';
import { authorizeInteractive, microsoftProvider } from '@imaptransfer/core';
import type { AccountSecret } from './accounts';
import { texts } from './texts';

declare const __MICROSOFT_CLIENT_ID__: string;

const TENANT = 'common';
const PENDING_TTL_MS = 30 * 60_000;
const pending = new Map<string, { secret: AccountSecret; createdAt: number }>();

/**
 * The Azure app registration of this build. Release builds get it at build time; for own
 * builds it can also come from the environment.
 */
export function microsoftClientId(): string {
  return process.env.IMAPTRANSFER_MICROSOFT_CLIENT_ID || __MICROSOFT_CLIENT_ID__;
}

function page(title: string, text: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>IMAP Transfer</title><style>
body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f2;color:#1d1d1f}
main{max-width:28rem;padding:2rem}h1{font-size:1.4rem;margin:0 0 .5rem}
@media (prefers-color-scheme:dark){body{background:#1c1c1e;color:#f2f2f2}}
</style></head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;
}

/** Opens the Microsoft sign-in in the system browser and keeps the result until the account is saved. */
export async function signInMicrosoft(loginHint?: string): Promise<{ signInId: string; email: string | null }> {
  const clientId = microsoftClientId();
  if (!clientId) throw new Error('Microsoft sign-in is not configured in this build.');
  const { signedIn, signInFailed } = texts();
  const tokens = await authorizeInteractive(microsoftProvider(clientId, TENANT), {
    openBrowser: (url) => shell.openExternal(url),
    ...(loginHint ? { loginHint } : {}),
    successPage: page(signedIn.title, signedIn.text),
    failurePage: page(signInFailed.title, signInFailed.text),
  });
  const now = Date.now();
  for (const [id, entry] of pending) if (now - entry.createdAt > PENDING_TTL_MS) pending.delete(id);
  const signInId = randomUUID();
  pending.set(signInId, { secret: { type: 'oauth-microsoft', tokens, clientId, tenant: TENANT }, createdAt: now });
  return { signInId, email: tokens.email };
}

export function pendingSignIn(signInId: string | undefined): AccountSecret | null {
  if (!signInId) return null;
  const entry = pending.get(signInId);
  if (!entry) throw new Error('The sign-in has expired. Please sign in again.');
  return entry.secret;
}

export function forgetSignIn(signInId: string | undefined): void {
  if (signInId) pending.delete(signInId);
}
