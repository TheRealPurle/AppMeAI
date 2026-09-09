import { mkdir, writeFile } from 'node:fs/promises';
import {
  clamp, getGalaxyAppDetails, getGalaxyCategories, getGalaxyCategoryApps,
  normalizeGalaxyApp, sleep
} from './galaxy_store.mjs';

const CATEGORY_LIMIT = clamp(Number(process.env.GALAXY_CATEGORY_LIMIT || 4), 1, 12);
const APPS_PER_CATEGORY = clamp(Number(process.env.GALAXY_APPS_PER_CATEGORY || 10), 1, 25);
const DELAY_MS = clamp(Number(process.env.GALAXY_DELAY_MS || 1800), 1500, 15000);
const OUT = process.env.OUTPUT_DIR || 'output-galaxy-test';
const failures = [];
const discovered = new Map();

await mkdir(OUT, { recursive: true });

for (const games of [false, true]) {
  try {
    const categories = (await getGalaxyCategories({ games })).slice(0, CATEGORY_LIMIT);
    console.log(`Galaxy ${games ? 'game' : 'app'} categories selected: ${categories.length}`);
    for (const category of categories) {
      try {
        const apps = await getGalaxyCategoryApps(category, { limit: APPS_PER_CATEGORY });
        console.log(`${category.type} > ${category.name}: ${apps.length}`);
        for (const app of apps) if (app.GUID) discovered.set(app.GUID, app);
      } catch (error) {
        failures.push(`${category.type} > ${category.name}: ${error.message}`);
      }
      await sleep(DELAY_MS);
    }
  } catch (error) {
    failures.push(`Galaxy ${games ? 'game' : 'app'} categories: ${error.message}`);
  }
}

const apps = [];
let index = 0;
for (const [guid, summary] of discovered) {
  index++;
  try {
    const detail = await getGalaxyAppDetails(guid);
    const app = normalizeGalaxyApp(summary, detail);
    if (app.store_app_id && app.name && app.store_url) apps.push(app);
    else failures.push(`${guid}: missing required fields`);
  } catch (error) {
    failures.push(`${guid}: ${error.message}`);
  }
  console.log(`Galaxy details: ${index}/${discovered.size}`);
  await sleep(DELAY_MS);
}

const jsonl = apps.map(app => JSON.stringify(app)).join('\n') + (apps.length ? '\n' : '');
await writeFile(`${OUT}/appmeai-galaxy-test.jsonl`, jsonl);
await writeFile(`${OUT}/summary.json`, JSON.stringify({
  generated_at: new Date().toISOString(),
  test_only: true,
  market: 'DK',
  categories_per_type: CATEGORY_LIMIT,
  apps_per_category: APPS_PER_CATEGORY,
  discovered: discovered.size,
  apps: apps.length,
  failures
}, null, 2) + '\n');

console.log(`Galaxy test finished with ${apps.length} apps and ${failures.length} failures.`);
if (!apps.length) process.exitCode = 1;
