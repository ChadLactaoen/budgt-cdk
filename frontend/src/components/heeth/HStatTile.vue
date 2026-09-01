<script setup lang="ts">
/**
 * A labelled figure with an optional one-line footnote. `accent` is the lime fill
 * reserved for the single most important number on a screen — one per view.
 *
 * On accent the figure is always flat: the fill already carries the emphasis, and a
 * green-on-green amount would be unreadable. That is done by rebinding the neutral
 * money token locally rather than overriding HMoney's colour from outside.
 */
import HIcon from './HIcon.vue';
import HMoney from './HMoney.vue';

withDefaults(
  defineProps<{
    label: string;
    /** Integer cents, or a pre-formatted string for values that are not money. */
    value: number | string;
    delta?: string;
    icon?: string;
    tone?: 'card' | 'accent';
    direction?: 'in' | 'out' | 'flat';
  }>(),
  { tone: 'card', direction: 'flat' },
);
</script>

<template>
  <div class="h-stat" :class="`h-stat--${tone}`">
    <div class="heeth-caps h-stat__label">
      <HIcon v-if="icon" :name="icon" :size="14" />
      {{ label }}
    </div>
    <HMoney
      v-if="typeof value === 'number'"
      :cents="value"
      size="l"
      :direction="tone === 'accent' ? 'flat' : direction"
      :show-sign="tone !== 'accent' && direction !== 'flat'"
    />
    <div v-else class="h-stat__value">{{ value }}</div>
    <div v-if="delta" class="heeth-mono h-stat__delta">{{ delta }}</div>
  </div>
</template>

<style scoped>
.h-stat {
  padding: var(--space-4);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-2);
}
.h-stat--card {
  background: var(--surface-card);
  color: var(--text-body);
}
.h-stat--accent {
  background: var(--surface-accent);
  color: var(--text-on-accent);
  --money-neutral: var(--text-on-accent);
}

.h-stat__label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--space-3);
  color: var(--text-muted);
}
.h-stat--accent .h-stat__label {
  color: inherit;
  opacity: 0.7;
}

.h-stat__value {
  font-family: var(--font-display);
  font-size: var(--fs-amount-l);
  line-height: 1.05;
}

.h-stat__delta {
  margin-top: 6px;
  font-size: var(--fs-body-s);
  color: var(--text-faint);
}
.h-stat--accent .h-stat__delta {
  color: inherit;
  opacity: 0.75;
}
</style>
