<script setup lang="ts">
import type { AccountSummary } from '../../../shared/api';
import { accountOrigin } from '../store';

/** An account in two lines: the address, and below it the provider or server it lives on. */
defineProps<{ account: AccountSummary }>();
</script>

<template>
  <span class="account-label">
    <span class="user">{{ account.user }}</span>
    <!-- Read aloud between the two lines; the eye has the line break. -->
    <span class="visually-hidden"> · </span>
    <span class="origin muted small">{{ accountOrigin(account) }}</span>
  </span>
</template>

<style scoped>
.account-label {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 100%;
  text-align: left;
}

.user,
.origin {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user {
  font-weight: 550;
}
</style>
