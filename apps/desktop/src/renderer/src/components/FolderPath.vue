<script setup lang="ts">
import { computed } from 'vue';

/**
 * A folder path that wraps after its separators ("INBOX.Archiv." | "Amazon") instead of in the
 * middle of a name, when a table gets narrow. Copying it copies the plain path.
 */
const props = defineProps<{ path: string }>();
const parts = computed(() => props.path.split(/(?<=[./\\_-])/));
</script>

<template>
  <span><template v-for="(part, index) in parts" :key="index">{{ part }}<wbr v-if="index < parts.length - 1" /></template></span>
</template>
