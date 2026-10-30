<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AccountOrder, ThemeChoice } from '../../shared/api';
import { LANGUAGES, type LanguageChoice } from '../../shared/languages';
import AccountEditor from './components/AccountEditor.vue';
import AccountLabel from './components/AccountLabel.vue';
import AccountView from './components/AccountView.vue';
import Icon from './components/Icon.vue';
import JobPanel from './components/JobPanel.vue';
import UpdateNotice from './components/UpdateNotice.vue';
import Welcome from './components/Welcome.vue';
import { formatRelative } from './format';
import { jobRunning, selectedAccount, showAccount, sortedAccounts, state, updateSettings } from './store';

const { t } = useI18n();

const THEMES: { value: ThemeChoice; icon: string }[] = [
  { value: 'system', icon: 'system' },
  { value: 'light', icon: 'sun' },
  { value: 'dark', icon: 'moon' },
];

const ORDERS: AccountOrder[] = ['address', 'provider'];

function status(account: (typeof state.accounts)[number]): string {
  if (!account.lastBackup) return t('account.never');
  const when = formatRelative(account.lastBackup.finishedAt);
  if (account.lastBackup.status === 'failed') return t('account.lastBackupFailed', { when });
  if (account.lastBackup.status === 'cancelled') return t('account.lastBackupCancelled', { when });
  return t('account.lastBackup', { when });
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="mark" aria-hidden="true"><Icon name="mail" :size="20" /></span>
        <div>
          <strong>IMAP Transfer</strong>
          <p class="muted small">{{ t('app.tagline') }}</p>
        </div>
      </div>

      <nav v-if="state.accounts.length" class="accounts" :aria-label="t('app.accounts')">
        <div class="section">
          <p class="muted small">{{ t('app.accounts') }}</p>
          <!-- Sorting needs at least two accounts. -->
          <div
            v-if="state.info && state.accounts.length > 1"
            class="segmented order"
            role="group"
            :aria-label="t('app.order.label')"
            :title="t('app.order.label')"
          >
            <button
              v-for="order in ORDERS"
              :key="order"
              type="button"
              :aria-pressed="state.info.settings.accountOrder === order"
              @click="updateSettings({ accountOrder: order })"
            >
              {{ t(`app.order.${order}`) }}
            </button>
          </div>
        </div>
        <button
          v-for="account in sortedAccounts"
          :key="account.id"
          class="account"
          :class="{ active: selectedAccount?.id === account.id }"
          :aria-current="selectedAccount?.id === account.id ? 'page' : undefined"
          @click="showAccount(account.id)"
        >
          <AccountLabel :account="account" />
          <span class="status muted small" :class="{ failed: account.lastBackup?.status === 'failed' }">
            <span class="dot" :class="account.lastBackup?.status ?? 'never'" aria-hidden="true" />
            {{ status(account) }}
          </span>
        </button>
      </nav>

      <button class="button add" :disabled="jobRunning" @click="state.view = { name: 'editor', id: null }">
        <Icon name="plus" :size="16" />
        {{ t('app.addAccount') }}
      </button>

      <div class="spacer" />
      <p v-if="state.info?.accountsProblem" class="notice error small">{{ t('app.accountsProblem') }} {{ state.info.accountsProblem }}</p>
      <p v-if="state.info?.secretStorage === 'weak'" class="notice warning small">{{ t('app.weakSecrets') }}</p>
      <template v-if="state.info">
        <label class="language">
          <Icon name="globe" :size="15" />
          <select
            :aria-label="t('app.language.label')"
            :value="state.info.settings.language"
            @change="updateSettings({ language: ($event.target as HTMLSelectElement).value as LanguageChoice })"
          >
            <option value="system">{{ t('app.language.system') }}</option>
            <option v-for="(name, code) in LANGUAGES" :key="code" :value="code" :lang="code">{{ name }}</option>
          </select>
        </label>
        <label v-if="state.info.updatesBuiltIn && state.info.settings.updateCheck !== null" class="checkbox updates muted small">
          <input
            type="checkbox"
            :checked="state.info.settings.updateCheck"
            @change="updateSettings({ updateCheck: ($event.target as HTMLInputElement).checked })"
          />
          <span>{{ t('app.updates.label') }}</span>
        </label>
        <div class="foot">
          <span class="muted small">{{ t('app.version', { version: state.info.version }) }}</span>
          <div class="segmented theme" role="group" :aria-label="t('app.theme.label')">
            <button
              v-for="theme in THEMES"
              :key="theme.value"
              type="button"
              :aria-pressed="state.info.settings.theme === theme.value"
              :aria-label="t(`app.theme.${theme.value}`)"
              :title="t(`app.theme.${theme.value}`)"
              @click="updateSettings({ theme: theme.value })"
            >
              <Icon :name="theme.icon" :size="15" />
            </button>
          </div>
        </div>
      </template>
    </aside>

    <main class="content">
      <UpdateNotice v-if="state.info?.updatesBuiltIn && state.info.settings.updateCheck === null" />
      <JobPanel v-if="state.job" :job="state.job" />
      <AccountEditor
        v-else-if="state.view.name === 'editor'"
        :key="state.view.id ?? 'new'"
        :account-id="state.view.id"
      />
      <AccountView v-else-if="selectedAccount" :key="selectedAccount.id" :account="selectedAccount" />
      <Welcome v-else />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: 270px 1fr;
  height: 100%;
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 14px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: var(--sidebar);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 4px 8px;
}

.brand .mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(160deg, var(--accent-bright), var(--accent));
  color: var(--accent-text);
}

.brand strong {
  font-size: 15.5px;
  letter-spacing: -0.01em;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
}

.dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border-strong);
}

.dot.completed {
  background: var(--success);
}

.dot.failed {
  background: var(--danger);
}

.dot.cancelled {
  background: var(--warning);
}

.accounts {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* The heading of the list, with the order of the accounts at its right. The height stays the same
   whether the order is shown or not, so the list does not jump when a second account arrives. */
.section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 28px;
  padding: 0 0 4px 8px;
}

.section p {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.account {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 7px 10px;
  border: 0;
  border-radius: var(--radius-small);
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.account:hover {
  background: color-mix(in srgb, var(--text) 6%, transparent);
}

.account.active {
  background: var(--surface);
  box-shadow: var(--shadow);
}

.failed {
  color: var(--danger);
}

.add {
  justify-content: flex-start;
}

/* Language and look: small, at the foot, out of the way of the work. */
.language {
  position: relative;
  display: flex;
  align-items: center;
  color: var(--text-muted);
}

.language .icon {
  position: absolute;
  left: 8px;
  pointer-events: none;
}

.language select {
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0 6px 0 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius-small);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
}

/* A few choices side by side, one of them pressed: the look, and the order of the accounts. */
.segmented {
  display: flex;
  flex: none;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-small);
  background: color-mix(in srgb, var(--text) 7%, transparent);
}

.segmented button {
  display: grid;
  place-items: center;
  min-width: 28px;
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: 5px;
  background: none;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
}

.segmented button:hover {
  color: var(--text);
}

.segmented button[aria-pressed='true'] {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow);
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: -4px;
  padding-left: 2px;
}

.content {
  overflow-y: auto;
}
</style>
