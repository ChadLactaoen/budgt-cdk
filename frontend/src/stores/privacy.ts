import { ref, watch } from 'vue';

/**
 * Privacy hides shoulder-surfers, not data at rest: every currency string collapses
 * to a fixed mask while it is on. Percentages and bar fills stay visible — they carry
 * no absolute figure, and hiding them would leave the page unreadable rather than
 * private.
 *
 * Session-scoped for the same reason the cache is: a setting that outlived the tab
 * would silently mask a fresh session the user never armed.
 */
const STORAGE_KEY = 'budgt:privacy';

/** Fixed width, so masking never reflows a column. */
export const MASK = '$XX.XX';
export const MASK_COMPACT = '$XX';

function stored(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Private mode degrades to off, which is the default anyway.
    return false;
  }
}

export const privacy = ref(stored());

watch(privacy, (on) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // A rejected write only costs the setting on reload.
  }
});

export function togglePrivacy() {
  privacy.value = !privacy.value;
}
