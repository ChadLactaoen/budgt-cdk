<script setup lang="ts">
/**
 * Every modal in this system is a Sheet. The scrim is the single translucent surface
 * and it is never blurred; the panel has a 4px top slab and no corner radius at all.
 *
 * The design system positions this absolutely inside a 430px shell. This uses fixed,
 * because the app is a real responsive viewport.
 */
import { onBeforeUnmount, onMounted } from 'vue';
import HIcon from './HIcon.vue';

defineProps<{ title?: string }>();
const emit = defineEmits<{ close: [] }>();

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => {
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
});
</script>

<template>
  <div class="h-sheet__scrim" @click="emit('close')">
    <section
      class="h-sheet"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      @click.stop
    >
      <header class="h-sheet__header">
        <h4 class="h-sheet__title">{{ title }}</h4>
        <button type="button" class="h-sheet__close" aria-label="Close" @click="emit('close')">
          <HIcon name="x" :size="16" />
        </button>
      </header>
      <div class="h-sheet__body"><slot /></div>
      <footer v-if="$slots.footer" class="h-sheet__footer"><slot name="footer" /></footer>
    </section>
  </div>
</template>

<style scoped>
.h-sheet__scrim {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.66);
  z-index: 50;
}

.h-sheet {
  background: var(--surface-raised);
  border-top: var(--bw-slab) solid var(--line-hard);
  max-height: 92%;
  display: flex;
  flex-direction: column;
  animation: heeth-sheet-up var(--dur) var(--ease-snap);
}

/* A 16px rise, not a full slide. Nothing bounces and nothing fades. */
@keyframes heeth-sheet-up {
  from { transform: translateY(16px); }
  to { transform: translateY(0); }
}

.h-sheet__header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--gutter);
  border-bottom: var(--bw) solid var(--line-hard);
}

.h-sheet__title {
  flex: 1;
  font-family: var(--font-display);
  font-size: var(--fs-title);
  text-transform: uppercase;
  color: var(--text-strong);
}

.h-sheet__close {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  background: transparent;
  border: var(--bw) solid transparent;
  border-radius: var(--radius-1);
  color: var(--text-strong);
  cursor: pointer;
}

.h-sheet__body {
  padding: var(--space-5) var(--gutter);
  overflow-y: auto;
}

.h-sheet__footer {
  padding: var(--space-4) var(--gutter);
  border-top: var(--bw) solid var(--line-hard);
}

@media (min-width: 1024px) {
  .h-sheet__scrim { justify-content: center; align-items: center; }
  .h-sheet {
    width: 560px;
    max-height: 80%;
    border: var(--bw) solid var(--line-hard);
    border-top-width: var(--bw-slab);
    box-shadow: var(--shadow-3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .h-sheet { animation: none; }
}
</style>
