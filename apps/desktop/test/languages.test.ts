// Portuguese is that of Portugal: every Portuguese system gets it, and a choice of Brazilian
// Portuguese saved by version 0.2.0 carries over to it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickLanguage, savedLanguage } from '../src/shared/languages.ts';

describe('pickLanguage', () => {
  it('gives every Portuguese system the Portuguese of Portugal', () => {
    for (const system of ['pt-PT', 'pt-BR', 'pt', 'PT-br']) assert.equal(pickLanguage(system), 'pt-PT', system);
  });

  it('keeps the other languages and gives English to the rest', () => {
    assert.equal(pickLanguage('de-AT'), 'de');
    assert.equal(pickLanguage('ja-JP'), 'en');
  });
});

describe('savedLanguage', () => {
  it('turns the Brazilian Portuguese of 0.2.0 into the Portuguese of Portugal', () => {
    assert.equal(savedLanguage('pt-BR'), 'pt-PT');
  });

  it('keeps every other choice and lets anything unknown follow the system', () => {
    assert.equal(savedLanguage('pt-PT'), 'pt-PT');
    assert.equal(savedLanguage('de'), 'de');
    assert.equal(savedLanguage('system'), 'system');
    assert.equal(savedLanguage('xx'), 'system');
    assert.equal(savedLanguage(undefined), 'system');
  });
});
