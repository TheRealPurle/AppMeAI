import { readFile } from 'node:fs/promises';
import { importApps } from './import_catalogue.mjs';
import { verifiedStoreLink } from './collect_store_coverage.mjs';

const key = process.env.COVERAGE_STORE;
if (!['huawei', 'xiaomi'].includes(key)) throw new Error('Invalid COVERAGE_STORE');
const expected = key === 'huawei' ? 5 : 6;
const lines = await readFile(`output-${key}-coverage/appmeai-${key}-coverage.jsonl`, 'utf8');
const apps = lines.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
if (!apps.length) throw new Error('No verified apps to import');
for (const app of apps) {
  if (app.store !== expected || !verifiedStoreLink(app.store_url, expected)) throw new Error('Invalid store or non-listing URL in import');
}
// Uses the repository's existing authenticated, batched importer.
await importApps(apps);
