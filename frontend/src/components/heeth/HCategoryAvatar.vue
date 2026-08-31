<script setup lang="ts">
/**
 * The colour prop is used verbatim as the background — no tint or alpha derivation.
 * Glyph contrast comes from the fixed near-navy foreground.
 */
import HIcon from './HIcon.vue';

const props = withDefaults(
  defineProps<{ icon?: string; color?: string; size?: number; empty?: boolean; error?: boolean }>(),
  { icon: 'shopping-bag', color: 'var(--cat-essentials)', size: 40 },
);
</script>

<template>
  <span
    class="h-avatar"
    :class="{ 'is-empty': empty, 'is-error': error }"
    :style="{
      width: `${props.size}px`,
      height: `${props.size}px`,
      background: empty ? 'transparent' : props.color,
    }"
  >
    <HIcon :name="icon" :size="Math.round(props.size * 0.5)" />
  </span>
</template>

<style scoped>
.h-avatar {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-050);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-1);
}
/* The unfilled slot: a dashed outline rather than a coloured block. */
.h-avatar.is-empty {
  border-style: dashed;
  border-color: var(--ink-500);
  color: var(--ink-600);
  box-shadow: none;
}
.h-avatar.is-empty.is-error {
  border-color: var(--coral-500);
  color: var(--coral-300);
}
</style>
