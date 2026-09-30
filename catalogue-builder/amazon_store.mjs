import { clean, fetchText, stableId } from './store_collector_common.mjs';

export const AMAZON_QUERIES = ['games','kids','education','fitness','health','finance','productivity','music','photo','video','social','shopping','travel','weather','books','business','food','sports','news','utilities'];
export async function getAmazonApps(query, limit = 20) {
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}&i=mobile-apps`;
  const html = await fetchText(url);
  const rows = [...html.matchAll(/data-asin="([A-Z0-9]{10})"[\s\S]{0,12000}?<h2[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]{0,8000}?(?:<img[^>]+src="([^"]+)"|$)/gi)];
  return rows.slice(0, limit).map(m => ({
    store: 4, store_app_id: m[1], name: clean(m[2],191), icon_url: clean(m[3],1000), developer: null,
    pricing: null, price_detail: null, rating: null, rating_count: null, downloads: null, description: null,
    category: /fitness|health/i.test(query) ? 'Fitness' : clean(query,100), subcategory: clean(query,100),
    search_keywords: clean(`Amazon Appstore ${query}`,2000), store_url: `https://www.amazon.com/dp/${m[1]}`,
    origin_country: null, market: 'US', source: 'amazon-appstore-public-web', source_updated_at: null
  })).filter(x => x.name);
}

