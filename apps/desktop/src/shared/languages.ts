/** The languages the app speaks, each named in itself, as the language menu lists them. */
export const LANGUAGES = {
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  nl: 'Nederlands',
  'pt-PT': 'Português',
} as const;

export type Language = keyof typeof LANGUAGES;

/** A language the user picked, or `system` to follow the operating system. */
export type LanguageChoice = 'system' | Language;

export function isLanguageChoice(value: unknown): value is LanguageChoice {
  return value === 'system' || (typeof value === 'string' && Object.hasOwn(LANGUAGES, value));
}

/** A language choice as the settings file holds it. Version 0.2.0 spoke Brazilian Portuguese; whoever picked it keeps Portuguese. Anything unknown follows the system. */
export function savedLanguage(value: unknown): LanguageChoice {
  if (value === 'pt-BR') return 'pt-PT';
  return isLanguageChoice(value) ? value : 'system';
}

/** The app's language for a system language such as `de-AT`; anything not translated gets English. Portuguese is that of Portugal, also for `pt-BR`. */
export function pickLanguage(system: string): Language {
  const lower = system.toLowerCase();
  if (lower.startsWith('pt')) return 'pt-PT';
  for (const language of ['de', 'es', 'fr', 'it', 'nl'] as const) {
    if (lower.startsWith(language)) return language;
  }
  return 'en';
}
