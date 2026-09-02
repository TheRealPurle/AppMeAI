import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const API_URL = (process.env.APPMEAI_API_URL || '').replace(/\/$/, '');
const IMPORT_TOKEN = process.env.APPMEAI_IMPORT_TOKEN || '';
const BATCH_SIZE = 200;

async function postBatch(apps) {
  const response = await fetch(`${API_URL}/import.php`, {
    method: 'POST',
    headers: { authorization: `Bearer ${IMPORT_TOKEN}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ apps }),
    signal: AbortSignal.timeout(60000)
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`Import returned non-JSON (HTTP ${response.status})`); }
  if (!response.ok || !body.ok) throw new Error(body.error || `Import HTTP ${response.status}`);
  return body;
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

