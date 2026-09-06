<script setup lang="ts">
/**
 * The same well as HInput — sunken, hard-bordered — wrapped around a native <select>.
 * `appearance: none` removes the platform arrow so the Lucide chevron is the only one,
 * but the popup itself stays native: a hand-rolled listbox would lose the OS picker on
 * mobile, which is the better control on the screen sizes this app is built for.
 */
import HIcon from './HIcon.vue';

defineProps<{
  label?: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
  id?: string;
}>();

const model = defineModel<string>({ required: true });
</script>

<template>
  <label class="h-select" :for="id">
    <span v-if="label" class="h-select__label heeth-caps">{{ label }}</span>
    <span class="h-select__field" :class="{ 'is-error': !!error }">
      <select :id="id" v-model="model" :aria-invalid="error ? 'true' : undefined">
        <option v-for="option in options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <HIcon name="chevron-down" :size="18" class="h-select__chevron" />
    </span>
    <span v-if="error || hint" class="h-select__note" :class="{ 'is-error': !!error }">
      <HIcon v-if="error" name="octagon-alert" :size="16" />
      {{ error || hint }}
    </span>
  </label>
</template>

<style scoped>
.h-select { display: block; }

.h-select__label {
  display: block;
  margin-bottom: 6px;
  color: var(--text-muted);
}

.h-select__field {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--tap-min);
  padding: 0 var(--space-4);
  background: var(--surface-sunken);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  transition: border-color var(--dur-fast) var(--ease-out);
}
.h-select__field:focus-within {
  border-color: var(--lime-500);
  box-shadow: var(--shadow-1);
}
.h-select__field.is-error { border-color: var(--coral-500); }

.h-select__field select {
  flex: 1;
  min-width: 0;
  appearance: none;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-strong);
  font-family: var(--font-ui);
  font-weight: var(--fw-medium);
  font-size: var(--fs-body-l);
  cursor: pointer;
}
/* The popup is drawn by the OS, so its background has to be set on the option itself. */
.h-select__field option { background: var(--surface-card); }

.h-select__chevron { color: var(--text-muted); }

.h-select__note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: var(--fs-body-s);
  color: var(--text-faint);
}
.h-select__note.is-error { color: var(--coral-400); }
</style>
