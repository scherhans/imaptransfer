<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DuplicateFolder, DuplicatePlan } from '@imaptransfer/core';
import type { AccountSummary, DuplicateSearchProgress } from '../../../shared/api';
import { errorText, formatBytes, formatDate, formatNumber, formatRelative } from '../format';
import { accountName, api, state } from '../store';
import FolderPath from './FolderPath.vue';
import Icon from './Icon.vue';

const props = defineProps<{ account: AccountSummary }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

// Opening the dialog is the test run: it reads the account and changes nothing. Only the
// button at the end cleans up.
const plan = ref<DuplicatePlan | null>(null);
const loading = ref(true);
/** How far the test run is: it reads every mail of the account, which takes a while. */
const progress = ref<DuplicateSearchProgress | null>(null);
const error = ref<string | null>(null);
const excluded = reactive(new Set<string>());
/** The folder whose affected messages are listed, instead of the overview. */
const inspecting = ref<DuplicateFolder | null>(null);
const dialog = ref<HTMLDialogElement | null>(null);

const withCopies = computed(() => plan.value?.folders.filter((folder) => folder.duplicates > 0) ?? []);
const selected = computed(() => withCopies.value.filter((folder) => !excluded.has(folder.path)));
const selectedCopies = computed(() => selected.value.reduce((sum, folder) => sum + folder.duplicates, 0));
const canClean = computed(() => plan.value !== null && !plan.value.problem && plan.value.duplicates > 0);
const lastBackup = computed(() => props.account.lastBackup);
const percent = computed(() => {
  const current = progress.value;
  return current && current.total > 0 ? Math.min(100, (current.done / current.total) * 100) : null;
});

function toggle(path: string, include: boolean): void {
  if (include) excluded.delete(path);
  else excluded.add(path);
}

async function start(): Promise<void> {
  try {
    state.job = await api.jobs.start({ kind: 'dedupe', accountId: props.account.id, excludeFolders: [...excluded] });
    emit('close');
  } catch (failure) {
    error.value = errorText(failure);
  }
}

const stopListening = api.jobs.onDuplicateProgress((update) => {
  progress.value = update;
});

onMounted(async () => {
  dialog.value?.showModal();
  try {
    plan.value = await api.jobs.findDuplicates(props.account.id);
  } catch (failure) {
    error.value = errorText(failure);
  } finally {
    loading.value = false;
    stopListening();
  }
});

// Closing the dialog while the test run still reads ends it; nothing waits for its answer.
onBeforeUnmount(() => {
  stopListening();
  if (loading.value) void api.jobs.cancelFindDuplicates();
});
</script>

<template>
  <dialog ref="dialog" class="dialog" @close="emit('close')">
    <!-- The affected messages of one folder: a page of its own inside the dialog. -->
    <div v-if="inspecting" class="stack">
      <div class="row">
        <button type="button" class="button" @click="inspecting = null">← {{ t('common.back') }}</button>
        <h2 class="list-title">{{ t('dedupe.listTitle', { folder: inspecting.path }) }}</h2>
      </div>
      <p class="muted small">{{ t('dedupe.listHint') }}</p>
      <div class="affected">
        <table class="table">
          <thead>
            <tr>
              <th class="number">{{ t('dedupe.copies') }}</th>
              <th>{{ t('dedupe.date') }}</th>
              <th>{{ t('dedupe.subject') }}</th>
              <th>{{ t('dedupe.from') }}</th>
              <th class="number">{{ t('dedupe.size') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(message, index) in inspecting.duplicated" :key="index">
              <td class="number count">{{ t('dedupe.times', { n: message.copies }) }}</td>
              <td class="date">{{ message.date ? formatDate(message.date) : '–' }}</td>
              <td class="subject">{{ message.subject ?? t('report.noSubject') }}</td>
              <td class="from muted">{{ message.from ?? '' }}</td>
              <td class="number muted">{{ formatBytes(message.size) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted small">{{ t('dedupe.listSummary', { messages: formatNumber(inspecting.duplicated.length), copies: formatNumber(inspecting.duplicates) }) }}</p>
    </div>

    <form v-else method="dialog" class="stack" @submit.prevent="start">
      <h2>{{ t('dedupe.title', { user: accountName(account) }) }}</h2>
      <p class="muted small">{{ t('dedupe.explain') }}</p>

      <div v-if="loading" class="searching stack" aria-live="polite">
        <p>{{ progress?.phase === 'scan' ? t('dedupe.loading') : t('job.phases.connect') }}</p>
        <div
          class="progress"
          :class="{ indeterminate: percent === null }"
          role="progressbar"
          :aria-valuenow="percent === null ? undefined : Math.round(percent)"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div :style="percent === null ? undefined : { width: `${percent}%` }" />
        </div>
        <div class="row small numbers">
          <span v-if="progress && progress.total > 0" class="checked">
            {{ t('dedupe.checked', { done: formatNumber(progress.done), total: formatNumber(progress.total) }) }}
          </span>
          <span class="spacer" />
          <span v-if="progress?.folder" class="muted folder">
            {{ t('job.folder', { path: progress.folder.path, index: progress.folder.index + 1, count: progress.folder.count }) }}
          </span>
        </div>
        <p class="muted small">{{ t('dedupe.readOnly') }}</p>
      </div>
      <p v-if="error" class="notice error small">{{ error }}</p>
      <p v-if="plan?.problem" class="notice error small">{{ t(`conflicts.${plan.problem}`) }}</p>
      <p v-else-if="plan && plan.duplicates === 0" class="notice success small test-run">{{ t('dedupe.none') }}</p>
      <p v-else-if="plan" class="notice small test-run">{{ t('dedupe.testRun') }}</p>

      <template v-if="plan && canClean">
        <div class="folders">
          <table class="table">
            <thead>
              <tr>
                <th />
                <th>{{ t('dedupe.folder') }}</th>
                <th class="number">{{ t('dedupe.messages') }}</th>
                <th class="number">{{ t('dedupe.copies') }}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="folder in withCopies" :key="folder.path">
                <td>
                  <input
                    type="checkbox"
                    :checked="!excluded.has(folder.path)"
                    :aria-label="folder.path"
                    @change="toggle(folder.path, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td class="mono"><FolderPath :path="folder.path" /></td>
                <td class="number">{{ formatNumber(folder.messages) }}</td>
                <td class="number">{{ formatNumber(folder.duplicates) }}</td>
                <td class="show">
                  <button type="button" class="button link show-messages" @click="inspecting = folder">
                    {{ t('dedupe.show') }}
                    <Icon name="migrate" :size="14" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="small">{{ t('dedupe.toTrash', { trash: plan.trash }) }}</p>
        <p v-if="plan.similar > 0" class="muted small">{{ t('dedupe.similar', { n: formatNumber(plan.similar) }, plan.similar) }}</p>
        <p v-if="!lastBackup" class="notice warning small">{{ t('dedupe.noBackup') }}</p>
        <p v-else class="muted small">{{ t('account.lastBackup', { when: formatRelative(lastBackup.finishedAt) }) }}</p>
        <p class="small muted">{{ t('dedupe.summary', { copies: t('dedupe.copyCount', { n: formatNumber(selectedCopies) }, selectedCopies) }) }}</p>
      </template>

      <div class="row">
        <span class="spacer" />
        <button type="button" class="button" @click="dialog?.close()">{{ loading || canClean ? t('common.cancel') : t('common.close') }}</button>
        <button v-if="canClean" type="submit" class="button primary" :disabled="selectedCopies === 0">{{ t('dedupe.start') }}</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.dialog {
  width: min(860px, calc(100vw - 48px));
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

.searching {
  padding: 14px 16px;
  border-radius: var(--radius-small);
  background: var(--surface-muted);
}

/* The box has the bar's usual track color; a tint keeps the track visible on it. */
.searching .progress {
  background: color-mix(in srgb, var(--text) 10%, transparent);
}

.searching .numbers {
  font-variant-numeric: tabular-nums;
}

.searching .folder {
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folders {
  max-height: 40vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-small);
}

.folders td:first-child,
.folders th:first-child {
  width: 28px;
}

.folders .show {
  text-align: right;
  white-space: nowrap;
}

.show-messages {
  gap: 4px;
}

.list-title {
  overflow-wrap: anywhere;
}

.affected {
  max-height: 55vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-small);
}

.affected .count {
  font-weight: 600;
}

.affected .date {
  white-space: nowrap;
}

.affected .subject,
.affected .from {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
