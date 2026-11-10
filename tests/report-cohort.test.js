import test from 'node:test';
import assert from 'node:assert/strict';
import {createDB} from '../scripts/local-db.mjs';
import {makeReport} from '../src/report.js';

test('relatório reutiliza uma seleção CRM e mantém somas, filtro após deduplicação e paginação',async()=>{
 const db=createDB();try{
  db.sqlite.exec("UPDATE sources SET confirmed_at='2026-11-09T22:00:00Z' WHERE provider='crm'");
  const event=db.sqlite.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)');
  for(let i=0;i<56;i++){
   const id='p'+String(i).padStart(2,'0');
   db.sqlite.prepare('INSERT INTO contacts VALUES(?,?,?,?,?)').run(id,'s','Contato',0,'2026-11-09');
   event.run('e'+i,id,'2026-11-09T12:00:00Z','2026-11-09',i<30?'A':'B','s','a','Mensagem recebida com referência paga');
  }
  event.run('return','p00','2026-11-09T13:00:00Z','2026-11-09','B','s','b','Mensagem recebida com referência paga');
  let rankedQueries=0;
  const wrapped={...db,prepare(sql){if(sql.includes('WITH ranked AS'))rankedQueries++;return db.prepare(sql);}};
  const env={ECCOA_DB:wrapped};
  const report=await makeReport(env,new URL('https://test/api/report?start=2026-11-09&end=2026-11-09&page=2'));
  assert.equal(rankedQueries,1);
  assert.equal(report.totals.contacts,56);assert.equal(report.contacts.length,6);
  assert.equal(report.entries.reduce((sum,row)=>sum+row.contacts,0),56);
  assert.equal(report.funnel[0].contacts,56);assert.equal(report.series[0].contacts,56);
  assert.ok(report.contacts.every(row=>row.label.startsWith('Contato ')&&row.stage==='Contato'));
  const filtered=await makeReport(env,new URL('https://test/api/report?start=2026-11-09&end=2026-11-09&campaign=B'));
  assert.equal(filtered.totals.contacts,26);assert.ok(!filtered.contacts.some(row=>row.contactId==='p00'));
  assert.equal(filtered.entries[0].contacts,26);
 }finally{db.close();}
});
