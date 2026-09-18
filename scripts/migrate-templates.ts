/**
 * Migrates the legacy `Template` table's `type: "TRANSACTION"` rows into `Budgt`.
 *
 *   npx ts-node scripts/migrate-templates.ts            # dry run, writes nothing
 *   npx ts-node scripts/migrate-templates.ts --apply
 *
 * Independent of the period and transaction migrations: this script owns the whole
 * `TMP#` partition and touches nothing else, so it can run in any order.
 */
import { isCategoryId, CATEGORIES } from '../shared/categories';
import { TEMPLATE_PK } from '../lambda/api/keys';
import { buildTemplateItems, type LegacyTemplate } from './migration/templates';
import { APPLY, batchWrite, clearPartitions, scanAll, TARGET_TABLE, REGION } from './migration/ddb';

const SOURCE_TABLE = 'Template';

async function main() {
  const rows = await scanAll<LegacyTemplate>(SOURCE_TABLE);
  console.log(`scanned ${rows.length} rows from ${SOURCE_TABLE} (${REGION})`);

  const items = buildTemplateItems(rows);
  const skipped = rows.length - items.length;
  if (skipped) console.log(`  skipped ${skipped}: type is not TRANSACTION`);

  // Print the whole mapping: 19 rows is small enough to review by eye, and the category
  // translation is the only part of this migration that can be wrong without erroring.
  console.log(`\nwill write ${items.length} TEMPLATE items`);
  for (const t of items) {
    console.log(
      `  ${t.SK.padEnd(20)} ${t.tn.padEnd(16)} ${t.nm.padEnd(26)} ${t.cat.padEnd(22)}` +
        ` ${(t.amt / 100).toFixed(2).padStart(9)}${t.active ? '' : '  <-- inactive, category is retired'}`,
    );
  }

  // The keys are derived from `templateName`, the source's own hash key, so a collision
  // would mean the source itself is inconsistent.
  const keys = new Set(items.map((t) => `${t.PK}|${t.SK}`));
  if (keys.size !== items.length) throw new Error(`${items.length - keys.size} duplicate template key(s)`);

  for (const t of items) {
    if (!isCategoryId(t.cat)) throw new Error(`${t.SK}: ${t.cat} is not a category ID`);
    if (!Number.isSafeInteger(t.amt)) throw new Error(`${t.SK}: amt ${t.amt} is not an integer`);
    if (!t.tn || !t.nm) throw new Error(`${t.SK}: missing label or payee`);
    if (t.active !== CATEGORIES[t.cat].active) throw new Error(`${t.SK}: active disagrees with its category`);
  }
  console.log('\nevery template resolves to a live category ID with an exact cent amount');

  if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply.');
    return;
  }

  // This script owns the partition outright, so clearing it wholesale is what makes a
  // re-run idempotent after the mapping or a source price has changed.
  const removed = await clearPartitions([TEMPLATE_PK]);
  console.log(`\ncleared ${removed} existing template(s)`);

  await batchWrite(items.map((Item) => ({ PutRequest: { Item } })));
  console.log(`wrote ${items.length} items to ${TARGET_TABLE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
