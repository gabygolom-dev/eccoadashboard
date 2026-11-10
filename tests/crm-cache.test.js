import test from 'node:test';
import assert from 'node:assert/strict';
import {createDB} from '../scripts/local-db.mjs';
import {processQueueJob} from '../src/sync-worker.js';
import {conversationNeedsScan} from '../src/connectors/rugido.js';

test('cache CRM busca mudanças e revisões diárias, atualiza etapas e só confirma após sucesso integral',async()=>{
 const db=createDB(),oldFetch=globalThis.fetch,queue=[];
 const workspace='workspace_test',secret='test-only-pseudonym-key-0000000000000000';
 const base=Math.floor(Date.parse('2026-11-09T12:00:00Z')/1000);
 let version=1,currentStage='s1',failMessages=false,missingVersion=false,messageRequests=0;
 let queries=0,maxQueries=0;
 const budgetDB={prepare(sql){assert.ok(++queries<=50,'A execução ultrapassou 50 consultas D1');return db.prepare(sql);},batch:statements=>db.batch(statements)};
 const messages=[{id:'m1',source_id:'external-m1',sender_id:'contact1',conversation_id:'conv1',message_type:'incoming',created_at:base,content:'PRIVATE_MESSAGE',content_attributes:{origem_anuncio:{ad_id:'12345678'},external_created_at:base}}];
 const env={ECCOA_DB:budgetDB,CRM_API_ORIGIN_APPROVED:'true',CRM_TOKEN:'test-only-crm-token',CRM_WORKSPACE_ID:workspace,CRM_WORKSPACE_NAME:'Test workspace',PSEUDONYM_KEY:secret,ECCOA_JOBS:{async send(job){queue.push(job);}}};
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);assert.equal(u.origin,'https://clientcrm-api.rugido.com');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
  const page=Number(u.searchParams.get('page'));
  if(u.pathname.endsWith('/workspaces/current'))return Response.json({data:{id:workspace,name:'Test workspace'}});
  if(u.pathname.endsWith('/pipelines'))return Response.json({data:[{id:'p1',workspace_id:workspace,name:'Funil',stages:[{id:'s1',pipeline_id:'p1',name:'Contato'},{id:'s2',pipeline_id:'p1',name:'Agendado'}]}]});
  if(u.pathname.endsWith('/contacts'))return Response.json({data:page===1?[{id:'contact1',name:'PRIVATE_NAME',phone:'PRIVATE_PHONE'}]:[],meta:{pagination:{page,total:1}}});
  if(u.pathname.endsWith('/conversations')){
   const row={id:'conv1',contact:{id:'contact1'},updated_at:new Date((base+version*3600)*1000).toISOString(),last_activity_at:base+version*3600,last_non_activity_message:{id:messages.at(-1).id,content:'PRIVATE_LAST_MESSAGE'},pipelines:[{id:'p1',stages:[{id:currentStage}]}]};
   if(missingVersion)delete row.updated_at;
   return Response.json({data:page===1?[row]:[],meta:{current_page:page,total:1}});
  }
  if(u.pathname.endsWith('/messages')){
   messageRequests++;if(failMessages)throw Error('PRIVATE_NETWORK_DETAIL');
   return Response.json({data:u.searchParams.has('before')?[]:messages});
  }
  throw Error('UNEXPECTED_ENDPOINT');
 };
 async function cycle(){
  const id=crypto.randomUUID();
  await db.prepare("INSERT INTO runs(id,provider,state,cursor_json,started_at) VALUES(?,'crm','running','{}',?)").bind(id,new Date().toISOString()).run();
  await db.prepare("UPDATE sources SET active_run=? WHERE provider='crm'").bind(id).run();queue.push({runId:id,provider:'crm'});
  let steps=0;while(queue.length){assert.ok(++steps<100);queries=0;await processQueueJob(env,queue.shift());maxQueries=Math.max(maxQueries,queries);}
  return db.prepare('SELECT id,state,started_at FROM runs WHERE id=?').bind(id).first();
 }
 async function countEvents(){return (await db.prepare('SELECT count(*) n FROM events').first()).n;}
 try{
  const legacy=await cycle();assert.equal(legacy.state,'completed');assert.equal(messageRequests,2);assert.equal(await countEvents(),1);
  // Simulate upgrading a confirmed legacy snapshot that predates version-marker
  // storage: its full scan can be reused only for proven unchanged conversations.
  await db.prepare('DELETE FROM conversation_cache').run();
  await db.prepare("DELETE FROM stage WHERE run_id=? AND kind='conversation_page'").bind(legacy.id).run();
  await db.prepare("UPDATE stage SET data=json_remove(data,'$.fingerprint','$.needsMessages','$.bootstrap','$.cacheScanAt') WHERE run_id=? AND kind='conversation'").bind(legacy.id).run();
  currentStage='s2';assert.equal((await cycle()).state,'completed');assert.equal(messageRequests,2);
  assert.equal((await db.prepare('SELECT full_scan_at FROM conversation_cache').first()).full_scan_at,legacy.started_at);
  assert.match((await db.prepare('SELECT stage_name FROM contacts').first()).stage_name,/Agendado/);
  version=2;messages.push({...messages[0],id:'m2',source_id:'external-m2',created_at:base+3600,content_attributes:{origem_anuncio:{ad_id:'87654321'},external_created_at:base+3600}});
  assert.equal((await cycle()).state,'completed');assert.equal(messageRequests,4);assert.equal(await countEvents(),2);
  const confirmed=(await db.prepare("SELECT confirmed_at FROM sources WHERE provider='crm'").first()).confirmed_at;
  const cached=await db.prepare('SELECT * FROM conversation_cache').first();
  version=3;failMessages=true;assert.equal((await cycle()).state,'failed');
  assert.equal((await db.prepare("SELECT confirmed_at FROM sources WHERE provider='crm'").first()).confirmed_at,confirmed);
  assert.deepEqual(await db.prepare('SELECT * FROM conversation_cache').first(),cached);assert.equal(await countEvents(),2);
  failMessages=false;assert.equal((await cycle()).state,'completed');assert.equal(await countEvents(),2);
  assert.notEqual((await db.prepare('SELECT fingerprint FROM conversation_cache').first()).fingerprint,cached.fingerprint);
  const beforeAudit=messageRequests;
  await db.prepare('UPDATE conversation_cache SET full_scan_at=?').bind(new Date(Date.now()-25*3600000).toISOString()).run();
  assert.equal((await cycle()).state,'completed');assert.equal(messageRequests,beforeAudit+2);
  missingVersion=true;const beforeMissing=messageRequests;
  await cycle();await cycle();assert.equal(messageRequests,beforeMissing+4);assert.equal(await countEvents(),2);
  const persisted=JSON.stringify((await db.prepare('SELECT data FROM stage').all()).results);
  assert.ok(!persisted.includes('PRIVATE_'));assert.ok(!persisted.includes(env.CRM_TOKEN));
  assert.ok(maxQueries<=50);
  assert.equal(conversationNeedsScan({fingerprint:'x',full_scan_at:'invalid'},'x',new Date().toISOString()),true);
 }finally{globalThis.fetch=oldFetch;db.close();}
});
