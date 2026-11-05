import { mkdir, writeFile } from 'node:fs/promises';
import { TARGETS } from './collect_store_coverage.mjs';
const base = (process.env.APPMEAI_API_URL || '').replace(/\/$/, '');
if (!base.startsWith('https://')) throw new Error('Set APPMEAI_API_URL to the existing HTTPS API base URL');
const stores = [{ id: 1, name: 'Apple' }, { id: 2, name: 'Google' }, { id: 3, name: 'Samsung' }, { id: 5, name: 'Huawei' }, { id: 6, name: 'Xiaomi' }];
const rows = [];
for (const target of TARGETS) {
  // Four parallel read-only requests maximum; no catalogue writes here.
  for (let offset = 0; offset < stores.length; offset += 4) {
    rows.push(...await Promise.all(stores.slice(offset, offset + 4).map(async store => {
      try {
        const q = target.queries[0];
        const response = await fetch(`${base}/search.php?${new URLSearchParams({ q, stores: String(store.id), limit: '20' })}`, { signal: AbortSignal.timeout(20000) });
        const data = await response.json();
        if (!response.ok || !data.ok || data.search_version !== 10) throw new Error('Search v10 is unavailable; upload the PHP fix first');
        const apps = data.apps.filter(app => Number(app.store_code) === store.id);
        const ownCoverage = TARGETS.find(t => t.name === target.name);
        const relevant = apps.filter(app => !ownCoverage.reject?.test(`${app.category} ${app.subcategory}`) && ownCoverage.terms.test(`${app.name} ${app.category} ${app.subcategory} ${app.description}`));
        return { category: target.name, store: store.name, count_returned: relevant.length, covered: relevant.length > 0, examples: relevant.slice(0, 2).map(a => a.name) };
      } catch (error) { return { category: target.name, store: store.name, covered: false, error: error.message }; }
    })));
  }
}
await mkdir('output-live-coverage', { recursive: true });
await writeFile('output-live-coverage/coverage.json', JSON.stringify({ checked_at: new Date().toISOString(), rows, complete: rows.every(r => r.covered) }, null, 2));
console.table(rows.map(({ examples, ...row }) => row));
if (rows.some(r => !r.covered)) throw new Error('Some store/category combinations are missing or unavailable. Inspect the report.');
