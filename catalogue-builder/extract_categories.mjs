import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';

const input = process.argv[2] || '../AppMeAI-site-public-pages/index.html';
const output = process.argv[3] || 'categories.json';
const html = await readFile(input, 'utf8');
const start = html.indexOf('const CAT_TREE =');
const end = html.indexOf('\n};', start);
if (start < 0 || end < 0) throw new Error('CAT_TREE was not found in index.html');

const literal = html.slice(start + 'const CAT_TREE ='.length, end + 2).trim();
const tree = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 });
const rows = [];
for (const [mainLabel, groups] of Object.entries(tree)) {
  const category = mainLabel.replace(/^\S+\s+/, '');
  for (const [subcategory, terms] of Object.entries(groups)) {
    for (const term of terms) rows.push({ category, subcategory, term });
  }
}

await writeFile(output, JSON.stringify(rows, null, 2) + '\n');
console.log(`Wrote ${rows.length} category searches to ${output}`);
