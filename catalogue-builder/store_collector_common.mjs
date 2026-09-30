import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

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

export async function renderPage(url, { waitFor = null, timeoutMs = 60000 } = {}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      locale: 'en-GB',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (waitFor) await page.locator(waitFor).first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1800);
    return { html: await page.content(), title: await page.title(), url: page.url() };
  } finally {
    await browser.close();
  }
}

export async function saveDiagnostic(store, key, html) {
  const outputDir = `output-${store}-test/diagnostics`;
  await mkdir(outputDir, { recursive: true });
  const safeKey = String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'page';
  await writeFile(`${outputDir}/${safeKey}.html`, html);
}
