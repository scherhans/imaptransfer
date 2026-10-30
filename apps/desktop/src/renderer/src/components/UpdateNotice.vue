<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { updateSettings } from '../store';

const { t } = useI18n();
const check = ref(true);
</script>

<template>
  <section class="update-notice notice">
    <p>
      {{ t('app.updates.text') }}
      <a :href="t('app.updates.privacyUrl')" target="_blank" rel="noreferrer">{{ t('app.updates.privacy') }}</a>
    </p>
    <div class="choice">
      <label class="checkbox">
        <input v-model="check" type="checkbox" />
        <span>{{ t('app.updates.label') }}</span>
      </label>
      <button class="button primary" @click="updateSettings({ updateCheck: check })">{{ t('common.done') }}</button>
    </div>
  </section>
</template>

<style scoped>
.update-notice {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 16px;
}

.choice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
</style>
