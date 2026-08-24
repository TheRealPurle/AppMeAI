// AppMeUp database refresh — one execution, then exit.
// Recommended Render Cron schedule: 0 * * * * (UTC). The script itself runs
// only at 08:00, 11:00, 14:00 and 17:00 Copenhagen time (DST-safe).
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const REQUIRED = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const missing = REQUIRED.filter(name => !process.env[name]);
if (missing.length) { console.error(`Missing environment variables: ${missing.join(', ')}`); process.exit(1); }

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const FORCE_REFRESH = process.env.FORCE_REFRESH === 'true';
const TARGET_HOURS = new Set([8, 11, 14, 17]);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const CATEGORIES = [
  'productivity apps', 'fitness and health apps', 'finance and budgeting apps',
  'meditation and mindfulness apps', 'language learning apps', 'music apps',
  'travel apps', 'food and recipe apps', 'education apps', 'AI assistant apps',
  'photo editing apps', 'sleep tracking apps', 'games', 'social apps', 'utilities'
];

function copenhagenParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.map(p => [p.type, p.value]));
}
function categoryForRun(parts) {
  const day = Math.floor(Date.UTC(+parts.year, +parts.month - 1, +parts.day) / 86400000);
  const slot = [8, 11, 14, 17].indexOf(+parts.hour);
  return CATEGORIES[(day * 4 + Math.max(slot, 0)) % CATEGORIES.length];
}
function anthropicRequest(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({ hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', headers: {
      'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01', 'content-length': Buffer.byteLength(payload)
    }}, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { return reject(new Error(`Anthropic returned invalid JSON (HTTP ${res.statusCode})`)); }
        if (res.statusCode < 200 || res.statusCode >= 300 || parsed.error) {
          return reject(new Error(parsed.error?.message || `Anthropic HTTP ${res.statusCode}`));
        }
        resolve(parsed);
      });
    });
    req.setTimeout(120000, () => req.destroy(new Error('Anthropic request timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}
function extractJsonArray(response) {
  const text = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  const match = text.replace(/```(?:json)?/gi, '').match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Anthropic response did not contain a JSON array');
  const value = JSON.parse(match[0]);
  if (!Array.isArray(value) || !value.length) throw new Error('Anthropic returned an empty or invalid app list');
  return value;
}
function estimateApiCost(response) {
  const input = Number(response.usage?.input_tokens || 0);
  const output = Number(response.usage?.output_tokens || 0);
  const searches = Number(response.usage?.server_tool_use?.web_search_requests || 0);
  return input * 3 / 1e6 + output * 15 / 1e6 + searches * 0.01;
}
async function writeLog(values) {
  const { error } = await supabase.from('refresh_log').insert(values);
  if (error) console.error('Could not write refresh_log:', error.message);
}
async function runRefresh(category) {
  const started = new Date().toISOString();
  try {
    const response = await anthropicRequest({
      model: MODEL, max_tokens: 2200,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
      messages: [{ role: 'user', content:
        `Find 8 popular, currently available ${category} on Google Play and/or the Apple App Store. ` +
        `Return only a JSON array. Each object must contain name, icon (one emoji), category, stores (array), ` +
        `pricing (Free, Paid, or Freemium), price_detail, rating (number 1-5), rating_count, downloads, ` +
        `description (one factual sentence), alternatives (array of two names), and a real store url.` }]
    });
    const apps = extractJsonArray(response);
    const rows = apps.filter(a => a && a.name).map(a => ({
      name: String(a.name).trim(), icon: a.icon || '📱', category: a.category || category,
      stores: Array.isArray(a.stores) ? a.stores : ['Google Play', 'App Store'],
      pricing: ['Free', 'Paid', 'Freemium'].includes(a.pricing) ? a.pricing : 'Free',
      price_detail: a.price_detail || '', rating: String(Math.min(5, Math.max(1, Number(a.rating) || 4))),
      rating_count: a.rating_count || '', downloads: a.downloads || '', description: a.description || '',
      alternatives: Array.isArray(a.alternatives) ? a.alternatives : [], url: a.url || '',
      is_removed: false, last_seen: started, updated_at: started
    }));
    const names = rows.map(r => r.name);
    const { data: existing, error: lookupError } = await supabase.from('apps').select('name').in('name', names);
    if (lookupError) throw lookupError;
    const existingNames = new Set((existing || []).map(r => r.name));
    const added = rows.filter(r => !existingNames.has(r.name)).length;
    const { error: upsertError } = await supabase.from('apps').upsert(rows, { onConflict: 'name' });
    if (upsertError) throw upsertError;
    const staleBefore = new Date(Date.now() - 45 * 86400000).toISOString();
    const { data: removedRows, error: removeError } = await supabase.from('apps')
      .update({ is_removed: true, updated_at: started }).eq('is_removed', false)
      .lt('last_seen', staleBefore).select('id');
    if (removeError) throw removeError;
    const cost = estimateApiCost(response);
    await writeLog({ query_type: category, apps_added: added, apps_removed: removedRows?.length || 0, api_cost_usd: cost });
    console.log(`Updated ${rows.length} apps (${added} new); estimated API cost $${cost.toFixed(4)}.`);
  } catch (error) {
    console.error('Refresh failed:', error.message);
    await writeLog({ query_type: category, error: error.message.slice(0, 1000) });
    process.exitCode = 1;
  }
}
(async () => {
  const parts = copenhagenParts();
  const hour = +parts.hour;
  if (!FORCE_REFRESH && !TARGET_HOURS.has(hour)) {
    console.log(`No refresh scheduled at ${String(hour).padStart(2, '0')}:00 Copenhagen time.`);
    return;
  }
  const category = categoryForRun(parts);
  console.log(`Starting ${category} refresh at ${new Date().toISOString()}.`);
  await runRefresh(category);
})();
