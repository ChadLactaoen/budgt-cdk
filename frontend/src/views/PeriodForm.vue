<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { allCategories } from '@shared/categories';
import { centsToInput, parseDollarsToCents } from '@shared/money';
import { api, type Allocation } from '../api/client';
import { invalidateMonths } from '../stores/cache';
import { currentYearMonth } from '../router';
import HButton from '../components/heeth/HButton.vue';
import HCallout from '../components/heeth/HCallout.vue';
import HCategoryAvatar from '../components/heeth/HCategoryAvatar.vue';
import HInput from '../components/heeth/HInput.vue';
import HMoney from '../components/heeth/HMoney.vue';

const route = useRoute();
const router = useRouter();

const yearMonth = ref(String(route.query.m ?? currentYearMonth()));
const total = ref('');
const memo = ref('');
/** Every category, keyed by id, as a dollar string. Blank means no allocation. */
const amounts = ref<Record<string, string>>({});
const spent = ref<Record<string, number>>({});
const error = ref('');
const saving = ref(false);

const categories = allCategories().filter((c) => c.active);

const totalCents = computed(() => parseDollarsToCents(total.value) ?? 0);
const allocatedCents = computed(() =>
  Object.values(amounts.value).reduce((sum, v) => sum + (parseDollarsToCents(v) ?? 0), 0),
);
const remaining = computed(() => totalCents.value - allocatedCents.value);
const balanced = computed(() => remaining.value === 0 && totalCents.value !== 0);

onMounted(async () => {
  if (!route.query.m) return;
  try {
    // Transactions come back too, so the form can show what is already spent.
    const data = await api.getMonth(yearMonth.value);
    total.value = centsToInput(data.period.amt);
    memo.value = data.period.memo;
    for (const a of data.allocations) amounts.value[a.cat] = centsToInput(a.amt);
    for (const t of data.transactions) {
      if (t.src) continue;
      spent.value[t.cat] = (spent.value[t.cat] ?? 0) + t.amt;
    }
  } catch {
    // A month with no period yet is a create, not an error.
  }
});

async function save() {
  error.value = '';
  if (!balanced.value) {
    error.value = 'Allocations must add up to the period total before saving.';
    return;
  }
  const allocations: Allocation[] = categories
    .map((c) => ({ cat: c.id, amt: parseDollarsToCents(amounts.value[c.id] ?? '') ?? 0 }))
    .filter((a) => a.amt !== 0);

  saving.value = true;
  try {
    await api.savePeriod({ yearMonth: yearMonth.value, amt: totalCents.value, memo: memo.value, allocations });
    invalidateMonths(yearMonth.value);
    router.push({ name: 'month', params: { yearMonth: yearMonth.value } });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Save failed.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="page">
    <h1 class="page__title">Period · {{ yearMonth }}</h1>

    <HCallout v-if="error" tone="over" title="That did not save">{{ error }}</HCallout>

    <div class="card">
      <HInput v-model="total" label="Period total" placeholder="0.00" />
      <HInput v-model="memo" label="Memo" placeholder="Optional note" />

      <div class="summary" :class="{ 'is-off': !balanced }">
        <span class="heeth-caps">{{ remaining === 0 ? 'Balanced' : 'Unallocated' }}</span>
        <HMoney :cents="remaining" size="m" :direction="remaining === 0 ? 'flat' : undefined" />
      </div>
    </div>

    <section class="card">
      <span class="heeth-caps card__title">Allocations</span>
      <div class="rows">
        <div v-for="c in categories" :key="c.id" class="row">
          <HCategoryAvatar :icon="c.icon" :color="c.hex" :size="32" />
          <span class="row__name">
            {{ c.nm }}
            <span class="row__sub">
              {{ c.pt }}<template v-if="spent[c.id]"> · {{ (spent[c.id] / 100).toFixed(2) }} spent</template>
            </span>
          </span>
          <input
            v-model="amounts[c.id]"
            class="row__input heeth-mono"
            type="text"
            inputmode="decimal"
            placeholder="0.00"
            :aria-label="`${c.pt} ${c.nm} allocation`"
          />
        </div>
      </div>
    </section>

    <div class="actions">
      <HButton variant="ghost" @click="router.back()">Cancel</HButton>
      <HButton :disabled="saving || !balanced" @click="save">
        {{ saving ? 'Saving' : 'Save period' }}
      </HButton>
    </div>
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
.page__title {
  font-family: var(--font-display);
  font-size: var(--fs-display-m);
  text-transform: uppercase;
  color: var(--text-strong);
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-5);
  background: var(--surface-card);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-2);
}
.card__title { color: var(--text-faint); }

.summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4);
  background: var(--surface-sunken);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  color: var(--text-faint);
}
.summary.is-off { border-color: var(--coral-500); color: var(--coral-300); }

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

.row__input {
  width: 110px;
  height: 40px;
  padding: 0 var(--space-4);
  text-align: right;
  background: var(--surface-sunken);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  color: var(--text-strong);
  font-size: var(--fs-body);
}
.row__input:focus { outline: none; border-color: var(--lime-500); box-shadow: var(--shadow-1); }

.actions { display: flex; justify-content: flex-end; gap: var(--space-4); }
</style>
