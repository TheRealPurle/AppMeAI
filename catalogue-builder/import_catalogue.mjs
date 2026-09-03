import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const API_URL = (process.env.APPMEAI_API_URL || '').replace(/\/$/, '');
const IMPORT_TOKEN = process.env.APPMEAI_IMPORT_TOKEN || '';
// Smaller requests are gentler on shared PHP hosting and less likely to hit a
// proxy/PHP timeout. Transient HTML/empty responses are retried automatically.
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 4;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeJson(payload) {
  // Public store data can occasionally contain an unpaired UTF-16 surrogate.
  // JavaScript can hold it, but PHP correctly rejects it as invalid JSON.
  return JSON.stringify(payload, (_key, value) => {
    if (typeof value !== 'string') return value;
    return typeof value.toWellFormed === 'function'
      ? value.toWellFormed()
      : Buffer.from(value, 'utf8').toString('utf8');
  });
}

async function postBatch(apps) {
  let lastError;
  const requestBody = safeJson({ apps });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${API_URL}/import.php`, {
        method: 'POST',
        headers: { authorization: `Bearer ${IMPORT_TOKEN}`, 'content-type': 'application/json', accept: 'application/json' },
        body: requestBody,
        signal: AbortSignal.timeout(90000)
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        const preview = text.replace(/\s+/g, ' ').trim().slice(0, 160) || '<empty response>';
        throw new Error(`Import returned non-JSON (HTTP ${response.status}): ${preview}`);
      }
      if (!response.ok || !body.ok) throw new Error(body.error || `Import HTTP ${response.status}`);
      return body;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
      const waitMs = attempt * 3000;
      console.warn(`Import attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}. Retrying in ${waitMs / 1000}s...`);
      await sleep(waitMs);
    }
  }

  throw lastError;
}

export async function importApps(apps) {
  if (!API_URL || !IMPORT_TOKEN) throw new Error('Missing APPMEAI_API_URL or APPMEAI_IMPORT_TOKEN');
  let accepted = 0;
  let rejected = 0;
  for (let index = 0; index < apps.length; index += BATCH_SIZE) {
    const result = await postBatch(apps.slice(index, index + BATCH_SIZE));
    accepted += Number(result.accepted || 0);
    rejected += Number(result.rejected || 0);
    console.log(`Batch ${index / BATCH_SIZE + 1}: ${result.accepted} accepted, ${result.rejected} rejected`);
  }
  console.log(`Import complete: ${accepted} accepted, ${rejected} rejected.`);
}

async function readJsonLines(path) {
  const input = createReadStream(path);
  const stream = path.endsWith('.gz') ? input.pipe(createGunzip()) : input;
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const apps = [];
  for await (const line of lines) if (line.trim()) apps.push(JSON.parse(line));
  return apps;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  const path = process.argv[2] || 'output/appmeai-catalogue.jsonl.gz';
  await importApps(await readJsonLines(path));
}
