<script setup lang="ts">
/**
 * One view serves both `/month/:yearMonth` and `/year/:year`: a period is a period,
 * and the only real difference is that a year has no allocations to compare against.
 * `hasLimits` is that difference, and it is the only thing the template branches on.
 *
 * Mobile keeps allocated, spent and left above the fold and pushes the two heavy
 * lists behind tabs. Desktop shows the whole breakdown and the whole ledger at once —
 * which is why the layout switches on `matchMedia` rather than on CSS alone: the tab
 * state is only meaningful at one of the two sizes.
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CATEGORIES, PARENTS, type CategoryId, type Parent } from '@shared/categories';
import { FUNDS } from '@shared/funds';
import { api, ApiError, type MonthResponse, type Transaction, type YearResponse } from '../api/client';
import { cached, monthKey, yearKey } from '../stores/cache';
import { privacy } from '../stores/privacy';
import { currentYearMonth } from '../router';
import { formatAmount, formatCompact } from '../components/heeth/money';
import HBudgetBar from '../components/heeth/HBudgetBar.vue';
import HCallout from '../components/heeth/HCallout.vue';
import HCategoryAvatar from '../components/heeth/HCategoryAvatar.vue';
import HIcon from '../components/heeth/HIcon.vue';
import HIconButton from '../components/heeth/HIconButton.vue';
import HMoney from '../components/heeth/HMoney.vue';
import HSegmentedControl from '../components/heeth/HSegmentedControl.vue';
import HStatTile from '../components/heeth/HStatTile.vue';
import HSwitch from '../components/heeth/HSwitch.vue';

const route = useRoute();
const router = useRouter();

/* ---- Which period, and at what scope ------------------------------------------ */

const isYear = computed(() => route.name === 'year');
const yearMonth = computed(() => String(route.params.yearMonth ?? ''));
const year = computed(() => (isYear.value ? String(route.params.year) : yearMonth.value.slice(0, 4)));

/** Doubles as the cache key and as the watch key: both change exactly when the period does. */
const periodKey = computed(() => (isYear.value ? yearKey(year.value) : monthKey(yearMonth.value)));

/* ---- Viewport ------------------------------------------------------------------ */

const query = window.matchMedia('(min-width: 1024px)');
const isDesktop = ref(query.matches);
const onQuery = (e: MediaQueryListEvent) => {
  isDesktop.value = e.matches;
};
query.addEventListener('change', onQuery);
onUnmounted(() => query.removeEventListener('change', onQuery));

/* ---- Loading ------------------------------------------------------------------- */

const month = ref<MonthResponse | null>(null);
const rollup = ref<YearResponse | null>(null);
const error = ref('');
const missing = ref(false);
const loading = ref(false);

async function load(force = false) {
  loading.value = true;
  error.value = '';
  missing.value = false;
  try {
    if (isYear.value) {
      rollup.value = await cached(yearKey(year.value), () => api.getYear(year.value), force);
      month.value = null;
    } else {
      month.value = await cached(monthKey(yearMonth.value), () => api.getMonth(yearMonth.value), force);
      rollup.value = null;
    }
  } catch (e) {
    month.value = null;
    rollup.value = null;
    if (e instanceof ApiError && e.status === 404) missing.value = true;
    else error.value = e instanceof Error ? e.message : 'Could not load this period.';
  } finally {
    loading.value = false;
  }
}

watch(periodKey, () => load(), { immediate: true });

const ready = computed(() => Boolean(month.value || rollup.value));
const hasLimits = computed(() => !isYear.value);
const transactions = computed<Transaction[]>(
  () => month.value?.transactions ?? rollup.value?.transactions ?? [],
);
const funds = computed(() => month.value?.funds ?? rollup.value?.funds ?? []);

/* ---- Period maths -------------------------------------------------------------- */

/**
 * Period maths excludes `src` transactions: a withdrawal was already budgeted in the
 * month it was deposited, so counting it again would double it. The year rollup does
 * count them, under their own category, and subtracts them from the fund's category —
 * which nets that category to the fund balance and keeps the rows summing to total
 * allocated.
 */
const spendByCategory = computed(() => {
  const totals = new Map<CategoryId, number>();
  const add = (cat: CategoryId, amt: number) => totals.set(cat, (totals.get(cat) ?? 0) + amt);

  for (const t of transactions.value) {
    if (isYear.value) {
      add(t.cat, t.amt);
      if (t.src) add(FUNDS[t.src].cat, -t.amt);
    } else if (!t.src) {
      add(t.cat, t.amt);
    }
  }
  return totals;
});

const limitByCategory = computed(() => {
  const totals = new Map<CategoryId, number>();
  for (const a of month.value?.allocations ?? []) totals.set(a.cat, (totals.get(a.cat) ?? 0) + a.amt);
  return totals;
});

interface SubRow {
  cat: CategoryId;
  name: string;
  limit: number;
  spent: number;
}

interface ParentRow {
  name: Parent;
  icon: string;
  color: string;
  limit: number;
  spent: number;
  /** What the row leads with: how much of the allocation is unspent — as a magnitude,
   *  since the adjacent word says whether it is left or over — or, with no allocation
   *  to compare against, what was spent. */
  headline: number;
  over: boolean;
  pct: number;
  tone: string;
  subs: SubRow[];
}

/** Spend in a category with no allocation still has to appear, at a limit of zero. */
const parents = computed<ParentRow[]>(() => {
  const cats = new Set<CategoryId>(limitByCategory.value.keys());
  for (const [cat, amt] of spendByCategory.value) if (amt !== 0) cats.add(cat);

  const groups = new Map<Parent, SubRow[]>();
  for (const cat of cats) {
    const meta = CATEGORIES[cat];
    if (!meta) continue;
    const parent = meta.pt as Parent;
    const rows = groups.get(parent) ?? [];
    rows.push({
      cat,
      name: meta.nm,
      limit: limitByCategory.value.get(cat) ?? 0,
      spent: spendByCategory.value.get(cat) ?? 0,
    });
    groups.set(parent, rows);
  }

  return PARENTS.filter((p) => groups.has(p)).map((p) => {
    const subs = groups.get(p)!.sort((a, b) => CATEGORIES[a.cat].ord - CATEGORIES[b.cat].ord);
    const meta = CATEGORIES[subs[0].cat];
    const limit = subs.reduce((sum, s) => sum + s.limit, 0);
    const spent = subs.reduce((sum, s) => sum + s.spent, 0);
    const over = spent > limit;
    const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    return {
      name: p,
      icon: meta.icon,
      color: meta.hex,
      limit,
      spent,
      headline: hasLimits.value ? Math.abs(limit - spent) : spent,
      over,
      pct,
      tone: !hasLimits.value
        ? 'var(--text-strong)'
        : over
          ? 'var(--status-over)'
          : pct > 85
            ? 'var(--status-warn)'
            : 'var(--text-strong)',
      subs,
    };
  });
});

const allocated = computed(() =>
  isYear.value
    ? (rollup.value?.periods ?? []).reduce((sum, p) => sum + p.amt, 0)
    : (month.value?.period.amt ?? 0),
);
const spent = computed(() => [...spendByCategory.value.values()].reduce((sum, a) => sum + a, 0));
const left = computed(() => allocated.value - spent.value);
const pct = computed(() => (allocated.value > 0 ? Math.round((spent.value / allocated.value) * 100) : 0));

const fund = computed(() => funds.value[0] ?? null);
const fundName = computed(() => (fund.value ? FUNDS[fund.value.id].nm : 'Rainy Day'));
const fundNote = computed(() =>
  fund.value ? `${formatCompact(fund.value.dep)} in · ${formatCompact(fund.value.wd)} out` : '',
);

const allocatedNote = computed(() => {
  if (isYear.value) {
    const periods = (rollup.value?.periods ?? []).length;
    return `Across ${periods} period${periods === 1 ? '' : 's'}`;
  }
  const n = (month.value?.allocations ?? []).length;
  return `${n} categor${n === 1 ? 'y' : 'ies'}`;
});

/* ---- Header -------------------------------------------------------------------- */

const title = computed(() =>
  isYear.value
    ? year.value
    : new Date(`${yearMonth.value}-01T00:00:00`).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      }),
);

/**
 * Days left is only meaningful for the month you are actually in, and it comes from
 * the browser clock for the same reason the current month does.
 */
const daysLeft = computed(() => {
  if (isYear.value || yearMonth.value !== currentYearMonth()) return null;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
});

const subtitle = computed(() => {
  const n = transactions.value.length;
  const txns = `${n} transaction${n === 1 ? '' : 's'}`;
  if (isYear.value) {
    const periods = (rollup.value?.periods ?? []).length;
    return `${periods} period${periods === 1 ? '' : 's'} · ${txns}`;
  }
  return daysLeft.value === null ? txns : `${daysLeft.value} days left · ${txns}`;
});

function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function step(by: number) {
  if (isYear.value) router.push(`/year/${Number(year.value) + by}`);
  else router.push(`/month/${shiftMonth(yearMonth.value, by)}`);
}

const scopeOptions = [
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const scope = computed({
  get: () => (isYear.value ? 'year' : 'month'),
  set: (next: string) => {
    if (next === scope.value) return;
    if (next === 'year') {
      router.push(`/year/${year.value}`);
    } else {
      // Leaving a year lands on the current month when it belongs to that year, and
      // on its first month otherwise — never on a month outside the year you left.
      const now = currentYearMonth();
      router.push(`/month/${now.startsWith(year.value) ? now : `${year.value}-01`}`);
    }
  },
});

const hideAmounts = computed({
  get: () => privacy.value,
  set: (on: boolean) => {
    privacy.value = on;
  },
});

/* ---- Tabs and expansion --------------------------------------------------------- */

const tab = ref('breakdown');
const tabOptions = [
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'transactions', label: 'Transactions' },
];
const showBreakdown = computed(() => isDesktop.value || tab.value === 'breakdown');
const showTransactions = computed(() => isDesktop.value || tab.value === 'transactions');

/**
 * Parents start collapsed at every size. Expanding them all on desktop pushed the last
 * two envelopes below the fold, which defeats the point of the breakdown: the whole
 * value of the panel is seeing what is left in all six at a glance. Subcategories are
 * the drill-down, so they cost a click.
 */
const opened = ref(new Set<Parent>());
const isOpen = (name: Parent) => opened.value.has(name);

function toggle(name: Parent) {
  const next = new Set(opened.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  opened.value = next;
}

watch(periodKey, () => {
  opened.value = new Set();
});

/* ---- Ledger --------------------------------------------------------------------- */

type SortKey = 'date' | 'payee' | 'amount' | 'category';

const sortKey = ref<SortKey>('date');
const sortDir = ref<'asc' | 'desc'>('desc');

function sortBy(key: SortKey) {
  if (sortKey.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  else {
    sortKey.value = key;
    sortDir.value = 'desc';
  }
}

const arrow = (key: SortKey) => (sortKey.value !== key ? '' : sortDir.value === 'asc' ? ' ↑' : ' ↓');

interface Row extends Transaction {
  icon: string;
  color: string;
  catText: string;
  catSort: string;
  dateText: string;
  metaText: string;
}

const DAY_MONTH = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' });

/** Sorting is client-side over the cached period, so changing it never refetches. */
const rows = computed<Row[]>(() => {
  const list = transactions.value.map((t) => {
    const meta = CATEGORIES[t.cat];
    const dateText = DAY_MONTH.format(new Date(`${t.td}T00:00:00`));
    return {
      ...t,
      icon: meta?.icon ?? 'shapes',
      color: meta?.hex ?? 'var(--cat-miscellaneous)',
      // Subcategory only: the swatch beside it already carries the parent, and the
      // parent's name is the longest half of a string this column has no room for.
      catText: meta?.nm ?? t.cat,
      // Sorting still keys on the parent first, so the category sort groups envelopes
      // together the way the swatches suggest it does.
      catSort: meta ? `${meta.pt} ${meta.nm}` : t.cat,
      dateText,
      metaText:
        `${dateText} · ${meta?.nm ?? t.cat}` + (t.src ? ` · from ${FUNDS[t.src].nm}` : ''),
    };
  });

  const compare: Record<SortKey, (a: Row, b: Row) => number> = {
    date: (a, b) => a.td.localeCompare(b.td) || a.id.localeCompare(b.id),
    payee: (a, b) => a.nm.localeCompare(b.nm),
    amount: (a, b) => a.amt - b.amt,
    category: (a, b) => a.catSort.localeCompare(b.catSort),
  };

  const dir = sortDir.value === 'asc' ? 1 : -1;
  return list.sort((a, b) => compare[sortKey.value](a, b) * dir);
});

const columns: Array<{ key: SortKey | null; slug: string; label: string; align: 'start' | 'end' }> = [
  { key: 'date', slug: 'date', label: 'Date', align: 'start' },
  { key: 'payee', slug: 'payee', label: 'Payee', align: 'start' },
  { key: 'category', slug: 'cat', label: 'Category', align: 'start' },
  { key: null, slug: 'memo', label: 'Memo', align: 'start' },
  { key: 'amount', slug: 'amount', label: 'Amount', align: 'end' },
];

const chips: Array<{ key: SortKey; label: string }> = [
  { key: 'date', label: 'Date' },
  { key: 'payee', label: 'Payee' },
  { key: 'amount', label: 'Amount' },
  { key: 'category', label: 'Cat' },
];

/**
 * A negative amount is money back in, so it is the credit colour — the reverse of
 * HMoney's default, which reads a minus as an outflow. A fund-sourced row is neither:
 * it sits outside period maths entirely and takes the fund's own colour from CSS.
 */
function amountDirection(row: Row): 'in' | 'flat' {
  if (row.src) return 'flat';
  return row.amt < 0 ? 'in' : 'flat';
}

const ledgerNote = computed(() => {
  const n = rows.value.length;
  const funded = rows.value.filter((r) => r.src).length;
  return funded ? `${n} rows · ${funded} fund-sourced, marked ◇` : `${n} rows`;
});
</script>

<template>
  <main class="period">
    <header class="period__bar">
      <HIconButton
        name="chevron-left"
        :label="isYear ? 'Previous year' : 'Previous month'"
        :variant="isDesktop ? 'secondary' : 'bare'"
        @click="step(-1)"
      />
      <div class="period__id">
        <h1 class="period__title">{{ title }}</h1>
        <span class="period__subtitle heeth-mono">{{ subtitle }}</span>
      </div>
      <HIconButton
        name="chevron-right"
        :label="isYear ? 'Next year' : 'Next month'"
        :variant="isDesktop ? 'secondary' : 'bare'"
        @click="step(1)"
      />

      <template v-if="isDesktop">
        <HSegmentedControl
          v-model="scope"
          :options="scopeOptions"
          label="Period scope"
          class="period__scope"
        />
        <div class="period__privacy">
          <HSwitch v-model="hideAmounts"><span class="heeth-caps">Hide amounts</span></HSwitch>
        </div>
      </template>
      <HIconButton
        v-else
        :name="privacy ? 'eye-off' : 'eye'"
        :label="privacy ? 'Show amounts' : 'Hide amounts'"
        :variant="privacy ? 'primary' : 'bare'"
        @click="hideAmounts = !privacy"
      />
    </header>

    <p v-if="loading" class="period__muted">Loading.</p>
    <HCallout v-else-if="error" tone="over" title="Could not load this period">{{ error }}</HCallout>

    <HCallout v-else-if="missing" tone="info" title="No period yet">
      Nothing has been budgeted for {{ title }}.
      <RouterLink :to="`/period?m=${yearMonth}`">Create this period.</RouterLink>
    </HCallout>

    <template v-else-if="ready">
      <HCallout v-if="rollup?.truncated" tone="warn" title="This year is truncated">
        More transactions exist than one query returns, so the totals below are incomplete.
      </HCallout>

      <div class="period__grid">
        <div class="period__main">
          <div v-if="isDesktop" class="tiles">
            <HStatTile
              tone="accent"
              icon="wallet"
              label="Left to spend"
              :value="left"
              :delta="`${pct}% spent`"
            />
            <HStatTile icon="target" label="Allocated" :value="allocated" :delta="allocatedNote" />
            <HStatTile
              icon="trending-down"
              label="Spent"
              :value="spent"
              :delta="`${pct}% of allocated`"
            />
            <HStatTile
              icon="piggy-bank"
              :label="fundName"
              :value="fund?.bal ?? 0"
              :delta="fundNote"
            />
          </div>

          <section v-else class="summary">
            <div class="summary__top">
              <div class="summary__headline">
                <span class="heeth-caps summary__label">Left to spend</span>
                <HMoney :cents="left" size="xl" direction="flat" />
              </div>
              <span class="heeth-mono summary__pct">{{ pct }}% spent</span>
            </div>
            <div class="summary__track">
              <div class="summary__fill" :style="{ width: `${Math.min(100, pct)}%` }" />
            </div>
            <div class="summary__stats">
              <div class="summary__stat">
                <span class="heeth-caps summary__label">Allocated</span>
                <span class="heeth-mono summary__figure">{{ formatAmount(allocated) }}</span>
              </div>
              <div class="summary__stat">
                <span class="heeth-caps summary__label">Spent</span>
                <span class="heeth-mono summary__figure">{{ formatAmount(spent) }}</span>
              </div>
              <div class="summary__stat">
                <span class="heeth-caps summary__label">{{ fundName }}</span>
                <span class="heeth-mono summary__figure">{{ formatAmount(fund?.bal ?? 0) }}</span>
              </div>
            </div>
          </section>

          <HSegmentedControl v-if="!isDesktop" v-model="tab" :options="tabOptions" label="Section" />

          <section v-if="showBreakdown" class="section">
            <div class="section__head">
              <span class="heeth-caps section__title">Breakdown by category</span>
              <span class="heeth-mono section__note">
                {{ hasLimits ? 'Allocated · spent · left' : 'Rolled up across the year' }}
              </span>
            </div>

            <p v-if="!parents.length" class="period__muted">
              Nothing allocated or logged for this period yet.
            </p>

            <div v-else class="envelopes">
              <article v-for="parent in parents" :key="parent.name" class="cat">
                <button type="button" class="cat__head" @click="toggle(parent.name)">
                  <HCategoryAvatar :icon="parent.icon" :color="parent.color" :size="36" />
                  <div class="cat__body">
                    <div class="cat__line cat__line--head">
                      <span class="heeth-caps cat__name">{{ parent.name }}</span>
                      <span class="cat__amount" :style="{ '--money-neutral': parent.tone }">
                        <HMoney :cents="parent.headline" size="s" direction="flat" />
                        <span v-if="hasLimits" class="cat__amount-word">{{ parent.over ? 'over' : 'left' }}</span>
                      </span>
                    </div>
                    <HBudgetBar
                      v-if="hasLimits"
                      :spent="parent.spent"
                      :limit="parent.limit"
                      :height="8"
                      :show-numbers="false"
                    />
                    <div class="cat__line cat__line--detail">
                      <span class="heeth-mono cat__meta">
                        <template v-if="hasLimits">
                          {{ formatAmount(parent.spent) }} of {{ formatAmount(parent.limit) }}
                        </template>
                        <template v-else>{{ formatAmount(parent.spent) }} spent</template>
                      </span>
                      <span class="heeth-mono cat__meta">{{ parent.subs.length }} categories</span>
                    </div>
                  </div>
                  <HIcon
                    name="chevron-down"
                    :size="16"
                    class="cat__chevron"
                    :class="{ 'is-open': isOpen(parent.name) }"
                  />
                </button>

                <div v-if="isOpen(parent.name)" class="subs">
                  <div v-for="sub in parent.subs" :key="sub.cat" class="sub">
                    <span class="sub__name">{{ sub.name }}</span>
                    <HBudgetBar
                      v-if="hasLimits"
                      class="sub__bar"
                      :spent="sub.spent"
                      :limit="sub.limit"
                      :height="6"
                      :show-numbers="false"
                    />
                    <span
                      class="heeth-mono sub__figure"
                      :class="{ 'is-over': sub.spent > sub.limit && hasLimits }"
                    >
                      <template v-if="hasLimits">
                        {{ formatAmount(sub.spent) }} / {{ formatAmount(sub.limit) }}
                      </template>
                      <template v-else>{{ formatAmount(sub.spent) }}</template>
                    </span>
                  </div>
                </div>
              </article>
            </div>
          </section>
        </div>

        <div v-if="showTransactions" class="period__side">
          <section class="section">
            <div class="section__head">
              <span class="heeth-caps section__title">Transactions</span>
              <span class="heeth-mono section__note">{{ ledgerNote }}</span>
            </div>

            <p v-if="!rows.length" class="period__muted">
              Nothing logged yet. Your first entry takes about five seconds.
            </p>

            <!-- Desktop: a five-column table. Memo is display-only; the rest sort both ways. -->
            <div v-else-if="isDesktop" class="ledger">
              <div class="ledger__head">
                <button
                  v-for="col in columns"
                  :key="col.label"
                  type="button"
                  class="heeth-caps ledger__sort"
                  :class="[`is-${col.align}`, `ledger__col--${col.slug}`, { 'is-active': col.key && sortKey === col.key, 'is-static': !col.key }]"
                  :disabled="!col.key"
                  @click="col.key && sortBy(col.key)"
                >{{ col.label }}{{ col.key ? arrow(col.key) : '' }}</button>
              </div>
              <div class="ledger__body">
                <RouterLink
                  v-for="row in rows"
                  :key="row.id"
                  :to="`/transaction?id=${encodeURIComponent(row.id)}`"
                  class="ledger__row"
                >
                  <span class="heeth-mono ledger__date">{{ row.dateText }}</span>
                  <span class="ledger__payee">{{ row.nm }}</span>
                  <span class="ledger__cat">
                    <span class="ledger__swatch" :style="{ background: row.color }" />
                    <span class="ledger__cat-text">{{ row.catText }}</span>
                  </span>
                  <span class="ledger__memo ledger__col--memo">{{ row.memo }}</span>
                  <span class="ledger__amount" :class="{ 'is-funded': row.src }">
                    <span v-if="row.src" class="ledger__diamond" :title="`From ${FUNDS[row.src].nm}`">◇</span>
                    <HMoney :cents="row.amt" size="s" :direction="amountDirection(row)" />
                  </span>
                </RouterLink>
              </div>
            </div>

            <!-- Mobile: chips, because a five-column header does not survive 430px. -->
            <template v-else>
              <div class="chips">
                <span class="heeth-caps chips__label">Sort</span>
                <button
                  v-for="chip in chips"
                  :key="chip.key"
                  type="button"
                  class="heeth-caps chip"
                  :class="{ 'is-active': sortKey === chip.key }"
                  @click="sortBy(chip.key)"
                >{{ chip.label }}{{ arrow(chip.key) }}</button>
              </div>
              <div class="feed">
                <RouterLink
                  v-for="row in rows"
                  :key="row.id"
                  :to="`/transaction?id=${encodeURIComponent(row.id)}`"
                  class="feed__row"
                >
                  <HCategoryAvatar :icon="row.icon" :color="row.color" :size="36" />
                  <span class="feed__body">
                    <span class="feed__payee">{{ row.nm }}</span>
                    <span class="heeth-mono feed__meta">{{ row.metaText }}</span>
                  </span>
                  <span class="ledger__amount" :class="{ 'is-funded': row.src }">
                    <span v-if="row.src" class="ledger__diamond">◇</span>
                    <HMoney :cents="row.amt" size="s" :direction="amountDirection(row)" />
                  </span>
                </RouterLink>
              </div>
            </template>
          </section>
        </div>
      </div>
    </template>
  </main>
</template>

<style scoped>
/**
 * Block names here avoid `stack`, `hero`, `table`, `list` and `card`, which are all
 * DaisyUI component classes. `scoped` does not protect against them: it wins on the
 * element itself by specificity, but a global `.stack > *` still matches these
 * children, which carry no competing rule. DaisyUI's stack put all six breakdown
 * cards in one grid cell and its `height: 100%` clipped every expanded card.
 */
.period {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding-bottom: var(--space-9);
}
.period__muted { font-size: var(--fs-body); color: var(--text-faint); padding: 0 var(--gutter); }

/* ---- Header --------------------------------------------------------------- */

.period__bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--header-h);
  padding: var(--space-3) var(--gutter);
  background: var(--surface-canvas);
  border-bottom: var(--bw) solid var(--line-hard);
}

.period__id {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}
.period__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-title);
  line-height: 1;
  letter-spacing: var(--ls-display);
  text-transform: uppercase;
  color: var(--text-strong);
}
.period__subtitle {
  font-size: var(--fs-micro);
  color: var(--text-faint);
}

.period__scope { width: 220px; margin-left: auto; }

.period__privacy {
  display: flex;
  align-items: center;
  padding: 0 14px;
  height: 44px;
  color: var(--text-muted);
  background: var(--surface-card);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-1);
}
/* The switch owns a tap target of its own; inside the box it only needs its height. */
.period__privacy :deep(.h-switch) { min-height: auto; gap: var(--space-4); }

@media (min-width: 1024px) {
  .period__bar {
    gap: var(--space-5);
    padding: var(--space-5) var(--gutter-lg);
  }
  .period__id {
    flex: 0 1 auto;
    align-items: baseline;
    flex-direction: row;
    gap: var(--space-5);
  }
  .period__title { font-size: var(--fs-display-m); }
  .period__subtitle { font-size: var(--fs-body-s); }
}

/* ---- Layout --------------------------------------------------------------- */

.period__grid {
  display: grid;
  gap: var(--space-5);
  padding: 0 var(--gutter);
}
.period__main { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }
.period__side { min-width: 0; }

@media (min-width: 1024px) {
  .period__grid {
    grid-template-columns: minmax(0, 640px) minmax(0, 1fr);
    gap: var(--space-7);
    padding: 0 var(--gutter-lg);
    align-items: start;
  }
}

.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }

/* ---- Mobile hero ---------------------------------------------------------- */

.summary {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: var(--space-5);
  background: var(--surface-accent);
  color: var(--text-on-accent);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-3);
  /* The lime fill already carries the emphasis; the figure on it stays flat. */
  --money-neutral: var(--text-on-accent);
}
.summary__top {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
}
.summary__headline { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.summary__label { opacity: 0.7; }
.summary__pct {
  flex: 0 0 auto;
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-body-s);
  background: var(--ink-050);
  color: var(--lime-500);
  border-radius: var(--radius-1);
}
.summary__track {
  height: 10px;
  background: var(--ink-050);
  border: var(--bw) solid var(--ink-050);
  overflow: hidden;
}
.summary__fill {
  height: 100%;
  background: var(--surface-canvas);
  transition: width var(--dur-slow) var(--ease-snap);
}
.summary__stats {
  display: flex;
  gap: var(--space-6);
  padding-top: var(--space-3);
  border-top: var(--bw-hair) solid color-mix(in srgb, var(--ink-050) 25%, transparent);
}
.summary__stat { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.summary__figure { font-size: var(--fs-amount-s); font-weight: var(--fw-bold); }

/* ---- Sections ------------------------------------------------------------- */

.section { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.section__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
}
.section__title { color: var(--text-muted); }
.section__note { font-size: var(--fs-label); color: var(--text-faint); }

.envelopes { display: flex; flex-direction: column; gap: var(--space-4); }

/**
 * The six envelopes are the reason this panel exists, so all six have to be readable
 * without scrolling. Stacked one per row they run past the fold on a laptop; two
 * columns puts them in three rows and leaves room to spare. A card that is expanded
 * grows its own row, which is the only time the panel gets taller.
 */
@media (min-width: 1024px) {
  .envelopes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(288px, 1fr));
    align-items: start;
  }
}

/* ---- Breakdown ------------------------------------------------------------ */

.cat {
  container-type: inline-size;
  background: var(--surface-card);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}

.cat__head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: var(--tap-min);
  padding: var(--space-4);
  background: transparent;
  border: 0;
  color: var(--text-body);
  font-family: var(--font-ui);
  text-align: left;
  cursor: pointer;
}
.cat__head:hover { background: var(--surface-hover); }

.cat__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.cat__line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}
/**
 * The name owns its line. Sharing one with the amount meant "Entertainment" and
 * "Subscriptions" read as "Entertainme…" once the breakdown went two-up, and the
 * envelope's name is the thing you navigate the panel by.
 */
.cat__name {
  letter-spacing: var(--ls-label);
  color: var(--text-strong);
}
.cat__amount {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  flex: 0 0 auto;
  white-space: nowrap;
  color: var(--money-neutral);
}
/* The figure being scanned for, so it outweighs the label beside it. */
.cat__amount :deep(.h-money) { font-weight: var(--fw-bold); }
.cat__amount-word {
  font-family: var(--font-mono);
  font-size: var(--fs-label);
}
.cat__meta {
  min-width: 0;
  font-size: var(--fs-label);
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/**
 * A card two-up in the desktop column is roughly a third the width of the same card on
 * a phone, and it is the card's own width that decides what fits — not the viewport's.
 * Narrow, it drops to what the panel is actually scanned for: the envelope and what is
 * left in it. The name moves onto its own line rather than truncating, since the name
 * is how you find the row.
 */
@container (max-width: 340px) {
  .cat__line--head { flex-direction: column; align-items: flex-start; gap: 2px; }
  .cat__line--detail { display: none; }
}

.cat__chevron {
  flex: 0 0 auto;
  color: var(--text-faint);
  transition: transform var(--dur-fast) var(--ease-snap);
}
.cat__chevron.is-open { transform: rotate(180deg); }

.subs {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--surface-raised);
  border-top: var(--bw-hair) solid var(--line-subtle);
}
.sub {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 26px;
}
.sub__name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-body-s);
  color: var(--text-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub__bar { flex: 0 0 56px; }
.sub__figure {
  flex: 0 0 auto;
  white-space: nowrap;
  font-size: var(--fs-label);
  color: var(--text-faint);
}
.sub__figure.is-over { color: var(--status-over); }

/* Subcategories fill whatever width their card happens to have. */
@media (min-width: 1024px) {
  .subs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: var(--space-1) var(--space-6);
  }
}

/* ---- Ledger, desktop ------------------------------------------------------ */

.ledger {
  display: flex;
  flex-direction: column;
  background: var(--surface-card);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}

.ledger__head,
.ledger__row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1.1fr) minmax(0, 170px) minmax(0, 0.9fr) 118px;
  gap: var(--space-3);
  align-items: center;
  padding: 0 14px;
}
.ledger__head {
  min-height: 44px;
  background: var(--surface-sunken);
  border-bottom: var(--bw) solid var(--line-hard);
}

.ledger__sort {
  display: flex;
  align-items: center;
  padding: 0;
  background: transparent;
  border: 0;
  color: var(--text-faint);
  cursor: pointer;
}
.ledger__sort.is-end { justify-content: flex-end; }
.ledger__sort.is-active { color: var(--lime-500); }
.ledger__sort.is-static { cursor: default; }

/**
 * Below this width the flexible columns get so narrow that payee and memo are both
 * ellipsis. Memo is the one to drop: it is the only column that cannot be sorted on
 * and the only one whose content is optional.
 */
@media (max-width: 1399px) {
  .ledger__head,
  .ledger__row {
    grid-template-columns: 88px minmax(0, 1fr) minmax(0, 180px) 118px;
  }
  .ledger__col--memo { display: none; }
}

.ledger__body { max-height: 62vh; overflow: auto; }

.ledger__row {
  min-height: var(--tap-min);
  border-bottom: var(--bw-hair) solid var(--line-subtle);
  color: var(--text-body);
  text-decoration: none;
}
.ledger__row:last-child { border-bottom: 0; }
.ledger__row:hover { background: var(--surface-hover); }

.ledger__date { font-size: var(--fs-body-s); color: var(--text-muted); }
.ledger__payee {
  font-size: var(--fs-body-s);
  font-weight: var(--fw-medium);
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ledger__cat { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.ledger__swatch {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border: var(--bw-hair) solid var(--line-hard);
}
.ledger__cat-text,
.ledger__memo {
  font-size: var(--fs-body-s);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ledger__memo { color: var(--text-faint); }

.ledger__amount {
  display: flex;
  --money-neutral: var(--text-strong);
  align-items: baseline;
  justify-content: flex-end;
  gap: var(--space-2);
  flex: 0 0 auto;
  white-space: nowrap;
}
.ledger__amount :deep(.h-money) { font-weight: var(--fw-bold); }
/* Fund-sourced rows sit outside period maths, so they read as a different kind of row. */
.ledger__amount.is-funded { --money-neutral: var(--peri-400); }
.ledger__diamond { font-size: var(--fs-body-s); color: var(--peri-400); }

/* ---- Ledger, mobile ------------------------------------------------------- */

.chips { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.chips__label { flex: 0 0 auto; color: var(--text-faint); }

.chip {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 var(--space-3);
  background: transparent;
  color: var(--text-faint);
  border: var(--bw-hair) solid currentColor;
  border-radius: var(--radius-1);
  cursor: pointer;
}
.chip.is-active { background: var(--lime-900); color: var(--lime-500); }

.feed {
  display: flex;
  flex-direction: column;
  background: var(--surface-card);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}
.feed__row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 64px;
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--bw-hair) solid var(--line-subtle);
  color: var(--text-body);
  text-decoration: none;
}
.feed__row:last-child { border-bottom: 0; }
.feed__row:hover { background: var(--surface-hover); }
.feed__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.feed__payee {
  font-size: var(--fs-body);
  font-weight: var(--fw-medium);
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.feed__meta {
  font-size: var(--fs-label);
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .cat__chevron,
  .summary__fill { transition: none; }
}
</style>
