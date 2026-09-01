<script setup lang="ts">
/**
 * The square sibling of HButton: one glyph, no text, and a label that exists only for
 * assistive tech. `bare` has neither border nor shadow, so — like the ghost button —
 * it has nothing to press into and does not move.
 */
import { ref } from 'vue';
import HIcon from './HIcon.vue';

const props = withDefaults(
  defineProps<{
    name: string;
    label: string;
    size?: 'sm' | 'md' | 'lg';
    variant?: 'primary' | 'secondary' | 'bare';
    disabled?: boolean;
  }>(),
  { size: 'md', variant: 'secondary' },
);

const down = ref(false);
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :title="label"
    :disabled="disabled"
    :class="['h-iconbtn', `h-iconbtn--${variant}`, `h-iconbtn--${size}`, { 'is-down': down }]"
    @pointerdown="down = true"
    @pointerup="down = false"
    @pointerleave="down = false"
  >
    <HIcon :name="name" :size="props.size === 'sm' ? 16 : 20" />
  </button>
</template>

<style scoped>
.h-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: var(--radius-1);
  cursor: pointer;
  transition:
    transform var(--dur-instant) var(--ease-snap),
    box-shadow var(--dur-instant) var(--ease-snap),
    background var(--dur-fast) var(--ease-out);
}
.h-iconbtn:disabled { opacity: 0.4; cursor: not-allowed; }

.h-iconbtn--sm { width: 36px; height: 36px; }
.h-iconbtn--md { width: 44px; height: 44px; }
.h-iconbtn--lg { width: var(--tap-min); height: var(--tap-min); }

.h-iconbtn--primary {
  background: var(--surface-accent);
  color: var(--text-on-accent);
  border: var(--bw) solid var(--line-hard);
  box-shadow: var(--shadow-1);
}
.h-iconbtn--secondary {
  background: var(--surface-card);
  color: var(--text-strong);
  border: var(--bw) solid var(--line-hard);
  box-shadow: var(--shadow-1);
}
/* Transparent border preserves layout parity with the other variants. */
.h-iconbtn--bare {
  background: transparent;
  color: var(--text-strong);
  border: var(--bw) solid transparent;
  box-shadow: none;
}
.h-iconbtn--bare:hover:not(:disabled) { background: var(--surface-hover); }

.h-iconbtn--primary.is-down,
.h-iconbtn--secondary.is-down {
  transform: translate(1px, 1px);
  box-shadow: var(--shadow-press);
}

@media (prefers-reduced-motion: reduce) {
  .h-iconbtn.is-down { transform: none; }
}
</style>
