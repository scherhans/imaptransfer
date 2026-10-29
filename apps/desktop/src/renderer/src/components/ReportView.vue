<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { JobState } from '../../../shared/api';
import { formatBytes, formatDuration, formatNumber, messageCount, runErrorText } from '../format';
import { accountName, api, dismissJob, state } from '../store';
import FolderPath from './FolderPath.vue';
import Icon from './Icon.vue';

const props = defineProps<{ job: JobState }>();
const { t } = useI18n();

const report = computed(() => props.job.report);
const isBackup = computed(() => props.job.request.kind === 'backup');
const isCleanup = computed(() => props.job.request.kind === 'dedupe');
/** The source account of a migration: the report says that it stayed as it was. */
const migratedFrom = computed(() => {
  const request = props.job.request;
  if (request.kind !== 'migrate') return null;
  const account = state.accounts.find((candidate) => candidate.id === request.fromAccountId);
  return account ? accountName(account) : null;
});
const isSync = computed(() => {
  const request = props.job.request;
  return (request.kind === 'restore' || request.kind === 'migrate') && request.sync;
});
/** A cleanup lists only the folders it changed or could not handle. */
const folders = computed(() => (isCleanup.value ? (report.value?.folders.filter((folder) => folder.transferred > 0 || folder.error) ?? []) : (report.value?.folders ?? [])));
const folderErrors = computed(() => report.value?.folders.filter((folder) => folder.error).length ?? 0);

const cleanupTotals = computed(() => {
  const totals = report.value?.totals;
  if (!totals || totals.transferred === 0) return t('report.cleanup.none');
  const trash = report.value?.folders.find((folder) => folder.transferred > 0)?.target ?? t('dedupe.trashFallback');
  return t('report.cleanup.removed', { n: formatNumber(totals.transferred), trash }, totals.transferred);
});

const headline = computed(() => {
  const job = props.job;
  if (job.status === 'cancelled') return { tone: 'warning', text: t('report.cancelled') };
  if (job.status === 'failed') return { tone: 'error', text: t('report.failed') };
  if (isCleanup.value && folderErrors.value > 0) {
    return { tone: 'warning', text: t('report.cleanup.withErrors', { n: formatNumber(folderErrors.value) }, folderErrors.value) };
  }
  if (report.value && report.value.totals.failed > 0) {
    return { tone: 'warning', text: t('report.withFailures', { n: formatNumber(report.value.totals.failed) }) };
  }
  if (report.value) return { tone: 'success', text: isSync.value ? t('report.completed.sync') : t(`report.completed.${report.value.kind}`) };
  if (job.verify) {
    const problems = job.verify.missing.length + job.verify.damaged.length;
    return problems === 0
      ? { tone: 'success', text: t('report.verifyOk', { n: formatNumber(job.verify.messages) }) }
      : { tone: 'error', text: t('report.verifyProblems', { ok: formatNumber(job.verify.ok), n: formatNumber(job.verify.messages) }) };
  }
  if (job.mbox) {
    return { tone: 'success', text: t('report.mboxDone', { messages: messageCount(job.mbox.messages), files: formatNumber(job.mbox.files.length) }) };
  }
  return { tone: 'success', text: '' };
});

const errorMessage = computed(() => {
  const error = report.value?.error ?? props.job.error;
  return error ? runErrorText(error) : null;
});

const directory = computed(() => {
  const request = props.job.request;
  if (request.kind === 'backup' || request.kind === 'verify') return request.directory;
  if (request.kind === 'export-mbox') return request.outputDirectory;
  return null;
});

const duration = computed(() => (report.value ? formatDuration(Date.parse(report.value.finishedAt) - Date.parse(report.value.startedAt)) : null));
</script>

<template>
  <div class="stack">
    <p v-if="headline.text" class="notice headline" :class="headline.tone">
      <Icon :name="headline.tone === 'success' ? 'check' : 'mail'" :size="18" />
      <strong>{{ headline.text }}</strong>
    </p>
    <p v-if="errorMessage" class="notice error">{{ errorMessage }}</p>

    <template v-if="report">
      <div class="card stack">
        <p v-if="isCleanup">{{ cleanupTotals }}</p>
        <p v-else>
          {{
            t('report.totals', {
              transferred: formatNumber(report.totals.transferred),
              size: formatBytes(report.totals.bytes),
              skipped: formatNumber(report.totals.skipped),
              failed: formatNumber(report.totals.failed),
            })
          }}
        </p>
        <p v-if="isSync">{{ t('report.removed', { n: formatNumber(report.totals.removed) }, report.totals.removed) }}</p>
        <p v-if="report.totals.deduplicated > 0" class="muted small">
          {{ t('report.deduplicated', { n: formatNumber(report.totals.deduplicated) }) }}
        </p>
        <p v-if="migratedFrom" class="kept small">
          <Icon name="shield" :size="15" />
          <span>{{ t('report.sourceKept', { source: migratedFrom }) }}</span>
        </p>
        <p v-if="duration" class="muted small">{{ t('report.duration', { duration }) }}</p>

        <table v-if="isCleanup && folders.length" class="table">
          <thead>
            <tr>
              <th>{{ t('report.folder') }}</th>
              <th class="number">{{ t('report.messages') }}</th>
              <th class="number">{{ t('report.cleanup.removedColumn') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="folder in folders" :key="folder.path">
              <td class="mono">
                <FolderPath :path="folder.path" />
                <p v-if="folder.error" class="folder-error small">{{ folder.error }}</p>
              </td>
              <td class="number">{{ formatNumber(folder.sourceCount) }}</td>
              <td class="number">{{ formatNumber(folder.transferred) }}</td>
            </tr>
          </tbody>
        </table>
        <table v-else-if="folders.length" class="table">
          <thead>
            <tr>
              <th>{{ t('report.folder') }}</th>
              <th v-if="!isBackup">{{ t('report.target') }}</th>
              <th class="number">{{ isBackup ? t('report.onServer') : t('report.messages') }}</th>
              <th v-if="isBackup" class="number">{{ t('report.inBackup') }}</th>
              <th class="number">{{ t('report.new') }}</th>
              <th class="number">{{ t('report.present') }}</th>
              <th class="number">{{ t('report.failedColumn') }}</th>
              <th v-if="isSync" class="number">{{ t('report.removedColumn') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="folder in folders" :key="folder.path">
              <td class="mono">
                <FolderPath :path="folder.path" />
                <p v-if="folder.error" class="folder-error small">{{ t('report.folderSkipped') }}: {{ folder.error }}</p>
              </td>
              <td v-if="!isBackup" class="mono"><FolderPath :path="folder.target ?? ''" /></td>
              <td class="number">{{ formatNumber(folder.sourceCount) }}</td>
              <td v-if="isBackup" class="number">{{ folder.targetCount === null ? '–' : formatNumber(folder.targetCount) }}</td>
              <td class="number">{{ formatNumber(folder.transferred) }}</td>
              <td class="number">{{ formatNumber(folder.skipped) }}</td>
              <td class="number" :class="{ failed: folder.failed > 0 }">{{ formatNumber(folder.failed) }}</td>
              <td v-if="isSync" class="number">{{ formatNumber(folder.removed) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="report.failures.length" class="card stack">
        <h2>{{ t('report.failures') }}</h2>
        <ul class="failures">
          <li v-for="(failure, index) in report.failures" :key="index">
            <span class="mono"><FolderPath :path="failure.folder" /></span>
            {{ t('common.quoted', { text: failure.subject ?? t('report.noSubject') }) }}
            <span v-if="failure.date" class="muted">({{ failure.date.slice(0, 10) }})</span>
            <p class="muted small">{{ failure.reason }}</p>
          </li>
        </ul>
      </div>
    </template>

    <div v-if="job.verify && job.verify.missing.length + job.verify.damaged.length > 0" class="card">
      <ul class="failures small">
        <li v-for="file in job.verify.missing" :key="`m-${file}`" class="mono">{{ t('report.missing', { file }) }}</li>
        <li v-for="file in job.verify.damaged" :key="`d-${file}`" class="mono">{{ t('report.damaged', { file }) }}</li>
      </ul>
    </div>

    <div class="row">
      <button v-if="directory" class="button" @click="api.shell.openPath(directory)">{{ t('common.openFolder') }}</button>
      <span class="spacer" />
      <button class="button primary" @click="dismissJob">{{ t('common.done') }}</button>
    </div>
  </div>
</template>

<style scoped>
.headline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kept {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
}

.kept .icon {
  flex: none;
  color: var(--accent);
}

.failures {
  max-height: 320px;
  margin: 0;
  padding-left: 18px;
  overflow-y: auto;
}

.failures li + li {
  margin-top: 6px;
}

.failed {
  color: var(--danger);
  font-weight: 600;
}

.folder-error {
  margin-top: 2px;
  color: var(--danger);
  font-family: var(--font);
  white-space: normal;
}
</style>
