import { githubUrl, SITE } from './config.ts';
import { CONTENT, type Content, type Lang } from './content.ts';
import { escape, fill, formatDate, formatSize, groupedChecksum, inline, NOT_FOUND, relative } from './html.ts';
import { LEGAL, type LegalKind } from './legal.ts';
import { SLOTS, type Download, type Platform, type Release, type Slot } from './release.ts';

export type PageKind = 'home' | LegalKind;

/** Where each page lives, per language. English is the root; German lives under /de/. */
export const PATHS: Record<PageKind, Record<Lang, string>> = {
  home: { en: '/', de: '/de/' },
  imprint: { en: '/legal-notice/', de: '/de/impressum/' },
  privacy: { en: '/privacy/', de: '/de/datenschutz/' },
};

/** Pixel size of each screenshot, by "lang/name"; the build reads it from the files. */
export type ImageSizes = Map<string, { width: number; height: number }>;

export interface RenderContext {
  release: Release | null;
  images: ImageSizes;
}

const LANGS: Lang[] = ['en', 'de'];
const other = (lang: Lang): Lang => (lang === 'en' ? 'de' : 'en');
const SHIELD = 'M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6zM9 12l2 2 4-4';
const ARROW_DOWN = 'M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14';
/** The flag beside the link to a language. The word says it; the flag helps find it. */
const FLAG: Record<Lang, string> = { en: 'gb', de: 'de' };

function icon(path: string): string {
  return `<svg class="symbol" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
}

/**
 * A screenshot of the app in its language. The files are taken at twice the size they are shown,
 * so they stay sharp on every screen; a phone gets its own cut of the window, large enough to read.
 */
function screenshot(context: RenderContext, lang: Lang, from: string, name: string, alt: string, narrow?: string): string {
  const file = (image: string) => {
    const size = context.images.get(`${lang}/${image}`);
    if (!size) throw new Error(`Screenshot assets/img/${lang}/${image}.png is missing`);
    return { src: relative(from, `/assets/img/${lang}/${image}.png`), width: Math.round(size.width / 2), height: Math.round(size.height / 2) };
  };
  const main = file(name);
  const img = `<img src="${main.src}" width="${main.width}" height="${main.height}" alt="${escape(alt)}" decoding="async">`;
  if (!narrow) return img;
  const cut = file(narrow);
  return `<picture><source media="(max-width: 640px)" srcset="${cut.src}" width="${cut.width}" height="${cut.height}">${img}</picture>`;
}

function head(c: Content, kind: PageKind | 'notFound', path: string, title: string, description: string, context: RenderContext): string {
  const alternates =
    kind === 'notFound'
      ? ''
      : [
          ...LANGS.map((lang) => `<link rel="alternate" hreflang="${lang}" href="${SITE.url}${PATHS[kind][lang]}">`),
          `<link rel="alternate" hreflang="x-default" href="${SITE.url}${PATHS[kind].en}">`,
        ].join('\n  ');
  const image = `${SITE.url}/assets/img/${c.lang}/app.png`;
  return `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)}</title>
  <meta name="description" content="${escape(description)}">
  ${context.release?.example || kind === 'notFound' ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${SITE.url}${path}">`}
  ${alternates}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escape(title)}">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:url" content="${SITE.url}${path}">
  <meta property="og:image" content="${image}">
  <meta property="og:locale" content="${c.locale.replace('-', '_')}">
  <meta name="theme-color" content="#f7f6f3">
  <link rel="icon" href="${relative(path, '/assets/icon.svg')}" type="image/svg+xml">
  <link rel="preload" href="${relative(path, '/assets/fonts/newsreader-500.woff2')}" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${relative(path, '/assets/fonts/hanken-grotesk-400.woff2')}" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${relative(path, '/assets/site.css')}">
  ${kind === 'home' ? `<script src="${relative(path, '/assets/site.js')}" defer></script>` : ''}
</head>`;
}

function languageLink(c: Content, kind: PageKind | 'notFound', path: string, className?: string): string {
  const switchTo = other(c.lang);
  const target = kind === 'notFound' ? PATHS.home[switchTo] : PATHS[kind][switchTo];
  const flag = `<img class="flagge" src="${relative(path, `/assets/flags/${FLAG[switchTo]}.svg`)}" alt="" width="21" height="14">`;
  return `<a${className ? ` class="${className}"` : ''} href="${relative(path, target)}" hreflang="${switchTo}" lang="${switchTo}">${flag}${c.nav.language}</a>`;
}

function header(c: Content, kind: PageKind | 'notFound', path: string): string {
  return `<header class="kopf">
  <a class="marke" href="${relative(path, PATHS.home[c.lang])}"><img src="${relative(path, '/assets/icon.svg')}" alt="" width="36" height="36"><span>IMAP Transfer</span></a>
  <div class="kopf-rechts">
    ${languageLink(c, kind, path, 'sprache')}
    <a class="knopf knopf-klein" href="${relative(path, `${PATHS.home[c.lang]}#download`)}">${c.nav.download}</a>
  </div>
</header>`;
}

function footer(c: Content, kind: PageKind | 'notFound', path: string): string {
  const links = [
    `<a href="${githubUrl()}" rel="noopener">${c.footer.source}</a>`,
    `<a href="${githubUrl('/blob/main/LICENSE')}" rel="noopener">${c.footer.license}</a>`,
    `<a href="${relative(path, PATHS.imprint[c.lang])}">${c.footer.imprint}</a>`,
    `<a href="${relative(path, PATHS.privacy[c.lang])}">${c.footer.privacy}</a>`,
    languageLink(c, kind, path),
  ];
  const closing =
    kind === 'home'
      ? `<h2 class="schluss">${escape(c.footer.title)}</h2>
  <p class="vorspann schluss-text">${escape(c.footer.text)}</p>`
      : '';
  return `<footer class="fuss">
  ${closing}
  <ul class="fuss-links">${links.map((link) => `<li>${link}</li>`).join('')}</ul>
  <p class="klein leise">© 2026 Sebastian Scherhans</p>
</footer>`;
}

function frame(c: Content, kind: PageKind | 'notFound', path: string, title: string, description: string, main: string, context: RenderContext): string {
  const banner = context.release?.example ? `<p class="vorschau" role="note">${escape(c.preview)}</p>` : '';
  return `<!doctype html>
<html lang="${c.lang}">
${head(c, kind, path, title, description, context)}
<body>
<a class="springen" href="#inhalt">${c.nav.skip}</a>
${banner}
${header(c, kind, path)}
<main id="inhalt">
${main}
</main>
${footer(c, kind, path)}
</body>
</html>
`;
}

// ── The landing page ──────────────────────────────────────────────────────────────────────────

function hero(c: Content, path: string, context: RenderContext): string {
  const release = context.release;
  const note = release
    ? `${escape(fill(c.hero.version, { version: release.version }))} <a href="#download">${escape(c.hero.all)}</a>`
    : escape(c.hero.soon);
  return `<section class="buehne" aria-labelledby="titel">
  <h1 id="titel" class="anzeige">${escape(c.hero.title[0])}<br>${escape(c.hero.title[1])}</h1>
  <div class="buehne-zeile">
    <p class="vorspann">${inline(c.hero.lead)}</p>
    <div class="buehne-aktion">
      <a class="knopf" id="laden" href="#download">${escape(c.hero.button)}</a>
      <p class="klein leise">${note}</p>
    </div>
  </div>
  <figure class="fenster">
    ${screenshot(context, c.lang, path, 'app', c.hero.image, 'app-narrow')}
  </figure>
</section>`;
}

function backup(c: Content): string {
  return `<section class="abschnitt sicherung" id="backup" aria-labelledby="backup-titel">
  <div class="sicherung-text">
    <h2 id="backup-titel">${escape(c.backup.title)}</h2>
    <p>${inline(c.backup.text)}</p>
    <ul class="fakten">${c.backup.facts.map((fact) => `<li>${inline(fact)}</li>`).join('')}</ul>
  </div>
  <figure class="baum">
    <pre tabindex="0"><code>${escape(c.backup.tree)}</code></pre>
    <figcaption class="klein leise">${inline(c.backup.caption)}</figcaption>
  </figure>
</section>`;
}

function migrate(c: Content, path: string, context: RenderContext): string {
  return `<section class="abschnitt umzug" id="migrate" aria-labelledby="umzug-titel">
  <figure class="ausschnitt umzug-bild">
    ${screenshot(context, c.lang, path, 'migrate', c.migrate.image)}
  </figure>
  <div class="umzug-text">
    <h2 id="umzug-titel">${escape(c.migrate.title)}</h2>
    <p>${inline(c.migrate.text)}</p>
    <p class="bleibt">${icon(SHIELD)}<span>${escape(c.migrate.kept)}</span></p>
    <h3>${escape(c.migrate.syncTitle)}</h3>
    <p>${inline(c.migrate.sync)}</p>
  </div>
</section>`;
}

function care(c: Content, path: string, context: RenderContext): string {
  const part = (key: 'stop' | 'clean', image: string) => {
    const text = c.care[key];
    return `<div class="sorgfalt-teil">
      <h3>${escape(text.title)}</h3>
      <p>${inline(text.text)}</p>
      <figure class="ausschnitt">${screenshot(context, c.lang, path, image, text.image)}</figure>
    </div>`;
  };
  return `<section class="abschnitt sorgfalt" aria-labelledby="sorgfalt-titel">
  <h2 id="sorgfalt-titel">${escape(c.care.title)}</h2>
  <div class="sorgfalt-paar">
    ${part('stop', 'running')}
    ${part('clean', 'cleanup')}
  </div>
</section>`;
}

function providers(c: Content): string {
  const rows = c.providers.rows.map(([name, how]) => `<tr><th scope="row">${escape(name)}</th><td>${escape(how)}</td></tr>`).join('');
  return `<section class="abschnitt anbieter" aria-labelledby="anbieter-titel">
  <h2 id="anbieter-titel">${escape(c.providers.title)}</h2>
  <div class="anbieter-kopf">
    <p>${inline(c.providers.lead)}</p>
    <p class="klein leise">${inline(c.providers.note)}</p>
  </div>
  <table class="tabelle anbieter-tabelle">
    <thead><tr><th scope="col">${escape(c.providers.head[0])}</th><th scope="col">${escape(c.providers.head[1])}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function commandLine(c: Content): string {
  const code = c.cli.code
    .split('\n')
    .map((line) => (line.startsWith('#') ? `<span class="kommentar">${escape(line)}</span>` : escape(line)))
    .join('\n');
  return `<section class="feld-dunkel" aria-labelledby="cli-titel">
  <div class="abschnitt kommandozeile">
    <div class="kommandozeile-text">
      <h2 id="cli-titel">${escape(c.cli.title)}</h2>
      <p>${inline(c.cli.text)}</p>
      <p class="klein">${inline(c.cli.exit)}</p>
    </div>
    <pre class="code" tabindex="0"><code>${code}</code></pre>
  </div>
</section>`;
}

const TERMINAL: Record<Platform, (name: string) => string> = {
  mac: (name) => `shasum -a 256 ~/Downloads/${name}`,
  windows: (name) => `Get-FileHash $HOME\\Downloads\\${name}`,
  linux: (name) => `sha256sum ~/Downloads/${name}`,
};

const PLATFORMS: Platform[] = ['mac', 'windows', 'linux'];

/** One installer on one line: its button, size, checksum and copy button; or a placeholder while its file is missing. */
function variant(c: Content, path: string, slot: Slot, download: Download | undefined): string {
  const label = `${icon(ARROW_DOWN)}<span>${escape(c.download.variants[slot.key] ?? slot.key)}</span>`;
  const data = `data-platform="${slot.platform}" data-arch="${slot.arch}" data-kind="${slot.kind}"`;
  if (!download) {
    return `<li class="variante fehlt" ${data}>
        <span class="knopf knopf-aus" aria-disabled="true">${label}</span>
        <span class="klein leise fehlt-text">${escape(c.download.missing)}</span>
      </li>`;
  }
  return `<li class="variante" ${data}>
        <a class="knopf knopf-zweit" href="${escape(relative(path, download.url))}" download="${escape(download.name)}">${label}</a>
        <span class="klein leise groesse">${formatSize(download.size, c.locale)}</span>
        <p class="pruefsumme"><span class="unsichtbar">SHA-256 </span><code>${groupedChecksum(download.sha256)}</code></p>
        <button type="button" class="kopieren" data-summe="${download.sha256}" hidden>${escape(c.download.copy)}</button>
      </li>`;
}

function downloads(c: Content, path: string, release: Release | null): string {
  const available = release?.downloads ?? [];
  const systems = PLATFORMS.map((platform) => {
    const system = c.download.systems[platform];
    const variants = SLOTS.filter((slot) => slot.platform === platform)
      .map((slot) => variant(c, path, slot, available.find((download) => download.key === slot.key)))
      .join('\n      ');
    return `<div class="system" data-platform="${platform}">
    <div class="system-kopf">
      <h3>${escape(system.name)}<span class="deins" hidden>${escape(c.download.yours)}</span></h3>
      <p class="klein leise">${escape(system.hint)}</p>
    </div>
    <ul class="varianten">
      ${variants}
    </ul>
  </div>`;
  }).join('\n  ');
  const intro = release
    ? escape(fill(c.download.released, { version: release.version, date: formatDate(release.publishedAt, c.locale) }))
    : escape(c.download.none);
  return `<section class="abschnitt herunterladen" id="download" aria-labelledby="download-titel">
  <div class="herunterladen-kopf">
    <h2 id="download-titel">${escape(c.download.title)}</h2>
    <p>${intro}</p>
  </div>
  <div class="systeme">
  ${systems}
  </div>
  ${release && available.length > 0 ? checker(c, path, release) : ''}
</section>`;
}

/** Checking a downloaded file: in the browser, or with the terminal commands. */
function checker(c: Content, path: string, release: Release): string {
  const first = (platform: Platform) => release.downloads.find((download) => download.platform === platform);
  const commands = PLATFORMS.map((platform) => {
    const download = first(platform);
    return download ? `<li><span class="klein leise">${escape(c.download.commands[platform])}</span><code>${escape(TERMINAL[platform](download.name))}</code></li>` : '';
  }).join('');
  const data = {
    version: release.version,
    downloads: release.downloads.map(({ platform, arch, kind, name, url, sha256 }) => ({ platform, arch, kind, name, url: relative(path, url), sha256 })),
    texts: {
      buttonFor: c.hero.buttonFor,
      copy: c.download.copy,
      copied: c.download.copied,
      checking: c.download.checking,
      match: c.download.match,
      mismatch: c.download.mismatch,
      unreadable: c.download.unreadable,
    },
  };
  return `<div class="pruefen">
    <div class="pruefen-text">
      <h3>${escape(c.download.checkTitle)}</h3>
      <p>${escape(c.download.checkText)}</p>
    </div>
    <div class="ablage" hidden>
      <label class="knopf knopf-zweit" for="datei">${escape(c.download.choose)}</label>
      <input class="unsichtbar" type="file" id="datei">
      <span class="leise">${escape(c.download.drop)}</span>
      <p class="ergebnis" role="status" aria-live="polite"></p>
    </div>
    <div class="terminal">
      <p class="klein leise">${escape(c.download.terminal)}</p>
      <ul>${commands}</ul>
    </div>
  </div>
  <script type="application/json" id="daten">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

export function homePage(lang: Lang, context: RenderContext): string {
  const c = CONTENT[lang];
  const path = PATHS.home[lang];
  const main = [
    hero(c, path, context),
    backup(c),
    migrate(c, path, context),
    care(c, path, context),
    providers(c),
    commandLine(c),
    downloads(c, path, context.release),
  ].join('\n');
  return frame(c, 'home', path, c.meta.title, c.meta.description, main, context);
}

/** Links of a text to a path of this site ("/assets/…"), made relative to the page. */
function ownLinks(html: string, path: string): string {
  return html.replace(/href="(\/[^"]*)"/g, (_, to: string) => `href="${relative(path, to)}"`);
}

export function legalPage(lang: Lang, kind: LegalKind, context: RenderContext): string {
  const c = CONTENT[lang];
  const doc = LEGAL[lang][kind];
  const path = PATHS[kind][lang];
  const sections = doc.sections
    .map((section) => `${section.heading ? `<h2>${escape(section.heading)}</h2>` : ''}${section.paragraphs.map((text) => `<p>${ownLinks(inline(text), path)}</p>`).join('')}`)
    .join('\n  ');
  const main = `<article class="rechtliches" aria-labelledby="titel">
  <h1 id="titel">${escape(doc.title)}</h1>
  ${sections}
  <p class="klein leise stand">${escape(doc.updated)}</p>
</article>`;
  return frame(c, kind, path, `${doc.title}: IMAP Transfer`, doc.description, main, context);
}

/** One page for both languages: the server answers every unknown path with it. */
export function notFoundPage(context: RenderContext): string {
  const path = NOT_FOUND;
  const main = `<article class="rechtliches nicht-gefunden" aria-labelledby="titel">
  <h1 id="titel">This page does not exist</h1>
  <p><a href="${relative(path, PATHS.home.en)}">Go to the start page</a></p>
  <h2 lang="de">Diese Seite gibt es nicht</h2>
  <p lang="de"><a href="${relative(path, PATHS.home.de)}">Zur Startseite</a></p>
</article>`;
  return frame(CONTENT.en, 'notFound', path, 'Page not found: IMAP Transfer', 'This page does not exist.', main, context);
}

export function sitemap(): string {
  const urls = (Object.keys(PATHS) as PageKind[])
    .flatMap((kind) =>
      LANGS.map(
        (lang) => `  <url>
    <loc>${SITE.url}${PATHS[kind][lang]}</loc>
${LANGS.map((alternate) => `    <xhtml:link rel="alternate" hreflang="${alternate}" href="${SITE.url}${PATHS[kind][alternate]}"/>`).join('\n')}
  </url>`,
      ),
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
}
