# Contributing

Thank you for helping. Bug reports with the server or provider involved are especially valuable: mail servers differ in many small ways.

## Setup

Node.js 24 (see `.nvmrc`), pnpm 10 and, for the integration tests, Java 17 or newer.

```sh
pnpm install
pnpm build
pnpm test                 # unit tests of engine and command line
pnpm test:integration     # starts GreenMail, runs the engine against it, stops it
pnpm typecheck
pnpm dev                  # desktop app with hot reload
```

`pnpm greenmail` keeps a test mail server running on `127.0.0.1:3143` (IMAP) and `127.0.0.1:3993` (IMAPS). It accepts any user name and password, and every new user name is an empty account.

End-to-end test of the desktop app (needs a build and GreenMail):

```sh
pnpm build
node scripts/with-greenmail.mjs pnpm --filter imaptransfer-desktop test:e2e
```

Screenshots for the README and the website, with example accounts on example.* servers and no real mail (needs a build):

```sh
pnpm --filter imaptransfer-desktop screenshots docs          # docs/screenshots/
pnpm --filter imaptransfer-desktop screenshots website en    # apps/website/assets/img/en/
pnpm --filter imaptransfer-desktop screenshots website de    # apps/website/assets/img/de/
pnpm --filter imaptransfer-desktop website-icons             # apps/website/public/favicon.ico, apple-touch-icon.png
```

When working inside VS Code's terminal, unset `ELECTRON_RUN_AS_NODE` first (`env -u ELECTRON_RUN_AS_NODE …`); VS Code sets it, and Electron then starts as plain Node.js.

## Guidelines

- Every change to the engine comes with a test, ideally an integration test against GreenMail.
- Nothing may lose mail or create duplicates when a run is cancelled, crashes or loses its connection. If a change touches backup, restore or migration, add a test for the interrupted case.
- User-facing text of the app goes into `apps/desktop/src/renderer/src/i18n/` and, for menus and dialogs, `apps/desktop/src/main/texts.ts`, in all seven languages. The website's goes into `apps/website/src/content.ts` and `apps/website/src/legal.ts`, in English and German.
- TypeScript runs directly in Node for tests, so only erasable syntax (no `enum`, no parameter properties).

## Reporting security issues

Please use GitHub's private vulnerability reporting (Security → Report a vulnerability) instead of a public issue.
