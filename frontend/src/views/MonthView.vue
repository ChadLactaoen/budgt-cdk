<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CATEGORIES } from '@shared/categories';
import { api, ApiError, type MonthResponse } from '../api/client';
import { cached, monthKey } from '../stores/cache';
import HButton from '../components/heeth/HButton.vue';
import HCallout from '../components/heeth/HCallout.vue';
import HCategoryAvatar from '../components/heeth/HCategoryAvatar.vue';
import HMoney from '../components/heeth/HMoney.vue';

const route = useRoute();
const data = ref<MonthResponse | null>(null);
const error = ref('');
const missing = ref(false);
const loading = ref(false);

async function load(force = false) {
  const yearMonth = String(route.params.yearMonth);
  loading.value = true;
  error.value = '';
  missing.value = false;
  try {
    data.value = await cached(monthKey(yearMonth), () => api.getMonth(yearMonth), force);
  } catch (e) {
    data.value = null;
    if (e instanceof ApiError && e.status === 404) missing.value = true;
    else error.value = e instanceof Error ? e.message : 'Could not load this month.';
  } finally {
    loading.value = false;
  }
}

watch(() => route.params.yearMonth, () => load(), { immediate: true });

/** Amount left is derived, never stored: transactions with a `src` are excluded. */
function spent(cat: string): number {
  return (data.value?.transactions ?? [])
    .filter((t) => t.cat === cat && !t.src)
    .reduce((sum, t) => sum + t.amt, 0);
}
</script>

<template>
  <main class="page">
    <header class="page__head">
      <h1 class="page__title">{{ route.params.yearMonth }}</h1>
      <HButton variant="ghost" size="sm" :disabled="loading" @click="load(true)">Refresh</HButton>
    </header>

    <p v-if="loading" class="page__muted">Loading.</p>
    <HCallout v-else-if="error" tone="over" title="Could not load this month">{{ error }}</HCallout>

    <HCallout v-else-if="missing" tone="info" title="No period yet">
      Nothing has been budgeted for {{ route.params.yearMonth }}.
      <RouterLink :to="`/period?m=${route.params.yearMonth}`">Create this period.</RouterLink>
    </HCallout>

    <template v-else-if="data">
      <div class="tiles">
        <div class="tile">
          <span class="heeth-caps tile__label">Allocated</span>
          <HMoney :cents="data.period.amt" size="l" direction="flat" />
        </div>
        <div v-for="fund in data.funds" :key="fund.id" class="tile">
          <span class="heeth-caps tile__label">Rainy Day</span>
          <HMoney :cents="fund.bal" size="l" direction="flat" />
        </div>
      </div>

      <section class="card">
        <span class="heeth-caps card__title">Allocations</span>
        <div class="rows">
          <div v-for="a in data.allocations" :key="a.cat" class="row">
            <HCategoryAvatar :icon="CATEGORIES[a.cat]?.icon" :color="CATEGORIES[a.cat]?.hex" :size="32" />
            <span class="row__name">
              {{ CATEGORIES[a.cat]?.nm }}
              <span class="row__sub">{{ CATEGORIES[a.cat]?.pt }}</span>
            </span>
            <HMoney :cents="a.amt - spent(a.cat)" size="s" direction="flat" />
          </div>
        </div>
      </section>

      <section class="card">
        <span class="heeth-caps card__title">Transactions · {{ data.transactions.length }}</span>
        <p v-if="!data.transactions.length" class="page__muted">
          Nothing logged yet. Your first entry takes about five seconds.
        </p>
        <div v-else class="rows">
          <RouterLink
            v-for="t in data.transactions"
            :key="t.id"
            :to="`/transaction?id=${encodeURIComponent(t.id)}`"
            class="row row--link"
          >
            <HCategoryAvatar :icon="CATEGORIES[t.cat]?.icon" :color="CATEGORIES[t.cat]?.hex" :size="32" />
            <span class="row__name">
              {{ t.nm }}
              <span class="row__sub">
                {{ CATEGORIES[t.cat]?.nm }}<template v-if="t.src"> · from fund</template>
              </span>
            </span>
            <HMoney :cents="t.amt" size="s" :direction="t.src ? 'flat' : undefined" />
          </RouterLink>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.page {
  max-width: 760px;
  margin: 0 auto;
  padding: var(--space-6) var(--gutter) var(--space-9);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
.page__head { display: flex; align-items: center; gap: var(--space-4); }
.page__title {
  font-family: var(--font-display);
  font-size: var(--fs-display-m);
  text-transform: uppercase;
  color: var(--text-strong);
}
.page__muted { font-size: var(--fs-body); color: var(--text-faint); }

.tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-4); }
.tile {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-5);
  background: var(--surface-card);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-2);
}
.tile__label { color: var(--text-faint); }

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  background: var(--surface-card);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-2);
}
.card__title { color: var(--text-faint); }

/* Lists live in one card with hairline rules — never one card per row. */
.rows { display: flex; flex-direction: column; }
.row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: var(--tap-min);
  padding: var(--space-3) 0;
  border-bottom: var(--bw-hair) solid var(--line-subtle);
  color: var(--text-body);
  text-decoration: none;
}
.row:last-child { border-bottom: 0; }
.row--link:hover { background: var(--surface-hover); }
.row__name { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.row__sub { font-size: var(--fs-body-s); color: var(--text-faint); }
</style>
