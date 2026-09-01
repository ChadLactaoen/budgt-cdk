<script setup lang="ts">
/**
 * A row of equal columns divided by hard rules, with the selected segment filled in
 * lime. Not a pill and not an animated thumb: selection snaps.
 */
defineProps<{ options: Array<{ value: string; label: string }>; label?: string }>();

const model = defineModel<string>({ required: true });
</script>

<template>
  <div
    class="h-seg"
    role="tablist"
    :aria-label="label"
    :style="{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="option.value === model"
      class="h-seg__tab"
      :class="{ 'is-on': option.value === model }"
      @click="model = option.value"
    >{{ option.label }}</button>
  </div>
</template>

<style scoped>
.h-seg {
  display: grid;
  background: var(--surface-sunken);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-1);
  overflow: hidden;
}

.h-seg__tab {
  height: 44px;
  background: transparent;
  color: var(--text-muted);
  border: 0;
  /* The divider belongs to the segment on its right, so the first one has none. */
  border-left: var(--bw) solid var(--line-hard);
  font-family: var(--font-ui);
  font-weight: var(--fw-bold);
  font-size: var(--fs-body-s);
  letter-spacing: var(--ls-label);
  text-transform: uppercase;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.h-seg__tab:first-child { border-left: 0; }
.h-seg__tab:hover:not(.is-on) { background: var(--surface-hover); }
.h-seg__tab.is-on {
  background: var(--lime-500);
  color: var(--ink-050);
}
</style>
