import { clean, fetchText, stableId } from './store_collector_common.mjs';

export const HUAWEI_QUERIES = ['games','education','fitness','health','finance','productivity','music','photo','video','social','shopping','travel','weather','books','business','food','sports','news','tools','lifestyle'];
export async function getHuaweiApps(query, limit = 20) {
  const url = `https://appgallery.huawei.com/search/${encodeURIComponent(query)}?sharePrepath=ag`;
  const html = await fetchText(url);
  const rows = [...html.matchAll(/(?:appid|appId)["'=:\s]+([A-Za-z0-9._-]{5,})[\s\S]{0,3000}?(?:name|appName)["'=:\s]+([^"'<>{]{2,191})[\s\S]{0,4000}?(https?:\\?\/\\?\/[^"'<> ]+(?:png|jpg|webp))/gi)];
  return rows.slice(0,limit).map(m => {
    const id=clean(m[1],191), name=clean(m[2],191);
    return { store:5, store_app_id:id || stableId('huawei',name), name, icon_url:clean(m[3].replaceAll('\\/','/'),1000), developer:null, pricing:null, price_detail:null, rating:null, rating_count:null, downloads:null, description:null, category:/fitness|health/i.test(query)?'Fitness':clean(query,100), subcategory:clean(query,100), search_keywords:clean(`Huawei AppGallery ${query}`,2000), store_url:id?`https://appgallery.huawei.com/app/${encodeURIComponent(id)}`:url, origin_country:null, market:'GB', source:'huawei-appgallery-public-web', source_updated_at:null };
  }).filter(x=>x.name && x.store_app_id);
}

