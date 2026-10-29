# Microsoft sign-in

Outlook.com, Hotmail and Microsoft 365 no longer accept passwords for IMAP. imaptransfer signs in through the Microsoft login page instead (OAuth 2.0 authorization code flow with PKCE). For that, every build needs an app registration in Microsoft Entra ID. It is free.

## Register the app

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com) → *Identity* → *Applications* → *App registrations* → *New registration*.
2. Name: `imaptransfer`. Supported account types: *Accounts in any organizational directory and personal Microsoft accounts*.
3. Redirect URI: platform *Public client/native (mobile & desktop)*, value `http://localhost`. Microsoft accepts any port on localhost, which imaptransfer picks at sign-in.
4. After creating it, open *Authentication* and set *Allow public client flows* to *Yes*.
5. Open *API permissions* → *Add a permission* → *APIs my organization uses* → search *Office 365 Exchange Online* → *Delegated permissions* → `IMAP.AccessAsUser.All`. Also add `offline_access`, `openid` and `email` from *Microsoft Graph*.
6. Copy the *Application (client) ID*. There is no client secret; a desktop app cannot keep one.

## Use it

Desktop app, for a release build: set the repository variable `IMAPTRANSFER_MICROSOFT_CLIENT_ID` (GitHub → Settings → Secrets and variables → Actions → Variables). The release workflow builds it into the app.

Desktop app, local build:

```sh
IMAPTRANSFER_MICROSOFT_CLIENT_ID=<client id> pnpm build
```

Command line:

```sh
export IMAPTRANSFER_MICROSOFT_CLIENT_ID=<client id>
imaptransfer login microsoft --token-file ~/.imaptransfer-anna.json --user anna@outlook.com
imaptransfer backup ~/Backups/anna --token-file ~/.imaptransfer-anna.json
```

The token file holds a refresh token. It is written with permissions `600`; treat it like a password.

## Microsoft 365 business accounts

An organisation's administrator may have to approve the app once (*Grant admin consent*), and IMAP must be enabled for the mailbox in the Exchange admin center.

## Gmail

The engine also supports Google sign-in (`googleProvider` in `packages/core/src/oauth.ts`). Full IMAP access is a *restricted* scope at Google: a public app needs a yearly security assessment (CASA Tier 2). Until the project has one, Gmail works with an app password.
