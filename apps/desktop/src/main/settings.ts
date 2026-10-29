import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AccountOrder, Settings, ThemeChoice } from '../shared/api';
import { isLanguageChoice } from '../shared/languages';

const THEMES: readonly unknown[] = ['system', 'light', 'dark'] satisfies ThemeChoice[];
const ORDERS: readonly unknown[] = ['address', 'provider'] satisfies AccountOrder[];
const DEFAULTS: Settings = { theme: 'system', language: 'system', accountOrder: 'address' };

const isTheme = (value: unknown): value is ThemeChoice => THEMES.includes(value);
const isOrder = (value: unknown): value is AccountOrder => ORDERS.includes(value);

/** Preferences of the app itself, next to the accounts: the look, the language and the order of the accounts. */
export class SettingsStore {
  private readonly file: string;
  private settings: Settings;

  constructor(file: string) {
    this.file = file;
    this.settings = this.load();
  }

  private load(): Settings {
    try {
      const content = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      return {
        theme: isTheme(content.theme) ? content.theme : DEFAULTS.theme,
        language: isLanguageChoice(content.language) ? content.language : DEFAULTS.language,
        accountOrder: isOrder(content.accountOrder) ? content.accountOrder : DEFAULTS.accountOrder,
      };
    } catch {
      // Missing or damaged: the defaults are a fine start, nothing of value is lost.
      return { ...DEFAULTS };
    }
  }

  get current(): Settings {
    return { ...this.settings };
  }

  /** Takes over the given values and writes them; an unknown value changes nothing. */
  update(change: Record<string, unknown>): Settings {
    const next = { ...this.settings };
    if (change.theme !== undefined) {
      if (!isTheme(change.theme)) throw new Error(`Unknown theme ${String(change.theme)}`);
      next.theme = change.theme;
    }
    if (change.language !== undefined) {
      if (!isLanguageChoice(change.language)) throw new Error(`Unknown language ${String(change.language)}`);
      next.language = change.language;
    }
    if (change.accountOrder !== undefined) {
      if (!isOrder(change.accountOrder)) throw new Error(`Unknown account order ${String(change.accountOrder)}`);
      next.accountOrder = change.accountOrder;
    }
    this.write(next);
    this.settings = next;
    return this.current;
  }

  private write(settings: Settings): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    const handle = openSync(temporary, 'w', 0o600);
    try {
      writeSync(handle, JSON.stringify({ version: 1, ...settings }, null, 2));
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(temporary, this.file);
  }
}
