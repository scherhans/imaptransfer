<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BackupSummary } from '@imaptransfer/core';
import type { AccountSummary, PlanRequest } from '../../../shared/api';
import { errorText, formatBytes, formatRelative, messageCount } from '../format';
import { accountName, api, providerById, refreshAccounts, sortedAccounts, state } from '../store';
import AccountLabel from './AccountLabel.vue';
import DedupeDialog from './DedupeDialog.vue';
import Icon from './Icon.vue';
import TransferDialog from './TransferDialog.vue';

const props = defineProps<{ account: AccountSummary }>();
const { t } = useI18n();

const error = ref<string | null>(null);
const plan = ref<{ request: PlanRequest; backup: BackupSummary | null } | null>(null);
const cleanup = ref(false);
const otherAccounts = computed(() => sortedAccounts.value.filter((account) => account.id !== props.account.id));
const migrationTarget = ref('');
// Accounts can be added or removed while this view is open: keep a valid target selected.
watchEffect(() => {
  if (!otherAccounts.value.some((account) => account.id === migrationTarget.value)) {
    migrationTarget.value = otherAccounts.value[0]?.id ?? '';
  }
});
const busy = computed(() => state.job?.status === 'running');

const authLabel = computed(() => {
  if (props.account.auth === 'oauth-microsoft') return t('auth.oauth-microsoft');
  return providerById(props.account.providerId)?.auth === 'app-password' ? t('auth.app-password') : t('auth.password');
});

/** The last run went into another folder than the one chosen now: that one starts afresh. */
const newFolder = computed(() => props.account.lastBackup !== null && props.account.lastBackup.directory !== props.account.backupDirectory);

const lastBackup = computed(() => {
  const last = props.account.lastBackup;
  if (!last) return t('account.never');
  const when = formatRelative(last.finishedAt);
  if (last.status === 'failed') return t('account.lastBackupFailed', { when });
  if (last.status === 'cancelled') return t('account.lastBackupCancelled', { when });
  return t('account.lastBackup', { when });
});

async function run(action: () => Promise<unknown>): Promise<void> {
  error.value = null;
  try {
    await action();
  } catch (failure) {
    error.value = errorText(failure);
  }
}

async function backupDirectory(): Promise<string | null> {
  if (props.account.backupDirectory) return props.account.backupDirectory;
  return chooseBackupDirectory();
}

async function chooseBackupDirectory(): Promise<string | null> {
  const defaultPath = props.account.backupDirectory ?? (await api.app.defaultBackupDirectory(accountName(props.account)));
  const directory = await api.dialogs.chooseDirectory({
    title: t('account.backup.chooseDirectory', { user: accountName(props.account) }),
    defaultPath,
    create: true,
  });
  if (!directory) return null;
  await api.accounts.setBackupDirectory(props.account.id, directory);
  await refreshAccounts();
  return directory;
}

function openBackupFolder(): Promise<void> {
  return run(async () => {
    if (props.account.backupDirectory) await api.shell.openPath(props.account.backupDirectory);
  });
}

function startBackup(): Promise<void> {
  return run(async () => {
    const directory = await backupDirectory();
    if (directory) state.job = await api.jobs.start({ kind: 'backup', accountId: props.account.id, directory, excludeFolders: [] });
  });
}

function verify(): Promise<void> {
  return run(async () => {
    if (props.account.backupDirectory) state.job = await api.jobs.start({ kind: 'verify', directory: props.account.backupDirectory });
  });
}

function exportMbox(): Promise<void> {
  return run(async () => {
    if (!props.account.backupDirectory) return;
    const outputDirectory = await api.dialogs.chooseDirectory({ title: t('account.backup.exportTitle'), create: true });
    if (outputDirectory) {
      state.job = await api.jobs.start({ kind: 'export-mbox', directory: props.account.backupDirectory, outputDirectory, includeRemoved: false });
    }
  });
}

function chooseRestore(): Promise<void> {
  return run(async () => {
    const directory = await api.dialogs.chooseDirectory({
      title: t('account.restore.chooseTitle'),
      ...(props.account.backupDirectory ? { defaultPath: props.account.backupDirectory } : {}),
    });
    if (!directory) return;
    const backup = await api.backups.inspect(directory);
    if (!backup) throw new Error(t('account.restore.notABackup'));
    plan.value = { request: { kind: 'restore', directory, accountId: props.account.id, includeRemoved: false, excludeFolders: [], sync: false }, backup };
  });
}

function chooseMigration(): void {
  if (!migrationTarget.value) return;
  plan.value = { request: { kind: 'migrate', fromAccountId: props.account.id, toAccountId: migrationTarget.value, excludeFolders: [], sync: false }, backup: null };
}

function remove(): Promise<void> {
  return run(async () => {
    if (!window.confirm(t('account.removeConfirm', { user: accountName(props.account) }))) return;
    await api.accounts.remove(props.account.id);
    await refreshAccounts();
  });
}
</script>

<template>
  <div class="page">
    <header class="row">
      <div>
        <h1>{{ account.user }}</h1>
        <p class="muted">{{ account.host }} · {{ authLabel }}</p>
      </div>
      <span class="spacer" />
      <button class="button" :disabled="busy" @click="state.view = { name: 'editor', id: account.id }">{{ t('account.edit') }}</button>
      <button class="button danger" :disabled="busy" @click="remove">{{ t('account.remove') }}</button>
    </header>

    <p v-if="error" class="notice error">{{ error }}</p>

    <section class="card stack">
      <h2 class="heading"><Icon name="backup" />{{ t('account.backup.title') }}</h2>
      <p class="muted">{{ t('account.backup.text') }}</p>
      <div class="directory">
        <span class="label">{{ t('account.backup.directory') }}</span>
        <template v-if="account.backupDirectory">
          <span class="mono path" :title="account.backupDirectory">{{ account.backupDirectory }}</span>
          <button class="button link" :disabled="busy" @click="run(chooseBackupDirectory)">{{ t('common.change') }}</button>
          <button class="button link" @click="openBackupFolder">{{ t('common.openFolder') }}</button>
        </template>
        <button v-else class="button link" :disabled="busy" @click="run(chooseBackupDirectory)">{{ t('common.choose') }}</button>
      </div>
      <p v-if="newFolder" class="small muted">{{ t('account.backup.newFolder') }}</p>
      <p v-else class="small" :class="account.lastBackup?.status === 'failed' ? 'failed' : 'muted'">
        {{ lastBackup }}
        <template v-if="account.lastBackup && account.lastBackup.messages > 0">
          · {{ t('account.backup.stats', { messages: messageCount(account.lastBackup.messages), size: formatBytes(account.lastBackup.bytes) }) }}
        </template>
      </p>
      <div class="row">
        <button class="button primary" :disabled="busy" @click="startBackup">{{ t('account.backup.start') }}</button>
        <template v-if="account.lastBackup && !newFolder">
          <button class="button" :disabled="busy" @click="verify">{{ t('account.backup.verify') }}</button>
          <button class="button" :disabled="busy" @click="exportMbox">{{ t('account.backup.exportMbox') }}</button>
        </template>
      </div>
    </section>

    <div class="pair">
      <section class="card stack">
        <h2 class="heading"><Icon name="restore" />{{ t('account.restore.title') }}</h2>
        <p class="muted">{{ t('account.restore.text') }}</p>
        <div class="row bottom">
          <button class="button" :disabled="busy" @click="chooseRestore">{{ t('account.restore.start') }}</button>
        </div>
      </section>

      <section class="card stack">
        <h2 class="heading"><Icon name="migrate" />{{ t('account.migrate.title') }}</h2>
        <p class="muted">{{ t('account.migrate.text') }}</p>
        <div v-if="otherAccounts.length" class="row bottom">
          <label class="field target">
            <span class="small">{{ t('account.migrate.target') }}</span>
            <select v-model="migrationTarget" class="input accounts">
              <!-- Shows the chosen account in the field the same way as in the list: two lines. -->
              <button type="button"><selectedcontent /></button>
              <option v-for="other in otherAccounts" :key="other.id" :value="other.id"><AccountLabel :account="other" /></option>
            </select>
          </label>
          <button class="button" :disabled="busy || !migrationTarget" @click="chooseMigration">{{ t('account.migrate.start') }}</button>
        </div>
        <p v-else class="muted small bottom">{{ t('account.migrate.noTarget') }}</p>
      </section>
    </div>

    <section class="card stack">
      <h2 class="heading"><Icon name="optimize" />{{ t('account.dedupe.title') }}</h2>
      <p class="muted">{{ t('account.dedupe.text') }}</p>
      <div class="row">
        <button class="button" :disabled="busy" @click="cleanup = true">{{ t('account.dedupe.start') }}</button>
      </div>
    </section>

    <TransferDialog v-if="plan" :request="plan.request" :backup="plan.backup" @close="plan = null" />
    <DedupeDialog v-if="cleanup" :account="account" @close="cleanup = false" />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 32px;
}

header h1 {
  overflow-wrap: anywhere;
}

.directory {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.directory .label {
  font-weight: 550;
}

.path {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.failed {
  color: var(--danger);
}

.pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px;
}

.pair .card {
  display: flex;
}

.bottom {
  margin-top: auto;
  align-items: flex-end;
}

.target {
  flex: 1;
  min-width: 160px;
}
</style>
