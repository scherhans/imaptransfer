import type { Lang } from './content.ts';
import type { LegalKind } from './legal.ts';

export type PageKind = 'home' | 'download' | LegalKind;

/** Where each page lives, per language. English is the root; German lives under /de/. */
export const PATHS: Record<PageKind, Record<Lang, string>> = {
  home: { en: '/', de: '/de/' },
  download: { en: '/download/', de: '/de/download/' },
  imprint: { en: '/legal-notice/', de: '/de/impressum/' },
  privacy: { en: '/privacy/', de: '/de/datenschutz/' },
};

/** The anchor of the section on liability for the app, in the legal notice. */
export const LIABILITY: Record<Lang, string> = { de: 'haftung', en: 'liability' };

/** That section; the downloads, the footer of every page and the privacy policy link to it. */
export const liabilityPath = (lang: Lang) => `${PATHS.imprint[lang]}#${LIABILITY[lang]}`;
