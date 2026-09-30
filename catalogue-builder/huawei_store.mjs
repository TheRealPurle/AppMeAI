import { clean, renderPage, saveDiagnostic, stableId } from './store_collector_common.mjs';

export const HUAWEI_QUERIES = ['games','education','fitness','health','finance','productivity','music','photo','video','social','shopping','travel','weather','books','business','food','sports','news','tools','lifestyle'];

const textOnly = value => clean(String(value || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' '), 20000);

export function parseHuaweiCards(html, query, url, limit) {
  const markers = [...html.matchAll(/<div[^>]+class="[^"]*\btem\b[^"]*\btem-l\b[^"]*\btem-big\b[^"]*"[^>]*>/gi)];
  const apps = [];

  for (let index = 0; index < markers.length && apps.length < limit; index++) {
    const start = markers[index].index;
    const end = markers[index + 1]?.index ?? html.length;
    const card = html.slice(start, end);
    const icon = card.match(/<img[^>]+(?:src|data-src)="(https:\/\/appimg-[^"]+)"/i)?.[1];
    const intro = card.match(/<div[^>]+class="[^"]*intro_left[^"]*"[^>]*>([\s\S]*?)<div[^>]+class="[^"]*intro_right/i)?.[1] || card;
    const paragraphs = [...intro.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(match => textOnly(match[1])).filter(Boolean);
    const name = paragraphs[0];
    if (!name || !icon) continue;

    const category = [...intro.matchAll(/<span[^>]*>([^<]{2,100})<\/span>/gi)]
      .map(match => textOnly(match[1])).filter(Boolean).at(-1) || clean(query, 100);
    const description = paragraphs.slice(1).join(' ') || null;
    apps.push({
      store: 5,
      store_app_id: stableId('huawei', name, icon),
      name,
      icon_url: clean(icon.replaceAll('\\/', '/'), 1000),
      developer: null,
      pricing: null,
      price_detail: null,
      rating: null,
      rating_count: null,
      downloads: null,
      description: clean(description, 300),
      category: /fitness|health|sport/i.test(`${query} ${category}`) ? 'Fitness' : category,
      subcategory: category,
      search_keywords: clean(`Huawei AppGallery ${query} ${category} ${name}`, 2000),
      // Huawei's public result cards expose no stable app URL or package id.
      // Keep the exact store search URL so users still land on the official listing page.
      store_url: url,
      origin_country: null,
      market: 'GB',
      source: 'huawei-appgallery-public-web',
      source_updated_at: null
    });
  }
  return apps;
}

export async function getHuaweiApps(query, limit = 20) {
  const url = `https://appgallery.huawei.com/search/${encodeURIComponent(query)}?sharePrepath=ag`;
  const { html } = await renderPage(url, { waitFor: '.tem.tem-l.tem-big' });
  const apps = parseHuaweiCards(html, query, url, limit);
  if (!apps.length) await saveDiagnostic('huawei', query, html);
  return apps;
}
