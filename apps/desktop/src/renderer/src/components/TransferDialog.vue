<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BackupSummary, TransferPlan } from '@imaptransfer/core';
import type { PlanRequest } from '../../../shared/api';
import { errorText, folderCount, formatNumber, formatRelative, messageCount } from '../format';
import { accountName, api, state } from '../store';
import FolderPath from './FolderPath.vue';
import Icon from './Icon.vue';

const props = defineProps<{ request: PlanRequest; backup: BackupSummary | null }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const plan = ref<TransferPlan | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const includeRemoved = ref(false);
/** In one direction: what left the source leaves the target too. */
const sync = ref(false);
const excluded = reactive(new Set<string>());
const dialog = ref<HTMLDialogElement | null>(null);

const nameOf = (id: string): string => {
  const account = state.accounts.find((candidate) => candidate.id === id);
  return account ? accountName(account) : '';
};
const title = computed(() =>
  props.request.kind === 'restore'
    ? t('plan.restoreTitle', { user: nameOf(props.request.accountId) })
    : t('plan.migrateTitle', { from: nameOf(props.request.fromAccountId), to: nameOf(props.request.toAccountId) }),
);

const targetName = computed(() => nameOf(props.request.kind === 'restore' ? props.request.accountId : props.request.toAccountId));
/** Whose mail the source is: the account the backup was made of, or the source account. */
const sourceName = computed(() => {
  if (props.request.kind === 'migrate') return nameOf(props.request.fromAccountId);
  const owner = props.backup?.account;
  if (!owner) return props.request.directory;
  const known = state.accounts.find((account) => account.user.toLowerCase() === owner.user.toLowerCase() && account.host.toLowerCase() === owner.host.toLowerCase());
  return known ? accountName(known) : owner.user;
});
const syncProblem = computed(() => plan.value?.target.syncProblem ?? null);

const selected = computed(() => plan.value?.mappings.filter((mapping) => !excluded.has(mapping.source)) ?? []);
const selectedMessages = computed(() => selected.value.reduce((sum, mapping) => sum + mapping.messages, 0));

function currentRequest(): PlanRequest {
  const excludeFolders = [...excluded];
  return props.request.kind === 'restore'
    ? { ...props.request, includeRemoved: includeRemoved.value && !sync.value, excludeFolders, sync: sync.value }
    : { ...props.request, excludeFolders, sync: sync.value };
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    plan.value = await api.jobs.plan({ ...currentRequest(), excludeFolders: [] });
  } catch (failure) {
    error.value = errorText(failure);
  } finally {
    loading.value = false;
  }
}

function toggle(source: string, include: boolean): void {
  if (include) excluded.delete(source);
  else excluded.add(source);
}

async function start(): Promise<void> {
  try {
    state.job = await api.jobs.start(currentRequest());
    emit('close');
  } catch (failure) {
    error.value = errorText(failure);
  }
}

watch(includeRemoved, () => void load());
// A sync takes deleted mail out of the target, so it cannot bring it back at the same time.
watch(sync, (on) => {
  if (on) includeRemoved.value = false;
});
watch(syncProblem, (problem) => {
  if (problem) sync.value = false;
});
onMounted(() => {
  dialog.value?.showModal();
  void load();
});
</script>

<template>
  <dialog ref="dialog" class="dialog" @close="emit('close')">
    <form method="dialog" class="stack" @submit.prevent="start">
      <h2>{{ title }}</h2>
      <!-- A migration only reads the source account: say so before anything starts. -->
      <p v-if="request.kind === 'migrate'" class="notice kept">
        <Icon name="shield" :size="16" />
        <span>{{ t('plan.sourceKept', { source: sourceName }) }}</span>
      </p>
      <p v-if="backup?.account && backup.lastRun" class="muted small">
        {{ t('plan.backupOf', { user: backup.account.user, when: formatRelative(backup.lastRun.finishedAt) }) }}
      </p>

      <label v-if="request.kind === 'restore'" class="checkbox">
        <input v-model="includeRemoved" type="checkbox" :disabled="sync" />
        {{ t('plan.includeRemoved') }}
      </label>
      <div v-if="plan" class="stack sync">
        <label class="checkbox">
          <input v-model="sync" type="checkbox" :disabled="syncProblem !== null" />
          <span>
            {{ t('plan.sync.label') }}
            <span class="explain muted small">{{ t(`plan.sync.explain.${request.kind}`, { source: sourceName, target: targetName }) }}</span>
          </span>
        </label>
        <p v-if="syncProblem" class="notice small">{{ t('plan.sync.unavailable') }} {{ t(`conflicts.${syncProblem}`) }}</p>
        <p v-else-if="sync && !plan.history" class="notice small">{{ t('plan.sync.first', { source: sourceName, target: targetName }) }}</p>
        <p v-else-if="sync && request.kind === 'restore' && plan.removed > 0" class="notice warning small">
          {{ t('plan.sync.removed', { messages: messageCount(plan.removed), source: sourceName, target: targetName }, plan.removed) }}
        </p>
      </div>
      <!-- After an account was emptied, everything in the backup counts as deleted: say so. -->
      <p v-if="plan && !loading && !includeRemoved && !sync && plan.removed > 0" class="notice small" :class="{ warning: plan.messages === 0 }">
        {{ t('plan.removedHint', { messages: messageCount(plan.removed) }, plan.removed) }}
      </p>

      <p v-if="loading" class="notice small">{{ t('plan.loading') }}</p>
      <p v-if="error" class="notice error small">{{ error }}</p>
      <p v-if="plan?.target.gmail" class="notice small">{{ t('plan.gmailTarget') }}</p>

      <div v-if="plan && !loading" class="mappings">
        <table class="table">
          <thead>
            <tr>
              <th />
              <th>{{ t('plan.source') }}</th>
              <th>{{ t('plan.target') }}</th>
              <th class="number">{{ t('plan.count') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="mapping in plan.mappings" :key="mapping.source">
              <td>
                <input
                  type="checkbox"
                  :checked="!excluded.has(mapping.source)"
                  :aria-label="mapping.source"
                  @change="toggle(mapping.source, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td class="mono"><FolderPath :path="mapping.source" /></td>
              <td>
                <span class="mono"><FolderPath :path="mapping.target" /></span>
                <span v-if="!mapping.exists" class="badge">{{ t('plan.new') }}</span>
                <p v-if="mapping.role === 'all'" class="muted small">{{ t('plan.allMail') }}</p>
              </td>
              <td class="number">{{ formatNumber(mapping.messages) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="plan && !loading" class="small muted">
        {{ t('plan.summary', { messages: messageCount(selectedMessages), folders: folderCount(selected.length) }) }}
      </p>

      <div class="row">
        <span class="spacer" />
        <button type="button" class="button" @click="dialog?.close()">{{ t('common.cancel') }}</button>
        <button type="submit" class="button primary" :disabled="!plan || loading || selected.length === 0">
          {{ sync ? t('plan.startSync') : t('plan.start') }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.dialog {
  width: min(760px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 20px 60px rgb(0 0 0 / 0.25);
}

.dialog::backdrop {
  background: rgb(0 0 0 / 0.35);
}

.mappings {
  max-height: 45vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-small);
}

.mappings td:first-child,
.mappings th:first-child {
  width: 28px;
}

.badge {
  margin-left: 6px;
}

.kept {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.kept .icon {
  flex: none;
  margin-top: 2px;
  color: var(--accent);
}

.sync .explain {
  display: block;
  margin-top: 2px;
}
</style>
