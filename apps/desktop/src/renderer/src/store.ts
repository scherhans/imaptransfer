import { computed, reactive } from 'vue';
import type { ProviderPreset } from '@imaptransfer/core';
import type { AccountSummary, AppInfo, JobState, Settings } from '../../shared/api';
import { needsOrigin, originOf, sortAccounts } from './account-name';
import { i18n, showLanguage } from './i18n';

const api = window.imaptransfer;

export type View = { name: 'welcome' } | { name: 'account'; id: string } | { name: 'editor'; id: string | null };

/** The whole user interface state; small enough to need no state library. */
export const state = reactive({
  info: null as AppInfo | null,
  providers: [] as ProviderPreset[],
  accounts: [] as AccountSummary[],
  view: { name: 'welcome' } as View,
  job: null as JobState | null,
});

export const selectedAccount = computed(() =>
  state.view.name === 'account' ? (state.accounts.find((account) => account.id === (state.view as { id: string }).id) ?? null) : null,
);

export const jobRunning = computed(() => state.job?.status === 'running');

/** The accounts in the order the user picked for the sidebar; every list of accounts follows it. */
export const sortedAccounts = computed(() =>
  sortAccounts(state.accounts, state.providers, state.info?.settings.accountOrder ?? 'address', i18n.global.locale.value),
);

export async function refreshAccounts(): Promise<void> {
  state.accounts = await api.accounts.list();
  if (state.view.name === 'account' && !state.accounts.some((account) => account.id === (state.view as { id: string }).id)) {
    const first = sortedAccounts.value[0];
    state.view = first ? { name: 'account', id: first.id } : { name: 'welcome' };
  }
}

export function showAccount(id: string): void {
  state.view = { name: 'account', id };
}

export async function initialize(): Promise<void> {
  const [info, providers, job] = await Promise.all([api.app.info(), api.providers(), api.jobs.current()]);
  state.info = info;
  showLanguage(info.settings.language);
  state.providers = providers;
  state.job = job;
  await refreshAccounts();
  if (sortedAccounts.value[0]) showAccount(sortedAccounts.value[0].id);
  api.jobs.onUpdate((update) => {
    state.job = update;
  });
  api.jobs.onAccountsChanged(() => void refreshAccounts());
}

/** Changes the look or the language; the app keeps the choice for the next start. */
export async function updateSettings(change: Partial<Settings>): Promise<void> {
  const settings = await api.app.updateSettings(change);
  if (state.info) state.info.settings = settings;
  showLanguage(settings.language);
}

export async function dismissJob(): Promise<void> {
  await api.jobs.dismiss();
  state.job = null;
}

export function providerById(id: string | null): ProviderPreset | undefined {
  return id ? state.providers.find((provider) => provider.id === id) : undefined;
}

/** The provider's name, or the server: what tells two accounts with the same address apart. */
export function accountOrigin(account: AccountSummary): string {
  return originOf(account, state.providers);
}

/** How the window names an account: its address, with the origin added when another account has the same address. */
export function accountName(account: AccountSummary): string {
  if (!needsOrigin(account, state.accounts)) return account.user;
  return i18n.global.t('account.withOrigin', { user: account.user, origin: accountOrigin(account) });
}

export { api };
