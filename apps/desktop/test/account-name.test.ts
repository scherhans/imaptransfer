// Two accounts with the same address, e.g. before and after a migration, are told apart by where
// they live: the provider's name, or the server.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProviderPreset } from '@imaptransfer/core';
import { needsOrigin, originOf, sortAccounts } from '../src/renderer/src/account-name.ts';

const providers = [
  { id: 'mittwald', name: 'mittwald', host: 'mail.agenturserver.de' },
  { id: 'gmail', name: 'Gmail', host: 'imap.gmail.com' },
] as ProviderPreset[];

describe('originOf', () => {
  it('names the provider, or the server when none was chosen', () => {
    assert.equal(originOf({ providerId: 'mittwald', host: 'mail.agenturserver.de' }, providers), 'mittwald');
    assert.equal(originOf({ providerId: null, host: 'mail.firma.example' }, providers), 'mail.firma.example');
  });

  it('falls back to the server when it no longer matches the provider', () => {
    assert.equal(originOf({ providerId: 'gmail', host: 'imap.other.example' }, providers), 'imap.other.example');
  });
});

describe('needsOrigin', () => {
  const anna = { id: 'a', user: 'anna@firma.example' };
  const annaAgain = { id: 'b', user: 'Anna@firma.example' };
  const max = { id: 'c', user: 'max@firma.example' };
  const accounts = [anna, annaAgain, max];

  it('is true only when another account carries the same address, whatever the case', () => {
    assert.equal(needsOrigin(anna, accounts), true);
    assert.equal(needsOrigin(annaAgain, accounts), true);
    assert.equal(needsOrigin(max, accounts), false);
    assert.equal(needsOrigin(anna, [anna]), false);
  });
});

describe('sortAccounts', () => {
  const account = (user: string, providerId: string | null, host: string) => ({ user, providerId, host });
  const accounts = [
    account('max@firma.example', 'gmail', 'imap.gmail.com'),
    account('Anna@firma.example', 'mittwald', 'mail.agenturserver.de'),
    account('anna@firma.example', null, 'imap.ionos.de'),
    account('zoe@verein.example', null, 'mail.verein.example'),
    account('bob@firma.example', 'mittwald', 'mail.agenturserver.de'),
  ];
  const listed = (sorted: typeof accounts) => sorted.map((entry) => `${entry.user} ${originOf(entry, providers)}`);

  it('orders by address, case aside, and the same address by provider', () => {
    assert.deepEqual(listed(sortAccounts(accounts, providers, 'address', 'de')), [
      'anna@firma.example imap.ionos.de',
      'Anna@firma.example mittwald',
      'bob@firma.example mittwald',
      'max@firma.example Gmail',
      'zoe@verein.example mail.verein.example',
    ]);
  });

  it('orders by provider or server, and within one by address', () => {
    assert.deepEqual(listed(sortAccounts(accounts, providers, 'provider', 'de')), [
      'max@firma.example Gmail',
      'anna@firma.example imap.ionos.de',
      'zoe@verein.example mail.verein.example',
      'Anna@firma.example mittwald',
      'bob@firma.example mittwald',
    ]);
  });

  it('counts numbers as numbers and leaves the given list as it was', () => {
    const numbered = [account('team10@firma.example', null, 'h'), account('team2@firma.example', null, 'h')];
    assert.deepEqual(sortAccounts(numbered, providers, 'address', 'de').map((entry) => entry.user), ['team2@firma.example', 'team10@firma.example']);
    assert.equal(numbered[0]?.user, 'team10@firma.example');
  });
});
