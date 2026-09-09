const BASE_URL = 'https://galaxystore.samsung.com';

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function clean(value, max = 20000) {
  const text = value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function decodeXml(value = '') {
  return value
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"').replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

export function parseSamsungLists(xml) {
  const lists = [];
  for (const match of xml.matchAll(/<list(?:\s[^>]*)?>([\s\S]*?)<\/list>/gi)) {
    const item = {};
    for (const value of match[1].matchAll(/<value\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/value>/gi)) {
      item[value[1]] = decodeXml(value[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
    }
    if (Object.keys(item).length) lists.push(item);
  }
  return lists;
}

function protocol(request, { mcc = '450', mnc = '00', csc = 'CPW', odcVersion = '4.5.21.6' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<SamsungProtocol networkType="0" version2="0" lang="EN" openApiVersion="28" deviceModel="SM-G998B" storeFilter="themeDeviceModel=SM-G998B_TM||OTFVersion=8000000||gearDeviceModel=SM-G998B_SM-R800||gOSVersion=4.0.0" mcc="${mcc}" mnc="${mnc}" csc="${csc}" odcVersion="${odcVersion}" version="6.5" filter="1" odcType="01" systemId="1604973510099" sessionId="10a4ee19e202011101104" logId="XXX" userMode="0">
${request}
</SamsungProtocol>`;
}

function categoriesPayload(games) {
  const filter = games
    ? '<param name="upLevelCategoryKeyword">Games</param>'
    : '<param name="gameCateYN">N</param>';
  return protocol(`<request name="normalCategoryList" id="2225" numParam="4" transactionId="10a4ee19e011">
<param name="needKidsCategoryYN">Y</param><param name="imgWidth">135</param><param name="imgHeight">135</param>${filter}
</request>`);
}

function categoryAppsPayload(categoryId, end) {
  return protocol(`<request name="categoryProductList2Notc" id="2030" numParam="10" transactionId="10a4ee19e126">
<param name="imgWidth">135</param><param name="startNum">1</param><param name="imgHeight">135</param>
<param name="alignOrder">bestselling</param><param name="contentType">All</param><param name="endNum">${end}</param>
<param name="categoryName">${categoryId}</param><param name="categoryID">${categoryId}</param>
<param name="srcType">01</param><param name="status">0</param>
</request>`, { mcc: '310', mnc: '03', csc: 'MWD', odcVersion: '9.9.30.9' });
}

async function postOds(id, payload, timeoutMs) {
  const response = await fetch(`${BASE_URL}/storeserver/ods.as?id=${id}`, {
    method: 'POST',
    headers: {
      accept: 'application/xml,text/xml,*/*',
      'content-type': 'application/xml',
      origin: BASE_URL,
      'user-agent': 'AppMeAI-Galaxy-Store-Test/1.0',
      'x-galaxystore-url': 'http://us-odc.samsungapps.com/ods.as'
    },
    body: payload,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Galaxy Store HTTP ${response.status}`);
  if (!text.trim().startsWith('<')) throw new Error('Galaxy Store returned a non-XML response');
  const error = text.match(/<value\s+name=["']errorString["'][^>]*>([\s\S]*?)<\/value>/i)?.[1];
  if (error) throw new Error(`Galaxy Store: ${decodeXml(error)}`);
  const rows = parseSamsungLists(text);
  if (!rows.length) {
    const preview = clean(text.replace(/<[^>]+>/g, ' '), 240) || '<empty XML>';
    throw new Error(`Galaxy Store returned no catalogue rows: ${preview}`);
  }
  return rows;
}

export async function getGalaxyCategories({ games, timeoutMs = 30000 }) {
  const rows = await postOds('normalCategoryList', categoriesPayload(games), timeoutMs);
  return rows.map(row => ({
    id: clean(row.categoryID, 64),
    name: clean(row.categoryName, 100),
    type: games ? 'Games' : 'Apps'
  })).filter(row => row.id && row.name);
}

export async function getGalaxyCategoryApps(category, { limit = 10, timeoutMs = 30000 }) {
  const rows = await postOds('categoryProductList2Notc', categoryAppsPayload(category.id, limit), timeoutMs);
  return rows.map(row => ({ ...row, galaxy_category: category.name, galaxy_type: category.type }));
}

export async function getGalaxyAppDetails(guid, { timeoutMs = 30000 } = {}) {
  const response = await fetch(`${BASE_URL}/api/detail/${encodeURIComponent(guid)}`, {
    headers: { accept: 'application/json', 'user-agent': 'AppMeAI-Galaxy-Store-Test/1.0' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Galaxy detail HTTP ${response.status}`);
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`Galaxy detail returned invalid JSON (HTTP ${response.status})`); }
}

export function normalizeGalaxyApp(summary, detail) {
  const main = detail?.DetailMain || {};
  const guid = clean(detail?.appId || summary.GUID, 191);
  const rawPrice = main.localPrice ?? summary.discountPrice ?? summary.price;
  const priceNumber = Number(String(rawPrice ?? '').replace(/[^0-9.,-]/g, '').replace(',', '.'));
  const imagePath = main.iconURL || main.contentImgURL || main.cnvrnImgUrl;
  const rating = Number(main.ratingNumber ?? summary.averageRating) || null;
  const ratingCount = Number(detail?.commentListTotalCount) || null;
  const modifiedText = clean(main.modifyDate, 32)?.replace(/\.+$/, '').replaceAll('.', '-');
  const modified = modifiedText ? new Date(`${modifiedText}T00:00:00Z`) : null;
  return {
    store: 3,
    store_app_id: guid,
    name: clean(main.contentName || summary.productName, 191),
    icon_url: clean(imagePath ? (imagePath.startsWith('http') ? imagePath : `https://img.samsungapps.com${imagePath}`) : summary.productImgUrl, 1000),
    developer: clean(main.sellerName || summary.sellerName, 191),
    pricing: Number.isFinite(priceNumber) ? (priceNumber === 0 ? 'Free' : 'Paid') : null,
    price_detail: clean(rawPrice, 100),
    rating,
    rating_count: ratingCount,
    downloads: null,
    description: clean(main.contentDescription, 300),
    category: summary.galaxy_type === 'Games' ? 'Games' : (clean(summary.galaxy_category, 100) || 'Other'),
    subcategory: clean(summary.galaxy_category, 100) || 'Other',
    search_keywords: clean(`${summary.galaxy_type || ''} ${summary.galaxy_category || ''}`, 2000),
    store_url: guid ? `${BASE_URL}/detail/${encodeURIComponent(guid)}?cntyCd=DNK` : null,
    origin_country: null,
    market: 'DK',
    source: 'samsung-galaxy-public-test',
    source_updated_at: modified && !Number.isNaN(modified.valueOf()) ? modified.toISOString() : null
  };
}
