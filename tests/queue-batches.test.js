import test from 'node:test';
import assert from 'node:assert/strict';
import {processQueueJob} from '../src/sync-worker.js';
import {createDB} from '../scripts/local-db.mjs';

const body={provider:'crm',runId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
async function setup(phase){
 const db=createDB(),sent=[];
 await db.prepare("INSERT INTO runs(id,provider,state,cursor_json,started_at) VALUES(?,'crm','running',?,'2026-11-10T12:00:00Z')").bind(body.runId,JSON.stringify({phase,count:0})).run();
 return {db,sent,env:{ECCOA_DB:db,ECCOA_JOBS:{async send(job,options){sent.push({job,options});}}}};
}
test('lote de histórico preserva cada checkpoint e enfileira somente a continuação final',async()=>{
 const {db,env,sent}=await setup('messages');let steps=0;
 try{
  await processQueueJob(env,body,async(local,job)=>{
   steps++;await local.ECCOA_DB.prepare("UPDATE runs SET cursor_json=json_set(cursor_json,'$.count',json_extract(cursor_json,'$.count')+1) WHERE id=?").bind(job.runId).run();
   await local.ECCOA_JOBS.send(job);
  });
  assert.equal(steps,5);assert.equal(sent.length,1);assert.deepEqual(sent[0].job,body);
  assert.equal(JSON.parse((await db.prepare('SELECT cursor_json FROM runs WHERE id=?').bind(body.runId).first()).cursor_json).count,5);
 }finally{db.close();}
});
test('conclusão e retentativa com atraso encerram o lote sem avançar indevidamente',async()=>{
 const {db,env,sent}=await setup('messages');let steps=0;
 try{
  await processQueueJob(env,body,async(local,job)=>{steps++;if(steps<3)await local.ECCOA_JOBS.send(job);});
  assert.equal(steps,3);assert.equal(sent.length,0);steps=0;
  await processQueueJob(env,body,async(local,job)=>{steps++;await local.ECCOA_JOBS.send(job,{delaySeconds:120});});
  assert.equal(steps,1);assert.equal(sent.length,1);assert.equal(sent[0].options.delaySeconds,120);
 }finally{db.close();}
});
test('páginas de contatos não agrupam trabalho criptográfico e falha no envio permite retry do checkpoint',async()=>{
 const {db,env,sent}=await setup('contacts');let steps=0;
 try{
  const step=async(local,job)=>{steps++;await local.ECCOA_JOBS.send(job);};
  await processQueueJob(env,body,step);assert.equal(steps,1);assert.equal(sent.length,1);
  env.ECCOA_JOBS.send=async()=>{throw Error('QUEUE_UNAVAILABLE');};
  await assert.rejects(()=>processQueueJob(env,body,step),/QUEUE_UNAVAILABLE/);
  assert.equal((await db.prepare('SELECT state FROM runs WHERE id=?').bind(body.runId).first()).state,'running');
 }finally{db.close();}
});
