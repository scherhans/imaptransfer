// Builds the website into dist/ (or --out): every page in both languages, sitemap, robots.txt, the
// assets, and the downloads. The installers come from the app's release folder and are served by
// this site under /downloads/, next to a SHA256SUMS list and the files the app's updater reads. No
// visitor's browser talks to anyone else. Slots without a file show as not available yet.
//
//   node src/build.ts                          the real site, from release/ at the root of the repository
//   node src/build.ts --release <folder>       the real site, from another folder of installers
//   node src/build.ts --published <iso date>   the date the release was published (files fetched
//                                              from GitHub carry the date they were fetched)
//   node src/build.ts --example --out preview  a preview with every slot filled, marked as such
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative as relativePath, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SITE } from './config.ts';
import { homePage, legalPage, notFoundPage, PATHS, sitemap, type ImageSizes } from './pages.ts';
import { pngSize } from './png.ts';
import { belongsTo, checksumList, DOWNLOADS, exampleRelease, installerName, isFeed, latestVersion, parseInstaller, releaseOf, SLOTS, type LocalFile, type Release } from './release.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The root of the repository: the desktop app's version, and release/ with the installers it built. */
const repository = join(root, '..', '..');

/** The font files the stylesheet names, and the license that has to travel with them. */
const FONTS: [string, string][] = [
  ['@fontsource/newsreader/files/newsreader-latin-500-normal.woff2', 'newsreader-500.woff2'],
  ['@fontsource/newsreader/files/newsreader-latin-600-normal.woff2', 'newsreader-600.woff2'],
  ['@fontsource/newsreader/LICENSE', 'newsreader-OFL.txt'],
  ['@fontsource/hanken-grotesk/files/hanken-grotesk-latin-400-normal.woff2', 'hanken-grotesk-400.woff2'],
  ['@fontsource/hanken-grotesk/files/hanken-grotesk-latin-600-normal.woff2', 'hanken-grotesk-600.woff2'],
  ['@fontsource/hanken-grotesk/LICENSE', 'hanken-grotesk-OFL.txt'],
];

/**
 * For Apache, which serves the site at mittwald: the not-found page, and no caching for the files
 * that name the current version, so the app's updater and the checksums never lag behind. Each
 * block only applies where its module is there; elsewhere the file is ignored.
 */
const HTACCESS = `ErrorDocument 404 /404.html

<IfModule mod_headers.c>
  <FilesMatch "^(latest.*\\.yml|SHA256SUMS)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
`;

/** The screenshots in assets/img/<lang>/, taken at twice the size they are shown. */
function screenshots(): ImageSizes {
  const sizes: ImageSizes = new Map();
  for (const lang of ['en', 'de']) {
    const directory = join(root, 'assets', 'img', lang);
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.png'))) {
      sizes.set(`${lang}/${file.replace(/\.png$/, '')}`, pngSize(readFileSync(join(directory, file))));
    }
  }
  return sizes;
}

function sha256Of(path: string): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => done(hash.digest('hex')))
      .on('error', fail);
  });
}

async function measure(folder: string, name: string): Promise<LocalFile> {
  const path = join(folder, name);
  return { name, size: statSync(path).size, sha256: await sha256Of(path) };
}

/** The newest version in a release folder, with every file that belongs to it; null when there is none. */
async function localRelease(folder: string, published?: string): Promise<Release | null> {
  if (!existsSync(folder)) return null;
  const names = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const version = latestVersion(names);
  if (!version) return null;
  const own = names.filter((name) => belongsTo(version, name, isFeed(name) ? readFileSync(join(folder, name), 'utf8') : undefined));
  const files = await Promise.all(own.map((name) => measure(folder, name)));
  if (published) return releaseOf(version, files, new Date(published).toISOString());
  // Without a date from outside: published when the newest installer was built.
  const built = Math.max(...own.filter((name) => parseInstaller(name)).map((name) => statSync(join(folder, name)).mtimeMs));
  return releaseOf(version, files, new Date(built).toISOString());
}

async function previewRelease(folder: string): Promise<Release> {
  const appPackage = join(repository, 'apps', 'desktop', 'package.json');
  const version = existsSync(appPackage) ? (JSON.parse(readFileSync(appPackage, 'utf8')) as { version: string }).version : '0.0.0';
  const local = new Map<string, { size: number; sha256: string }>();
  for (const slot of SLOTS) {
    const name = installerName(version, slot);
    if (existsSync(join(folder, name))) local.set(name, await measure(folder, name));
  }
  return exampleRelease(version, local);
}

function write(out: string, path: string, content: string): void {
  const file = path.endsWith('/') ? join(out, path, 'index.html') : join(out, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function copyDirectory(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) copyDirectory(join(from, entry.name), join(to, entry.name));
    else copyFileSync(join(from, entry.name), join(to, entry.name));
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      example: { type: 'boolean', default: false },
      out: { type: 'string', default: 'dist' },
      release: { type: 'string', default: join(repository, 'release') },
      published: { type: 'string' },
    },
  });
  if (values.published && Number.isNaN(Date.parse(values.published))) throw new Error(`--published is not a date: ${values.published}`);
  const out = resolve(root, values.out);
  // The build empties its output folder first, so that folder must never hold the sources.
  const holds = (outer: string, inner: string) => !relativePath(outer, inner).startsWith('..');
  if (holds(out, root) || ['src', 'assets', 'test', 'node_modules'].some((part) => holds(join(root, part), out))) {
    throw new Error(`--out ${values.out} would empty a folder with the website's sources`);
  }
  const folder = resolve(values.release);
  const release = values.example ? await previewRelease(folder) : await localRelease(folder, values.published);
  const context = { release, images: screenshots() };

  rmSync(out, { recursive: true, force: true });
  for (const lang of ['en', 'de'] as const) {
    write(out, PATHS.home[lang], homePage(lang, context));
    write(out, PATHS.imprint[lang], legalPage(lang, 'imprint', context));
    write(out, PATHS.privacy[lang], legalPage(lang, 'privacy', context));
  }
  write(out, '/404.html', notFoundPage(context));
  write(out, '/sitemap.xml', sitemap());
  write(out, '/robots.txt', values.example ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\nSitemap: ${SITE.url}/sitemap.xml\n`);
  write(out, '/.htaccess', HTACCESS);

  const assets = join(out, 'assets');
  copyDirectory(join(root, 'assets'), assets);
  // What browsers and crawlers look for at the root: favicon.ico, apple-touch-icon.png.
  copyDirectory(join(root, 'public'), out);
  mkdirSync(join(assets, 'fonts'), { recursive: true });
  for (const [from, to] of FONTS) copyFileSync(join(root, 'node_modules', from), join(assets, 'fonts', to));

  if (release && !release.example) {
    const downloads = join(out, DOWNLOADS);
    mkdirSync(downloads, { recursive: true });
    for (const file of release.files) copyFileSync(join(folder, file.name), join(downloads, file.name));
    writeFileSync(join(downloads, 'SHA256SUMS'), checksumList(release.files));
  }

  const where = relativePath(process.cwd(), out) || '.';
  if (!release) {
    console.log(`Built ${where}: no installers in ${folder}, every download shows as not available yet.`);
    return;
  }
  const missing = SLOTS.filter((slot) => !release.downloads.some((download) => download.key === slot.key)).map((slot) => slot.key);
  const example = release.example ? ' (example data)' : '';
  console.log(`Built ${where}: version ${release.version} with ${release.downloads.length} of ${SLOTS.length} installers${example}.`);
  if (missing.length > 0) console.log(`Not available yet: ${missing.join(', ')}.`);
}

await main();
