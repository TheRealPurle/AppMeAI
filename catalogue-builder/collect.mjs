import { createGzip } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const MARKET = (process.env.MARKET || 'DK').toUpperCase();
const LANGUAGE = (process.env.LANGUAGE || 'en').toLowerCase();
const LIMIT = clamp(Number(process.env.RESULTS_PER_QUERY || 20), 5, 50);
const QUERY_START = Math.max(0, Number(process.env.QUERY_START || 0));
const QUERY_LIMIT = Math.max(1, Number(process.env.QUERY_LIMIT || 10000));
const STORES = new Set((process.env.COLLECT_STORES || 'apple,google').split(',').map(x => x.trim().toLowerCase()));
const IMPORT_AFTER_COLLECT = process.env.IMPORT_AFTER_COLLECT === 'true';
const OUT = process.env.OUTPUT_DIR || 'output';
const APPLE_DELAY_MS = clamp(Number(process.env.APPLE_DELAY_MS || 3200), 3000, 30000);
const GOOGLE_DELAY_MS = clamp(Number(process.env.GOOGLE_DELAY_MS || 1500), 1000, 30000);

const queries = JSON.parse(await readFile(new URL('./categories.json', import.meta.url), 'utf8'))
  .slice(QUERY_START, QUERY_START + QUERY_LIMIT);
await mkdir(OUT, { recursive: true });

const records = new Map();
const failures = [];

function clamp(value, min, max) { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clean(value, max = 20000) {
  const text = value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}
function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
function positiveNumeric(value) {
  const number = numeric(value);
  return number > 0 ? number : null;
}
function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}
function pricing(free, price) {
  if (free === true || Number(price) === 0) return 'Free';
  if (Number(price) > 0) return 'Paid';
  return null;
}
function add(record, query) {
  if (!record.store_app_id || !record.name) return;
  const key = `${record.store}:${record.store_app_id}`;
  const existing = records.get(key);
  if (!existing) {
    records.set(key, { ...record, _matches: [query] });
    return;
  }
  const matchKey = `${query.category}|${query.subcategory}|${query.term}`;
  if (!existing._matches.some(x => `${x.category}|${x.subcategory}|${x.term}` === matchKey)) {
    existing._matches.push(query);
  }
  for (const [field, value] of Object.entries(record)) {
    if (field !== '_matches' && (existing[field] == null || existing[field] === '') && value != null) existing[field] = value;
  }
}
function finalize(record) {
  const primary = record._matches[0];
  const keywords = [...new Set(record._matches.flatMap(x => [x.category, x.subcategory, x.term]))].join(' ');
  const { _matches, store_genre, ...app } = record;
  return { ...app, category: primary.category, subcategory: primary.subcategory, search_keywords: keywords.slice(0, 2000) };
}
function relevant(record) {
  const primary = record._matches[0];
  const genre = String(record.store_genre || '').toLowerCase();
  if (primary.category !== 'Games' && (genre === 'games' || genre.startsWith('game'))) return false;
  return true;
}

async function collectApple(query) {
  const params = new URLSearchParams({
    term: `${query.term} app`, country: MARKET, media: 'software', entity: 'software', limit: String(LIMIT), lang: 'en_us'
  });
  const response = await fetch(`https://itunes.apple.com/search?${params}`, {
    headers: { accept: 'application/json', 'user-agent': 'AppMeAI-Catalogue/1.0' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Apple HTTP ${response.status}`);
  const data = await response.json();
  for (const item of (data.results || [])) {
    add({
      store: 1,
      store_app_id: clean(item.trackId, 191),
      name: clean(item.trackName, 191),
      icon_url: clean(item.artworkUrl512 || item.artworkUrl100, 1000),
      developer: clean(item.artistName, 191),
      pricing: pricing(Number(item.price) === 0, item.price),
      price_detail: clean(item.formattedPrice, 100),
      rating: positiveNumeric(item.averageUserRating),
      rating_count: positiveNumeric(item.userRatingCount),
      downloads: null,
      description: clean(item.description, 300),
      store_genre: clean(item.primaryGenreName, 100),
      store_url: clean(item.trackViewUrl, 1000),
      origin_country: null,
      market: MARKET,
      source: 'apple-search-api',
      source_updated_at: isoDate(item.currentVersionReleaseDate || item.releaseDate)
    }, query);
  }
  return (data.results || []).length;
}

let googleClient;
async function getGoogleClient() {
  if (googleClient) return googleClient;
  const { createClient } = await import('@mradex77/google-play-scraper');
  googleClient = createClient({ country: MARKET.toLowerCase(), lang: LANGUAGE, throttle: 1 });
  return googleClient;
}
async function collectGoogle(query) {
  const client = await getGoogleClient();
  const items = await client.search({ term: `${query.term} app`, num: LIMIT, fullDetail: false });
  for (const item of items) {
    add({
      store: 2,
      store_app_id: clean(item.appId, 191),
      name: clean(item.title, 191),
      icon_url: clean(item.icon, 1000),
      developer: clean(item.developer, 191),
      pricing: pricing(item.free, item.price),
      price_detail: clean(item.priceText || item.price, 100),
      rating: numeric(item.score),
      rating_count: numeric(item.ratings),
      downloads: clean(item.installs, 64),
      description: clean(item.summary || item.description, 300),
      store_genre: clean(item.genre, 100),
      store_url: clean(item.url, 1000) || `https://play.google.com/store/apps/details?id=${encodeURIComponent(item.appId)}`,
      origin_country: null,
      market: MARKET,
      source: 'google-play-public',
      source_updated_at: isoDate(item.updated)
    }, query);
  }
  return items.length;
}

async function save() {
  const apps = [...records.values()].filter(relevant).map(finalize).sort((a, b) => a.store - b.store || a.name.localeCompare(b.name));
  const jsonl = apps.map(app => JSON.stringify(app)).join('\n') + (apps.length ? '\n' : '');
  await writeFile(`${OUT}/appmeai-catalogue.jsonl`, jsonl);
  await pipeline(Readable.from([jsonl]), createGzip({ level: 9 }), createWriteStream(`${OUT}/appmeai-catalogue.jsonl.gz`));
  await writeFile(`${OUT}/summary.json`, JSON.stringify({
    generated_at: new Date().toISOString(), market: MARKET, queries: queries.length,
    apps: apps.length, apple: apps.filter(x => x.store === 1).length,
    google: apps.filter(x => x.store === 2).length, failures
  }, null, 2) + '\n');
  return apps;
}

async function enrichGoogle() {
  const client = await getGoogleClient();
  const googleRecords = [...records.entries()].filter(([, app]) => app.store === 2);
  console.log(`Enriching ${googleRecords.length} Google apps with full details.`);
  for (let offset = 0; offset < googleRecords.length; offset += 250) {
    const batch = googleRecords.slice(offset, offset + 250);
    const result = await client.apps({ appIds: batch.map(([, app]) => app.store_app_id), concurrency: 5 });
    for (let index = 0; index < result.length; index++) {
      const entry = result[index];
      if (entry.status !== 'fulfilled') {
        failures.push(`Google detail ${entry.appId}: ${entry.error?.message || entry.error?.name || 'failed'}`);
        continue;
      }
      const target = batch[index][1];
      const item = entry.app;
      Object.assign(target, {
        name: clean(item.title, 191) || target.name,
        icon_url: clean(item.icon, 1000) || target.icon_url,
        developer: clean(item.developer, 191) || target.developer,
        pricing: pricing(item.free, item.price) || target.pricing,
        price_detail: clean(item.priceText, 100) || target.price_detail,
        rating: positiveNumeric(item.score),
        rating_count: positiveNumeric(item.ratings),
        downloads: clean(item.installs, 64),
        description: clean(item.description || item.summary, 300) || target.description,
        store_genre: clean(item.genre, 100) || target.store_genre,
        store_url: clean(item.url, 1000) || target.store_url,
        source_updated_at: isoDate(item.updated) || target.source_updated_at
      });
    }
    console.log(`Google details: ${Math.min(offset + 250, googleRecords.length)}/${googleRecords.length}`);
    await save();
  }
}

for (let index = 0; index < queries.length; index++) {
  const query = queries[index];
  const label = `[${QUERY_START + index + 1}/${QUERY_START + queries.length}] ${query.category} > ${query.subcategory} > ${query.term}`;
  if (STORES.has('apple')) {
    try { console.log(`${label}: Apple ${await collectApple(query)}`); }
    catch (error) { failures.push(`${label}: ${error.message}`); console.error(failures.at(-1)); }
    await sleep(APPLE_DELAY_MS);
  }
  if (STORES.has('google')) {
    try { console.log(`${label}: Google ${await collectGoogle(query)}`); }
    catch (error) { failures.push(`${label}: ${error.message}`); console.error(failures.at(-1)); }
    await sleep(GOOGLE_DELAY_MS);
  }
  if ((index + 1) % 20 === 0) await save();
}

if (STORES.has('google')) await enrichGoogle();
const apps = await save();
console.log(`Finished with ${apps.length} unique apps and ${failures.length} failed searches.`);

if (IMPORT_AFTER_COLLECT && apps.length) {
  const { importApps } = await import('./import_catalogue.mjs');
  await importApps(apps);
}
