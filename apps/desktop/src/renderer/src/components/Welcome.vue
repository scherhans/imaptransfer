<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { state } from '../store';
import Icon from './Icon.vue';

const { t } = useI18n();
const features = ['backup', 'restore', 'migrate'] as const;
</script>

<template>
  <div class="welcome">
    <div class="mark" aria-hidden="true">
      <Icon name="mail" :size="34" />
    </div>
    <h1>{{ t('welcome.title') }}</h1>
    <p class="lead">{{ t('welcome.text') }}</p>

    <div class="features">
      <div v-for="feature in features" :key="feature" class="feature">
        <span class="feature-icon"><Icon :name="feature" :size="22" /></span>
        <strong>{{ t(`welcome.features.${feature}.title`) }}</strong>
        <p class="muted small">{{ t(`welcome.features.${feature}.text`) }}</p>
      </div>
    </div>

    <button class="button primary large" @click="state.view = { name: 'editor', id: null }">
      <Icon name="plus" :size="18" />
      {{ t('app.addAccount') }}
    </button>

    <p class="privacy muted small">
      <Icon name="shield" :size="16" />
      {{ t('welcome.privacy') }}
    </p>
  </div>
</template>

<style scoped>
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  max-width: 680px;
  margin: 0 auto;
  padding: clamp(32px, 10vh, 96px) 32px 48px;
  text-align: center;
}

.mark {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: linear-gradient(160deg, var(--accent-bright), var(--accent));
  color: var(--accent-text);
  box-shadow: 0 10px 30px color-mix(in srgb, var(--accent) 35%, transparent);
}

h1 {
  font-size: 28px;
  letter-spacing: -0.01em;
}

.lead {
  max-width: 540px;
  font-size: 15.5px;
  color: var(--text-muted);
}

.features {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  width: 100%;
  margin-top: 8px;
}

.feature {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  text-align: left;
}

.feature-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  margin-bottom: 4px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
}

.feature strong {
  font-weight: 600;
}

.large {
  min-height: 40px;
  padding: 0 20px;
  margin-top: 8px;
  font-size: 15px;
}

.privacy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

@media (max-width: 760px) {
  .features {
    grid-template-columns: 1fr;
  }
}
</style>
