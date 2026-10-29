<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConnectionTestResult, ProviderPreset } from '@imaptransfer/core';
import type { AccountDraft, AuthKind } from '../../../shared/api';
import { errorText, explainError, folderCount } from '../format';
import { api, providerById, refreshAccounts, showAccount, sortedAccounts, state } from '../store';

const props = defineProps<{ accountId: string | null }>();
const { t } = useI18n();

const existing = props.accountId ? (state.accounts.find((account) => account.id === props.accountId) ?? null) : null;
const form = reactive({
  user: existing?.user ?? '',
  providerId: existing?.providerId ?? (null as string | null),
  host: existing?.host ?? '',
  port: existing?.port ?? 993,
  secure: existing?.secure ?? true,
  allowSelfSigned: existing?.allowSelfSigned ?? false,
  password: '',
});
const providerChosen = ref(Boolean(existing));
const showAdvanced = ref(Boolean(existing && !existing.providerId));
const signIn = reactive({ id: null as string | null, email: null as string | null, busy: false, error: null as string | null });
const check = reactive({ busy: false, result: null as ConnectionTestResult | null, error: null as string | null });
const saving = ref(false);
const offerSaveAnyway = ref(false);

const preset = computed(() => providerById(form.providerId));
const auth = computed<AuthKind>(() => (preset.value?.auth === 'oauth-microsoft' ? 'oauth-microsoft' : 'password'));
const storedSecretMatches = computed(() => Boolean(existing && existing.auth === auth.value));
const passwordLabel = computed(() => (preset.value?.auth === 'app-password' ? t('editor.appPassword') : t('editor.password')));
const providers = computed(() => [...state.providers].sort((a, b) => a.name.localeCompare(b.name)));

function detect(user: string): ProviderPreset | undefined {
  const domain = user.split('@')[1]?.trim().toLowerCase();
  return domain ? state.providers.find((provider) => provider.domains.includes(domain)) : undefined;
}

function applyPreset(provider: ProviderPreset): void {
  form.providerId = provider.id;
  form.host = provider.host;
  form.port = provider.port;
  form.secure = provider.secure;
}

watch(
  () => form.user,
  (user) => {
    if (providerChosen.value) return;
    const provider = detect(user);
    if (provider) applyPreset(provider);
  },
);

function chooseProvider(event: Event): void {
  const id = (event.target as HTMLSelectElement).value;
  providerChosen.value = true;
  const provider = providerById(id);
  if (provider) {
    applyPreset(provider);
  } else {
    form.providerId = null;
    showAdvanced.value = true;
  }
}

function chooseSecurity(secure: boolean): void {
  if (form.port === (form.secure ? 993 : 143)) form.port = secure ? 993 : 143;
  form.secure = secure;
}

function draft(): AccountDraft {
  return {
    ...(existing ? { id: existing.id } : {}),
    user: form.user.trim(),
    host: form.host.trim(),
    port: Number(form.port),
    secure: form.secure,
    allowSelfSigned: form.allowSelfSigned,
    providerId: form.providerId,
    auth: auth.value,
    ...(form.password ? { password: form.password } : {}),
    ...(signIn.id ? { signInId: signIn.id } : {}),
  };
}

async function microsoftSignIn(): Promise<void> {
  signIn.busy = true;
  signIn.error = null;
  try {
    const result = await api.accounts.signInMicrosoft(form.user.trim() || undefined);
    signIn.id = result.signInId;
    signIn.email = result.email;
    if (result.email) form.user = result.email;
  } catch (error) {
    signIn.error = errorText(error);
  } finally {
    signIn.busy = false;
  }
}

async function runTest(): Promise<boolean> {
  check.busy = true;
  check.result = null;
  check.error = null;
  try {
    check.result = await api.accounts.test(draft());
    return check.result.ok;
  } catch (error) {
    check.error = errorText(error);
    return false;
  } finally {
    check.busy = false;
  }
}

const testMessage = computed(() => {
  const result = check.result;
  if (!result) return null;
  if (result.ok) return t('editor.testOk', { folders: folderCount(result.folders) });
  return explainError(result.kind, result.message);
});

async function save(force = false): Promise<void> {
  if (!form.user.trim() || !form.host.trim()) {
    check.error = t('editor.missingFields');
    return;
  }
  saving.value = true;
  try {
    if (!force && !(await runTest())) {
      offerSaveAnyway.value = Boolean(check.result);
      return;
    }
    const saved = await api.accounts.save(draft());
    await refreshAccounts();
    showAccount(saved.id);
  } catch (error) {
    check.error = errorText(error);
  } finally {
    saving.value = false;
  }
}

function cancel(): void {
  if (existing) showAccount(existing.id);
  else if (sortedAccounts.value[0]) showAccount(sortedAccounts.value[0].id);
  else state.view = { name: 'welcome' };
}

function openHelp(url: string): void {
  void api.shell.openExternal(url);
}
</script>

<template>
  <form class="editor" novalidate @submit.prevent="save()">
    <h1>{{ existing ? t('editor.titleEdit') : t('editor.titleNew') }}</h1>

    <label class="field">
      <span>{{ t('editor.email') }}</span>
      <!-- Not type="email": on own servers the login is often a plain user name. -->
      <input
        v-model="form.user"
        class="input"
        type="text"
        inputmode="email"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('editor.emailPlaceholder')"
        autofocus
      />
      <small class="muted">{{ t('editor.emailHelp') }}</small>
    </label>

    <label class="field">
      <span>{{ t('editor.provider') }}</span>
      <select class="input" :value="form.providerId ?? ''" @change="chooseProvider">
        <option v-for="provider in providers" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
        <option value="">{{ t('editor.providerOther') }}</option>
      </select>
    </label>

    <p v-for="hint in preset?.hints ?? []" :key="hint" class="notice small">
      {{ t(`editor.hints.${hint}`, { provider: preset?.name }) }}
    </p>
    <p v-if="preset?.id === 'gmail'" class="notice small">{{ t('editor.gmailNote') }}</p>

    <template v-if="auth === 'oauth-microsoft'">
      <div v-if="state.info?.microsoftSignIn" class="stack">
        <div class="row">
          <button type="button" class="button" :disabled="signIn.busy" @click="microsoftSignIn">{{ t('editor.microsoftSignIn') }}</button>
          <span v-if="signIn.busy" class="muted">{{ t('editor.microsoftWaiting') }}</span>
          <span v-else-if="signIn.id" class="signed-in">{{ t('editor.microsoftSignedIn', { email: signIn.email ?? form.user }) }}</span>
        </div>
        <p v-if="!signIn.id && storedSecretMatches" class="muted small">{{ t('editor.microsoftStored') }}</p>
        <p v-if="signIn.error" class="notice error small">{{ signIn.error }}</p>
      </div>
      <p v-else class="notice warning small">{{ t('editor.microsoftUnavailable') }}</p>
    </template>

    <template v-else>
      <label class="field">
        <span>{{ passwordLabel }}</span>
        <input
          v-model="form.password"
          class="input"
          type="password"
          autocomplete="off"
          :placeholder="storedSecretMatches ? t('editor.passwordKeep') : ''"
        />
      </label>
      <p v-if="preset?.auth === 'app-password'" class="muted small row">
        {{ t('editor.appPasswordHelp', { provider: preset.name }) }}
        <button v-if="preset.helpUrl" type="button" class="button link small" @click="openHelp(preset.helpUrl)">
          {{ t('editor.openHelp') }}
        </button>
      </p>
    </template>

    <details :open="showAdvanced" @toggle="showAdvanced = ($event.target as HTMLDetailsElement).open">
      <summary>{{ t('editor.advanced') }}</summary>
      <div class="advanced">
        <label class="field host">
          <span>{{ t('editor.host') }}</span>
          <input v-model="form.host" class="input" autocomplete="off" spellcheck="false" />
        </label>
        <label class="field port">
          <span>{{ t('editor.port') }}</span>
          <input v-model.number="form.port" class="input" type="number" min="1" max="65535" />
        </label>
        <fieldset class="field security">
          <span>{{ t('editor.security') }}</span>
          <label class="checkbox"><input type="radio" :checked="form.secure" @change="chooseSecurity(true)" />{{ t('editor.tls') }}</label>
          <label class="checkbox"><input type="radio" :checked="!form.secure" @change="chooseSecurity(false)" />{{ t('editor.starttls') }}</label>
        </fieldset>
        <label class="checkbox self-signed">
          <input v-model="form.allowSelfSigned" type="checkbox" />
          {{ t('editor.selfSigned') }}
        </label>
      </div>
    </details>

    <p v-if="check.busy" class="notice small">{{ t('editor.testing') }}</p>
    <p v-else-if="check.error" class="notice error small">{{ check.error }}</p>
    <p v-else-if="testMessage" class="notice small" :class="check.result?.ok ? 'success' : 'error'">{{ testMessage }}</p>

    <div class="row actions">
      <button type="button" class="button" :disabled="check.busy || saving" @click="runTest">{{ t('editor.test') }}</button>
      <span class="spacer" />
      <button type="button" class="button" @click="cancel">{{ t('common.cancel') }}</button>
      <button v-if="offerSaveAnyway && check.result && !check.result.ok" type="button" class="button" :disabled="saving" @click="save(true)">
        {{ t('editor.saveAnyway') }}
      </button>
      <button type="submit" class="button primary" :disabled="saving || check.busy">{{ t('common.save') }}</button>
    </div>
  </form>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 560px;
  margin: 0 auto;
  padding: 40px 32px;
}

details {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

summary {
  cursor: pointer;
  font-weight: 550;
}

.advanced {
  display: grid;
  grid-template-columns: 1fr 110px;
  gap: 14px;
  margin-top: 14px;
}

.security,
.self-signed {
  grid-column: 1 / -1;
}

fieldset {
  margin: 0;
  padding: 0;
  border: 0;
}

.signed-in {
  color: var(--success);
  font-weight: 550;
}

.actions {
  margin-top: 8px;
}
</style>
