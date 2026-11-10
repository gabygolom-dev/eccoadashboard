import test from 'node:test';
import assert from 'node:assert/strict';
import {metaRead,adsPage,insightPage,exactReach} from '../src/connectors/meta.js';
import {ECCOA_META} from '../src/connectors/meta-schema.js';
import {createDB} from '../scripts/local-db.mjs';
import {stage,stageMany,stageMissingAds} from '../src/db.js';
import {publishRun} from '../src/sync.js';
import {makeReport} from '../src/report.js';
import {digest} from '../src/domain.js';
const env={META_TOKEN:'test-only-meta-token',META_ACCOUNT_ID:ECCOA_META.accountId,META_ACCOUNT_NAME:ECCOA_META.accountName,META_API_VERSION:ECCOA_META.apiVersion,META_CONVERSATION_ACTION:ECCOA_META.conversationAction,META_METRIC_VALIDATED:'true',HISTORY_START:'2025-12-01'};
const response=data=>Response.json(data,{headers:{'facebook-api-version':ECCOA_META.apiVersion}});
async function withFetch(mock,fn){const original=globalThis.fetch;globalThis.fetch=mock;try{return await fn();}finally{globalThis.fetch=original;}}

test('Meta bloqueia outra conta, versão ou ação de conversa antes de consultar',async()=>{
 let calls=0;await withFetch(async()=>{calls++;return response({data:[]});},async()=>{
  await assert.rejects(()=>metaRead({...env,META_ACCOUNT_ID:'111111111'},'/insights'),/ACCOUNT_SCOPE_BLOCKED/);
  await assert.rejects(()=>metaRead({...env,META_API_VERSION:'v99.0'},'/insights'),/VERSION_NOT_VALIDATED/);
  await assert.rejects(()=>metaRead({...env,META_CONVERSATION_ACTION:'link_click'},'/insights'),/ACTION_NOT_VALIDATED/);
  await assert.rejects(()=>metaRead(env,'/campaigns'),/ENDPOINT_BLOCKED/);
 });assert.equal(calls,0);
});
test('Meta envia apenas GET com token em header e impede upgrade silencioso da versão',async()=>{
 await withFetch(async(url,opts)=>{
  assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(new URL(url).origin,'https://graph.facebook.com');assert.ok(new URL(url).pathname.startsWith('/v26.0/act_'+ECCOA_META.accountId+'/'));assert.ok(!url.includes(env.META_TOKEN));assert.equal(opts.headers.Authorization,'Bearer '+env.META_TOKEN);
  return Response.json({data:[]},{headers:{'facebook-api-version':'v99.0'}});
 },()=>assert.rejects(()=>metaRead(env,'/ads'),/API_VERSION_MISMATCH/));
});
test('dados diários preservam atribuição e não confundem conversas com cliques',async()=>{
 await withFetch(async()=>response({data:[{account_id:ECCOA_META.accountId,ad_id:'ad_test',adset_id:'set_test',campaign_id:'campaign_test',date_start:'2026-11-09',date_stop:'2026-11-09',spend:'50',impressions:'1000',inline_link_clicks:'20',attribution_setting:'7d_click',actions:[{action_type:'link_click',value:'20'},{action_type:ECCOA_META.conversationAction,value:'4'},{action_type:'onsite_conversion.total_messaging_connection',value:'8'}]}]}),async()=>{
  const page=await insightPage(env,'2026-11-09','2026-11-09');assert.equal(page.items[0].conversations,4);assert.equal(page.items[0].clicks,20);assert.equal(page.items[0].attributionSetting,'7d_click');
 });
 await withFetch(async()=>response({data:[{account_id:'other_account',date_start:'2026-11-09',date_stop:'2026-11-09'}]}),()=>assert.rejects(()=>insightPage(env,'2026-11-09','2026-11-09'),/SCOPE_MISMATCH/));
 await withFetch(async()=>response({data:[{id:'ad_test',account_id:'other_account'}]}),()=>assert.rejects(()=>adsPage(env),/AD_ACCOUNT_MISMATCH/));
});
test('alcance usa intervalo e escopo exatos e nunca soma duas linhas',async()=>{
 await withFetch(async url=>{const q=new URL(url).searchParams;assert.equal(q.get('level'),'ad');assert.equal(q.has('time_increment'),false);assert.deepEqual(JSON.parse(q.get('time_range')),{since:'2026-11-01',until:'2026-11-09'});assert.deepEqual(JSON.parse(q.get('filtering')),[{field:'campaign.id',operator:'IN',value:['campaign_test']},{field:'ad.id',operator:'IN',value:['ad_test']}]);return response({data:[{account_id:ECCOA_META.accountId,campaign_id:'campaign_test',ad_id:'ad_test',reach:'123',date_start:'2026-11-01',date_stop:'2026-11-09'}]});},async()=>assert.equal(await exactReach(env,'2026-11-01','2026-11-09',{campaign:'campaign_test',ad:'ad_test'}),123));
 await withFetch(async()=>response({data:[{},{}]}),()=>assert.rejects(()=>exactReach(env,'2026-11-01','2026-11-09'),/SCOPE_AMBIGUOUS/));
 await withFetch(async()=>response({data:[{account_id:ECCOA_META.accountId,reach:'1',date_start:'2026-11-02',date_stop:'2026-11-09'}]}),()=>assert.rejects(()=>exactReach(env,'2026-11-01','2026-11-09'),/SCOPE_MISMATCH/));
});
test('anúncios históricos ganham correspondência sem sobrescrever metadados atuais',async()=>{
 const db=createDB();try{
 await stageMany(db,'run1','ad',[{key:'ad_current',data:{id:'ad_current',name:'Nome atual',status:'ACTIVE',format:'VIDEO'}}]);
 await stageMissingAds(db,'run1',[{adId:'ad_current',adName:'Nome histórico',campaignId:'c',adsetId:'s'},{adId:'ad_old',adName:'Anúncio histórico',campaignId:'c',campaignName:'Campanha real',adsetId:'s',adsetName:'Conjunto real'}]);
 const current=JSON.parse((await db.prepare("SELECT data FROM stage WHERE key='ad_current'").first()).data);assert.equal(current.name,'Nome atual');assert.equal(current.status,'ACTIVE');
 const old=JSON.parse((await db.prepare("SELECT data FROM stage WHERE key='ad_old'").first()).data);assert.equal(old.campaignId,'c');assert.equal(old.status,null);
 }finally{db.close();}
});
test('falha no alcance mantém o valor confirmado e cache de outro filtro não é reutilizado',async()=>{
 const db=createDB();try{
 const id=await digest(JSON.stringify([ECCOA_META.accountId,'2026-11-09','2026-11-09','','']));
 await db.prepare("INSERT INTO reach_reports(id,start,end,requested_at,confirmed_at,value) VALUES(?,'2026-11-09','2026-11-09','2026-11-09T10:00:00Z','2026-11-09T10:00:00Z',123)").bind(id).run();
 await db.prepare("INSERT INTO runs(id,provider,state,cursor_json,started_at) VALUES('meta_failed_reach','meta','running','{}','2026-11-09T10:15:00Z')").run();
 await db.prepare("UPDATE sources SET active_run='meta_failed_reach' WHERE provider='meta'").run();
 await stage(db,'meta_failed_reach','identity','meta',{conversationsValidated:true});await stage(db,'meta_failed_reach','reach',id,{value:null,error:'UPSTREAM_HTTP_429'});
 await publishRun({ECCOA_DB:db},{id:'meta_failed_reach',provider:'meta'},{start:'2026-11-09',end:'2026-11-09',done:true});
 const report=await makeReport({ECCOA_DB:db},new URL('https://test/api/report?start=2026-11-09&end=2026-11-09'));assert.equal(report.totals.reach,123);assert.equal(report.reachError,'UPSTREAM_HTTP_429');assert.equal(report.reachUpdatedAt,'2026-11-09T10:00:00Z');
 const filtered=await makeReport({ECCOA_DB:db},new URL('https://test/api/report?start=2026-11-09&end=2026-11-09&campaign=campaign_test'));assert.equal(filtered.totals.reach,null);assert.equal(filtered.reachPending,true);
 }finally{db.close();}
});
