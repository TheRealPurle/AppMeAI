import { clean, renderPage, saveDiagnostic } from './store_collector_common.mjs';

export const AMAZON_QUERIES = ['games','kids','education','fitness','health','finance','productivity','music','photo','video','social','shopping','travel','weather','books','business','food','sports','news','utilities'];

const textOnly = value => clean(String(value || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' '), 20000);

const INVALID_NAMES = [
  /^\$\s?\d/i,
  /^price(?:,|\s|$)/i,
  /^best seller$/i,
  /^amazon'?s choice$/i,
  /^sponsored$/i,
  /^\d(?:\.\d)? out of 5 stars$/i,
  /^\d+(?:,\d+)* ratings?$/i
];

function isValidAppName(name) {
  if (!name || name.length < 2 || name.length > 191) return false;
  return !INVALID_NAMES.some(pattern => pattern.test(name));
}

export function parseAmazonCards(html, query, limit = 20) {
  const markers = [...html.matchAll(/data-asin="([A-Z0-9]{10})"/gi)];
  const apps = [];

  for (let index = 0; index < markers.length && apps.length < limit; index++) {
    const asin = markers[index][1].toUpperCase();
    // App ASINs begin with B. Numeric ISBNs occasionally leak into Amazon's
    // mobile-app search results and must not enter the AppMeAI catalogue.
    if (!asin.startsWith('B')) continue;

    const start = markers[index].index;
    const end = markers[index + 1]?.index ?? html.length;
    const card = html.slice(start, end);
    const heading = card.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
    const name = textOnly(heading);
    if (!isValidAppName(name)) continue;

    const images = [...card.matchAll(/<img[^>]+(?:src|data-src)="([^"]+)"/gi)].map(match => match[1].replaceAll('\\/', '/'));
    const icon = images.find(url => /^https:\/\/m\.media-amazon\.com\/images\//i.test(url));
    if (!icon) continue;

    apps.push({
      store: 4,
      store_app_id: asin,
      name: clean(name, 191),
      icon_url: clean(icon, 1000),
      developer: null,
      pricing: null,
      price_detail: null,
      rating: null,
      rating_count: null,
      downloads: null,
      description: null,
      category: /fitness|health/i.test(query) ? 'Fitness' : clean(query, 100),
      subcategory: clean(query, 100),
      search_keywords: clean(`Amazon Appstore ${query} ${name}`, 2000),
      store_url: `https://www.amazon.com/dp/${asin}`,
      origin_country: null,
      market: 'US',
      source: 'amazon-appstore-public-web',
      source_updated_at: null
    });
  }
  return apps;
}

export async function getAmazonApps(query, limit = 20) {
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}&i=mobile-apps`;
  const { html } = await renderPage(url, { waitFor: '[data-asin]' });
  const apps = parseAmazonCards(html, query, limit);
  if (!apps.length) await saveDiagnostic('amazon', query, html);
  return apps;
}
