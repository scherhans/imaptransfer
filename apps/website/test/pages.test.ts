import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { formatSize, inline, relative } from '../src/html.ts';
import { homePage, legalPage, notFoundPage, type ImageSizes, type RenderContext } from '../src/pages.ts';
import { liabilityPath, PATHS } from '../src/paths.ts';
import { exampleRelease, releaseOf, SLOTS } from '../src/release.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = ['newsreader-500.woff2', 'newsreader-600.woff2', 'newsreader-OFL.txt', 'hanken-grotesk-400.woff2', 'hanken-grotesk-600.woff2', 'hanken-grotesk-OFL.txt'];
const images: ImageSizes = new Map(
  ['en', 'de'].flatMap((lang) => ['app', 'app-narrow', 'migrate'].map((name) => [`${lang}/${name}`, { width: 2000, height: 1000 }] as const)),
);

function pages(context: RenderContext): Map<string, string> {
  const result = new Map<string, string>();
  for (const lang of ['en', 'de'] as const) {
    result.set(PATHS.home[lang], homePage(lang, context));
    result.set(PATHS.imprint[lang], legalPage(lang, 'imprint', context));
    result.set(PATHS.privacy[lang], legalPage(lang, 'privacy', context));
  }
  result.set('/404.html', notFoundPage(context));
  return result;
}

const release = exampleRelease('0.2.0', new Map(), '2026-10-29T00:00:00Z');
/** A release as the build makes it, with three of the eight installers built so far. */
const real = releaseOf(
  '0.2.0',
  ['mac-arm64.dmg', 'windows-x64.exe', 'linux-x64.AppImage', 'mac-arm64.zip'].map((end, index) => ({
    name: `imaptransfer-0.2.0-${end}`,
    size: 120_000_000,
    sha256: String(index).repeat(64),
  })),
  '2026-10-29T08:30:00Z',
);
const withRelease = pages({ release: real, images });
const withoutRelease = pages({ release: null, images });

describe('pages', () => {
  it('say their language, link the other one and every page carries the legal links', () => {
    for (const [path, html] of withRelease) {
      const lang = path.startsWith('/de/') ? 'de' : 'en';
      assert.match(html, new RegExp(`<html lang="${lang}">`), path);
      const imprint = relative(path, PATHS.imprint[lang]);
      const privacy = relative(path, PATHS.privacy[lang]);
      assert.ok(html.includes(`href="${imprint}"`), `${path}: no link to the legal notice`);
      assert.ok(html.includes(`href="${privacy}"`), `${path}: no link to the privacy policy`);
      assert.ok(html.includes(`href="${relative(path, liabilityPath(lang))}"`), `${path}: no link to the liability section`);
      if (path !== '/404.html') assert.match(html, /hreflang="de" href="https:\/\/imaptransfer\.com\/de\//, path);
    }
  });

  it('link only to pages and files that exist', () => {
    const files = new Set([
      '/assets/site.css',
      '/assets/site.js',
      '/assets/icon.svg',
      '/assets/flags/gb.svg',
      '/assets/flags/de.svg',
      '/assets/favicon.svg',
      '/favicon.ico',
      '/apple-touch-icon.png',
      ...FONTS.map((font) => `/assets/fonts/${font}`),
      ...real.downloads.map((download) => download.url),
    ]);
    for (const [path, html] of withRelease) {
      const directory = path.endsWith('/') ? path : `${posix.dirname(path)}/`;
      const links = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1] ?? '');
      const sources = [...html.matchAll(/srcset="([^"]+)"/g)].flatMap((match) => (match[1] ?? '').split(',').map((entry) => entry.trim().split(' ')[0] ?? ''));
      for (const link of [...links, ...sources]) {
        if (!link || /^(?:https?:|mailto:|tel:|#)/.test(link)) continue;
        const target = posix.join(directory, link.split('#')[0] ?? '');
        const isPage = withRelease.has(target.endsWith('/') ? target : `${target}/`) || withRelease.has(target);
        const isAsset = /^\/assets\/(?:img\/(?:en|de)\/[a-z-]+\.png|flags\/[a-z]+\.svg)$/.test(target) && existsSync(join(root, target));
        assert.ok(isPage || files.has(target) || isAsset, `${path} links to ${link}, which does not exist`);
      }
    }
  });

  it('name the icons browsers and phones look for, and the files exist', () => {
    const home = withRelease.get('/') ?? '';
    assert.match(home, /<link rel="icon" href="favicon\.ico" sizes="32x32">/);
    assert.match(home, /<link rel="icon" href="assets\/favicon\.svg" type="image\/svg\+xml">/);
    assert.match(home, /<link rel="apple-touch-icon" href="apple-touch-icon\.png">/);
    for (const file of ['public/favicon.ico', 'public/apple-touch-icon.png', 'assets/favicon.svg']) {
      assert.ok(existsSync(join(root, file)), file);
    }
  });

  it('load nothing from other servers: fonts, styles and scripts are the site’s own', () => {
    for (const [path, html] of withRelease) {
      for (const [, tag] of html.matchAll(/<(?:link|script|img)\b[^>]*>/g)) {
        if (/rel="(?:canonical|alternate)"/.test(tag ?? '') || /property=/.test(tag ?? '')) continue;
        assert.doesNotMatch(tag ?? '', /(?:src|href)="https?:/, `${path}: ${tag}`);
      }
    }
  });

  it('offer every built installer from this site with its checksum, and keep a place for the others', () => {
    const page = withRelease.get('/de/') ?? '';
    for (const download of real.downloads) {
      assert.ok(page.includes(`href="../downloads/${download.name}" download="${download.name}"`), download.name);
      assert.ok(page.includes(`data-summe="${download.sha256}"`), download.name);
    }
    assert.equal(page.match(/class="variante fehlt"/g)?.length, SLOTS.length - real.downloads.length);
    assert.match(page, /Noch nicht verfügbar/);
    assert.doesNotMatch(page, /zip"/);
  });

  it('show every button before the first version, as places only, and nothing to check', () => {
    const page = withoutRelease.get('/') ?? '';
    assert.equal(page.match(/class="variante fehlt"/g)?.length, SLOTS.length);
    assert.match(page, /The first version is not out yet/);
    assert.match(withoutRelease.get('/de/') ?? '', /Die erste Version ist noch nicht erschienen/);
    assert.doesNotMatch(page, /id="daten"/);
  });

  it('are one page: the stage downloads for the visitor\'s system or leads to the downloads below, and every header leads there', () => {
    const home = withRelease.get('/de/') ?? '';
    assert.ok(home.includes('<a class="knopf laden" href="#download">Herunterladen</a>'), 'stage');
    assert.match(home, /<section class="abschnitt herunterladen" id="download"/);
    assert.match(home, /<section class="feld-dunkel" id="cli"/);
    assert.match(home, /id="daten"/);
    assert.doesNotMatch(home, /<nav\b/);
    for (const [path, html] of withRelease) {
      const lang = path.startsWith('/de/') ? 'de' : 'en';
      assert.ok(html.includes(`<a class="knopf knopf-klein" href="${relative(path, `${PATHS.home[lang]}#download`)}">`), `${path}: no way to the downloads`);
    }
  });

  it('show the flag of the other language beside its name', () => {
    assert.match(withRelease.get('/de/') ?? '', /<a class="sprache" href="\.\.\/" hreflang="en" lang="en"><img class="flagge" src="\.\.\/assets\/flags\/gb\.svg" alt=""/);
    assert.match(withRelease.get('/') ?? '', /<a class="sprache" href="de\/" hreflang="de" lang="de"><img class="flagge" src="assets\/flags\/de\.svg" alt=""/);
  });

  it('invite to support on every page as a plain link, and on the start page with a button', () => {
    for (const [path, html] of withRelease) {
      assert.ok(html.includes('<a href="https://buymeacoffee.com/scherhans" rel="noopener">'), `${path}: no link to support`);
    }
    assert.match(withRelease.get('/de/') ?? '', /<div class="unterstuetzen">[\s\S]*?class="knopf knopf-hell" href="https:\/\/buymeacoffee\.com\/scherhans" rel="noopener">Einen Kaffee spendieren</);
    assert.match(withRelease.get('/') ?? '', /class="knopf knopf-hell" href="https:\/\/buymeacoffee\.com\/scherhans" rel="noopener">Buy me a coffee</);
  });

  it('point from the downloads to the liability section of the legal notice, before and after the first version', () => {
    for (const result of [withRelease, withoutRelease]) {
      assert.ok(result.get('/de/')?.includes('<a href="impressum/#haftung">Mehr zur Haftung</a>'));
      assert.ok(result.get('/')?.includes('<a href="legal-notice/#liability">About liability</a>'));
    }
    assert.match(withRelease.get('/de/impressum/') ?? '', /<h2 id="haftung">Haftung für die App<\/h2><p>[^<]*§ 521 BGB/);
    assert.match(withRelease.get('/legal-notice/') ?? '', /<h2 id="liability">Liability for the app<\/h2><p>[^<]*Section 521 BGB/);
    assert.ok(withRelease.get('/de/datenschutz/')?.includes('<a href="../impressum/#haftung">Haftung für die App</a>'));
    assert.ok(withRelease.get('/privacy/')?.includes('<a href="../legal-notice/#liability">Liability for the app</a>'));
  });

  it('keep the preview out of search engines and mark it', () => {
    const preview = pages({ release, images }).get('/de/') ?? '';
    assert.match(preview, /<meta name="robots" content="noindex">/);
    assert.match(preview, /Vorschau mit Beispieldaten/);
    assert.doesNotMatch(withRelease.get('/de/') ?? '', /noindex/);
  });
});

describe('html helpers', () => {
  it('escape text and allow only the inline marks', () => {
    assert.equal(inline('<b>`x` **y** [z](https://a.example/?q=1&r=2)'), '&lt;b&gt;<code>x</code> <strong>y</strong> <a href="https://a.example/?q=1&amp;r=2" rel="noopener">z</a>');
    assert.equal(inline('a\nb'), 'a<br>b');
  });

  it('link relatively between the pages and the assets', () => {
    assert.equal(relative('/', '/de/'), 'de/');
    assert.equal(relative('/de/', '/'), '../');
    assert.equal(relative('/de/impressum/', '/assets/site.css'), '../../assets/site.css');
    assert.equal(relative('/', '/#download'), './#download');
    assert.equal(relative('/404.html', '/de/'), '/de/');
    assert.equal(relative('/404.html', '/assets/site.css'), '/assets/site.css');
    assert.equal(relative('/de/', '#download'), '#download');
  });

  it('write sizes the way people read them', () => {
    assert.equal(formatSize(121_456_789, 'en-GB'), '121 MB');
    assert.equal(formatSize(8_400_000, 'de-DE'), '8,4 MB');
  });
});
