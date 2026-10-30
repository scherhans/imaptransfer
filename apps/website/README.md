# imaptransfer.com

The website of [IMAP Transfer](https://github.com/sebastian-scherhans/imaptransfer): one landing page
with the downloads and their SHA-256 checksums, a legal notice and a privacy policy, in English (`/`)
and German (`/de/`). Static HTML, no framework, no cookies, no tracking, nothing loaded from other
servers: fonts and images are served from the site itself.

## Commands

Node 24 and pnpm, installed at the root of the repository with `pnpm install`. From there, each
command runs with `pnpm --filter imaptransfer-website <command>`; inside `apps/website`, plain
`pnpm <command>` does the same.

```bash
pnpm build                         # the real site into dist/, installers from release/ at the root
pnpm build --release <folder>      # the same, from another folder of installers
pnpm build --published <iso date>  # the date the release was published, for files fetched later
pnpm preview                       # into preview/, every installer filled with example data, not indexed
pnpm serve                         # serve dist/ on http://127.0.0.1:4321 (PORT for another port)
pnpm serve preview                 # serve preview/
pnpm test                          # releases, pages, links, checksums
pnpm typecheck
```

## Downloads

The site serves the installers itself, under `/downloads/`. No visitor's browser talks to GitHub or
anyone else, and the privacy policy says so.

- **Where they come from.** The build reads the release folder (`release/` at the root of the
  repository, where the desktop app's installers land, or `--release`), takes the newest version it
  finds there and measures every file of it. When the site goes live, the workflow fetches the files
  of the published GitHub release into such a folder.
- **What goes to /downloads/.** The installers, named as the app's `electron-builder.yml` names
  them (`imaptransfer-<version>-<mac|windows|linux>-<arch>.<dmg|exe|AppImage|deb>`), the zips and
  blockmaps of the same version, the updater feeds (`latest*.yml`) that announce it, and a
  `SHA256SUMS` list of all of them. Older versions, unpacked apps and builder logs stay out.
- **Eight places, always.** The page shows a button for each of the eight installers. A file that
  is not built yet shows as a dashed placeholder saying "not available yet"; the build lists them.
  Before the first version, all eight are placeholders.
- **Every release goes live by itself.** Publishing a release starts the website workflow; see
  [Deploy](#deploy).

The preview takes the version from `apps/desktop/package.json` and the real
checksums of the installers it finds in the release folder; for missing files it makes up example
checksums. A banner marks the preview, and it is not indexed.

On the page, a visitor can drop a downloaded file to check it: the browser computes its SHA-256
locally and compares it with the published checksums. The file never leaves the computer. Without
JavaScript, the buttons, the checksums and the terminal commands do the same job.

A checksum on the same server as its file shows that a download arrived intact. It cannot show that
the server was not tampered with; that is what the signatures of the installers are for (Developer ID
and notarization on macOS, Authenticode on Windows).

### The app's updater

The app still asks GitHub for updates (`publish: github` in its `electron-builder.yml`). To move it
to this site, put `provider: generic` with `url: https://imaptransfer.com/downloads` first in
`publish`, and keep GitHub as the second entry: the first one is what the updater asks, and releases
still land on GitHub as the archive the website workflow reads. The feeds and files the updater
reads are already in `/downloads/`. Then the privacy policy's paragraph on the update check names
this server instead of GitHub.

## Content

| What | Where |
| --- | --- |
| Address, repository, email | `src/config.ts` |
| The eight installers and their order | `SLOTS` in `src/release.ts` |
| Texts of the landing page, both languages | `src/content.ts` |
| Where each page lives | `PATHS` in `src/paths.ts` |
| Legal notice and privacy policy | `src/legal.ts` (update the date when they change) |
| Icons | `assets/favicon.svg` for the tab, `icons/touch-icon.svg` as the source of the home screen icon; `public/favicon.ico` and `public/apple-touch-icon.png` are made from them by `pnpm --filter imaptransfer-desktop website-icons` and copied to the root |
| Screenshots | `assets/img/<en\|de>/`: `app.png`, its phone crop `app-narrow.png` and `migrate.png`, taken at twice the size they are shown. Made with example data by `pnpm --filter imaptransfer-desktop screenshots website <en\|de>` |
| Layout and colours | `assets/site.css`, the design decisions in `gestaltung.md` |
| Platform detection, copying, the checker | `assets/site.js` |

## Deploy

The site is hosted at mittwald. The [website workflow](../../.github/workflows/website.yml) checks
every change to it and puts it online:

- **When main changes the site,** with the files of the latest published release.
- **When a release is published,** with its files. Drafts never go online.
- **By hand,** from the Actions tab.

It fetches the files of the release, builds `dist/` and copies it with rsync over SSH: the new
downloads first, then the pages, and only at the end it removes what the new version no longer
has. So no page ever links to a file that is missing. `.well-known/` on the server stays untouched.
The build also writes a `.htaccess` with `404.html` as the not-found page and no caching for
`latest*.yml` and `SHA256SUMS`.

### Setting it up once

1. **mittwald.** A project with the domain imaptransfer.com and a folder for the site, and an SSH
   user for that project with a key of its own, used for nothing else. Sign the data processing
   agreement in mStudio: the privacy policy says one exists.
2. **The host key.** Run `ssh-keyscan <host>` once, compare the result with the fingerprint mStudio
   shows, and keep the lines.
3. **GitHub, environment "production"** (Settings → Environments). Deployment branches and tags:
   `main` and `v*`. Optionally yourself as required reviewer. Its secrets:

   | Secret | Content |
   | --- | --- |
   | `MITTWALD_SSH_KEY` | the private key of the SSH user |
   | `MITTWALD_KNOWN_HOSTS` | the lines from step 2 |
   | `MITTWALD_SSH_USER` | the user name, as mStudio shows it (for example `mail@app-id`) |
   | `MITTWALD_SSH_HOST` | the SSH host, for example `ssh.<cluster>.project.host` |

4. **GitHub, repository variable** `MITTWALD_PATH`: the site's folder on the server. Until it is
   set, the deploy job is skipped and only the checks run.

Host and user sit in secrets so the public logs show them as `***`.

A full release is close to 1 GB of installers, zips and blockmaps. Only the current version stays on
the server; the GitHub releases keep every version.
