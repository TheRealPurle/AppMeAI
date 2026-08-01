const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const ANTHROPIC_API_KEY    = process.env.ANTHROPIC_API_KEY    || '';
const SUPABASE_URL         = process.env.SUPABASE_URL         || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: Missing environment variables.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CATEGORIES = [
  'productivity apps', 'fitness & health apps', 'finance & budgeting apps',
  'meditation & mindfulness apps', 'language learning apps', 'music apps',
  'travel apps', 'food & recipe apps', 'education apps', 'AI assistant apps',
  'photo editing apps', 'sleep tracking apps', 'games', 'social apps', 'utilities'
];

let runCount = 0;

async function runRefresh() {
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  runCount++;
  console.log(`[${new Date().toISOString()}] Refresh #${runCount} — category: ${category}`);

  try {
    const prompt = `Find the top 8 most popular ${category} available on Google Play and App Store.
Return ONLY a valid JSON array, no markdown, no code fences.
Each object must have: name, icon (emoji), category, stores (array), pricing (Free/Paid/Freemium), price_detail, rating (number), rating_count (string like "2.4M"), downloads (string like "500M+"), description (1 sentence), url.`;

    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    const text = (result.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const apps = JSON.parse(clean);

    if (!Array.isArray(apps)) throw new Error('Not an array');

    const rows = apps.map(app => ({
      name: app.name,
      icon: app.icon || '📱',
      category: app.category || category,
      stores: app.stores || ['Google Play', 'App Store'],
      pricing: app.pricing || 'Free',
      price_detail: app.price_detail || '',
      rating: parseFloat(app.rating) || 4.0,
      rating_count: app.rating_count || '0',
      downloads: app.downloads || '0',
      description: app.description || '',
      url: app.url || '',
      updated_at: new Date().toISOString()
    }));

    const { error } = await supabase.from('apps').upsert(rows, { onConflict: 'name' });
    if (error) throw error;

    console.log(`✅ Added/updated ${rows.length} apps for "${category}"`);
  } catch (err) {
    console.error(`❌ Error:`, err.message);
    process.exit(1);
  }
}

// If --once flag passed (GitHub Actions), run once and exit
if (process.argv.includes('--once')) {
  runRefresh().then(() => process.exit(0));
} else {
  // Cron mode (Render etc)
  const cron = require('node-cron');
  cron.schedule('0 8 * * *',  runRefresh, { timezone: 'Europe/Copenhagen' });
  cron.schedule('0 11 * * *', runRefresh, { timezone: 'Europe/Copenhagen' });
  cron.schedule('0 14 * * *', runRefresh, { timezone: 'Europe/Copenhagen' });
  cron.schedule('0 17 * * *', runRefresh, { timezone: 'Europe/Copenhagen' });
  console.log('✅ AppMeUp worker running — scheduled 08:00, 11:00, 14:00, 17:00 Copenhagen');
  runRefresh(); // run once on startup
}
