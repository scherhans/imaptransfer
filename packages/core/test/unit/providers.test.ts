import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectProvider, findProvider, PROVIDERS } from '../../src/providers.ts';

describe('providers', () => {
  it('have unique ids and claim each domain only once', () => {
    const ids = PROVIDERS.map((provider) => provider.id);
    assert.deepEqual(ids, [...new Set(ids)]);
    const domains = PROVIDERS.flatMap((provider) => provider.domains);
    assert.deepEqual(domains, [...new Set(domains)]);
  });

  it('are found by id, also a hoster whose customers use their own domains', () => {
    const mittwald = findProvider('mittwald');
    assert.equal(mittwald?.host, 'mail.agenturserver.de');
    assert.equal(mittwald?.port, 993);
    assert.equal(mittwald?.secure, true);
    assert.equal(mittwald?.auth, 'password');
    assert.equal(findProvider('nope'), undefined);
  });

  it('detect the provider from the domain of an address, ignoring case', () => {
    assert.equal(detectProvider('Anna@GMX.de')?.id, 'gmx');
    assert.equal(detectProvider('anna@firma.example'), undefined);
    assert.equal(detectProvider('anna'), undefined);
  });
});
