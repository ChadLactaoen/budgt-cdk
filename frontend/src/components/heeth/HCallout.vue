<script setup lang="ts">
/**
 * The glyph is fixed by tone and not overridable. The 4px left edge is a width
 * override on the same tone-coloured border, not a separate colour.
 */
import { computed } from 'vue';
import HIcon from './HIcon.vue';

const props = withDefaults(
  defineProps<{ tone?: 'info' | 'ok' | 'warn' | 'over'; title?: string }>(),
  { tone: 'info' },
);

const TONES = {
  info: { fg: 'var(--status-info)', bg: 'var(--status-info-bg)', icon: 'info' },
  ok: { fg: 'var(--status-ok)', bg: 'var(--status-ok-bg)', icon: 'check' },
  warn: { fg: 'var(--status-warn)', bg: 'var(--status-warn-bg)', icon: 'triangle-alert' },
  over: { fg: 'var(--status-over)', bg: 'var(--status-over-bg)', icon: 'octagon-alert' },
} as const;

const tone = computed(() => TONES[props.tone]);
</script>

<template>
  <div
    class="h-callout"
    :role="props.tone === 'over' ? 'alert' : 'status'"
    :aria-live="props.tone === 'over' ? 'assertive' : 'polite'"
    :style="{ background: tone.bg, borderColor: tone.fg }"
  >
    <span class="h-callout__chip" :style="{ background: tone.fg }">
      <HIcon :name="tone.icon" :size="18" />
    </span>
    <div class="h-callout__body">
      <p v-if="title" class="h-callout__title">{{ title }}</p>
      <p class="h-callout__text"><slot /></p>
    </div>
  </div>
</template>

<style scoped>
.h-callout {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-5);
  color: var(--text-body);
  border: var(--bw) solid;
  border-left-width: var(--bw-slab);
  border-radius: var(--radius-1);
}

.h-callout__chip {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  color: var(--ink-050);
  border: var(--bw-hair) solid var(--line-hard);
  border-radius: var(--radius-1);
}

.h-callout__body { flex: 1; min-width: 0; }

/* Public Sans, not Anton — callout titles are UI text, not display type. */
.h-callout__title {
  font-family: var(--font-ui);
  font-weight: var(--fw-bold);
  font-size: var(--fs-body-l);
  line-height: var(--lh-title);
  color: var(--text-strong);
  margin-bottom: var(--space-2);
}

.h-callout__text {
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  color: var(--text-body);
}
</style>
