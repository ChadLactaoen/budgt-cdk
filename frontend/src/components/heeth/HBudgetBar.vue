<script setup lang="ts">
/**
 * Fill colour is the whole message: green under budget, marigold past 85%, coral
 * over. The fill is clamped at 100% so an overspend widens no further than the track
 * — the colour, not the length, says it went over.
 */
import { computed } from 'vue';
import { formatCompact } from './money';

const props = withDefaults(
  defineProps<{
    /** Integer cents. */
    spent: number;
    /** Integer cents. A limit of zero means unbudgeted: any spend is over. */
    limit: number;
    label?: string;
    currency?: string;
    height?: number;
    showNumbers?: boolean;
  }>(),
  { currency: '$', height: 14, showNumbers: true },
);

const over = computed(() => props.spent > props.limit);

const pct = computed(() => {
  if (props.limit <= 0) return props.spent > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((props.spent / props.limit) * 100)));
});

const fill = computed(() =>
  over.value ? 'var(--status-over)' : pct.value > 85 ? 'var(--status-warn)' : 'var(--status-ok)',
);

/** Whole units only: this is a glance, not a reconciliation. */
const fmt = (cents: number) => formatCompact(cents, props.currency);
</script>

<template>
  <div class="h-bar">
    <div v-if="label || showNumbers" class="h-bar__head">
      <span v-if="label" class="heeth-caps h-bar__label">{{ label }}</span>
      <span
        v-if="showNumbers"
        class="heeth-mono h-bar__numbers"
        :style="{ color: over ? 'var(--status-over)' : 'var(--text-muted)' }"
      >{{ fmt(spent) }} / {{ fmt(limit) }}</span>
    </div>
    <div class="h-bar__track" :style="{ height: `${height}px` }">
      <div class="h-bar__fill" :style="{ width: `${pct}%`, background: fill }" />
    </div>
  </div>
</template>

<style scoped>
.h-bar__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: 6px;
}
.h-bar__label { color: var(--text-body); }
.h-bar__numbers { font-size: var(--fs-body-s); }

.h-bar__track {
  background: var(--surface-sunken);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-0);
  overflow: hidden;
}
.h-bar__fill {
  height: 100%;
  transition: width var(--dur-slow) var(--ease-snap);
}
</style>
