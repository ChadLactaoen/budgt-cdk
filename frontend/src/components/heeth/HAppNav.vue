<script setup lang="ts">
/**
 * Wordmark, then the top-level destinations.
 *
 * Below 768px there is no room for the destination row: it used to overflow the bar
 * and leave the whole page scrolling sideways. The links collapse behind a hamburger
 * and drop as a panel under the bar instead.
 *
 * The switch is `matchMedia` rather than CSS alone for two reasons: the open/closed
 * state is only meaningful at one of the two sizes, and the `end` slot has to render
 * once — hiding a second copy with CSS would put a duplicate Sign out button in the
 * accessibility tree.
 */
import { onUnmounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import HIcon from './HIcon.vue';

defineProps<{ links: Array<{ label: string; to: string; active: boolean }> }>();

const route = useRoute();

const query = window.matchMedia('(min-width: 768px)');
const isCompact = ref(!query.matches);
const open = ref(false);

const onQuery = (e: MediaQueryListEvent) => {
  isCompact.value = !e.matches;
  // Rotating to landscape with the menu open would otherwise strand `open` at true.
  if (!isCompact.value) open.value = false;
};
query.addEventListener('change', onQuery);

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') open.value = false;
};

// Bound only while open, so the nav costs nothing on every other keystroke.
watch(open, (isOpen) => {
  if (isOpen) window.addEventListener('keydown', onKeydown);
  else window.removeEventListener('keydown', onKeydown);
});

// Covers the destinations that are not links — a redirect, or the back button.
watch(route, () => {
  open.value = false;
});

onUnmounted(() => {
  query.removeEventListener('change', onQuery);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <nav class="h-nav" :class="{ 'is-open': open }">
    <span class="h-nav__wordmark">Budgt</span>

    <template v-if="!isCompact">
      <div class="h-nav__links">
        <RouterLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="h-nav__link heeth-caps"
          :class="{ 'is-active': link.active }"
        >{{ link.label }}</RouterLink>
      </div>
      <div class="h-nav__end"><slot name="end" /></div>
    </template>

    <template v-else>
      <button
        type="button"
        class="h-nav__burger"
        :aria-expanded="open"
        aria-controls="h-nav-panel"
        :aria-label="open ? 'Close menu' : 'Open menu'"
        @click="open = !open"
      >
        <HIcon :name="open ? 'x' : 'menu'" :size="22" />
      </button>

      <!-- Doubles as the scroll lock: there is nothing scrollable under a fixed
           overlay, so the panel cannot drift away from the bar it is anchored to. -->
      <div v-if="open" class="h-nav__scrim" @click="open = false" />

      <div v-if="open" id="h-nav-panel" class="h-nav__panel">
        <RouterLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="h-nav__row heeth-caps"
          :class="{ 'is-active': link.active }"
          @click="open = false"
        >{{ link.label }}</RouterLink>
        <div class="h-nav__panel-end"><slot name="end" /></div>
      </div>
    </template>
  </nav>
</template>

<style scoped>
.h-nav {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-5);
  height: 64px;
  flex: none;
  padding: 0 var(--gutter);
  background: var(--surface-canvas);
  border-bottom: var(--bw) solid var(--line-hard);
}
/* Only while open, so the bar never sits above a page's own layers for no reason. */
.h-nav.is-open { z-index: 50; }

.h-nav__wordmark {
  font-family: var(--font-display);
  font-size: var(--fs-title);
  text-transform: uppercase;
  letter-spacing: var(--ls-label);
  color: var(--lime-500);
}

.h-nav__links { display: flex; gap: var(--space-6); }

.h-nav__link {
  color: var(--text-faint);
  text-decoration: none;
  white-space: nowrap;
  padding-bottom: var(--space-2);
  border-bottom: var(--bw-slab) solid transparent;
}
.h-nav__link:hover { color: var(--text-muted); }
.h-nav__link.is-active {
  color: var(--text-strong);
  border-bottom-color: var(--lime-500);
}

.h-nav__end { margin-left: auto; }

/* ---- Compact ------------------------------------------------------------------- */

.h-nav__burger {
  position: relative;
  z-index: 2;
  display: grid;
  place-items: center;
  width: var(--tap-min);
  height: var(--tap-min);
  margin-left: auto;
  margin-right: calc(var(--space-3) * -1);
  background: transparent;
  border: var(--bw) solid transparent;
  border-radius: var(--radius-1);
  color: var(--text-strong);
  cursor: pointer;
}

.h-nav__scrim {
  position: fixed;
  inset: 0;
  z-index: 1;
  background: rgba(6, 11, 46, 0.55);
}

.h-nav__panel {
  position: absolute;
  z-index: 2;
  top: 100%;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface-canvas);
  border-bottom: var(--bw) solid var(--line-hard);
  box-shadow: var(--shadow-2);
}

/* The lime slab turns 90 degrees off the bar's underline — same marker, same meaning. */
.h-nav__row {
  display: flex;
  align-items: center;
  min-height: var(--tap-min);
  padding: 0 var(--gutter);
  color: var(--text-faint);
  text-decoration: none;
  border-left: var(--bw-slab) solid transparent;
  border-bottom: var(--bw-hair) solid var(--line-subtle);
}
.h-nav__row.is-active {
  background: var(--surface-raised);
  border-left-color: var(--lime-500);
  color: var(--text-strong);
}

.h-nav__panel-end {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: var(--space-3) var(--space-4);
}

@media (min-width: 768px) {
  .h-nav { padding: 0 var(--gutter-lg); }
}
</style>
