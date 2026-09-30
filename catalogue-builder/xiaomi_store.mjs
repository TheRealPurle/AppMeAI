import { clean, fetchText, stableId } from './store_collector_common.mjs';

export const XIAOMI_CATEGORIES = [
  ['1','Communication'],['2','Social'],['3','Entertainment'],['4','Tools'],['5','Art & Design'],['6','Auto & Vehicles'],
  ['7','Beauty'],['8','Books & Reference'],['9','Business'],['10','Comics'],['11','Dating'],['12','Education'],['13','Events'],
  ['14','Finance'],['15','Health & Fitness'],['16','House & Home'],['17','Libraries & Demo'],['18','Lifestyle'],
  ['19','Maps & Navigation'],['20','Medical'],['21','Music & Audio'],['22','News & Magazines'],['23','Parenting'],
  ['24','Personalization'],['25','Photography'],['26','Productivity'],['27','Shopping'],['28','Sports'],['29','Travel & Local'],
  ['30','Video Players & Editors'],['31','Weather'],['32','Games']
].map(([id,name]) => ({ id, name }));

export async function getXiaomiCategoryApps(category, limit = 25) {
  const storeUrl = `https://global.app.mi.com/categoryList/${category.id}?lo=ID&la=en`;
  const html = await fetchText(storeUrl);
  const cards = [...html.matchAll(/aria-label="APP Name:(.*?),Developer:(.*?)"[\s\S]{0,900}?<img[^>]+src="([^"]+)"/gi)];
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
