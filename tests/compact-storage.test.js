import test from 'node:test';
import assert from 'node:assert/strict';
import {createDB} from '../scripts/local-db.mjs';
import {stage,stagePage,stagedRowsSQL,stagedKeysSQL} from '../src/db.js';
import {publishRun,startCycle} from '../src/sync.js';

async function start(db,id,provider){
 await db.prepare("INSERT INTO runs(id,provider,state,cursor_json,started_at) VALUES(?,?,'running','{}',?)").bind(id,provider,new Date().toISOString()).run();
 await db.prepare('UPDATE sources SET active_run=? WHERE provider=?').bind(id,provider).run();
 await stage(db,id,'identity',provider,{id:'test-only',conversationsValidated:true});
}
const changes=db=>Number(db.sqlite.prepare('SELECT total_changes() n').get().n);

test('snapshot escolhe a última página e o último item, mesmo quando o novo valor é menor',async()=>{
 const db=createDB();try{
  await stage(db,'order','metric','d:a',{spend:999});
  await stagePage(db,'order','metric',1,[{key:'d:a',data:{spend:8}}]);
  await stagePage(db,'order','metric',2,[{key:'d:a',data:{spend:5}},{key:'d:a',data:{spend:2}}]);
  const rows=(await db.prepare(stagedRowsSQL('metric')).bind('order','order').all()).results;
  assert.equal(rows.length,1);assert.equal(JSON.parse(rows[0].data).spend,2);
  assert.equal((await db.prepare(`SELECT count(*) n FROM (${stagedKeysSQL('metric')})`).bind('order','order').first()).n,1);
 }finally{db.close();}
});

test('3600 contatos usam páginas compactas e a publicação idêntica não regrava cadastros',async()=>{
 const db=createDB();
 const contacts=Array.from({length:3600},(_,i)=>({key:'p'+i,data:{id:'p'+i,stageId:null,stageName:'Etapa não informada',undated:i===0}}));
 const stages=[{key:'p0:s1',data:{contactId:'p0',stageId:'s1',stageName:'Funil A · Contato'}},{key:'p0:s2',data:{contactId:'p0',stageId:'s2',stageName:'Funil B · Agendado'}}];
 async function snapshot(id){
  await start(db,id,'crm');const before=changes(db);
  for(let n=0;n<contacts.length;n+=100)await stagePage(db,id,'contact',n/100,contacts.slice(n,n+100));
  await stagePage(db,id,'contact',36,[{key:'p0',data:{...contacts[0].data,undated:false}}]);
  await stagePage(db,id,'contact_stage',0,stages);
  assert.equal(changes(db)-before,38);
 }
 try{
  await snapshot('c1');await publishRun({ECCOA_DB:db},{id:'c1',provider:'crm'},{done:true});
  assert.equal((await db.prepare('SELECT count(*) n FROM contacts').first()).n,3600);
  const first=await db.prepare("SELECT * FROM contacts WHERE id='p0'").first();
  assert.equal(first.undated,1);assert.match(first.stage_name,/Funil A/);assert.match(first.stage_name,/Funil B/);
  const plan=JSON.stringify(db.sqlite.prepare('EXPLAIN QUERY PLAN SELECT count(*) FROM contacts c WHERE undated=1 AND NOT EXISTS(SELECT 1 FROM events e WHERE e.contact_id=c.id)').all());
  assert.match(plan,/contacts_paid_undated/);assert.match(plan,/events_by_contact/);
  await snapshot('c2');const before=changes(db);
  await publishRun({ECCOA_DB:db},{id:'c2',provider:'crm'},{done:true});
  assert.equal(changes(db)-before,2); // Only run and source metadata changed.
  assert.equal((await db.prepare("SELECT updated_at FROM contacts WHERE id='p0'").first()).updated_at,first.updated_at);
  stages.splice(1,1);await snapshot('c3');const beforeStage=changes(db);
  await publishRun({ECCOA_DB:db},{id:'c3',provider:'crm'},{done:true});
  assert.equal(changes(db)-beforeStage,3);assert.equal((await db.prepare("SELECT stage_name FROM contacts WHERE id='p0'").first()).stage_name,'Funil A · Contato');
 }finally{db.close();}
});

test('limpeza de snapshots expirados preserva eventos, revisões e execuções confirmadas',async()=>{
 const db=createDB();
 try{
  await start(db,'old-crm','crm');await stage(db,'old-crm','contact','p',{id:'p',stageId:null,stageName:'Contato',undated:false});
  await stage(db,'old-crm','event','e',{contactId:'p',at:'2026-11-09T12:00:00Z',day:'2026-11-09',campaignId:null,adsetId:null,adId:'12345678',evidence:'Mensagem recebida com referência paga'});
  await publishRun({ECCOA_DB:db},{id:'old-crm',provider:'crm'},{done:true});
  await start(db,'old-meta','meta');await stagePage(db,'old-meta','metric',0,[{key:'2026-11-09:a',data:{day:'2026-11-09',adId:'a',campaignId:'c',adsetId:'s',spend:5}}]);
  await publishRun({ECCOA_DB:db},{id:'old-meta',provider:'meta'},{start:'2026-11-09',end:'2026-11-09',done:true});
  await db.prepare('UPDATE runs SET finished_at=?').bind(new Date(Date.now()-2*3600000).toISOString()).run();
  await startCycle({ECCOA_DB:db,ECCOA_JOBS:{async send(){throw Error('UNEXPECTED_JOB');}}});
  assert.equal((await db.prepare('SELECT count(*) n FROM stage').first()).n,0);
  for(const table of ['events','metrics','metric_revisions'])assert.equal((await db.prepare('SELECT count(*) n FROM '+table).first()).n,1);
  assert.equal((await db.prepare("SELECT count(*) n FROM runs WHERE state='completed'").first()).n,2);
 }finally{db.close();}
});

test('Meta registra só revisões reais, preserva o histórico fora do intervalo e audita retrações',async()=>{
 const db=createDB();
 const metrics=Array.from({length:300},(_,i)=>({key:'2026-11-09:a'+i,data:{day:'2026-11-09',adId:'a'+i,campaignId:'c',adsetId:'s',spend:1,impressions:100,clicks:5,conversations:1}}));
 async function snapshot(id,rows){
  await start(db,id,'meta');for(let n=0;n<rows.length;n+=250)await stagePage(db,id,'metric',n/250,rows.slice(n,n+250));
 }
 const range={start:'2026-11-09',end:'2026-11-09',done:true};
 try{
  await db.prepare('INSERT INTO metrics(day,ad_id,campaign_id,adset_id,data,run_id) VALUES(?,?,?,?,?,?)').bind('2026-11-08','old','c','s',JSON.stringify({spend:7}),'older-confirmation').run();
  await snapshot('m1',metrics);await publishRun({ECCOA_DB:db},{id:'m1',provider:'meta'},range);
  assert.equal((await db.prepare('SELECT count(*) n FROM metric_revisions').first()).n,300);
  await snapshot('m2',metrics);const before=changes(db);
  await publishRun({ECCOA_DB:db},{id:'m2',provider:'meta'},range);
  assert.equal(changes(db)-before,3); // Coverage date, run and source only.
  assert.equal((await db.prepare('SELECT count(*) n FROM metric_revisions').first()).n,300);
  const revised=metrics.filter(x=>x.data.adId!=='a1').map(x=>x.data.adId==='a0'?{...x,data:{...x.data,spend:2}}:x);
  await snapshot('m3',revised);await publishRun({ECCOA_DB:db},{id:'m3',provider:'meta'},range);
  assert.equal((await db.prepare('SELECT count(*) n FROM metric_revisions').first()).n,302);
  assert.equal((await db.prepare("SELECT count(*) n FROM metrics WHERE day='2026-11-09'").first()).n,299);
  assert.equal(JSON.parse((await db.prepare("SELECT data FROM metrics WHERE ad_id='old'").first()).data).spend,7);
  assert.equal(JSON.parse((await db.prepare("SELECT data FROM metric_revisions WHERE run_id='m3' AND ad_id='a1'").first()).data).deleted,true);
  assert.equal((await db.prepare("SELECT run_id FROM metrics WHERE ad_id='a2'").first()).run_id,'m1');
 }finally{db.close();}
});
