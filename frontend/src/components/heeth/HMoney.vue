<script setup lang="ts">
/**
 * One place where currency formatting, tabular numerals and in/out colour are decided.
 * Signed money uses + and the true minus U+2212, never a hyphen.
 *
 * A negative amount always keeps its minus: `showSign` governs the optional + on a
 * positive figure, not whether the number is allowed to state that it is below zero.
 *
 * Privacy is applied here rather than at each call site, so a new amount cannot ship
 * unmasked by omission. A masked amount also drops its direction colour: the sign is
 * a fact about the figure, and leaking it would defeat the point.
 */
import { computed } from 'vue';
import { privacy } from '../../stores/privacy';
import { formatAmount } from './money';

const props = withDefaults(
  defineProps<{
    /** Integer cents. */
    cents: number;
    currency?: string;
    size?: 's' | 'm' | 'l' | 'xl';
    direction?: 'in' | 'out' | 'flat';
    showSign?: boolean;
  }>(),
  { currency: '$', size: 'm', showSign: false },
);

const dir = computed(
  () => props.direction ?? (props.cents < 0 ? 'out' : props.cents > 0 ? 'in' : 'flat'),
);

const color = computed(() =>
  privacy.value
    ? 'var(--money-neutral)'
    : dir.value === 'in'
      ? 'var(--money-in)'
      : dir.value === 'out'
        ? 'var(--money-out)'
        : 'var(--money-neutral)',
);

const text = computed(() => {
  const plus = props.showSign && props.cents > 0 && !privacy.value ? '+' : '';
  return plus + formatAmount(props.cents, props.currency);
});
</script>

<template>
  <span class="h-money heeth-mono" :class="`h-money--${size}`" :style="{ color }">{{ text }}</span>
</template>

<style scoped>
.h-money { font-weight: var(--fw-medium); }
.h-money--s { font-size: var(--fs-amount-s); }
.h-money--m { font-size: var(--fs-amount-m); }
.h-money--l { font-size: var(--fs-amount-l); font-family: var(--font-display); }
.h-money--xl { font-size: var(--fs-amount-xl); font-family: var(--font-display); }
</style>
