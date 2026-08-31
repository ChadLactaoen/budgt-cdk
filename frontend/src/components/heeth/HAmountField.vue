<script setup lang="ts">
/**
 * The hero amount: one per screen. A sunken well with the currency glyph and the
 * figure in display type, editable in place.
 */
const model = defineModel<string>({ default: '' });

defineProps<{ label?: string; hint?: string; error?: string; currency?: string }>();
</script>

<template>
  <div class="h-amount">
    <span v-if="label" class="h-amount__label heeth-caps" :class="{ 'is-error': !!error }">
      {{ label }}
    </span>
    <div class="h-amount__well" :class="{ 'is-error': !!error }">
      <span class="h-amount__currency">{{ currency ?? '$' }}</span>
      <input
        v-model="model"
        class="h-amount__input"
        type="text"
        inputmode="decimal"
        placeholder="0.00"
        aria-label="Amount"
        :aria-invalid="error ? 'true' : undefined"
      />
    </div>
    <span v-if="error || hint" class="h-amount__note" :class="{ 'is-error': !!error }">
      <slot name="noteIcon" />
      {{ error || hint }}
    </span>
  </div>
</template>

<style scoped>
.h-amount { display: flex; flex-direction: column; gap: var(--space-3); }

.h-amount__label { color: var(--text-faint); }
.h-amount__label.is-error { color: var(--coral-300); }

.h-amount__well {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-5);
  background: var(--surface-sunken);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
}
.h-amount__well.is-error { border-color: var(--coral-500); }

.h-amount__currency {
  font-family: var(--font-display);
  font-size: var(--fs-display-m);
  line-height: var(--lh-display);
  color: var(--text-faint);
}

.h-amount__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-family: var(--font-display);
  font-size: var(--fs-amount-xl);
  line-height: var(--lh-display);
  letter-spacing: var(--ls-amount);
  color: var(--text-strong);
}
.h-amount__input::placeholder { color: var(--text-faint); opacity: 1; }

.h-amount__note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-body-s);
  color: var(--text-faint);
}
.h-amount__note.is-error { color: var(--coral-300); }
</style>
