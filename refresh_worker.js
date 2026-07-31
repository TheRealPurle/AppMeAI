// ============================================================
// AppMeUp — Hourly refresh worker
// Runs 3 Claude searches per hour → upserts results to Supabase
// Cost: 4 searches/day × $0.02 = ~$0.08/day (~$2.40/month)
//
// HOW TO RUN:
//   1. npm install @supabase/supabase-js node-cron
//   2. Fill in your keys below (or use environment variables)
//   3. node refresh_worker.js
//   4. Deploy to Render.com free tier or any $5 VPS — runs 24/7
// ============================================================

const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

// ── Config — replace with your real keys ──────────────────────
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY  || 'sk-ant-YOUR_KEY_HERE';
const SUPABASE_URL        = process.env.SUPABASE_URL       || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'YOUR_SERVICE_ROLE_KEY';
// ──────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// The 5 stores AppMeUp covers
const STORES = ['Google Play', 'App Store', 'Galaxy Store', 'Amazon Appstore', 'Huawei AppGallery'];

// Rotate through categories so each hour focuses on something different
const CATEGORIES = [
  'productivity', 'fitness & health', 'finance & budgeting',
  'photo & video editing', 'meditation & mindfulness', 'language learning',
  'music & audio', 'travel & navigation', 'food & recipes',
  'education & learning', 'social & communication', 'games & entertainment',
  'utilities & tools', 'news & reading', 'shopping',
  'sleep tracking', 'habit tracking', 'AI assistant apps',
  'dating & relationships', 'parenting & family'
];

let categoryIndex = 0;

// ── Build prompt for Claude ────────────────────────────────────
function buildPrompt(queryType) {
  const storeList = STORES.join(', ');
  const category = CATEGORIES[categoryIndex % CATEGORIES.length];

  const prompts = {
    new: `You are a mobile app researcher. Search the web for the NEWEST mobile apps released in the last 7 days across these stores: ${storeList}.
Focus on apps that are brand new, just launched, or recently updated with major changes.
Return ONLY a valid JSON array of up to 8 apps. No markdown, no code fences, no preamble.
Each object: name (string), icon (single emoji), category (string), stores (array from ["Google Play","App Store","Galaxy Store","Amazon Appstore","Huawei AppGallery"]), pricing ("Free"/"Paid"/"Freemium"), price_detail (string), rating (string like "4.2"), description (2 sentences), alternatives (array of 2 names), url (real store link or "").`,

    popular: `You are a mobile app researcher. Search for the most popular and highly rated mobile apps right now in the category: "${category}" across these stores: ${storeList}.
Focus on apps with high download counts, good reviews, and active user bases.
Return ONLY a valid JSON array of up to 8 apps. No markdown, no code fences, no preamble.
Each object: name (string), icon (single emoji), category (string), stores (array from ["Google Play","App Store","Galaxy Store","Amazon Appstore","Huawei AppGallery"]), pricing ("Free"/"Paid"/"Freemium"), price_detail (string), rating (string like "4.2"), description (2 sentences), alternatives (array of 2 names), url (real store link or "").`,

    trending: `You are a mobile app researcher. Search for trending or viral mobile apps this week across these stores: ${storeList}.
Look for apps gaining rapid downloads, featured by stores, or going viral on social media.
Return ONLY a valid JSON array of up to 8 apps. No markdown, no code fences, no preamble.
Each object: name (string), icon (single emoji), category (string), stores (array from ["Google Play","App Store","Galaxy Store","Amazon Appstore","Huawei AppGallery"]), pricing ("Free"/"Paid"/"Freemium"), price_detail (string), rating (string like "4.2"), description (2 sentences), alternatives (array of 2 names), url (real store link or "").`
  };

  return prompts[queryType];
}

// ── Call Claude API ────────────────────────────────────────────
async function callClaude(queryType) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: buildPrompt(queryType) }]
    })
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const text = (data.content || []).map(b => b.type === 'text' ? b.text : '').join('').trim();
  const clean = text.replace(/```json|```/g, '').trim();
  const match = clean.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array in Claude response');
  return JSON.parse(match[0]);
}

// ── Upsert apps into Supabase ──────────────────────────────────
async function upsertApps(apps) {
  let added = 0;
  for (const app of apps) {
    const { error } = await supabase.rpc('upsert_app', { app });
    if (error) {
      console.error(`  Failed to upsert "${app.name}":`, error.message);
    } else {
      added++;
    }
  }
  return added;
}

// ── Mark stale apps as removed ─────────────────────────────────
async function markStaleApps() {
  // Apps not seen in 30 days are soft-deleted
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('apps')
    .update({ is_removed: true })
    .lt('last_seen', thirtyDaysAgo)
    .eq('is_removed', false)
    .select('id');

  if (error) {
    console.error('  Failed to mark stale apps:', error.message);
    return 0;
  }
  return data?.length || 0;
}

// ── Log the refresh run ────────────────────────────────────────
async function logRun(queryType, added, removed, costUsd, errorMsg = null) {
  await supabase.from('refresh_log').insert({
    query_type: queryType,
    apps_added: added,
    apps_removed: removed,
    api_cost_usd: costUsd,
    error: errorMsg
  });
}

// ── Main refresh function ──────────────────────────────────────
async function runRefresh() {
  const now = new Date().toISOString();
  console.log(`\n[${now}] Starting hourly refresh...`);

  // Rotate through query types — 1 per hour = 24/day total
  const queryTypes = ['new', 'popular', 'trending'];
  const queryType = queryTypes[categoryIndex % queryTypes.length];
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const queryType of [queryType]) {
    console.log(`  Running "${queryType}" query (category: ${CATEGORIES[categoryIndex % CATEGORIES.length]})...`);
    try {
      const apps = await callClaude(queryType);
      console.log(`    Claude returned ${apps.length} apps`);
      const added = await upsertApps(apps);
      totalAdded += added;
      console.log(`    Upserted ${added} apps to Supabase`);
      await logRun(queryType, added, 0, 0.02);
    } catch (err) {
      console.error(`    ERROR on "${queryType}":`, err.message);
      await logRun(queryType, 0, 0, 0, err.message);
    }

    // Small delay between Claude calls to be polite to the API
    await new Promise(r => setTimeout(r, 3000));
  }

  // Check for stale apps once per run
  const removed = await markStaleApps();
  if (removed > 0) {
    console.log(`  Marked ${removed} stale apps as removed`);
    totalRemoved += removed;
  }

  // Rotate category for next hour
  categoryIndex++;

  // Get current DB stats
  const { count } = await supabase.from('apps').select('*', { count: 'exact', head: true }).eq('is_removed', false);

  console.log(`  Done. +${totalAdded} added, -${totalRemoved} removed. Total in DB: ${count || '?'}`);
  console.log(`  Estimated cost this run: ~$0.02`);
}

// ── Schedule: run every hour on the hour ──────────────────────
cron.schedule('0 * * * *', runRefresh);

// ── Also run immediately on startup ───────────────────────────
console.log('AppMeUp refresh worker started.');
console.log('Scheduled to run at 08:00, 11:00, 14:00 and 17:00 Copenhagen time.');
console.log('Cost: 4 searches/day × $0.02 = ~$0.08/day (~$2.40/month)');
runRefresh();
