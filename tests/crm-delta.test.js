import test from 'node:test';
import assert from 'node:assert/strict';
import {createDB} from '../scripts/local-db.mjs';
import {stage,stagePage,statement} from '../src/db.js';
import {readCrmSnapshot,contactDeltaStatements} from '../src/crm-snapshot.js';

const at='2026-11-11T10:00:00.000Z';
const contact=(id,paid=false)=>({key:id,data:{id,stageId:null,stageName:'Etapa não informada',undated:paid}});
const assigned=(id,stageId,name)=>({key:id+':'+stageId,data:{contactId:id,stageId,stageName:name}});
const totalChanges=db=>Number(db.sqlite.prepare('SELECT total_changes() n').get().n);

test('cobertura CRM lê páginas compactas, une duplicados e aceita snapshots legados',async()=>{
 const db=createDB();try{
  await stage(db,'r','contact','a',contact('a',true).data);
  await stagePage(db,'r','contact',1,[contact('a'),contact('b')]);
  await stagePage(db,'r','contact',2,[{...contact('a'),data:{...contact('a').data,stageId:'latest'}}]);
  const rows=await readCrmSnapshot(db,'r','contact');
  assert.equal(rows.size,2);assert.equal(rows.get('a').undated,true);assert.equal(rows.get('a').stageId,'latest');
  await stagePage(db,'r','conversation',1,[{key:'c',data:{id:'c'}}]);
  await stage(db,'r','conversation','c',{id:'c',old:true});
  assert.deepEqual([...(await readCrmSnapshot(db,'r','conversation')).values()],[{id:'c'}]);
 }finally{db.close();}
});

test('4000 contatos estáveis não reconsultam a tabela inteira nem preparam regravação',async()=>{
 const db=createDB();try{
  const contacts=Array.from({length:4000},(_,i)=>contact('p'+i));
  for(let i=0;i<contacts.length;i+=100)await stagePage(db,'r','contact',i/100,contacts.slice(i,i+100));
  await stagePage(db,'r','contact_stage',0,[assigned('p0','s1','Contato')]);
  await db.batch(await contactDeltaStatements(db,'r',at));
  const traced=[],reads=[];
  const measured={prepare(sql){traced.push(sql);const original=db.prepare(sql);return {bind(...args){original.bind(...args);return this;},async all(){const result=await original.all();reads.push(result.results.length);return result;},first:()=>original.first()};}};
  const before=totalChanges(db);
  assert.deepEqual(await contactDeltaStatements(measured,'r',at),[]);
  assert.equal(totalChanges(db),before);
  assert.ok(traced.every(sql=>!sql.includes('FROM contacts')&&!sql.includes('INSERT INTO contacts')&&!sql.includes('json_each')));
  assert.equal(reads.reduce((sum,n)=>sum+n,0),41); // Stored page rows, not 4,000 virtual item rows.
 }finally{db.close();}
});

test('deltas preservam múltiplas etapas, contato removido e evidência paga sem data',async()=>{
 const db=createDB();try{
  await stagePage(db,'one','contact',0,[contact('a'),contact('b',true)]);
  await stagePage(db,'one','contact_stage',0,[assigned('a','s2','Agendado'),assigned('a','s1','Contato'),assigned('b','s1','Contato')]);
  await db.batch(await contactDeltaStatements(db,'one',at));
  const first=db.sqlite.prepare("SELECT * FROM contacts WHERE id='a'").get();
  assert.equal(first.stage_id,'s1,s2');assert.equal(first.stage_name,'Contato,Agendado');
  await stagePage(db,'same','contact',0,[contact('b',true),contact('a')]);
  await stagePage(db,'same','contact_stage',0,[assigned('b','s1','Contato'),assigned('a','s1','Contato'),assigned('a','s2','Agendado')]);
  assert.deepEqual(await contactDeltaStatements(db,'same',at),[]);
  await stagePage(db,'two','contact',0,[contact('b')]);
  await stagePage(db,'two','contact_stage',0,[assigned('b','s2','Agendado')]);
  await db.batch(await contactDeltaStatements(db,'two',at));
  assert.equal(db.sqlite.prepare("SELECT stage_name FROM contacts WHERE id='a'").get().stage_name,'Etapa não informada');
  const b=db.sqlite.prepare("SELECT * FROM contacts WHERE id='b'").get();
  assert.equal(b.stage_name,'Agendado');assert.equal(b.undated,1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM contacts').get().n,2);
 }finally{db.close();}
});

test('falha na confirmação não avança o cache nem muda dados confirmados',async()=>{
 const db=createDB();try{
  await stagePage(db,'one','contact',0,[contact('a')]);
  await db.batch(await contactDeltaStatements(db,'one',at));
  const oldCache=db.sqlite.prepare("SELECT value FROM settings WHERE key='crmContactSnapshotV1'").get().value;
  await stagePage(db,'two','contact',0,[contact('a'),contact('b')]);
  const prepared=await contactDeltaStatements(db,'two',at);
  prepared.push(statement(db,'INSERT INTO table_that_does_not_exist VALUES(1)'));
  await assert.rejects(()=>db.batch(prepared));
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM contacts').get().n,1);
  assert.equal(db.sqlite.prepare("SELECT value FROM settings WHERE key='crmContactSnapshotV1'").get().value,oldCache);
  await db.batch(await contactDeltaStatements(db,'two',at));
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM contacts').get().n,2);
 }finally{db.close();}
});

test('cache grande demais usa comparação segura com dados confirmados, sem valor acima do limite',async()=>{
 const db=createDB();try{
  const rows=Array.from({length:1800},(_,i)=>({key:'long'+i,data:{...contact('long'+i).data,stageName:'Funil '+('x'.repeat(900))}}));
  for(let i=0;i<rows.length;i+=100)await stagePage(db,'large','contact',i/100,rows.slice(i,i+100));
  const first=await contactDeltaStatements(db,'large',at);
  assert.ok(first.length<10);await db.batch(first);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM settings WHERE key='crmContactSnapshotV1'").get().n,0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM contacts').get().n,1800);
  assert.deepEqual(await contactDeltaStatements(db,'large',at),[]);
 }finally{db.close();}
});
