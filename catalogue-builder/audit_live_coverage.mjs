import { mkdir, writeFile } from 'node:fs/promises';
import { EVIDENCE, matchesCategory } from './category_evidence_v11.mjs';
const base = (process.env.APPMEAI_API_URL || '').replace(/\/$/, '');
if (!base.startsWith('https://')) throw new Error('Set APPMEAI_API_URL to the existing HTTPS API base URL');
const stores = [{id:1,name:'Apple'},{id:2,name:'Google'},{id:3,name:'Samsung'},{id:5,name:'Huawei'},{id:6,name:'Xiaomi'}];
const queries = {fitness:'fitness',finance:'finance',travel:'travel',language:'language learning',photo_video:'photo',sleep:'sleep',games:'games',productivity:'productivity',ai:'AI assistant',food:'recipes',meditation:'meditation',music:'music'};
const rows = [];
for (const id of EVIDENCE.main_categories) {
  for (let offset=0; offset<stores.length; offset+=4) {
    rows.push(...await Promise.all(stores.slice(offset,offset+4).map(async store => {
      const row = {category:EVIDENCE.rules[id].name,store:store.name,query:queries[id]};
      try {
        const response = await fetch(`${base}/search.php?${new URLSearchParams({q:queries[id],stores:String(store.id),limit:'20'})}`,{signal:AbortSignal.timeout(20000)});
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error('Search endpoint failed');
        if (data.search_revision !== 11) throw new Error('Upload the Simply v11 PHP files first');
        const apps = data.apps.filter(app => Number(app.store_code)===store.id);
        // Same functional evidence as collection and PHP, including vetted full-description markers.
        const relevant = apps.filter(app => matchesCategory(app,id));
        return {...row,count_returned:apps.length,count_relevant:relevant.length,covered:relevant.length>0,examples:relevant.slice(0,3).map(a=>a.name)};
      } catch(error) {return {...row,covered:false,error:error.message};}
    })));
  }
}
await mkdir('output-live-coverage',{recursive:true});
await writeFile('output-live-coverage/coverage.json',JSON.stringify({checked_at:new Date().toISOString(),evidence_version:11,rows,complete:rows.every(r=>r.covered)},null,2)+'\n');
console.table(rows.map(({examples,...row})=>row));
if (rows.some(r=>!r.covered)) throw new Error('Coverage remains incomplete or the API is unavailable. Inspect coverage.json for missing combinations and request errors.');
