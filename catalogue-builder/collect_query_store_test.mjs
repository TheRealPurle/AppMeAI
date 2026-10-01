import { clamp, sleep, writeResults } from './store_collector_common.mjs';
import { AMAZON_QUERIES, getAmazonApps } from './amazon_store.mjs';
import { HUAWEI_QUERIES, getHuaweiApps } from './huawei_store.mjs';

const key=(process.env.STORE_KEY||'').toLowerCase();
const config = key==='amazon' ? {store:4,queries:AMAZON_QUERIES,get:getAmazonApps,market:'US'} : key==='huawei' ? {store:5,queries:HUAWEI_QUERIES,get:getHuaweiApps,market:'GB'} : null;
if (!config) throw new Error('STORE_KEY must be amazon or huawei');
const prefix=key.toUpperCase(); const start=clamp(process.env[`${prefix}_QUERY_START`]||0,0,999); const limit=clamp(process.env[`${prefix}_QUERY_LIMIT`]??0,0,999); const per=clamp(process.env[`${prefix}_APPS_PER_QUERY`]||20,1,40); const delay=clamp(process.env[`${prefix}_DELAY_MS`]||3000,2000,20000);
const selected=config.queries.slice(start,limit?start+limit:undefined); const found=new Map(); const failures=[];
for(const query of selected){try{const apps=await config.get(query,per);if(!apps.length)throw new Error('no app cards found (store response/layout may have changed)');for(const app of apps){if(key==='amazon'){const duplicate=[...found.values()].some(existing=>(existing.name||'').localeCompare(app.name||'',undefined,{sensitivity:'base'})===0);if(duplicate)continue;}found.set(app.store_app_id,app);}console.log(`${key} > ${query}: ${apps.length}`);}catch(error){failures.push(`${query}: ${error.message}`);}await sleep(delay);}
await writeResults({outputDir:`output-${key}-test`,basename:`appmeai-${key}-test`,apps:[...found.values()],summary:{test_only:true,store:config.store,market:config.market,query_start:start,query_limit:limit,queries_selected:selected.length,apps_per_query:per,failures}});
if(!found.size)process.exitCode=1;
