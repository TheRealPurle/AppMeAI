import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

export const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const clean = (value, max = 20000) => {
  const text = value == null ? '' : String(value).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};
export const stableId = (...parts) => createHash('sha256').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 40);

export async function fetchText(url, { attempts = 4, delayMs = 2500, timeoutMs = 45000, headers = {} } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'en-GB,en;q=0.9', 'user-agent': 'Mozilla/5.0 (compatible; AppMeAI-Catalogue/1.0; +https://appmeai.com)', ...headers },
        signal: AbortSignal.timeout(timeoutMs)
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (text.trim().length < 80) throw new Error('empty/short response');
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}

export async function writeResults({ outputDir, basename, apps, summary }) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/${basename}.jsonl`, apps.map(app => JSON.stringify(app)).join('\n') + (apps.length ? '\n' : ''));
  await writeFile(`${outputDir}/summary.json`, JSON.stringify({ generated_at: new Date().toISOString(), ...summary, apps: apps.length }, null, 2) + '\n');
}

