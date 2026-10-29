import { createI18n } from 'vue-i18n';
import { pickLanguage, type Language, type LanguageChoice } from '../../../shared/languages';
import de from './de';
import en from './en';
import es from './es';
import fr from './fr';
import it from './it';
import nl from './nl';
import ptBR from './pt-BR';

export const messages: Record<Language, typeof de> = { de, en, es, fr, it, nl, 'pt-BR': ptBR };

const initial = pickLanguage(navigator.language);
document.documentElement.lang = initial;

export const i18n = createI18n({
  legacy: false,
  locale: initial,
  fallbackLocale: 'en',
  messages,
});

/** Shows the window in the language the user picked, or in the system's; anything else gets English. */
export function showLanguage(choice: LanguageChoice): void {
  const language = choice === 'system' ? pickLanguage(navigator.language) : choice;
  i18n.global.locale.value = language;
  document.documentElement.lang = language;
}
