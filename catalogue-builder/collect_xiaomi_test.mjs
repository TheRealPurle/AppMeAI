import { clamp, sleep, writeResults } from './store_collector_common.mjs';
import { XIAOMI_CATEGORIES, getXiaomiCategoryApps } from './xiaomi_store.mjs';

const start = clamp(process.env.XIAOMI_CATEGORY_START || 0, 0, 999);
const limit = clamp(process.env.XIAOMI_CATEGORY_LIMIT ?? 0, 0, 999);
const perCategory = clamp(process.env.XIAOMI_APPS_PER_CATEGORY || 20, 1, 40);
const delay = clamp(process.env.XIAOMI_DELAY_MS || 2500, 1800, 15000);
const selected = XIAOMI_CATEGORIES.slice(start, limit ? start + limit : undefined);
const found = new Map(); const failures = [];
for (const category of selected) {
  try {
    const apps = await getXiaomiCategoryApps(category, perCategory);
    if (!apps.length) throw new Error('no app cards found (store layout may have changed)');
    for (const app of apps) found.set(app.store_app_id, app);
    console.log(`Xiaomi > ${category.name}: ${apps.length}`);
  } catch (error) { failures.push(`${category.name}: ${error.message}`); }
  await sleep(delay);
}
await writeResults({ outputDir: 'output-xiaomi-test', basename: 'appmeai-xiaomi-test', apps: [...found.values()], summary: { test_only: true, store: 6, market: 'ID', category_start: start, category_limit: limit, categories_selected: selected.length, apps_per_category: perCategory, failures } });
if (!found.size) process.exitCode = 1;

