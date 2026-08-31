import { reactive } from 'vue';

/**
 * With one user and one client, the app is the only writer to the table. It observes
 * every mutation it causes, so cached data cannot go stale on its own — no TTL, no
 * polling. Invalidation is driven entirely by writes.
 *
 * Mirrored to sessionStorage so a reload within a tab is instant. localStorage is
 * deliberately avoided: a cache that outlives the session could serve data written
 * from another device.
 */
const STORAGE_KEY = 'budgt:cache';

const state = reactive<Record<string, unknown>>({});

try {
  Object.assign(state, JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}'));
} catch {
  // Corrupt or unavailable storage is not worth failing a page load over.
}

function persist() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or private-mode failures degrade to an in-memory cache.
  }
}

export const monthKey = (yearMonth: string) => `month:${yearMonth}`;
export const yearKey = (year: string) => `year:${year}`;
export const TEMPLATES_KEY = 'templates';

export function getCached<T>(key: string): T | undefined {
  return state[key] as T | undefined;
}

export function setCached<T>(key: string, value: T): T {
  state[key] = value;
  persist();
  return value;
}

export function drop(...keys: string[]) {
  for (const key of keys) delete state[key];
  persist();
}

/** Read through the cache, fetching on a miss. `force` bypasses it for one request. */
export async function cached<T>(key: string, fetcher: () => Promise<T>, force = false): Promise<T> {
  if (!force) {
    const hit = getCached<T>(key);
    if (hit !== undefined) return hit;
  }
  return setCached(key, await fetcher());
}

/**
 * A write to a month invalidates that month and its year. Callers pass every month
 * touched: an edit that moves a transaction across months (or years) affects both
 * sides. Fund balances ride along inside those payloads, so they need no key.
 */
export function invalidateMonths(...yearMonths: string[]) {
  const keys = new Set<string>();
  for (const ym of yearMonths) {
    keys.add(monthKey(ym));
    keys.add(yearKey(ym.slice(0, 4)));
  }
  drop(...keys);
}

export function clearCache() {
  for (const key of Object.keys(state)) delete state[key];
  persist();
}
