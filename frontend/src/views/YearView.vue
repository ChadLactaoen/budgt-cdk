<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CATEGORIES, type CategoryId } from '@shared/categories';
import { FUNDS } from '@shared/funds';
import { api, type YearResponse } from '../api/client';
import { cached, yearKey } from '../stores/cache';
import HButton from '../components/heeth/HButton.vue';
import HCallout from '../components/heeth/HCallout.vue';
import HCategoryAvatar from '../components/heeth/HCategoryAvatar.vue';
import HMoney from '../components/heeth/HMoney.vue';

const route = useRoute();
const data = ref<YearResponse | null>(null);
const error = ref('');
const loading = ref(false);

async function load(force = false) {
  const year = String(route.params.year);
  loading.value = true;
  error.value = '';
  try {
    data.value = await cached(yearKey(year), () => api.getYear(year), force);
  } catch (e) {
    data.value = null;
    error.value = e instanceof Error ? e.message : 'Could not load this year.';
  } finally {
    loading.value = false;
  }
}

watch(() => route.params.year, () => load(), { immediate: true });

const totalAllocated = computed(() =>
  (data.value?.periods ?? []).reduce((sum, p) => sum + p.amt, 0),
);

/**
 * Every transaction counts under its own category. A fund's own category reports NET
 * (deposits − withdrawals), because withdrawn money is already reported under the
 * category it was spent on — so the rows sum to total allocated.
 */
const byCategory = computed(() => {
  const totals = new Map<CategoryId, number>();
  const add = (cat: CategoryId, amt: number) => totals.set(cat, (totals.get(cat) ?? 0) + amt);

  for (const t of data.value?.transactions ?? []) {
    add(t.cat, t.amt);
    if (t.src) add(FUNDS[t.src].cat, -t.amt);
  }

  return [...totals.entries()].filter(([, amt]) => amt !== 0).sort((a, b) => b[1] - a[1]);
});
</script>

<template>
  <main class="page">
    <header class="page__head">
      <h1 class="page__title">{{ route.params.year }}</h1>
      <HButton variant="ghost" size="sm" :disabled="loading" @click="load(true)">Refresh</HButton>
    </header>

    <p v-if="loading" class="page__muted">Loading.</p>
    <HCallout v-else-if="error" tone="over" title="Could not load this year">{{ error }}</HCallout>

    <template v-else-if="data">
      <HCallout v-if="data.truncated" tone="warn" title="This year is truncated">
        More transactions exist than one query returns, so the totals below are incomplete.
      </HCallout>

      <div class="tiles">
        <div class="tile">
          <span class="heeth-caps tile__label">Total allocated</span>
          <HMoney :cents="totalAllocated" size="l" direction="flat" />
        </div>
        <div v-for="fund in data.funds" :key="fund.id" class="tile">
          <span class="heeth-caps tile__label">Rainy Day</span>
          <HMoney :cents="fund.bal" size="l" direction="flat" />
        </div>
      </div>

      <section class="card">
        <span class="heeth-caps card__title">Spend by category</span>
        <p v-if="!byCategory.length" class="page__muted">Nothing logged for this year yet.</p>
        <div v-else class="rows">
          <div v-for="[cat, amt] in byCategory" :key="cat" class="row">
            <HCategoryAvatar :icon="CATEGORIES[cat]?.icon" :color="CATEGORIES[cat]?.hex" :size="32" />
            <span class="row__name">
              {{ CATEGORIES[cat]?.nm }}
              <span class="row__sub">{{ CATEGORIES[cat]?.pt }}</span>
            </span>
            <HMoney :cents="amt" size="s" direction="flat" />
          </div>
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

.rows { display: flex; flex-direction: column; }
.row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: var(--tap-min);
  padding: var(--space-3) 0;
  border-bottom: var(--bw-hair) solid var(--line-subtle);
}
.row:last-child { border-bottom: 0; }
.row__name { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.row__sub { font-size: var(--fs-body-s); color: var(--text-faint); }
</style>
