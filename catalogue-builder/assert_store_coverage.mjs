import { readFile } from 'node:fs/promises';
const key = process.env.COVERAGE_STORE;
if (!['huawei', 'xiaomi'].includes(key)) throw new Error('Invalid COVERAGE_STORE');
const report = JSON.parse(await readFile(`output-${key}-coverage/coverage.json`, 'utf8'));
console.table(report.coverage);
const missing = report.coverage.filter(row => !row.covered).map(row => row.category);
if (missing.length) throw new Error(`Coverage incomplete for ${key}: ${missing.join(', ')}. Inspect the saved report; do not treat this run as complete.`);
