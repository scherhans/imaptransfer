// Every language must carry every key of the English texts, with the same placeholders and the
// same number of plural forms: a missing key would show up as the raw key name in the window.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import de from '../src/renderer/src/i18n/de.ts';
import en from '../src/renderer/src/i18n/en.ts';
import es from '../src/renderer/src/i18n/es.ts';
import fr from '../src/renderer/src/i18n/fr.ts';
import it_ from '../src/renderer/src/i18n/it.ts';
import nl from '../src/renderer/src/i18n/nl.ts';
import ptPT from '../src/renderer/src/i18n/pt-PT.ts';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') result.set(path, value);
    else for (const [inner, text] of flatten(value, path)) result.set(inner, text);
  }
  return result;
}

const placeholders = (text: string) => [...text.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
const pluralForms = (text: string) => text.split(' | ').length;

const reference = flatten(en as Tree);

describe('translations', () => {
  for (const [name, tree] of Object.entries({ de, es, fr, it: it_, nl, 'pt-PT': ptPT })) {
    it(`${name} has every key of en, with the same placeholders and plural forms`, () => {
      const translated = flatten(tree as Tree);
      const missing = [...reference.keys()].filter((key) => !translated.has(key));
      const extra = [...translated.keys()].filter((key) => !reference.has(key));
      assert.deepEqual({ missing, extra }, { missing: [], extra: [] });
      for (const [key, text] of reference) {
        const other = translated.get(key) ?? '';
        assert.deepEqual(placeholders(other), placeholders(text), `${key}: placeholders differ`);
        assert.equal(pluralForms(other), pluralForms(text), `${key}: plural forms differ`);
      }
    });
  }
});
