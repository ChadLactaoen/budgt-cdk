<script setup lang="ts">
/**
 * One place where currency formatting, tabular numerals and in/out colour are decided.
 * Signed money uses + and the true minus U+2212, never a hyphen.
 */
import { computed } from 'vue';

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
  dir.value === 'in' ? 'var(--money-in)' : dir.value === 'out' ? 'var(--money-out)' : 'var(--money-neutral)',
);

const sign = computed(() =>
  !props.showSign || dir.value === 'flat' ? '' : dir.value === 'in' ? '+' : '−',
);

const abs = computed(() =>
  Math.abs(props.cents / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
);
</script>

<template>
  <span class="h-money heeth-mono" :class="`h-money--${size}`" :style="{ color }">
    {{ sign }}{{ currency }}{{ abs }}
  </span>
</template>

<style scoped>
.h-money { font-weight: var(--fw-medium); }
.h-money--s { font-size: var(--fs-amount-s); }
.h-money--m { font-size: var(--fs-amount-m); }
.h-money--l { font-size: var(--fs-amount-l); font-family: var(--font-display); }
.h-money--xl { font-size: var(--fs-amount-xl); font-family: var(--font-display); }
</style>
