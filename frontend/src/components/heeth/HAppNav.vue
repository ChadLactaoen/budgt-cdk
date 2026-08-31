<script setup lang="ts">
/** Desktop chrome: wordmark, then the three top-level destinations. */
import { RouterLink } from 'vue-router';

defineProps<{ links: Array<{ label: string; to: string; active: boolean }> }>();
</script>

<template>
  <nav class="h-nav">
    <span class="h-nav__wordmark">Budgt</span>
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
  </nav>
</template>

<style scoped>
.h-nav {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  height: 64px;
  flex: none;
  padding: 0 var(--gutter-lg);
  background: var(--surface-canvas);
  border-bottom: var(--bw) solid var(--line-hard);
}

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
  padding-bottom: var(--space-2);
  border-bottom: var(--bw-slab) solid transparent;
}
.h-nav__link:hover { color: var(--text-muted); }
.h-nav__link.is-active {
  color: var(--text-strong);
  border-bottom-color: var(--lime-500);
}

.h-nav__end { margin-left: auto; }
</style>
