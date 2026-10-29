<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { JobState } from '../../../shared/api';
import { formatBytes, formatNumber, formatRemainingTime, messageCount } from '../format';
import { accountName, api, state } from '../store';
import ReportView from './ReportView.vue';

const props = defineProps<{ job: JobState }>();
const { t } = useI18n();
const cancelling = ref(false);
const now = ref(Date.now());
const ticker = setInterval(() => (now.value = Date.now()), 250);
/** A large message only gets its own bar once it takes a moment; quick ones would flicker. */
const SHOW_CURRENT_AFTER_MS = 800;
onBeforeUnmount(() => clearInterval(ticker));

const nameOf = (id: string): string => {
  const account = state.accounts.find((candidate) => candidate.id === id);
  return account ? accountName(account) : '';
};

const title = computed(() => {
  const request = props.job.request;
  switch (request.kind) {
    case 'backup':
      return t('job.titles.backup', { user: nameOf(request.accountId) });
    case 'restore':
      return t(request.sync ? 'job.titles.syncRestore' : 'job.titles.restore', { user: nameOf(request.accountId) });
    case 'migrate':
      return t(request.sync ? 'job.titles.syncMigrate' : 'job.titles.migrate', { from: nameOf(request.fromAccountId), to: nameOf(request.toAccountId) });
    case 'dedupe':
      return t('job.titles.dedupe', { user: nameOf(request.accountId) });
    default:
      return t(`job.titles.${request.kind}`);
  }
});

const percent = computed(() => {
  const { done, total } = props.job.progress;
  return total > 0 ? Math.min(100, (done / total) * 100) : null;
});

const current = computed(() => {
  const message = props.job.current;
  return message && now.value - message.startedAt >= SHOW_CURRENT_AFTER_MS ? message : null;
});

const currentPercent = computed(() => (current.value && current.value.size > 0 ? Math.min(100, (current.value.transferred / current.value.size) * 100) : 0));

const retrySeconds = computed(() => {
  const retry = props.job.retry;
  return retry ? Math.max(0, Math.ceil((retry.at + retry.delayMs - now.value) / 1000)) : 0;
});

async function cancel(): Promise<void> {
  cancelling.value = true;
  await api.jobs.cancel();
}
</script>

<template>
  <div class="panel">
    <h1>{{ title }}</h1>

    <template v-if="job.status === 'running'">
      <div class="card stack">
        <p>{{ job.phase ? t(`job.phases.${job.phase}`) : t('common.loading') }}</p>
        <div
          class="progress"
          :class="{ indeterminate: percent === null }"
          role="progressbar"
          :aria-valuenow="percent ?? undefined"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div :style="percent === null ? undefined : { width: `${percent}%` }" />
        </div>
        <div class="row numbers">
          <span v-if="job.progress.total > 0">
            {{ t('job.progress', { done: formatNumber(job.progress.done), total: formatNumber(job.progress.total) }) }}
          </span>
          <span v-if="job.progress.bytes > 0" class="muted">{{ formatBytes(job.progress.bytes) }}</span>
          <span class="spacer" />
          <span v-if="job.folder" class="muted folder">
            {{ t('job.folder', { path: job.folder.path, index: job.folder.index + 1, count: job.folder.count }) }}
          </span>
        </div>
        <p v-if="job.remaining" class="remaining">
          <strong>{{ formatRemainingTime(job.remaining.time) }}</strong>
          <span class="muted">
            · {{ t('job.remainingWork', { messages: messageCount(job.remaining.messages), size: formatBytes(job.remaining.bytes) }) }}
          </span>
        </p>
        <div v-if="current" class="current-message">
          <p class="small row">
            <span>{{ t(`job.current.${current.direction}`) }}</span>
            <span class="subject">{{ t('common.quoted', { text: current.subject ?? t('report.noSubject') }) }}</span>
          </p>
          <!-- Until the first part arrives, a running bar instead of an empty one that looks stuck. -->
          <div
            class="progress thin"
            :class="{ indeterminate: current.transferred === 0 }"
            role="progressbar"
            :aria-label="t(`job.current.${current.direction}`)"
            :aria-valuenow="current.transferred === 0 ? undefined : Math.round(currentPercent)"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div :style="current.transferred === 0 ? undefined : { width: `${currentPercent}%` }" />
          </div>
          <p class="muted small numbers">{{ t('job.current.amount', { done: formatBytes(current.transferred), total: formatBytes(current.size) }) }}</p>
        </div>
        <p v-if="job.retry" class="notice warning small">
          {{ t('job.retry', { reason: job.retry.reason, seconds: retrySeconds }) }}
        </p>
        <p class="muted small">{{ t('job.keepAwake') }}</p>
        <div class="row">
          <span class="spacer" />
          <span v-if="cancelling" class="muted small">{{ t('job.cancelling') }}</span>
          <button class="button" :disabled="cancelling" @click="cancel">{{ t('job.cancel') }}</button>
        </div>
      </div>

      <details v-if="job.warnings.length" class="warnings">
        <summary>{{ t('job.warnings', { n: job.warnings.length }) }}</summary>
        <ul>
          <li v-for="(warning, index) in job.warnings" :key="index" class="small">
            <span v-if="warning.folder" class="mono">{{ warning.folder }}</span>
            <span v-if="warning.subject"> {{ t('common.quoted', { text: warning.subject }) }}</span>
            {{ warning.message }}
          </li>
        </ul>
      </details>
    </template>

    <ReportView v-else :job="job" />
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 32px;
}

h1 {
  overflow-wrap: anywhere;
}

.numbers {
  font-variant-numeric: tabular-nums;
}

.remaining strong {
  font-weight: 600;
}

.current-message {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-small);
  background: var(--surface-muted);
}

.current-message .subject {
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress.thin {
  height: 5px;
  background: color-mix(in srgb, var(--text) 10%, transparent);
}

.folder {
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.warnings summary {
  cursor: pointer;
  font-weight: 550;
}

.warnings ul {
  margin: 8px 0 0;
  padding-left: 18px;
}
</style>
