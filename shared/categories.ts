/**
 * Categories are code-defined, not stored in DynamoDB. Items reference a category
 * only by its stable ID; display metadata lives here.
 *
 * Two rules keep this safe:
 *   1. An ID is permanent. Name, colour, icon and parent may change freely.
 *   2. An ID is never deleted. Retire a category with `active: false` so that
 *      historical transactions stay resolvable.
 *
 * `hex` is a design-system token reference (`var(--cat-*)`), not a literal colour,
 * and `icon` is a Lucide glyph name. Both are per-PARENT: the design system defines
 * one hue and one glyph per envelope, and category colour is identity, never
 * decoration.
 */

export interface Category {
  /** Display name of the subcategory. */
  nm: string;
  /** Parent category display name. */
  pt: string;
  /** Display colour, as a `var(--cat-*)` token reference. */
  hex: string;
  /** Lucide glyph name, shared by every category under the same parent. */
  icon: string;
  /** Whether the category may be assigned to new transactions. */
  active: boolean;
  /** Sort order within the parent. */
  ord: number;
  memo?: string;
}

export const PARENTS = ['Bills', 'Entertainment', 'Essentials', 'Miscellaneous', 'Savings', 'Subscriptions'] as const;
export type Parent = (typeof PARENTS)[number];

export const CATEGORIES = {
  // Bills
  BILLS_CAR: { nm: 'Car', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 1 },
  BILLS_CAR_INSURANCE: { nm: 'Car Insurance', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 2 },
  BILLS_ELECTRIC: { nm: 'Electric', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 3 },
  BILLS_GAS: { nm: 'Gas', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 4 },
  BILLS_HOA: { nm: 'HOA', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 5 },
  BILLS_HOME_SECURITY: { nm: 'Home Security', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 6 },
  BILLS_INTERNET_CABLE: { nm: 'Internet & Cable', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 7 },
  BILLS_LANDSCAPING: { nm: 'Landscaping', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 8 },
  BILLS_MORTGAGE: { nm: 'Mortgage', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 9 },
  BILLS_PHONE: { nm: 'Phone', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 10 },
  BILLS_PROPERTY_TAXES: { nm: 'Property Taxes', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 11 },
  BILLS_SEWER: { nm: 'Sewer', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 12 },
  BILLS_SOLAR: { nm: 'Solar', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 13 },
  BILLS_TRASH: { nm: 'Trash', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 14 },
  BILLS_WATER: { nm: 'Water', pt: 'Bills', hex: 'var(--cat-bills)', icon: 'receipt-text', active: true, ord: 15 },

  // Entertainment
  ENT_ART_HOBBIES: { nm: 'Art & Hobbies', pt: 'Entertainment', hex: 'var(--cat-entertainment)', icon: 'music', active: true, ord: 1 },
  ENT_BOOKS: { nm: 'Books', pt: 'Entertainment', hex: 'var(--cat-entertainment)', icon: 'music', active: true, ord: 2 },
  ENT_DIGITAL_MUSIC: { nm: 'Digital Music', pt: 'Entertainment', hex: 'var(--cat-entertainment)', icon: 'music', active: true, ord: 3 },
  ENT_EVENTS_ATTRACTIONS: { nm: 'Events & Attractions', pt: 'Entertainment', hex: 'var(--cat-entertainment)', icon: 'music', active: true, ord: 4 },
  ENT_GAMBLING: { nm: 'Gambling', pt: 'Entertainment', hex: 'var(--cat-entertainment)', icon: 'music', active: true, ord: 5 },
  ENT_GAMING: { nm: 'Gaming', pt: 'Entertainment', hex: 'var(--cat-entertainment)', icon: 'music', active: true, ord: 6 },
  ENT_MOVIES: { nm: 'Movies', pt: 'Entertainment', hex: 'var(--cat-entertainment)', icon: 'music', active: true, ord: 7 },

  // Essentials
  ESS_DINING: { nm: 'Dining', pt: 'Essentials', hex: 'var(--cat-essentials)', icon: 'shopping-basket', active: true, ord: 1 },
  ESS_DRINKS_SNACKS: { nm: 'Drinks & Snacks', pt: 'Essentials', hex: 'var(--cat-essentials)', icon: 'shopping-basket', active: true, ord: 2 },
  ESS_GAS: { nm: 'Gas', pt: 'Essentials', hex: 'var(--cat-essentials)', icon: 'shopping-basket', active: true, ord: 3 },
  ESS_GROCERIES: { nm: 'Groceries', pt: 'Essentials', hex: 'var(--cat-essentials)', icon: 'shopping-basket', active: true, ord: 4 },
  ESS_HEALTH_PERSONAL_CARE: { nm: 'Health & Personal Care', pt: 'Essentials', hex: 'var(--cat-essentials)', icon: 'shopping-basket', active: true, ord: 5 },

  // Miscellaneous
  MISC_CLOTHING: { nm: 'Clothing', pt: 'Miscellaneous', hex: 'var(--cat-miscellaneous)', icon: 'shapes', active: true, ord: 1 },
  MISC_DONATIONS: { nm: 'Donations', pt: 'Miscellaneous', hex: 'var(--cat-miscellaneous)', icon: 'shapes', active: true, ord: 2 },
  MISC_HOME: { nm: 'Home', pt: 'Miscellaneous', hex: 'var(--cat-miscellaneous)', icon: 'shapes', active: true, ord: 3 },
  MISC_OTHER: { nm: 'Other', pt: 'Miscellaneous', hex: 'var(--cat-miscellaneous)', icon: 'shapes', active: true, ord: 4 },
  MISC_TRAVEL_LODGING: { nm: 'Travel & Lodging', pt: 'Miscellaneous', hex: 'var(--cat-miscellaneous)', icon: 'shapes', active: true, ord: 5 },

  // Savings
  SAV_ADVANCE: { nm: 'Advance', pt: 'Savings', hex: 'var(--cat-savings)', icon: 'piggy-bank', active: true, ord: 1 },
  SAV_CRYPTO: { nm: 'Crypto', pt: 'Savings', hex: 'var(--cat-savings)', icon: 'piggy-bank', active: true, ord: 2 },
  SAV_IRA: { nm: 'IRA', pt: 'Savings', hex: 'var(--cat-savings)', icon: 'piggy-bank', active: true, ord: 3 },
  SAV_INVESTMENTS: { nm: 'Investments', pt: 'Savings', hex: 'var(--cat-savings)', icon: 'piggy-bank', active: true, ord: 4 },
  SAV_RAINY_DAY: { nm: 'Rainy Day', pt: 'Savings', hex: 'var(--cat-savings)', icon: 'piggy-bank', active: true, ord: 5 },
  SAV_SAVINGS: { nm: 'Savings', pt: 'Savings', hex: 'var(--cat-savings)', icon: 'piggy-bank', active: true, ord: 6 },

  // Subscriptions
  SUBS_AWS: { nm: 'AWS', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 1 },
  SUBS_AMAZON_PRIME: { nm: 'Amazon Prime', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 2 },
  SUBS_APPLE_MUSIC: { nm: 'Apple Music', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 3 },
  SUBS_APPLE_TV_PLUS: { nm: 'Apple TV+', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 4 },
  SUBS_ARLO: { nm: 'Arlo', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 5 },
  SUBS_CINEMARK: { nm: 'Cinemark', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 6 },
  SUBS_HBO_MAX: { nm: 'HBO Max', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 7 },
  SUBS_HELLOFRESH: { nm: 'HelloFresh', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 8 },
  SUBS_HULU: { nm: 'Hulu', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 9 },
  SUBS_MISC_SUBSCRIPTIONS: { nm: 'Misc Subscriptions', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 10 },
  SUBS_NBA: { nm: 'NBA', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 11 },
  SUBS_NETFLIX: { nm: 'Netflix', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 12 },
  SUBS_NUMBERFIRE: { nm: 'Numberfire', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 13 },
  SUBS_PARAMOUNT_PLUS: { nm: 'Paramount+', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 14 },
  SUBS_PEACOCK: { nm: 'Peacock', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 15 },
  SUBS_PEST_CONTROL: { nm: 'Pest Control', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 16 },
  SUBS_TWITCH: { nm: 'Twitch', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 17 },
  SUBS_VIKI: { nm: 'Viki', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 18 },
  SUBS_YOUTUBE_PREMIUM: { nm: 'YouTube Premium', pt: 'Subscriptions', hex: 'var(--cat-subscriptions)', icon: 'repeat', active: true, ord: 19 },
} satisfies Record<string, Category>;

export type CategoryId = keyof typeof CATEGORIES;

const CATEGORY_IDS = new Set(Object.keys(CATEGORIES));

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && CATEGORY_IDS.has(value);
}

/** Every category, in display order: by parent, then by `ord`. */
export function allCategories(): Array<Category & { id: CategoryId }> {
  return (Object.entries(CATEGORIES) as Array<[CategoryId, Category]>)
    .map(([id, c]) => ({ ...c, id }))
    .sort((a, b) => PARENTS.indexOf(a.pt as Parent) - PARENTS.indexOf(b.pt as Parent) || a.ord - b.ord);
}
