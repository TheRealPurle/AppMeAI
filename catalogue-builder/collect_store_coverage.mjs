import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const TARGETS = [
  { name: 'Fitness', queries: ['fitness', 'workout', 'running'], xiaomi: ['Health & Fitness', 'Sports'], terms: /\b(fitness|health|workout|running|yoga|exercise|nutrition|sports)\b/i, reject: /\b(game|games|racing|music|entertainment)\b/i },
  { name: 'Finance', queries: ['finance', 'budget'], xiaomi: ['Finance'], terms: /\b(finance|financial|budget|banking|expense|investing)\b/i },
  { name: 'Travel', queries: ['travel', 'navigation'], xiaomi: ['Travel & Local', 'Maps & Navigation'], terms: /\b(travel|trip|navigation|maps|flight|hotel)\b/i },
  { name: 'Language', queries: ['language learning', 'translator'], xiaomi: ['Education', 'Books & Reference'], terms: /\b(language|languages|translation|translator|dictionary|vocabulary)\b/i },
  { name: 'Photo & Video', queries: ['photo editor', 'video editor'], xiaomi: ['Photography', 'Video Players & Editors'], terms: /\b(photo|photography|camera|video)\b/i },
  { name: 'Sleep', queries: ['sleep', 'sleep tracker'], xiaomi: ['Health & Fitness', 'Lifestyle'], terms: /\b(sleep|bedtime|snore|insomnia)\b/i },
  { name: 'Games', queries: ['games', 'puzzle'], xiaomi: ['Games', 'Puzzle', 'Casual', 'Action', 'Strategy'], terms: /\b(game|games|puzzle|arcade|strategy|casual|action)\b/i },
  { name: 'Productivity', queries: ['productivity', 'notes'], xiaomi: ['Productivity', 'Tools'], terms: /\b(productivity|tasks?|notes|calendar|todo|to.do)\b/i },
  { name: 'AI Tools', queries: ['AI assistant', 'chatbot'], xiaomi: ['Productivity', 'Tools', 'Education'], terms: /\b(ai|artificial intelligence|chatbot)\b/i },
  { name: 'Food Recipes', queries: ['recipes', 'cooking'], xiaomi: ['Food & Drink'], terms: /\b(food|recipes?|cooking|meal)\b/i },
  { name: 'Meditation', queries: ['meditation', 'mindfulness'], xiaomi: ['Health & Fitness', 'Lifestyle'], terms: /\b(meditation|mindfulness|meditate|breathing)\b/i },
  { name: 'Music', queries: ['music', 'podcast'], xiaomi: ['Music & Audio'], terms: /\b(music|podcast|audio|radio)\b/i, reject: /\b(fitness|health|games|game|medical)\b/i }
];

export function coverageFor(apps) {
  return TARGETS.map(target => {
    const matching = apps.filter(app => {
      const classification = `${app.category || ''} ${app.subcategory || ''}`;
      if (target.reject?.test(classification)) return false;
      // Never classify an app from the query used to discover it.
      return target.terms.test(`${app.name || ''} ${classification} ${app.description || ''}`);
    });
    return { category: target.name, count: matching.length, covered: matching.length > 0, examples: matching.slice(0, 3).map(app => app.name) };
  });
}

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

async function collectCards(page, store, maximum, sourceCategory) {
  const selector = store === 5 ? '.tem.tem-l.tem-big' : '[role="button"][aria-label^="APP Name:"]';
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 20000 });
  const count = Math.min(await page.locator(selector).count(), maximum);
  const results = [];
  for (let index = 0; index < count; index++) {
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
      const meta = await detail.evaluate(() => ({
        description: document.querySelector('[class*="app-desc__content"]')?.textContent || document.querySelector('meta[name="description"]')?.content || null,
        category: document.querySelector('[aria-label^="Category:"]')?.getAttribute('aria-label')?.slice(9) || null,
        name: document.querySelector('[class*="app-info__title"]')?.textContent?.trim() || null,
        developer: document.querySelector('[class*="app-info__developer"]')?.textContent?.trim() || null,
        json: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent)
      }));
      const structured = meta.json.flatMap(text => { try { const d = JSON.parse(text); return Array.isArray(d) ? d : [d]; } catch { return []; } });
      const appMeta = structured.find(d => /SoftwareApplication|MobileApplication/.test(String(d['@type'])));
      const description = clean(appMeta?.description || meta.description || fields.description);
      const evidence = `${appMeta?.name || meta.name || fields.name} ${appMeta?.applicationCategory || meta.category || fields.category || ''} ${description || ''}`;
      const observedFeatures = [...new Set(TARGETS.flatMap(t => evidence.match(new RegExp(t.terms.source, 'gi')) || []))].join(' ');
      results.push({
        store, store_app_id: store === 5 ? detailUrl.match(/\bC\d+\b/)?.[0] || createHash('sha256').update(detailUrl).digest('hex').slice(0, 40) : new URL(detailUrl).searchParams.get('id') || decodeURIComponent(new URL(detailUrl).pathname.split('/').filter(Boolean).at(-1)),
        name: clean(appMeta?.name || meta.name || fields.name, 191), developer: clean(meta.developer || (fields.developer === 'undefined' ? null : fields.developer), 191),
        icon_url: clean(fields.icon_url, 1000), category: clean(appMeta?.applicationCategory || meta.category || fields.category || (store === 6 ? sourceCategory : null), 100), subcategory: null,
        description,
        search_keywords: clean(observedFeatures, 2000), pricing: null, price_detail: null, rating: null, rating_count: null, downloads: null,
        store_url: detailUrl, origin_country: null, market: store === 5 ? 'GB' : 'ID',
        source: store === 5 ? 'huawei-appgallery-verified-v10' : 'xiaomi-getapps-verified-v10', source_updated_at: null
      });
    } finally { await detail.close(); }
  }
  return results;
}

export async function main() {
  const key = process.env.COVERAGE_STORE || 'huawei';
  if (!['huawei', 'xiaomi'].includes(key)) throw new Error('COVERAGE_STORE must be huawei or xiaomi');
  const store = key === 'huawei' ? 5 : 6;
  const output = `output-${key}-coverage`;
  await mkdir(output, { recursive: true });
  const maximum = Math.max(1, Math.min(40, Number(process.env.COVERAGE_APPS_PER_PAGE || 20)));
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const records = new Map(), failures = [];
  try {
    const context = await browser.newContext({ locale: 'en-GB' });
    const page = await context.newPage();
    const requested = store === 5 ? [...new Set(TARGETS.flatMap(t => t.queries))] : [...new Set(TARGETS.flatMap(t => t.xiaomi))];
    for (const query of requested) {
      try {
        if (store === 5) {
          await page.goto(`https://appgallery.huawei.com/search/${encodeURIComponent(query)}?sharePrepath=ag`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } else {
          await page.goto('https://global.app.mi.com/category?lo=ID&la=en', { waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.getByRole('tab', { name: 'Category', exact: true }).click();
          await page.getByRole('button', { name: query, exact: true }).click({ timeout: 15000 });
          await page.waitForURL(/\/categoryList\//, { timeout: 20000 });
        }
        const apps = await collectCards(page, store, maximum, query);
        if (!apps.length) throw new Error('No verified individual app links collected');
        for (const app of apps) records.set(`${app.store}:${app.store_app_id}`, app);
        console.log(`${key} > ${query}: ${apps.length} verified listings`);
      } catch (error) {
        failures.push({ query, error: error.message });
        console.warn(`${key} > ${query}: ${error.message}`);
      }
      await delay(2500);
    }
  } finally { await browser.close(); }
  const apps = [...records.values()];
  const coverage = coverageFor(apps);
  const report = { generated_at: new Date().toISOString(), store, market: store === 5 ? 'GB' : 'ID', apps: apps.length, coverage, failures,
    complete: coverage.every(c => c.covered), note: 'Coverage is for the 12 main AppMeAI categories, not every subcategory, device or country.' };
  await writeFile(`${output}/appmeai-${key}-coverage.jsonl`, apps.map(a => JSON.stringify(a)).join('\n') + (apps.length ? '\n' : ''));
  await writeFile(`${output}/coverage.json`, JSON.stringify(report, null, 2) + '\n');
  console.table(coverage.map(c => ({ category: c.category, verified: c.count, status: c.covered ? 'covered' : 'MISSING' })));
  if (!apps.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
