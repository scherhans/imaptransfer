import type { ProviderPreset } from '@imaptransfer/core';
import type { AccountOrder, AccountSummary } from '../../shared/api';

type Named = Pick<AccountSummary, 'id' | 'user'>;
type Sortable = Pick<AccountSummary, 'user' | 'providerId' | 'host'>;

/**
 * Where an account lives, for telling two accounts with the same address apart, e.g. before and
 * after a migration: the provider's name, or the server when no provider was chosen or the server
 * was changed by hand.
 */
export function originOf(account: Pick<AccountSummary, 'providerId' | 'host'>, providers: ProviderPreset[]): string {
  const provider = providers.find((candidate) => candidate.id === account.providerId);
  return provider && provider.host === account.host ? provider.name : account.host;
}

/** True when another account carries the same address; the address alone then names nothing. */
export function needsOrigin(account: Named, accounts: Named[]): boolean {
  const user = account.user.toLowerCase();
  return accounts.some((other) => other.id !== account.id && other.user.toLowerCase() === user);
}

/**
 * The accounts in the order the user picked, as people sort words (case and accents do not count,
 * 2 comes before 10). By address, the same address is ordered by provider; by provider, the
 * accounts of one provider are ordered by address. Returns a new list.
 */
export function sortAccounts<T extends Sortable>(accounts: T[], providers: ProviderPreset[], order: AccountOrder, locale: string): T[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const keyed = accounts.map((account) => ({ account, user: account.user, origin: originOf(account, providers) }));
  keyed.sort((a, b) =>
    order === 'provider'
      ? collator.compare(a.origin, b.origin) || collator.compare(a.user, b.user)
      : collator.compare(a.user, b.user) || collator.compare(a.origin, b.origin),
  );
  return keyed.map((entry) => entry.account);
}
