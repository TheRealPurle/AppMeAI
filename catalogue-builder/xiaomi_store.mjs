import { chromium } from 'playwright';
import { clean, renderPage, saveDiagnostic, stableId } from './store_collector_common.mjs';

export const XIAOMI_CATEGORIES = ['Communication','Social','Entertainment','Tools','Art & Design','Auto & Vehicles','Beauty','Books & Reference','Business','Comics','Dating','Education','Events','Finance','Food & Drink','Health & Fitness','House & Home','Libraries & Demo','Lifestyle','Maps & Navigation','Medical','Music & Audio','News & Magazines','Parenting','Personalization','Photography','Productivity','Shopping','Sports','Travel & Local','Video Players & Editors','Weather'].map(name => ({ name }));

export async function resolveXiaomiCategories(categories) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ locale: 'en-GB' });
    const page = await context.newPage();
    const resolved = [];
    for (const category of categories) {
      await page.goto('https://global.app.mi.com/category?lo=ID&la=en', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.getByRole('tab', { name: 'Category' }).click();
      const button = page.getByRole('button', { name: category.name, exact: true });
      await button.waitFor({ state: 'visible', timeout: 20000 });
      await button.click();
      await page.waitForURL(/\/categoryList\/[^/?]+/, { timeout: 30000 });
      const match = page.url().match(/\/categoryList\/([^/?]+)/);
      if (!match) throw new Error(`category route not found for ${category.name}`);
      resolved.push({ ...category, id: decodeURIComponent(match[1]) });
    }
    return resolved;
  } finally {
    await browser.close();
  }
}

export async function getXiaomiCategoryApps(category, limit = 25) {
  const storeUrl = `https://global.app.mi.com/categoryList/${category.id}?lo=ID&la=en`;
  const { html } = await renderPage(storeUrl, { waitFor: '[role="button"][aria-label^="APP Name:"]' });
  const cards = [...html.matchAll(/aria-label="APP Name:(.*?),Developer:(.*?)"[\s\S]{0,900}?<img[^>]+src="([^"]+)"/gi)];
  if (!cards.length) await saveDiagnostic('xiaomi', category.name, html);
  return cards.slice(0, limit).map(match => {
    const name = clean(match[1], 191);
    const developer = clean(match[2] === 'undefined' ? null : match[2], 191);
    const id = stableId('xiaomi', name, developer);
    return {
      store: 6, store_app_id: id, name, icon_url: clean(match[3], 1000), developer,
      pricing: null, price_detail: null, rating: null, rating_count: null, downloads: null,
      description: null, category: /health|medical|fitness/i.test(category.name) ? 'Fitness' : category.name,
      subcategory: category.name, search_keywords: clean(`Xiaomi GetApps ${category.name}`, 2000),
      store_url: storeUrl, origin_country: null, market: 'ID', source: 'xiaomi-getapps-public-web', source_updated_at: null
    };
  });
}
