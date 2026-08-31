<script setup lang="ts">
/**
 * Press is the signature interaction: the element translates 2px down-right and its
 * shadow collapses from 4px to 1px, so it looks pushed into the page. Ghost buttons,
 * having no shadow, do not move.
 */
import { ref } from 'vue';
import HIcon from './HIcon.vue';

withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    iconLeft?: string;
    iconRight?: string;
    block?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit';
  }>(),
  { variant: 'primary', size: 'md', type: 'button' },
);

const down = ref(false);
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    :class="['h-btn', `h-btn--${variant}`, `h-btn--${size}`, { 'h-btn--block': block, 'is-down': down }]"
    @pointerdown="down = true"
    @pointerup="down = false"
    @pointerleave="down = false"
  >
    <HIcon v-if="iconLeft" :name="iconLeft" :size="size === 'sm' ? 16 : 20" />
    <slot />
    <HIcon v-if="iconRight" :name="iconRight" :size="size === 'sm' ? 16 : 20" />
  </button>
</template>

<style scoped>
.h-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  font-family: var(--font-ui);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-label);
  text-transform: uppercase;
  border-radius: var(--radius-1);
  cursor: pointer;
  box-shadow: var(--shadow-2);
  transition:
    transform var(--dur-instant) var(--ease-snap),
    box-shadow var(--dur-instant) var(--ease-snap),
    background var(--dur-fast) var(--ease-out);
}
.h-btn.is-down {
  transform: translate(var(--press-translate), var(--press-translate));
  box-shadow: var(--shadow-press);
}
.h-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.h-btn--primary {
  background: var(--surface-accent);
  color: var(--text-on-accent);
  border: var(--bw) solid var(--line-hard);
}
.h-btn--secondary {
  background: var(--surface-card);
  color: var(--text-strong);
  border: var(--bw) solid var(--line-hard);
}
.h-btn--danger {
  background: var(--coral-500);
  color: var(--ink-050);
  border: var(--bw) solid var(--line-hard);
}
/* Transparent border preserves layout parity with the other variants. */
.h-btn--ghost {
  background: transparent;
  color: var(--text-body);
  border: var(--bw) solid transparent;
  box-shadow: none;
}
.h-btn--ghost.is-down {
  transform: none;
  box-shadow: none;
}
.h-btn--ghost:hover:not(:disabled) {
  background: var(--surface-hover);
}

.h-btn--sm { height: 36px; padding: 0 var(--space-4); font-size: var(--fs-body-s); }
.h-btn--md { height: var(--tap-min); padding: 0 18px; font-size: var(--fs-body); }
.h-btn--lg { height: 56px; padding: 0 var(--space-7); font-size: var(--fs-body-l); }
.h-btn--block { width: 100%; }

@media (prefers-reduced-motion: reduce) {
  .h-btn.is-down { transform: none; }
}
</style>
