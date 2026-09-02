// AppMeAI catalogue worker.
// Imports Apple Marketing Tools chart feeds without using an AI model.

const API_URL = (process.env.APPMEAI_API_URL || '').replace(/\/$/, '');
const IMPORT_TOKEN = process.env.APPMEAI_IMPORT_TOKEN || '';
const FORCE_SEED = process.env.SEED_MODE === 'true';
const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 200;

const MARKETS = [
  'us', 'ca', 'gb', 'ie', 'au', 'nz', 'cn', 'kr',
  'dk', 'se', 'no', 'fi', 'de', 'fr', 'es', 'it',
  'nl', 'be', 'at', 'ch', 'pl', 'pt'
];
const CHARTS = ['top-free', 'top-paid'];

if (!DRY_RUN && (!API_URL || !IMPORT_TOKEN)) {
  console.error('Missing APPMEAI_API_URL or APPMEAI_IMPORT_TOKEN.');
  process.exit(1);
}

function marketsForRun(now = new Date()) {
  if (FORCE_SEED) return MARKETS;
  const slot = Math.floor(now.getUTCHours() / 6) % 4;
  return MARKETS.filter((_, index) => index % 4 === slot);
}

function feedUrl(market, chart) {
  return `https://rss.marketingtools.apple.com/api/v2/${market}/apps/${chart}/100/apps.json`;
}

async function fetchFeed(market, chart) {
  const response = await fetch(feedUrl(market, chart), {
    headers: { 'accept': 'application/json', 'user-agent': 'AppMeAI-Catalogue/1.0' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Apple feed ${market}/${chart} returned HTTP ${response.status}`);
  const body = await response.json();
  const results = body?.feed?.results;
  if (!Array.isArray(results)) throw new Error(`Apple feed ${market}/${chart} returned an invalid body`);
  return results.map(app => ({
    store: 1,
    store_app_id: String(app.id || ''),
    name: String(app.name || '').trim(),
    icon_url: String(app.artworkUrl100 || ''),
    market: market.toUpperCase()
  })).filter(app => app.store_app_id && app.name);
}

async function postBatch(apps) {
  const response = await fetch(`${API_URL}/import.php`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${IMPORT_TOKEN}`,
      'content-type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify({ apps }),
    signal: AbortSignal.timeout(60000)
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`Import API returned non-JSON (HTTP ${response.status})`); }
  if (!response.ok || !body.ok) throw new Error(body.error || `Import API returned HTTP ${response.status}`);
  return body;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function main() {
  const markets = marketsForRun();
  const observations = [];
  const failures = [];

  const feedTasks = markets.flatMap(market => CHARTS.map(chart => ({ market, chart })));
  const feedResults = await mapWithConcurrency(feedTasks, 4, async ({ market, chart }) => {
      try {
        const apps = await fetchFeed(market, chart);
        console.log(`${market}/${chart}: ${apps.length} apps`);
        return apps;
      } catch (error) {
        failures.push(`${market}/${chart}: ${error.message}`);
        console.error(failures[failures.length - 1]);
        return [];
      }
  });
  observations.push(...feedResults.flat());

  const unique = [...new Map(observations.map(app => [`${app.store}:${app.store_app_id}:${app.market}`, app])).values()];
  const uniqueAppCount = new Set(unique.map(app => `${app.store}:${app.store_app_id}`)).size;
  console.log(`Collected ${unique.length} unique app/market observations covering ${uniqueAppCount} distinct apps across ${markets.length} markets.`);

  if (DRY_RUN) {
    console.log('DRY_RUN enabled; nothing was written.');
    if (!unique.length) process.exitCode = 1;
    return;
  }

  let accepted = 0;
  let rejected = 0;
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const result = await postBatch(unique.slice(i, i + BATCH_SIZE));
    accepted += Number(result.accepted || 0);
    rejected += Number(result.rejected || 0);
    console.log(`Imported batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.accepted} accepted, ${result.rejected} rejected`);
  }
  console.log(`Finished: ${accepted} accepted, ${rejected} rejected, ${failures.length} feed failures.`);
  if (!accepted) process.exitCode = 1;
}

main().catch(error => {
  console.error('Catalogue refresh failed:', error.message);
  process.exitCode = 1;
});
