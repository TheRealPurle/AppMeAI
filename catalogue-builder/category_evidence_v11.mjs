import { readFileSync } from 'node:fs';
export const EVIDENCE = JSON.parse(readFileSync(new URL('./category-evidence-v11.json', import.meta.url), 'utf8'));
const rx = pattern => pattern ? new RegExp(`(^|[^\\p{L}\\p{N}_])(?:${pattern})(?=$|[^\\p{L}\\p{N}_])`, 'iu') : null;
const compiled = Object.fromEntries(Object.entries(EVIDENCE.rules).map(([id, rule]) => [id, Object.fromEntries(['title','category','description','blocked_category','blocked_title'].map(k => [k, rx(rule[k])]))]));
export function evidenceFor(app, id, { stored = true } = {}) {
  const spec = EVIDENCE.rules[id], patterns = compiled[id];
  if (!spec) return [];
  const name = String(app.name || '');
  const classification = `${app.category || ''} ${app.subcategory || ''}`;
  if (patterns.blocked_category?.test(classification) || patterns.blocked_title?.test(name)) return [];
  const evidence = [];
  if (patterns.title?.test(name)) evidence.push('name');
  if (patterns.category?.test(classification)) evidence.push('store_category');
  if (patterns.description?.test(String(app.description || ''))) evidence.push('functional_description');
  if (stored && EVIDENCE.trusted_sources.includes(app.source)) {
    const markers = String(app.search_keywords || '').split(/\s+/);
    if (markers.includes(spec.marker) || app.verified_intents?.includes(id)) evidence.push('verified_full_description');
  }
  return evidence;
}
export function matchesCategory(app, id) { return evidenceFor(app, id).length > 0; }
export function classifyForImport(app) {
  if (![5,6].includes(Number(app.store))) throw new Error('Only Huawei/Xiaomi records belong in this import');
  const ids = Object.keys(EVIDENCE.rules).filter(id => evidenceFor(app, id, {stored:false}).length);
  return {...app, search_keywords: ids.length ? ids.map(id => EVIDENCE.rules[id].marker).join(' ') : 'amu11_none',
    source: Number(app.store) === 5 ? 'huawei-appgallery-verified-v11' : 'xiaomi-getapps-verified-v11'};
}
export function coverageFor(apps) {
  return EVIDENCE.main_categories.map(id => {
    const matched = apps.filter(app => matchesCategory(app,id));
    return {category:EVIDENCE.rules[id].name, count:matched.length, covered:matched.length>0,
      examples:matched.slice(0,3).map(a=>a.name)};
  });
}
