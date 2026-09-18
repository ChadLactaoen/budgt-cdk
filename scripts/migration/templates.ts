/**
 * The legacy `Template` -> current Template translation. Pure, like `mapping.ts`, so it
 * can be exercised without credentials.
 *
 * Kept separate from `mapping.ts` because the source is a third table with its own
 * shape: a Template's category is a BARE name where `CATEGORY_MAP` is keyed
 * `"Parent>Name"`, and there is no period, fund or date arithmetic to share.
 */
import { CATEGORIES, isCategoryId, type CategoryId } from '../../shared/categories';
import { TEMPLATE_PK, templateSk } from '../../lambda/api/keys';
import type { TemplateItem } from '../../lambda/api/types';
import { cents } from './mapping';

/** The source table also holds `type: "BET"` rows, which are nothing to do with Budgt. */
export interface LegacyTemplate {
  templateName: string;
  type: string;
  /** The payee, e.g. "Freedom Mortgage" — not the template's own label. */
  name: string;
  /** A category name with no parent, resolved against `TEMPLATE_CATEGORY` below. */
  category: string;
  /** Dollars, as a float. */
  price: number;
}

/**
 * Every `category` value that appears on a `type: "TRANSACTION"` row.
 *
 * A bare name is only safe to map because none of the two names that collide across
 * parents in the legacy vocabulary — `Gas` (Bills and Essentials) and `Savings` (a
 * parent and a subcategory) — is used by any template. A new template on either would
 * need the parent to disambiguate, which is why this map is explicit rather than a
 * lookup over `CATEGORIES` by `nm`.
 */
export const TEMPLATE_CATEGORY: Record<string, CategoryId> = {
  'Home Security': 'BILLS_HOME_SECURITY',
  'Internet & Cable': 'BILLS_INTERNET_CABLE',
  HOA: 'BILLS_HOA',
  Landscaping: 'BILLS_LANDSCAPING',
  Mortgage: 'BILLS_MORTGAGE',
  Solar: 'BILLS_SOLAR',

  Investments: 'SAV_INVESTMENTS',

  'Amazon Prime': 'SUBS_AMAZON_PRIME',
  'Apple Music': 'SUBS_APPLE_MUSIC',
  'Apple TV+': 'SUBS_APPLE_TV_PLUS',
  Arlo: 'SUBS_ARLO',
  Cinemark: 'SUBS_CINEMARK',
  'HBO Max': 'SUBS_HBO_MAX',
  Hulu: 'SUBS_HULU',
  Netflix: 'SUBS_NETFLIX',
  Numberfire: 'SUBS_NUMBERFIRE',
  'Paramount+': 'SUBS_PARAMOUNT_PLUS',
  Viki: 'SUBS_VIKI',
  'YouTube Premium': 'SUBS_YOUTUBE_PREMIUM',
};

/** Throws rather than defaulting: an unmapped name is a mapping bug, not a data point. */
export function mapTemplateCategory(name: string): CategoryId {
  const id = TEMPLATE_CATEGORY[name];
  if (!id) throw new Error(`unmapped legacy template category: ${name}`);
  if (!isCategoryId(id)) throw new Error(`${name} maps to ${id}, which is not a category ID`);
  return id;
}

/**
 * `active` is derived from the category rather than hardcoded: a template pointing at a
 * retired category would offer the picker a choice the category sheet no longer does.
 * `SUBS_NUMBERFIRE` is the one that lands `false`.
 */
export function buildTemplateItems(rows: LegacyTemplate[]): TemplateItem[] {
  return rows
    .filter((r) => r.type === 'TRANSACTION')
    // A Scan returns rows in arbitrary order; sorting keeps the dry run's output diffable.
    .sort((a, b) => a.templateName.localeCompare(b.templateName))
    .map((r) => {
      const cat = mapTemplateCategory(r.category);
      return {
        PK: TEMPLATE_PK,
        SK: templateSk(r.templateName),
        tn: r.templateName,
        nm: r.name,
        amt: cents(r.price),
        cat,
        active: CATEGORIES[cat].active,
        type: 'TEMPLATE' as const,
      };
    });
}
