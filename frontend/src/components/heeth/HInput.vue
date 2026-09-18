<script setup lang="ts">
/**
 * Inputs are wells: darker than the surface, so they read as holes punched in it.
 * State precedence on the border is error > focus > default. Note the asymmetry from
 * the design system: the error border is --coral-500 while the error text is
 * --coral-400.
 */
import { onMounted, ref } from 'vue';
import HIcon from './HIcon.vue';

const props = defineProps<{
  label?: string;
  hint?: string;
  error?: string;
  icon?: string;
  suffix?: string;
  type?: string;
  placeholder?: string;
  id?: string;
  autofocus?: boolean;
}>();

// Re-emitted explicitly: native `blur` does not bubble, so a listener bound on
// <HInput> by a parent would attach to the <label> and never fire.
const emit = defineEmits<{ blur: [] }>();

const model = defineModel<string>({ default: '' });
const focus = ref(false);
const el = ref<HTMLInputElement | null>(null);

// Pointer devices only: on a touch screen the focus raises the soft keyboard, which on
// this phone-shaped app covers the very list the field is there to filter.
onMounted(() => {
  if (props.autofocus && window.matchMedia('(pointer: fine)').matches) el.value?.focus();
});

function onBlur() {
  focus.value = false;
  emit('blur');
}
</script>

<template>
  <label class="h-input" :for="id">
    <span v-if="label" class="h-input__label heeth-caps">{{ label }}</span>
    <span class="h-input__field" :class="{ 'is-focus': focus, 'is-error': !!error }">
      <HIcon v-if="icon" :name="icon" :size="18" class="h-input__icon" />
      <input
        :id="id"
        ref="el"
        v-model="model"
        :type="type ?? 'text'"
        :placeholder="placeholder"
        :aria-invalid="error ? 'true' : undefined"
        @focus="focus = true"
        @blur="onBlur"
      />
      <span v-if="suffix" class="h-input__suffix heeth-mono">{{ suffix }}</span>
    </span>
    <span v-if="error || hint" class="h-input__note" :class="{ 'is-error': !!error }">
      <HIcon v-if="error" name="octagon-alert" :size="16" />
      {{ error || hint }}
    </span>
  </label>
</template>

<style scoped>
.h-input { display: block; }

.h-input__label {
  display: block;
  margin-bottom: 6px;
  color: var(--text-muted);
}

.h-input__field {
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
/* Inputs opt out of the global focus ring and swap their border to lime instead. */
.h-input__field.is-focus {
  border-color: var(--lime-500);
  box-shadow: var(--shadow-1);
}
.h-input__field.is-error {
  border-color: var(--coral-500);
}

.h-input__icon { color: var(--text-faint); }

.h-input__field input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-strong);
  font-family: var(--font-ui);
  font-weight: var(--fw-medium);
  font-size: var(--fs-body-l);
}

.h-input__suffix {
  font-size: var(--fs-body-s);
  color: var(--text-faint);
}

.h-input__note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: var(--fs-body-s);
  color: var(--text-faint);
}
.h-input__note.is-error { color: var(--coral-400); }
</style>
