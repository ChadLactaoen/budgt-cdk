<script setup lang="ts">
import HIcon from './HIcon.vue';

defineProps<{ title: string; eyebrow?: string; back?: boolean }>();
const emit = defineEmits<{ back: [] }>();
</script>

<template>
  <header class="h-header">
    <button v-if="back" type="button" class="h-header__back" aria-label="Back" @click="emit('back')">
      <HIcon name="chevron-left" :size="16" />
    </button>
    <div class="h-header__col">
      <span v-if="eyebrow" class="h-header__eyebrow">{{ eyebrow }}</span>
      <span class="h-header__title">{{ title }}</span>
    </div>
    <div class="h-header__actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.h-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: var(--header-h);
  padding: var(--space-3) var(--gutter);
  background: var(--surface-canvas);
  border-bottom: var(--bw) solid var(--line-hard);
}

.h-header__back {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  background: transparent;
  border: var(--bw) solid transparent;
  border-radius: var(--radius-1);
  color: var(--text-strong);
  cursor: pointer;
}

.h-header__col { flex: 1; min-width: 0; }

.h-header__eyebrow {
  display: block;
  font-family: var(--font-ui);
  font-weight: var(--fw-bold);
  font-size: var(--fs-micro);
  letter-spacing: var(--ls-caps);
  text-transform: uppercase;
  color: var(--text-faint);
}

.h-header__title {
  display: block;
  font-family: var(--font-display);
  font-size: var(--fs-title);
  text-transform: uppercase;
  letter-spacing: var(--ls-display);
  line-height: 1.1;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.h-header__actions { display: flex; gap: var(--space-3); }
</style>
