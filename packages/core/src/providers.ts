/**
 * How a user signs in:
 * - `password`: the normal mail password.
 * - `app-password`: a separate password created in the provider's account settings.
 * - `oauth-microsoft`: sign-in through the Microsoft login page.
 */
export type ProviderAuth = 'password' | 'app-password' | 'oauth-microsoft';

/** Extra steps a user has to take before IMAP works; the user interface explains them. */
export type ProviderHint = 'enable-imap' | 'separate-password' | 'two-factor-required';

export interface ProviderPreset {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  auth: ProviderAuth;
  domains: string[];
  hints: ProviderHint[];
  helpUrl: string | null;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: 'app-password',
    domains: ['gmail.com', 'googlemail.com'],
    hints: ['two-factor-required'],
    helpUrl: 'https://myaccount.google.com/apppasswords',
  },
  {
    id: 'microsoft',
    name: 'Outlook.com / Hotmail / Microsoft 365',
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    auth: 'oauth-microsoft',
    domains: ['outlook.com', 'outlook.de', 'hotmail.com', 'hotmail.de', 'live.com', 'live.de', 'msn.com'],
    hints: [],
    helpUrl: null,
  },
  {
    id: 'icloud',
    name: 'iCloud Mail',
    host: 'imap.mail.me.com',
    port: 993,
    secure: true,
    auth: 'app-password',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    hints: ['two-factor-required'],
    helpUrl: 'https://account.apple.com',
  },
  {
    id: 'yahoo',
    name: 'Yahoo Mail',
    host: 'imap.mail.yahoo.com',
    port: 993,
    secure: true,
    auth: 'app-password',
    domains: ['yahoo.com', 'yahoo.de', 'ymail.com'],
    hints: [],
    helpUrl: 'https://login.yahoo.com/account/security',
  },
  {
    id: 'gmx',
    name: 'GMX',
    host: 'imap.gmx.net',
    port: 993,
    secure: true,
    auth: 'password',
    domains: ['gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch'],
    hints: ['enable-imap'],
    helpUrl: null,
  },
  {
    id: 'webde',
    name: 'WEB.DE',
    host: 'imap.web.de',
    port: 993,
    secure: true,
    auth: 'password',
    domains: ['web.de'],
    hints: ['enable-imap'],
    helpUrl: null,
  },
  {
    id: 't-online',
    name: 'T-Online',
    host: 'secureimap.t-online.de',
    port: 993,
    secure: true,
    auth: 'password',
    domains: ['t-online.de', 'magenta.de'],
    hints: ['separate-password'],
    helpUrl: null,
  },
  {
    id: 'ionos',
    name: 'IONOS',
    host: 'imap.ionos.de',
    port: 993,
    secure: true,
    auth: 'password',
    domains: [],
    hints: [],
    helpUrl: null,
  },
  {
    id: 'strato',
    name: 'STRATO',
    host: 'imap.strato.de',
    port: 993,
    secure: true,
    auth: 'password',
    domains: [],
    hints: [],
    helpUrl: null,
  },
  {
    id: 'mittwald',
    name: 'mittwald',
    host: 'mail.agenturserver.de',
    port: 993,
    secure: true,
    auth: 'password',
    domains: [],
    hints: [],
    helpUrl: null,
  },
  {
    id: 'posteo',
    name: 'Posteo',
    host: 'posteo.de',
    port: 993,
    secure: true,
    auth: 'password',
    domains: ['posteo.de', 'posteo.net', 'posteo.eu', 'posteo.org'],
    hints: [],
    helpUrl: null,
  },
  {
    id: 'mailbox-org',
    name: 'mailbox.org',
    host: 'imap.mailbox.org',
    port: 993,
    secure: true,
    auth: 'password',
    domains: ['mailbox.org'],
    hints: [],
    helpUrl: null,
  },
  {
    id: 'freenet',
    name: 'freenet Mail',
    host: 'mx.freenet.de',
    port: 993,
    secure: true,
    auth: 'password',
    domains: ['freenet.de'],
    hints: ['enable-imap'],
    helpUrl: null,
  },
];

export function findProvider(id: string): ProviderPreset | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

/** Guesses the provider from an email address; undefined for own domains. */
export function detectProvider(email: string): ProviderPreset | undefined {
  const domain = email.split('@')[1]?.trim().toLowerCase();
  if (!domain) return undefined;
  return PROVIDERS.find((provider) => provider.domains.includes(domain));
}
