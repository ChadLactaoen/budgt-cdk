<script setup lang="ts">
/**
 * The whole `POST /api/periods` body is on screen at once — total, memo, and one row
 * per category — because the body is a desired-state replacement rather than a delta.
 * That is why "present in the draft" is tracked separately from "has a non-zero
 * amount": clearing a row and deleting it are the same submitted payload, and the
 * server drops every allocation that does not come back.
 *
 * Two modes, one form. A month with no period yet is a create: it gets a month picker
 * and, when an earlier period exists, a draft carried over from it. A month that
 * already has one is an edit: the month locks — a period's identity IS its month, so
 * there is nothing to move it to — and every row gains the spend already booked
 * against it, which is what Match pulls the allocation up to.
 *
 * The gate is exact: save stays disabled until allocations sum to the total in cents,
 * which is the same comparison the Lambda makes before it will accept the write.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { allCategories, PARENTS, type CategoryId, type Parent } from '@shared/categories';
import { centsToInput, parseDollarsToCents } from '@shared/money';
import { api, type Allocation } from '../api/client';
import { cached, invalidateMonths, monthKey, yearKey } from '../stores/cache';
import { currentYearMonth } from '../router';
import HButton from '../components/heeth/HButton.vue';
import HCallout from '../components/heeth/HCallout.vue';
import HCategoryAvatar from '../components/heeth/HCategoryAvatar.vue';
import HIcon from '../components/heeth/HIcon.vue';
import HIconButton from '../components/heeth/HIconButton.vue';
import HInput from '../components/heeth/HInput.vue';
import HSegmentedControl from '../components/heeth/HSegmentedControl.vue';
import HSelect from '../components/heeth/HSelect.vue';

const route = useRoute();
const router = useRouter();

/* ---- Money -------------------------------------------------------------------- */

/**
 * Deliberately not `heeth/money#formatAmount`: this screen shows every amount raw in
 * an input the user is typing into, so masking only the derived figures would hide the
 * one number that decides whether the form can be saved and reveal nothing less.
 */
function money(cents: number): string {
  return (
    (cents < 0 ? '−' : '') +
    '$' +
    Math.abs(cents / 100).toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Blank is a legitimate draft value; only a malformed one is worth flagging. */
function draftCents(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 0;
  return parseDollarsToCents(value) ?? 0;
}

function isMalformed(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '' && parseDollarsToCents(value) === null;
}

/* ---- Months -------------------------------------------------------------------- */

function shiftMonth(yearMonth: string, by: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  // UTC arithmetic: the browser's zone has already been applied by `currentYearMonth`.
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(yearMonth: string): string {
  return new Date(`${yearMonth}-01T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

/** Three months back, five forward: far enough to budget ahead, short enough to scan. */
const WINDOW_BACK = 3;
const WINDOW_LENGTH = 9;

const requested = String(route.query.m ?? '');
const monthWindow = Array.from({ length: WINDOW_LENGTH }, (_, i) =>
  shiftMonth(requested || currentYearMonth(), i - WINDOW_BACK),
);

/* ---- Viewport ------------------------------------------------------------------ */

const query = window.matchMedia('(min-width: 1024px)');
const isDesktop = ref(query.matches);
const onQuery = (e: MediaQueryListEvent) => {
  isDesktop.value = e.matches;
};
query.addEventListener('change', onQuery);
onUnmounted(() => query.removeEventListener('change', onQuery));

/* ---- Draft --------------------------------------------------------------------- */

/** Fixed at load. Flipping it mid-edit would move the month out from under the draft. */
const editing = ref(false);

const yearMonth = ref(requested || currentYearMonth());
const total = ref('');
const memo = ref('');
/** Presence is the submitted set; the string is what the user typed, dollars. */
const alloc = ref<Partial<Record<CategoryId, string>>>({});
const spent = ref<Partial<Record<CategoryId, number>>>({});
const transactionCount = ref(0);
const existing = ref(new Set<string>());
/** The month this draft was copied from, empty once cleared or never prefilled. */
const copiedFrom = ref('');
const filter = ref<'alloc' | 'all'>('alloc');
const collapsed = ref<Partial<Record<Parent, boolean>>>({});

const loading = ref(true);
const saving = ref(false);
const error = ref('');

const categories = allCategories().filter((c) => c.active);

onMounted(load);

async function load() {
  try {
    // The year rollups already list every period, and they are the same cached payloads
    // the period view reads — so knowing which months are taken costs nothing extra.
    const years = [...new Set(monthWindow.map((m) => m.slice(0, 4)))];
    const rollups = await Promise.all(
      years.map((y) => cached(yearKey(y), () => api.getYear(y)).catch(() => null)),
    );
    for (const rollup of rollups) {
      for (const period of rollup?.periods ?? []) existing.value.add(period.yearMonth);
    }

    if (requested && existing.value.has(requested)) {
      editing.value = true;
      await loadExisting(requested);
    } else {
      // Landing here without a month means "budget the next month that has none yet".
      if (!requested) {
        yearMonth.value =
          monthWindow.slice(WINDOW_BACK).find((m) => !existing.value.has(m)) ?? yearMonth.value;
      }
      await prefill();
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not open this period.';
  } finally {
    // With nothing allocated yet, the allocated-only list would open empty.
    if (!Object.keys(alloc.value).length) filter.value = 'all';
    loading.value = false;
  }
}

async function loadExisting(month: string) {
  const data = await cached(monthKey(month), () => api.getMonth(month));
  total.value = centsToInput(data.period.amt);
  memo.value = data.period.memo;

  const draft: Partial<Record<CategoryId, string>> = {};
  for (const a of data.allocations) draft[a.cat] = centsToInput(a.amt);
  alloc.value = draft;

  // Same exclusion the period view makes: a fund withdrawal was budgeted in the month
  // it was deposited, so counting it again here would double it.
  const booked: Partial<Record<CategoryId, number>> = {};
  for (const t of data.transactions) {
    if (t.src) continue;
    booked[t.cat] = (booked[t.cat] ?? 0) + t.amt;
  }
  spent.value = booked;
  transactionCount.value = data.transactions.length;
}

/** A new month almost always looks like the last one, so start it there. */
async function prefill() {
  const source = [...existing.value].filter((m) => m < yearMonth.value).sort().pop();
  if (!source) return;
  try {
    const data = await cached(monthKey(source), () => api.getMonth(source));
    total.value = centsToInput(data.period.amt);
    const draft: Partial<Record<CategoryId, string>> = {};
    for (const a of data.allocations) draft[a.cat] = centsToInput(a.amt);
    alloc.value = draft;
    copiedFrom.value = source;
  } catch {
    // A convenience, not a requirement: an empty form is still a usable one.
  }
}

function clearPrefill() {
  total.value = '';
  alloc.value = {};
  copiedFrom.value = '';
  filter.value = 'all';
}

/* ---- Balance ------------------------------------------------------------------- */

const totalCents = computed(() => draftCents(total.value));
const assigned = computed(() =>
  Object.values(alloc.value).reduce((sum, v) => sum + draftCents(v), 0),
);
const left = computed(() => totalCents.value - assigned.value);
const balanced = computed(() => left.value === 0 && totalCents.value > 0);
const monthTaken = computed(() => !editing.value && existing.value.has(yearMonth.value));

const balanceColor = computed(() =>
  balanced.value ? 'var(--lime-500)' : left.value > 0 ? 'var(--status-warn)' : 'var(--status-over)',
);
const balanceLabel = computed(() =>
  balanced.value ? 'Fully allocated' : left.value > 0 ? 'Left to allocate' : 'Over-allocated',
);
const barWidth = computed(() => {
  if (totalCents.value <= 0) return '0%';
  return `${Math.min(100, Math.round((assigned.value / totalCents.value) * 100))}%`;
});
const ratioText = computed(() => `${money(assigned.value)} of ${money(totalCents.value)}`);
const totalSpent = computed(() =>
  Object.keys(alloc.value).reduce((sum, id) => sum + (spent.value[id as CategoryId] ?? 0), 0),
);

const saveDisabled = computed(() => saving.value || !balanced.value || monthTaken.value);
const saveHint = computed(() => {
  if (monthTaken.value) return 'Pick a month that has no period yet.';
  if (totalCents.value === 0) return 'Set a total for the month first.';
  if (balanced.value) return 'Allocations match the total. Ready to save.';
  if (left.value > 0) return `${money(left.value)} still to allocate before you can save.`;
  return `${money(-left.value)} over the total. Trim an allocation to save.`;
});

/* ---- Rows ---------------------------------------------------------------------- */

interface Row {
  id: CategoryId;
  name: string;
  present: boolean;
  value: string;
  cents: number;
  spent: number;
  malformed: boolean;
  overspent: boolean;
  showMatch: boolean;
  showAbsorb: boolean;
}

interface Group {
  pt: Parent;
  icon: string;
  color: string;
  rows: Row[];
  subtotal: number;
  spent: number;
  count: number;
  size: number;
  open: boolean;
}

/** The absorber: the one row it always makes sense to dump a remainder into. */
const ABSORBER: CategoryId = 'MISC_OTHER';

const groups = computed<Group[]>(() =>
  PARENTS.map((pt) => {
    const cats = categories.filter((c) => c.pt === pt);
    let subtotal = 0;
    let spentSum = 0;
    let count = 0;
    for (const c of cats) {
      const value = alloc.value[c.id];
      if (value === undefined) continue;
      subtotal += draftCents(value);
      spentSum += spent.value[c.id] ?? 0;
      count += 1;
    }

    const rows = cats
      .filter((c) => filter.value === 'all' || alloc.value[c.id] !== undefined)
      .map((c): Row => {
        const value = alloc.value[c.id];
        const cents = draftCents(value);
        const booked = spent.value[c.id] ?? 0;
        return {
          id: c.id,
          name: c.nm,
          present: value !== undefined,
          value: value ?? '',
          cents,
          spent: booked,
          malformed: isMalformed(value),
          overspent: editing.value && value !== undefined && booked > cents,
          showMatch: editing.value && booked > 0 && booked !== cents,
          showAbsorb: c.id === ABSORBER && left.value > 0,
        };
      });

    return {
      pt,
      icon: cats[0]?.icon ?? 'shapes',
      color: cats[0]?.hex ?? 'var(--cat-miscellaneous)',
      rows,
      subtotal,
      spent: spentSum,
      count,
      size: cats.length,
      open: !collapsed.value[pt],
    };
  }).filter((g) => g.rows.length > 0),
);

function setRow(id: CategoryId, event: Event) {
  alloc.value[id] = (event.target as HTMLInputElement).value;
}

function removeRow(id: CategoryId) {
  delete alloc.value[id];
}

function matchRow(row: Row) {
  alloc.value[row.id] = centsToInput(row.spent);
}

function absorbRow(row: Row) {
  alloc.value[row.id] = centsToInput(row.cents + left.value);
}

function toggleGroup(pt: Parent) {
  collapsed.value[pt] = !collapsed.value[pt];
}

const filterOptions = [
  { value: 'alloc', label: 'Allocated' },
  { value: 'all', label: 'All active' },
];

const monthOptions = computed(() =>
  monthWindow.map((m) => ({
    value: m,
    label: monthLabel(m) + (existing.value.has(m) ? ' · exists' : ''),
  })),
);

/* ---- Save ---------------------------------------------------------------------- */

async function save() {
  error.value = '';
  if (saveDisabled.value) return;

  // A row left blank sums to nothing and is dropped here, which is what makes the
  // server delete it: the submitted array is the period's complete allocation set.
  const allocations: Allocation[] = (
    Object.entries(alloc.value) as Array<[CategoryId, string]>
  )
    .map(([cat, value]) => ({ cat, amt: draftCents(value) }))
    .filter((a) => a.amt !== 0);

  saving.value = true;
  try {
    await api.savePeriod({
      yearMonth: yearMonth.value,
      amt: totalCents.value,
      memo: memo.value,
      allocations,
    });
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
  <main class="pf">
    <header class="pf__bar">
      <HIconButton
        name="arrow-left"
        label="Back"
        :variant="isDesktop ? 'secondary' : 'bare'"
        @click="router.back()"
      />
      <div class="pf__id">
        <span class="pf__eyebrow heeth-caps">{{ editing ? 'Edit period' : 'New period' }}</span>
        <h1 class="pf__title">{{ monthLabel(yearMonth) }}</h1>
      </div>
      <template v-if="isDesktop && !loading">
        <span class="pf__hint" :class="{ 'is-ready': balanced }">{{ saveHint }}</span>
        <HButton variant="ghost" @click="router.back()">Cancel</HButton>
        <HButton :disabled="saveDisabled" @click="save">
          {{ saving ? 'Saving' : editing ? 'Save period' : 'Create period' }}
        </HButton>
      </template>
    </header>

    <p v-if="loading" class="pf__muted">Loading.</p>

    <template v-else>
      <HCallout v-if="error" tone="over" title="That did not work">{{ error }}</HCallout>

      <div class="pf__grid">
        <section class="pf__side">
          <HSelect
            v-if="!editing"
            v-model="yearMonth"
            label="Month"
            :options="monthOptions"
            :error="monthTaken ? 'That month already has a period. Open it to edit instead.' : ''"
          />

          <div v-else class="locked">
            <span class="heeth-caps locked__label">Month</span>
            <div class="locked__field">
              <HIcon name="lock" :size="18" class="locked__icon" />
              <span class="locked__value">{{ monthLabel(yearMonth) }}</span>
              <span class="heeth-mono locked__count">
                {{ transactionCount }} {{ transactionCount === 1 ? 'transaction' : 'transactions' }}
              </span>
            </div>
            <span class="locked__note">A period's month cannot move. Create a new one instead.</span>
          </div>

          <div class="amount">
            <span class="heeth-caps amount__label">Total allocated</span>
            <div class="amount__field" :class="{ 'is-error': isMalformed(total) }">
              <span class="amount__currency">$</span>
              <input
                v-model="total"
                type="text"
                inputmode="decimal"
                placeholder="0.00"
                aria-label="Period total"
              />
            </div>
          </div>

          <HInput
            v-model="memo"
            label="Memo"
            icon="pencil-line"
            placeholder="Optional note for the month"
          />

          <div v-if="copiedFrom" class="copied">
            <HIcon name="info" :size="18" class="copied__icon" />
            <div class="copied__body">
              <span class="heeth-caps copied__title">Copied from {{ monthLabel(copiedFrom) }}</span>
              <span class="copied__text">
                Total and {{ Object.keys(alloc).length }} allocations carried over. Change anything
                before saving.
              </span>
            </div>
            <button type="button" class="copied__clear heeth-caps" @click="clearPrefill">Clear</button>
          </div>
        </section>

        <!-- Mobile: the one figure that decides whether this saves, pinned above the list. -->
        <section v-if="!isDesktop" class="balance balance--bar" :class="{ 'is-balanced': balanced }">
          <div class="balance__top">
            <div class="balance__headline">
              <span class="heeth-caps balance__label">{{ balanceLabel }}</span>
              <span class="balance__figure" :style="{ color: balanceColor }">
                {{ money(Math.abs(left)) }}
              </span>
            </div>
            <span class="heeth-mono balance__ratio">{{ ratioText }}</span>
          </div>
          <div class="balance__track">
            <div class="balance__fill" :style="{ width: barWidth, background: balanceColor }" />
          </div>
        </section>

        <section v-else class="balance balance--card" :class="{ 'is-balanced': balanced }">
          <span class="heeth-caps balance__label">{{ balanceLabel }}</span>
          <span class="balance__figure balance__figure--lg" :style="{ color: balanceColor }">
            {{ money(Math.abs(left)) }}
          </span>
          <div class="balance__track">
            <div class="balance__fill" :style="{ width: barWidth, background: balanceColor }" />
          </div>
          <div class="balance__stats">
            <div class="balance__stat">
              <span class="heeth-caps balance__statLabel">Assigned</span>
              <span class="heeth-mono balance__statValue">{{ money(assigned) }}</span>
            </div>
            <div class="balance__stat">
              <span class="heeth-caps balance__statLabel">Rows</span>
              <span class="heeth-mono balance__statValue">{{ Object.keys(alloc).length }}</span>
            </div>
            <div class="balance__stat">
              <span class="heeth-caps balance__statLabel">Spent</span>
              <span class="heeth-mono balance__statValue">{{ money(totalSpent) }}</span>
            </div>
          </div>
        </section>

        <aside v-if="isDesktop" class="note">
          <span class="heeth-caps note__title">One write</span>
          <span class="note__text">
            Saving posts the period and every row as one replacement set. Rows left empty are
            deleted from the period.
          </span>
        </aside>

        <section class="list">
          <div class="list__head">
            <span class="heeth-caps list__title">Allocations</span>
            <HSegmentedControl
              v-model="filter"
              :options="filterOptions"
              label="Allocation list"
              class="list__filter"
            />
            <span v-if="isDesktop" class="heeth-mono list__ratio">{{ ratioText }}</span>
          </div>

          <p v-if="!groups.length" class="pf__muted">
            Nothing allocated yet. Switch to All active to start assigning.
          </p>

          <!-- Desktop: one table, every row visible; the spend column is what Match reads. -->
          <div v-else-if="isDesktop" class="table">
            <div class="table__head trow">
              <span class="heeth-caps table__col">Category</span>
              <span class="heeth-caps table__col table__col--right">Spent</span>
              <span class="heeth-caps table__col table__col--center">Match</span>
              <span class="heeth-caps table__col table__col--right">Allocated</span>
              <span />
            </div>
            <div class="table__body">
              <template v-for="group in groups" :key="group.pt">
                <div class="trow trow--parent">
                  <span class="parent">
                    <span class="parent__swatch" :style="{ background: group.color }" />
                    <span class="heeth-caps parent__name">{{ group.pt }}</span>
                  </span>
                  <span class="heeth-mono table__cell table__col--right table__cell--faint">
                    {{ group.spent > 0 ? money(group.spent) : '—' }}
                  </span>
                  <span />
                  <span class="heeth-mono table__cell table__col--right table__cell--strong">
                    {{ money(group.subtotal) }}
                  </span>
                  <span />
                </div>

                <div v-for="row in group.rows" :key="row.id" class="trow trow--sub">
                  <span class="sub">
                    <span
                      class="sub__dot"
                      :style="{ background: row.present ? group.color : 'var(--ink-600)' }"
                    />
                    <span class="sub__name" :class="{ 'is-off': !row.present }">{{ row.name }}</span>
                    <button
                      v-if="row.showAbsorb"
                      type="button"
                      class="absorb heeth-caps"
                      @click="absorbRow(row)"
                    >
                      <HIcon name="chevrons-down" :size="14" />
                      Take {{ money(left) }}
                    </button>
                  </span>
                  <span
                    class="heeth-mono table__cell table__col--right"
                    :class="row.overspent ? 'table__cell--over' : 'table__cell--faint'"
                  >
                    {{ row.spent > 0 ? money(row.spent) : '—' }}
                  </span>
                  <span class="table__col--center">
                    <button
                      v-if="row.showMatch"
                      type="button"
                      class="match heeth-caps"
                      @click="matchRow(row)"
                    >
                      <HIcon name="equal" :size="14" />
                      Match
                    </button>
                  </span>
                  <span
                    class="field"
                    :class="{ 'is-over': row.overspent || row.malformed, 'is-off': !row.present }"
                  >
                    <span class="heeth-mono field__currency">$</span>
                    <input
                      :value="row.value"
                      class="heeth-mono"
                      type="text"
                      inputmode="decimal"
                      placeholder="0.00"
                      :aria-label="`${group.pt} ${row.name} allocation`"
                      @input="setRow(row.id, $event)"
                    />
                  </span>
                  <span class="table__col--right">
                    <button
                      type="button"
                      class="kill"
                      :disabled="!row.present"
                      :aria-label="`Remove ${row.name} allocation`"
                      @click="removeRow(row.id)"
                    >
                      <HIcon name="trash-2" :size="18" />
                    </button>
                  </span>
                </div>
              </template>
            </div>
          </div>

          <!-- Mobile: one card per envelope, collapsible, so the screen stays scannable. -->
          <div v-else class="cards">
            <article v-for="group in groups" :key="group.pt" class="card">
              <button type="button" class="card__head" @click="toggleGroup(group.pt)">
                <HCategoryAvatar :icon="group.icon" :color="group.color" :size="32" />
                <span class="card__id">
                  <span class="heeth-caps card__name">{{ group.pt }}</span>
                  <span class="heeth-mono card__meta">
                    {{ editing ? `${money(group.spent)} spent` : `${group.count} of ${group.size} allocated` }}
                  </span>
                </span>
                <span class="heeth-mono card__subtotal">{{ money(group.subtotal) }}</span>
                <HIcon
                  name="chevron-down"
                  :size="20"
                  class="card__chevron"
                  :class="{ 'is-closed': !group.open }"
                />
              </button>

              <div v-if="group.open" class="card__rows">
                <div v-for="row in group.rows" :key="row.id" class="mrow">
                  <div class="mrow__line">
                    <span class="mrow__id">
                      <span class="mrow__name" :class="{ 'is-off': !row.present }">{{ row.name }}</span>
                      <span
                        v-if="editing"
                        class="heeth-mono mrow__spent"
                        :class="{ 'is-over': row.overspent }"
                      >
                        {{ row.spent > 0 ? `${money(row.spent)} spent` : 'nothing spent' }}
                      </span>
                    </span>
                    <button
                      v-if="row.showMatch"
                      type="button"
                      class="icon-action icon-action--match"
                      aria-label="Match allocation to spend"
                      @click="matchRow(row)"
                    >
                      <HIcon name="equal" :size="18" />
                    </button>
                    <span
                      class="field"
                      :class="{ 'is-over': row.overspent || row.malformed, 'is-off': !row.present }"
                    >
                      <span class="heeth-mono field__currency">$</span>
                      <input
                        :value="row.value"
                        class="heeth-mono"
                        type="text"
                        inputmode="decimal"
                        placeholder="0.00"
                        :aria-label="`${group.pt} ${row.name} allocation`"
                        @input="setRow(row.id, $event)"
                      />
                    </span>
                    <button
                      type="button"
                      class="kill"
                      :disabled="!row.present"
                      :aria-label="`Remove ${row.name} allocation`"
                      @click="removeRow(row.id)"
                    >
                      <HIcon name="trash-2" :size="18" />
                    </button>
                  </div>
                  <button
                    v-if="row.showAbsorb"
                    type="button"
                    class="absorb absorb--block heeth-caps"
                    @click="absorbRow(row)"
                  >
                    <HIcon name="chevrons-down" :size="16" />
                    Take {{ money(left) }}
                  </button>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>

      <footer v-if="!isDesktop" class="pf__footer">
        <span class="pf__hint" :class="{ 'is-ready': balanced }">{{ saveHint }}</span>
        <div class="pf__actions">
          <HButton variant="ghost" @click="router.back()">Cancel</HButton>
          <HButton :disabled="saveDisabled" block @click="save">
            {{ saving ? 'Saving' : editing ? 'Save period' : 'Create period' }}
          </HButton>
        </div>
      </footer>
    </template>
  </main>
</template>

<style scoped>
.pf {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-5) var(--gutter) var(--space-9);
}

.pf__bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.pf__id { flex: 1; min-width: 0; }
.pf__eyebrow { display: block; color: var(--text-faint); }
.pf__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--fs-display-s);
  line-height: var(--lh-tight);
  letter-spacing: var(--ls-display);
  text-transform: uppercase;
  color: var(--text-strong);
}

.pf__hint {
  font-size: var(--fs-body-s);
  color: var(--text-muted);
}
.pf__hint.is-ready { color: var(--lime-500); }

.pf__muted { color: var(--text-faint); }

/*
 * Flex, not grid, until the desktop breakpoint: a grid item's containing block is its
 * own grid area, so the sticky balance bar would have nothing to travel over. In a flex
 * column the containing block is the whole container, which is what keeps the bar on
 * screen while the allocation list scrolls under it.
 */
.pf__grid { display: flex; flex-direction: column; gap: var(--space-5); }

.pf__footer {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0 calc(var(--gutter) * -1) calc(var(--space-9) * -1);
  padding: var(--space-4) var(--gutter) var(--space-5);
  background: var(--surface-canvas);
  border-top: var(--bw) solid var(--line-hard);
}
.pf__actions { display: flex; gap: var(--space-4); }

/* ---- Left column --------------------------------------------------------------- */

.pf__side { display: flex; flex-direction: column; gap: var(--space-5); }

.locked__label { display: block; margin-bottom: 6px; color: var(--text-muted); }
.locked__field {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--tap-min);
  padding: 0 var(--space-4);
  background: var(--surface-raised);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
}
.locked__icon { color: var(--text-faint); }
.locked__value {
  flex: 1;
  min-width: 0;
  font-weight: var(--fw-medium);
  color: var(--text-strong);
}
.locked__count { font-size: var(--fs-label); color: var(--text-faint); }
.locked__note {
  display: block;
  margin-top: 6px;
  font-size: var(--fs-body-s);
  color: var(--text-faint);
}

.amount__label { display: block; margin-bottom: 6px; color: var(--text-muted); }
.amount__field {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 14px var(--space-5);
  background: var(--surface-sunken);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  transition: border-color var(--dur-fast) var(--ease-out);
}
.amount__field:focus-within { border-color: var(--lime-500); box-shadow: var(--shadow-1); }
.amount__field.is-error { border-color: var(--coral-500); }
.amount__currency {
  font-family: var(--font-display);
  font-size: var(--fs-amount-l);
  line-height: var(--lh-display);
  color: var(--text-faint);
}
.amount__field input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-family: var(--font-display);
  font-size: var(--fs-display-l);
  line-height: var(--lh-display);
  letter-spacing: var(--ls-amount);
  color: var(--text-strong);
}

.copied {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: var(--space-4);
  background: var(--surface-raised);
  border: var(--bw) solid var(--line-hard);
  border-left: var(--bw-slab) solid var(--peri-500);
  border-radius: var(--radius-1);
}
.copied__icon { color: var(--peri-400); margin-top: 1px; }
.copied__body { flex: 1; display: flex; flex-direction: column; gap: var(--space-2); }
.copied__title { color: var(--text-strong); }
.copied__text { font-size: var(--fs-body-s); line-height: var(--lh-body); color: var(--text-muted); }
.copied__clear {
  flex: none;
  align-self: center;
  height: 32px;
  padding: 0 10px;
  background: transparent;
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  color: var(--text-muted);
  cursor: pointer;
}
.copied__clear:hover { background: var(--surface-hover); }

/* ---- Balance -------------------------------------------------------------------- */

.balance__label { color: var(--text-muted); }
.balance__figure {
  font-family: var(--font-display);
  font-size: var(--fs-amount-l);
  line-height: var(--lh-display);
}
.balance__figure--lg { font-size: var(--fs-display-l); }

.balance__track {
  height: 8px;
  background: var(--surface-sunken);
  border: var(--bw) solid var(--line-hard);
  overflow: hidden;
}
.balance__fill { height: 100%; transition: width var(--dur-fast) var(--ease-out); }

.balance--bar {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0 calc(var(--gutter) * -1);
  padding: var(--space-4) var(--gutter);
  background: var(--surface-card);
  border-top: var(--bw) solid var(--line-hard);
  border-bottom: var(--bw) solid var(--line-hard);
}
.balance--bar.is-balanced { background: var(--surface-raised); }
.balance__top { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-4); }
.balance__headline { display: flex; flex-direction: column; gap: 1px; }
.balance__ratio { font-size: var(--fs-label); text-align: right; color: var(--text-faint); }

.balance--card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: var(--space-5);
  background: var(--surface-card);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-2);
}
.balance--card.is-balanced { background: var(--surface-raised); }
.balance--card .balance__track { height: 10px; }
.balance__stats {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  padding-top: var(--space-4);
  border-top: var(--border-subtle);
}
.balance__stat { display: flex; flex-direction: column; gap: 1px; }
.balance__statLabel { color: var(--text-faint); }
.balance__statValue { font-size: var(--fs-body); font-weight: var(--fw-bold); color: var(--text-strong); }

.note {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px var(--space-5);
  background: var(--surface-raised);
  border-left: var(--bw-slab) solid var(--peri-500);
}
.note__title { color: var(--peri-400); }
.note__text { font-size: var(--fs-body-s); line-height: var(--lh-body); color: var(--text-muted); }

/* ---- List ---------------------------------------------------------------------- */

.list { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.list__head { display: flex; align-items: center; gap: var(--space-5); }
.list__title { display: none; color: var(--text-muted); }
.list__filter { flex: 1; }
.list__ratio { margin-left: auto; font-size: var(--fs-label); color: var(--text-faint); }

/* The allocation well, shared by both layouts. */
.field {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 116px;
  height: 40px;
  padding: 0 var(--space-3);
  background: var(--surface-canvas);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
}
.field.is-off { border-color: var(--ink-500); }
.field.is-over { border-color: var(--coral-500); }
.field:focus-within { border-color: var(--lime-500); }
.field__currency { font-size: var(--fs-body-s); color: var(--text-faint); }
.field input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  text-align: right;
  font-size: var(--fs-body);
  font-weight: var(--fw-bold);
  color: var(--text-strong);
}

.kill {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 40px;
  height: 40px;
  background: transparent;
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  color: var(--coral-300);
  cursor: pointer;
}
.kill:hover:not(:disabled) { background: var(--surface-hover); }
.kill:disabled {
  border-color: var(--ink-500);
  color: var(--ink-600);
  opacity: 0.4;
  cursor: default;
}

.match,
.absorb {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-1);
  font-family: var(--font-ui);
  cursor: pointer;
}
.match {
  background: transparent;
  border: var(--bw) solid var(--peri-500);
  color: var(--peri-400);
}
.match:hover { background: var(--surface-hover); }
.absorb {
  background: var(--lime-900);
  border: var(--bw) solid var(--lime-500);
  color: var(--lime-500);
}

.icon-action {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 40px;
  height: 40px;
  background: transparent;
  border-radius: var(--radius-1);
  cursor: pointer;
}
.icon-action--match { border: var(--bw) solid var(--peri-500); color: var(--peri-400); }
.icon-action--match:hover { background: var(--surface-hover); }

/* ---- Mobile cards --------------------------------------------------------------- */

.cards { display: flex; flex-direction: column; gap: var(--space-4); }

.card {
  background: var(--surface-card);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}
.card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 52px;
  padding: var(--space-3) var(--space-4);
  background: transparent;
  border: 0;
  color: var(--text-body);
  font-family: var(--font-ui);
  text-align: left;
  cursor: pointer;
}
.card__id { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.card__name { color: var(--text-strong); }
.card__meta { font-size: var(--fs-micro); color: var(--text-faint); }
.card__subtotal { font-size: var(--fs-body); font-weight: var(--fw-bold); color: var(--text-strong); }
.card__chevron {
  color: var(--text-faint);
  transition: transform var(--dur-fast) var(--ease-out);
}
.card__chevron.is-closed { transform: rotate(-90deg); }

.card__rows {
  display: flex;
  flex-direction: column;
  background: var(--surface-sunken);
  border-top: var(--bw) solid var(--line-hard);
}
.mrow { display: flex; flex-direction: column; border-bottom: var(--border-subtle); }
.mrow:last-child { border-bottom: 0; }
.mrow__line {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 56px;
  padding: var(--space-3) var(--space-4);
}
.mrow__id { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.mrow__name {
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mrow__name.is-off { color: var(--text-faint); }
.mrow__spent { font-size: var(--fs-label); color: var(--text-faint); }
.mrow__spent.is-over { color: var(--coral-300); }

.absorb--block {
  display: flex;
  justify-content: center;
  margin: 0 var(--space-4) 10px;
  min-height: 40px;
}

/* ---- Desktop table -------------------------------------------------------------- */

.table {
  display: flex;
  flex-direction: column;
  background: var(--surface-card);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}
.trow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px 120px 148px 56px;
  gap: var(--space-4);
  align-items: center;
  padding: 0 var(--space-5);
}
.table__head {
  min-height: 44px;
  background: var(--surface-sunken);
  border-bottom: var(--bw) solid var(--line-hard);
}
.table__body { max-height: 60vh; overflow: auto; }
.table__col { color: var(--text-faint); }
.table__col--right { text-align: right; justify-self: end; }
.table__col--center { text-align: center; justify-self: center; }
.table__cell { font-size: var(--fs-body-s); }
.table__cell--faint { color: var(--text-faint); }
.table__cell--over { color: var(--coral-300); }
.table__cell--strong {
  font-size: var(--fs-body);
  font-weight: var(--fw-bold);
  color: var(--text-strong);
}

.trow--parent {
  min-height: 48px;
  background: var(--surface-raised);
  border-bottom: var(--border-subtle);
}
.trow--sub { min-height: 52px; border-bottom: var(--border-subtle); }

.parent { display: flex; align-items: center; gap: 10px; }
.parent__swatch {
  flex: none;
  width: 12px;
  height: 12px;
  border: var(--bw-hair) solid var(--line-hard);
}
.parent__name { color: var(--text-strong); }

.sub { display: flex; align-items: center; gap: 10px; min-width: 0; }
.sub__dot { flex: none; width: 6px; height: 6px; }
.sub__name {
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub__name.is-off { color: var(--text-faint); }

/* ---- Desktop layout ------------------------------------------------------------- */

@media (min-width: 1024px) {
  .pf { gap: var(--space-7); padding: var(--space-7) var(--gutter-lg) var(--space-9); }
  .pf__title { font-size: var(--fs-display-m); }
  .pf__bar { gap: var(--space-5); border-bottom: var(--bw) solid var(--line-hard); padding-bottom: var(--space-5); }
  .pf__id { flex: 0 1 auto; margin-right: auto; }

  .pf__grid {
    display: grid;
    grid-template-columns: 380px minmax(0, 1fr);
    gap: var(--space-7);
    align-items: start;
  }
  .pf__side { grid-column: 1; grid-row: 1; }
  .balance--card { grid-column: 1; grid-row: 2; }
  .note { grid-column: 1; grid-row: 3; }
  .list { grid-column: 2; grid-row: 1 / span 3; }

  .list__title { display: inline; }
  .list__filter { flex: 0 0 300px; }
  .field { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .balance__fill,
  .card__chevron { transition: none; }
}
</style>
