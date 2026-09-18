<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CATEGORIES, type CategoryId } from '@shared/categories';
import { FUNDS, type FundId } from '@shared/funds';
import { centsToInput, formatCents, parseAmountExpression } from '@shared/money';
import { api, ApiError, type Template, type YearResponse } from '../api/client';
import { cached, invalidateMonths, TEMPLATES_KEY, yearKey } from '../stores/cache';
import HAmountField from '../components/heeth/HAmountField.vue';
import HAppHeader from '../components/heeth/HAppHeader.vue';
import HButton from '../components/heeth/HButton.vue';
import HCallout from '../components/heeth/HCallout.vue';
import HCategoryAvatar from '../components/heeth/HCategoryAvatar.vue';
import HCategorySheet from '../components/heeth/HCategorySheet.vue';
import HIcon from '../components/heeth/HIcon.vue';
import HIconButton from '../components/heeth/HIconButton.vue';
import HInput from '../components/heeth/HInput.vue';
import HMoney from '../components/heeth/HMoney.vue';
import HSelect from '../components/heeth/HSelect.vue';
import HSwitch from '../components/heeth/HSwitch.vue';

const route = useRoute();
const router = useRouter();

const id = ref<string | undefined>(route.query.id ? String(route.query.id) : undefined);
const td = ref(new Date().toISOString().slice(0, 10));
const nm = ref('');
const cat = ref<CategoryId | ''>('');
const amount = ref('');
const src = ref<FundId | ''>('');
const memo = ref('');

const advanced = ref(false);
const pickerOpen = ref(false);
const templates = ref<Template[]>([]);
/** The chosen template's id, or '' for none. Doubles as the applied-template label. */
const templateId = ref('');
const year = ref<YearResponse | null>(null);
const saveError = ref('');
/** Set when the save failed because the target month has no Period. */
const missingPeriod = ref('');
const saving = ref(false);
const submitted = ref(false);
/** The payee just saved, while the form stays open for the next one. */
const savedNote = ref('');
/** Explains an auto-filled category, so the change never looks like a glitch. */
const suggestNote = ref('');

/** The month this edit is leaving, if it moves. Both sides must be invalidated. */
const originalMonth = ref<string | null>(null);

const chosen = computed(() => (cat.value ? CATEGORIES[cat.value] : null));

/**
 * A native <option> is plain text, so the payee only earns its place when it differs
 * from the label — half the templates are named after their merchant, and "Netflix —
 * Netflix" is noise. The amount is deliberately left out: an option cannot route
 * through HMoney, so putting a figure here would show it under privacy mode.
 */
const templateOptions = computed(() => [
  { value: '', label: 'Start from a template…' },
  ...templates.value.map((t) => ({
    value: t.id,
    label: t.tn === t.nm ? t.tn : `${t.tn} — ${t.nm}`,
  })),
]);

/** Parsed once and read by both the validator and the save path. */
const amountCents = computed(() => parseAmountExpression(amount.value));

/**
 * A summed expression stays in the field as typed — it is the record of how the total
 * was arrived at — so the total itself has to be shown somewhere. `formatCents` rather
 * than the privacy-masked `formatAmount`: the operands are already on screen in the
 * input being typed into, so masking the sum would hide nothing.
 */
const amountHint = computed(() =>
  amount.value.includes('+') && amountCents.value !== null
    ? `= ${formatCents(amountCents.value)}`
    : 'Add amounts with + to combine a split charge.',
);
const showingTotal = computed(() => amountHint.value.startsWith('='));

const eyebrow = computed(() =>
  new Date(`${td.value}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
);

const errors = computed(() => ({
  amount: amountCents.value === null ? 'Enter an amount.' : '',
  nm: nm.value.trim() ? '' : 'Add a payee. This is the name on the statement.',
  cat: cat.value ? '' : 'Every transaction needs one category.',
}));

const errorCount = computed(() => Object.values(errors.value).filter(Boolean).length);
const showErrors = computed(() => submitted.value && errorCount.value > 0);

onMounted(async () => {
  // Templates are read-only, so the cache never needs invalidating.
  cached<{ templates: Template[] }>(TEMPLATES_KEY, () => api.getTemplates())
    .then((r) => (templates.value = r.templates.filter((t) => t.active)))
    .catch(() => undefined);

  // The year payload carries fund balances and, unlike the month, never 404s on a
  // month with no period. Read through the cache: the same payload backs the
  // payee -> category lookup, so on a warm cache that costs no request at all.
  loadYear(td.value.slice(0, 4));

  if (!id.value) return;
  try {
    const t = await api.getTransaction(id.value);
    td.value = t.td;
    nm.value = t.nm;
    cat.value = t.cat;
    amount.value = centsToInput(t.amt);
    src.value = t.src ?? '';
    memo.value = t.memo;
    originalMonth.value = t.td.slice(0, 7);
    advanced.value = Boolean(t.src || t.memo);
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Could not load that transaction.';
  }
});

function loadYear(y: string) {
  cached<YearResponse>(yearKey(y), () => api.getYear(y))
    .then((r) => (year.value = r))
    .catch(() => undefined);
}

/**
 * Fills the three fields a template knows about; date, source and memo stay the
 * user's. Selecting the placeholder clears nothing — the fields are theirs to edit
 * once filled, and silently emptying them would be the more surprising behaviour.
 */
watch(templateId, (id) => {
  const t = templates.value.find((x) => x.id === id);
  if (!t) return;
  nm.value = t.nm;
  cat.value = t.cat;
  amount.value = centsToInput(t.amt);
  suggestNote.value = '';
});

function pick(next: CategoryId) {
  cat.value = next;
  pickerOpen.value = false;
  suggestNote.value = '';
}

/**
 * A throw here would be expensive out of proportion to the bug: an exception raised
 * during render kills the component's reactive effect, leaving every control inert
 * until a reload.
 */
function balanceOf(fund: FundId): number {
  return year.value?.funds?.find((f) => f.id === fund)?.bal ?? 0;
}

/** Payees are matched loosely — case and inner whitespace are not meaningful. */
const normalize = (payee: string) => payee.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Most payees are always filed under the same category, so the history already loaded
 * for this year answers the question without a request. Nothing is fetched, scanned,
 * or indexed for this: the year payload carries `nm` and `cat` on every transaction.
 *
 * Runs on the payee field's blur, and only fills an *empty* category — a deliberate
 * choice is never overwritten.
 */
function suggestCategory() {
  if (cat.value) return;
  const key = normalize(nm.value);
  if (!key) return;

  // The year payload arrives in GSI1 order (MONTH#mm#DAY#dd#TS#ts), so it is already
  // chronological — the last N matches are the N most recent.
  const recent = (year.value?.transactions ?? []).filter((t) => normalize(t.nm) === key).slice(-10);
  if (recent.length === 0) return;

  // Later entries win a tie, which makes the most recent category the tiebreaker at
  // an exact 50/50 split.
  const counts = new Map<CategoryId, number>();
  let best: CategoryId | null = null;
  for (const t of recent) {
    const next = (counts.get(t.cat) ?? 0) + 1;
    counts.set(t.cat, next);
    if (best === null || next >= (counts.get(best) ?? 0)) best = t.cat;
  }

  if (best === null || (counts.get(best) ?? 0) * 2 < recent.length) return;

  cat.value = best;
  suggestNote.value = `Set from your last ${recent.length} ${nm.value.trim()} transaction${
    recent.length > 1 ? 's' : ''
  }.`;
}

async function save() {
  submitted.value = true;
  saveError.value = '';
  missingPeriod.value = '';
  const amt = amountCents.value;
  if (amt === null || !cat.value || !nm.value.trim()) return;

  saving.value = true;
  try {
    const saved = await api.saveTransaction({
      ...(id.value ? { id: id.value } : {}),
      td: td.value,
      nm: nm.value.trim(),
      cat: cat.value,
      amt,
      ...(src.value ? { src: src.value } : {}),
      memo: memo.value,
    });
    // The returned id may differ from the one sent: it encodes `td`, which is editable.
    const months = [saved.td.slice(0, 7)];
    if (originalMonth.value && originalMonth.value !== months[0]) months.push(originalMonth.value);
    invalidateMonths(...months);

    // An edit is done when it is saved. Adding is not: transactions arrive in batches
    // off a statement, so the form clears itself and waits for the next one. The
    // checkmark in the footer is the way out.
    if (id.value) {
      router.push({ name: 'month', params: { yearMonth: months[0] } });
      return;
    }
    savedNote.value = nm.value.trim();
    resetForNext();
    // The year payload was just invalidated, and the form reads it for fund balances
    // and the payee -> category suggestion. Pull it forward rather than showing the
    // balances the transaction has already moved.
    loadYear(saved.td.slice(0, 4));
    window.scrollTo({ top: 0 });
  } catch (e) {
    // A transaction filed into a month with no Period would be invisible in the month
    // view, so the API refuses it. Offer the fix rather than just the message.
    if (e instanceof ApiError && e.code === 'NO_PERIOD') {
      missingPeriod.value = String(e.detail?.yearMonth ?? td.value.slice(0, 7));
    }
    saveError.value = e instanceof Error ? e.message : 'Save failed.';
  } finally {
    saving.value = false;
  }
}

/**
 * Keeps the date — a batch off one statement usually shares it — and the advanced
 * panel's open state. The funding source is not kept: silently filing the next
 * transaction against a fund is the expensive mistake, and it is not visible from the
 * amount field where the user is typing.
 */
function resetForNext() {
  nm.value = '';
  cat.value = '';
  amount.value = '';
  src.value = '';
  memo.value = '';
  templateId.value = '';
  suggestNote.value = '';
  submitted.value = false;
}

/** The checkmark: done adding, back to the period being filed into. */
function done() {
  router.push({ name: 'month', params: { yearMonth: td.value.slice(0, 7) } });
}

function createPeriod() {
  router.push({ name: 'period', query: { m: missingPeriod.value } });
}

function cancel() {
  router.back();
}
</script>

<template>
  <div class="tx" :class="{ 'is-dimmed': pickerOpen }">
    <HAppHeader
      class="tx__header"
      :title="id ? 'Edit transaction' : 'New transaction'"
      :eyebrow="eyebrow"
      back
      @back="cancel"
    />

    <div class="tx__scroll">
      <div class="tx__col">
        <h2 class="tx__heading">{{ id ? 'Edit transaction' : 'New transaction' }}</h2>

        <HCallout
          v-if="showErrors"
          tone="over"
          :title="`${errorCount} field${errorCount > 1 ? 's need' : ' needs'} attention`"
        >Nothing has been saved yet.</HCallout>

        <HCallout v-else-if="saveError" tone="over" title="That did not save">
          {{ saveError }}
          <HButton
            v-if="missingPeriod"
            class="tx__callout-action"
            variant="secondary"
            size="sm"
            @click="createPeriod"
          >Create the period</HButton>
        </HCallout>

        <HCallout v-else-if="savedNote" tone="ok" :title="`Saved ${savedNote}`">
          Add the next one, or tap the checkmark to go back to the period.
        </HCallout>

        <HAmountField
          v-model="amount"
          label="Amount"
          :error="showErrors ? errors.amount : ''"
          :hint="amountHint"
        >
          <template #noteIcon>
            <HIcon v-if="showErrors && errors.amount" name="octagon-alert" :size="16" />
            <HIcon v-else-if="showingTotal" name="equal" :size="16" />
          </template>
        </HAmountField>

        <div class="tx__pair">
          <HInput
            v-model="nm"
            label="Payee"
            placeholder="Cinemark Theatres"
            icon="store"
            :error="showErrors ? errors.nm : ''"
            @blur="suggestCategory"
          />
          <HInput v-model="td" label="Date" type="date" icon="calendar" hint="When the spend happened." />
        </div>

        <HSelect
          v-if="templates.length"
          v-model="templateId"
          label="Template"
          :options="templateOptions"
          hint="Fills the payee, category and amount. Everything stays editable."
        />

        <div class="tx__field">
          <span class="heeth-caps tx__label" :class="{ 'is-error': showErrors && errors.cat }">
            Category
          </span>
          <button type="button" class="tx__cat" :class="{ 'is-error': showErrors && errors.cat }" @click="pickerOpen = true">
            <HCategoryAvatar
              v-if="chosen"
              :icon="chosen.icon"
              :color="chosen.hex"
            />
            <HCategoryAvatar v-else icon="shapes" empty :error="Boolean(showErrors && errors.cat)" />
            <span class="tx__cat-text">
              <template v-if="chosen">
                <span>{{ chosen.nm }}</span>
                <span class="tx__cat-parent">{{ chosen.pt }}</span>
              </template>
              <span v-else>Choose a category</span>
            </span>
            <HIcon name="chevron-right" />
          </button>
          <span v-if="showErrors && errors.cat" class="tx__error">
            <HIcon name="octagon-alert" :size="16" />
            {{ errors.cat }}
          </span>
          <span v-else-if="suggestNote" class="tx__hint tx__suggest">
            <HIcon name="info" :size="16" />
            {{ suggestNote }}
          </span>
        </div>

        <div class="tx__advanced">
          <HSwitch v-model="advanced">
            <span class="tx__adv-text">
              <span class="heeth-caps tx__adv-title">Advanced</span>
              <span class="tx__adv-sub">Funding source and memo</span>
            </span>
          </HSwitch>

          <template v-if="advanced">
            <div class="tx__field">
              <span class="heeth-caps tx__label">Paid from</span>
              <div class="tx__segments">
                <button
                  type="button"
                  class="tx__segment heeth-caps"
                  :class="{ 'is-on': src === '' }"
                  @click="src = ''"
                >This month's budget</button>
                <button
                  v-for="(fund, fid) in FUNDS"
                  :key="fid"
                  type="button"
                  class="tx__segment heeth-caps"
                  :class="{ 'is-on': src === fid }"
                  @click="src = fid as FundId"
                >
                  {{ fund.nm }}
                  <HMoney :cents="balanceOf(fid as FundId)" size="s" direction="flat" />
                </button>
              </div>
              <span class="tx__hint">
                A fund withdrawal is excluded from this month's allocation math.
              </span>
            </div>

            <HInput v-model="memo" label="Memo" placeholder="Optional note" />
          </template>
        </div>
      </div>
    </div>

    <div class="tx__footer">
      <div class="tx__footer-inner">
        <HButton variant="ghost" @click="cancel">Cancel</HButton>
        <HButton class="tx__save" :disabled="saving" @click="save">
          {{ saving ? 'Saving' : 'Save transaction' }}
        </HButton>
        <HIconButton
          v-if="!id"
          name="check"
          label="Done adding — back to the period"
          variant="primary"
          @click="done"
        />
      </div>
    </div>
  </div>

  <HCategorySheet v-if="pickerOpen" @close="pickerOpen = false" @pick="pick" />
</template>

<style scoped>
.tx {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--surface-canvas);
}
/* The form quiets while the picker is open. */
.tx.is-dimmed .tx__scroll,
.tx.is-dimmed .tx__header { opacity: 0.5; }

.tx__scroll { flex: 1; }

.tx__col {
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
  padding: var(--space-6) var(--gutter) var(--space-5);
}

/* Mobile uses the header; the display heading is a desktop affordance. */
.tx__heading { display: none; }

.tx__label { color: var(--text-faint); }
.tx__label.is-error { color: var(--coral-300); }

.tx__field { display: flex; flex-direction: column; gap: var(--space-3); }
.tx__pair { display: flex; flex-direction: column; gap: var(--space-7); }

.tx__cat {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  min-height: 64px;
  padding: 0 var(--space-4);
  background: var(--surface-sunken);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  text-align: left;
  cursor: pointer;
}
.tx__cat:hover { background: var(--surface-hover); }
.tx__cat.is-error { border-color: var(--coral-500); }

.tx__cat-text { display: flex; flex-direction: column; gap: var(--space-1); flex: 1; }
.tx__cat-parent { font-size: var(--fs-body-s); color: var(--text-faint); }

.tx__error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-body-s);
  color: var(--coral-300);
}

.tx__hint { font-size: var(--fs-body-s); color: var(--text-faint); }
.tx__suggest { display: flex; align-items: center; gap: 6px; }

/* The callout wraps its slot in a <p>, so the action needs to break the line itself. */
.tx__callout-action { display: block; margin-top: var(--space-3); }

.tx__advanced {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-4);
  background: var(--surface-raised);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
}
.tx__adv-text { display: flex; flex-direction: column; gap: var(--space-1); }
.tx__adv-title { color: var(--text-strong); }
.tx__adv-sub { font-size: var(--fs-body-s); color: var(--text-faint); font-weight: var(--fw-regular); }

.tx__segments { display: flex; gap: var(--space-4); flex-wrap: wrap; }
.tx__segment {
  flex: 1 1 45%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  min-height: var(--tap-min);
  padding: 0 var(--space-5);
  background: var(--surface-sunken);
  border: var(--bw) solid var(--line-hard);
  border-radius: var(--radius-1);
  color: var(--text-muted);
  cursor: pointer;
}
.tx__segment:hover { background: var(--surface-hover); }
.tx__segment.is-on { border-color: var(--lime-500); color: var(--text-strong); }

.tx__footer {
  position: sticky;
  bottom: 0;
  padding: var(--space-5) var(--gutter);
  border-top: var(--bw) solid var(--line-hard);
  background: var(--surface-canvas);
}
.tx__footer-inner { display: flex; gap: var(--space-4); }
.tx__save { flex: 1; }

@media (min-width: 1024px) {
  .tx__header { display: none; }
  .tx__heading {
    display: block;
    font-family: var(--font-display);
    font-size: var(--fs-display-m);
    line-height: var(--lh-display);
    letter-spacing: var(--ls-display);
    text-transform: uppercase;
    color: var(--text-strong);
  }
  /* Without this the region grows to fill 100vh and pushes the footer — and the
     Save button with it — below the fold. */
  .tx__scroll {
    flex: 0 0 auto;
    display: flex;
    justify-content: center;
    padding: var(--space-9) var(--gutter-lg);
  }
  .tx__col { width: 640px; max-width: 100%; padding: 0; }
  .tx__pair { display: grid; grid-template-columns: 1fr 240px; gap: var(--space-6); align-items: start; }
  .tx__footer { position: static; border-top: 0; padding: var(--space-3) 0 var(--space-9); }
  .tx__footer-inner { width: 640px; margin: 0 auto; justify-content: flex-end; }
  .tx__save { flex: 0 0 auto; }
}
</style>
