<script setup lang="ts">
/**
 * 52x30 with a 4px track radius — square, not a pill. The knob moves by flipping the
 * track's justification, so only the background animates; that matches the design
 * system, where the knob snaps.
 */
const model = defineModel<boolean>({ default: false });
</script>

<template>
  <label class="h-switch">
    <span v-if="$slots.default" class="h-switch__label"><slot /></span>
    <button
      type="button"
      role="switch"
      :aria-checked="model"
      class="h-switch__track"
      :class="{ 'is-on': model }"
      @click="model = !model"
    >
      <span class="h-switch__knob" />
    </button>
  </label>
</template>

<style scoped>
.h-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  min-height: var(--tap-min);
  cursor: pointer;
}

.h-switch__label {
  font-size: var(--fs-body);
  font-weight: var(--fw-medium);
  color: var(--text-body);
}

.h-switch__track {
  width: 52px;
  height: 30px;
  flex: 0 0 auto;
  padding: var(--space-1);
  display: flex;
  align-items: center;
  justify-content: flex-start;
  background: var(--surface-sunken);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-1);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.h-switch__track.is-on {
  justify-content: flex-end;
  background: var(--lime-500);
}

.h-switch__knob {
  width: 22px;
  height: 22px;
  background: var(--ink-500);
  border-radius: 2px;
}
.h-switch__track.is-on .h-switch__knob { background: var(--ink-050); }
</style>
