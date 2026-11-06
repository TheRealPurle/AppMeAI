import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { coverageFor, classifyForImport } from './category_evidence_v11.mjs';
export { coverageFor } from './category_evidence_v11.mjs';

export const TARGETS = [
  { name: 'Fitness', queries: ['fitness', 'workout', 'running'], xiaomi: ['Health & Fitness', 'Sports'] },
  { name: 'Finance', queries: ['finance', 'budget', 'money manager', 'expense tracker', 'bank'], xiaomi: ['Finance'] },
  { name: 'Travel', queries: ['travel', 'navigation', 'maps', 'hotel'], xiaomi: ['Travel & Local', 'Maps & Navigation'] },
  { name: 'Language', queries: ['language learning', 'translator'], xiaomi: ['Education', 'Books & Reference'] },
  { name: 'Photo & Video', queries: ['photo editor', 'video editor'], xiaomi: ['Photography', 'Video Players & Editors'] },
  { name: 'Sleep', queries: ['sleep', 'sleep tracker'], xiaomi: ['Health & Fitness', 'Lifestyle'] },
  { name: 'Games', queries: ['games', 'puzzle'], xiaomi: ['Games', 'Puzzle', 'Casual', 'Action', 'Strategy'] },
  { name: 'Productivity', queries: ['productivity', 'notes', 'notepad', 'calendar', 'to do'], xiaomi: ['Productivity', 'Tools'] },
  { name: 'AI Tools', queries: ['AI assistant', 'chatbot', 'AI chat', 'AI writer'], xiaomi: ['Productivity', 'Tools', 'Education'] },
  { name: 'Food Recipes', queries: ['recipes', 'cooking', 'cookbook', 'meal planner', 'food'], xiaomi: ['Food & Drink'] },
  { name: 'Meditation', queries: ['meditation', 'mindfulness'], xiaomi: ['Health & Fitness', 'Lifestyle'] },
  { name: 'Music', queries: ['music', 'podcast'], xiaomi: ['Music & Audio'] }
];

export function verifiedStoreLink(url, store) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return store === 5
      ? u.hostname === 'appgallery.huawei.com' && /^\/(?:#\/)?app\/C\d+\/?$/.test(u.pathname + u.hash)
      : u.hostname === 'global.app.mi.com' && ((u.pathname === '/details' && /^[A-Za-z0-9_.-]+$/.test(u.searchParams.get('id') || '')) || /^\/(?:details|detail)\/[A-Za-z0-9_.-]+\/?$/.test(u.pathname));
  } catch { return false; }
}

const clean = (value, limit = 20000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit) || null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function collectCards(page, store, maximum, sourceCategory) {
  const selector = store === 5 ? '.tem.tem-l.tem-big, a[href*="/app/C"]' : '[role="button"][aria-label^="APP Name:"]';
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 20000 });
  const count = Math.min(await page.locator(selector).count(), maximum);
  const results = [];
  for (let index = 0; index < count; index++) {
    try {
    const listUrl = page.url();
    const card = page.locator(selector).nth(index);
    const fields = await card.evaluate((el, store) => {
      const paragraphs = [...el.querySelectorAll('p')].map(p => p.textContent.trim()).filter(Boolean);
      const label = el.getAttribute('aria-label') || '';
      const match = label.match(/^APP Name:(.*?),Developer:(.*)$/s);
      const categories = [...el.querySelectorAll('.intro_left span')].map(s => s.textContent.trim()).filter(Boolean);
      const image = el.querySelector('img');
      return { name: store === 5 ? paragraphs[0] : match?.[1], developer: match?.[2],
        description: store === 5 ? paragraphs.slice(1).join(' ') : null,
        category: store === 5 ? categories.at(-1) : null,
        icon_url: image?.currentSrc || image?.src,
        href: el.querySelector('a[href]')?.href || el.closest('a[href]')?.href };
    }, store);
    if (!fields.name) continue;
    let detailUrl = fields.href;
    if (!verifiedStoreLink(detailUrl, store)) {
      // Store cards may use SPA navigation rather than anchors. Resolve the
      // actual destination; a search/category URL is never an app download URL.
      let popup;
      const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
      try {
        await card.click({ timeout: 10000 });
        popup = await popupPromise;
        if (popup) {
          await popup.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
          detailUrl = popup.url();
        } else {
          await page.waitForURL(url => verifiedStoreLink(url.href, store), { timeout: 10000 });
          detailUrl = page.url();
        }
      } catch { /* Unresolved cards are rejected below. */ }
      finally {
        if (popup) await popup.close();
        if (page.url() !== listUrl) await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.locator(selector).first().waitFor({ state: 'visible', timeout: 20000 });
      }
    }
    if (!verifiedStoreLink(detailUrl, store)) continue;
    // Detail-page metadata provides evidence unavailable on some category cards.
    const detail = await page.context().newPage();
    try {
      const response = await detail.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (response && !response.ok()) continue;
      await detail.locator('body').waitFor({ state: 'visible' });
      await detail.locator(store === 5 ? '[class*="intro"], script[type="application/ld+json"]' : '[class*="app-desc__content"]').first().waitFor({state:'attached',timeout:12000}).catch(() => {});
      const meta = await detail.evaluate(() => ({
        description: document.querySelector('[class*="app-desc__content"], .appIntro, .app-intro, .appIntroduction, .appDesc, .appDetailIntro, .intro_content')?.textContent || document.querySelector('meta[name="description"]')?.content || null,
        category: document.querySelector('[aria-label^="Category:"]')?.getAttribute('aria-label')?.slice(9) || null,
        name: document.querySelector('[class*="app-info__title"]')?.textContent?.trim() || null,
        developer: document.querySelector('[class*="app-info__developer"]')?.textContent?.trim() || null,
        json: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent)
      }));
      const structured = meta.json.flatMap(text => { try { const d = JSON.parse(text); return Array.isArray(d) ? d : [d]; } catch { return []; } });
      const appMeta = structured.find(d => /SoftwareApplication|MobileApplication/.test(String(d['@type'])));
      const description = clean(appMeta?.description || meta.description || fields.description);
      results.push(classifyForImport({
        store, store_app_id: store === 5 ? detailUrl.match(/\bC\d+\b/)?.[0] || createHash('sha256').update(detailUrl).digest('hex').slice(0, 40) : new URL(detailUrl).searchParams.get('id') || decodeURIComponent(new URL(detailUrl).pathname.split('/').filter(Boolean).at(-1)),
        name: clean(appMeta?.name || meta.name || fields.name, 191), developer: clean(meta.developer || (fields.developer === 'undefined' ? null : fields.developer), 191),
        icon_url: clean(fields.icon_url, 1000), category: clean(appMeta?.applicationCategory || meta.category || fields.category || (store === 6 && !sourceCategory.startsWith('search:') ? sourceCategory : null), 100), subcategory: null,
        description,
        search_keywords: null, pricing: null, price_detail: null, rating: null, rating_count: null, downloads: null,
        store_url: detailUrl, origin_country: null, market: store === 5 ? 'GB' : 'ID',
        source: store === 5 ? 'huawei-appgallery-verified-v10' : 'xiaomi-getapps-verified-v10', source_updated_at: null
      }));
    } finally { await detail.close(); }
    } catch (error) {
      console.warn(`Skipped ${store} card ${index + 1}: ${error.message}`);
    }
  }
  return results;
}

export function listingRoute(store, query) {
  if (store === 5) return {url:`https://appgallery.huawei.com/search/${encodeURIComponent(query)}?sharePrepath=ag`, category:false};
  if (query.startsWith('search:')) return {url:`https://global.app.mi.com/search?lo=ID&la=en&q=${encodeURIComponent(query.slice(7))}`,category:false};
  const games = ['Games', 'Puzzle', 'Casual', 'Action', 'Strategy'].includes(query);
  const path = query === 'Games' ? '/games' : games ? '/games/category' : '/category';
  return {url:`https://global.app.mi.com${path}?lo=ID&la=en`, category:query !== 'Games'};
}

export async function main() {
  const key = process.env.COVERAGE_STORE || 'huawei';
  if (!['huawei', 'xiaomi'].includes(key)) throw new Error('COVERAGE_STORE must be huawei or xiaomi');
  const store = key === 'huawei' ? 5 : 6;
  const output = `output-${key}-coverage`;
  await mkdir(output, { recursive: true });
  const maximum = Number(process.env.COVERAGE_APPS_PER_PAGE || 20);
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 40) throw new Error('COVERAGE_APPS_PER_PAGE must be an integer from 1 to 40');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const records = new Map(), failures = [];
  // Reclassify the user's saved official-listing export before refreshing it.
  // This preserves full-description evidence; it is not a new availability check.
  const saved = JSON.parse(await readFile(new URL(`./coverage-seeds/${key}.json`, import.meta.url), 'utf8'));
  for (const raw of saved) {
    if (Number(raw.store) !== store || !verifiedStoreLink(raw.store_url, store)) throw new Error('Invalid saved listing');
    const app = classifyForImport(raw);
    records.set(`${app.store}:${app.store_app_id}`, app);
  }
  try {
    const context = await browser.newContext({ locale: 'en-GB' });
    const page = await context.newPage();
    const requested = store === 5 ? [...new Set(TARGETS.flatMap(t => t.queries))] : [...new Set(TARGETS.flatMap(t => t.xiaomi)), 'search:sleep', 'search:meditation', 'search:mindfulness', 'search:recipes', 'search:AI assistant'];
    for (const query of requested) {
      let lastError;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const route = listingRoute(store, query);
          await page.goto(route.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
          if (store === 6 && route.category) {
            await page.getByRole('button', { name: query, exact: true }).click({ timeout: 15000 });
            await page.waitForURL(/\/categoryList\//, { timeout: 20000 });
          }
          const apps = await collectCards(page, store, maximum, query);
          if (!apps.length) throw new Error('No verified individual app links collected');
          for (const app of apps) records.set(`${app.store}:${app.store_app_id}`, app);
          console.log(`${key} > ${query}: ${apps.length} verified listings`);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          console.warn(`${key} > ${query}, attempt ${attempt}: ${error.message}`);
          if (attempt < 2) await delay(3000);
        }
      }
      if (lastError) {
        const diagnostic = await page.locator('body').innerText({timeout:3000}).catch(() => '');
        failures.push({ query, url:page.url(), error:lastError.message, page_excerpt:diagnostic.slice(0,500) });
      }
      await delay(2500);
    }
  } finally { await browser.close(); }
  const apps = [...records.values()];
  const coverage = coverageFor(apps);
  const report = { generated_at: new Date().toISOString(), store, market: store === 5 ? 'GB' : 'ID', apps: apps.length, coverage, failures,
    complete: coverage.every(c => c.covered), evidence_version:11, saved_export_records:saved.length, note: 'Includes reclassified saved exports and newly collected listings. Coverage is for the 12 main AppMeAI categories, not every subcategory, device or country.' };
  await writeFile(`${output}/appmeai-${key}-coverage.jsonl`, apps.map(a => JSON.stringify(a)).join('\n') + (apps.length ? '\n' : ''));
  await writeFile(`${output}/coverage.json`, JSON.stringify(report, null, 2) + '\n');
  console.table(coverage.map(c => ({ category: c.category, verified: c.count, status: c.covered ? 'covered' : 'MISSING' })));
  if (!apps.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
