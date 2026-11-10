import test from 'node:test';
import assert from 'node:assert/strict';
import {stageMany,stageMissingAds} from '../src/db.js';
import {createDB} from '../scripts/local-db.mjs';

test('páginas reais de contatos e insights cabem no limite de consultas D1 e mantêm deduplicação',async()=>{
 const db=createDB();let queries=0;
 const limited={prepare(sql){queries++;if(queries>50)throw Error('D1_TOO_MANY_QUERIES');return db.prepare(sql);}};
 try{
  const contacts=Array.from({length:100},(_,i)=>({key:'contact-'+i,data:{id:'contact-'+i,stageName:'Etapa não informada',undated:i===0}}));
  await stageMany(limited,'run','contact',contacts);
  await stageMany(limited,'run','contact',[{key:'contact-0',data:{id:'contact-0',stageName:'Etapa não informada',undated:false}}]);
  const metrics=Array.from({length:250},(_,i)=>({key:'2026-11-10:ad-'+i,data:{adId:'ad-'+i,adName:'Anúncio '+i,campaignId:'c',adsetId:'s'}}));
  await stageMany(limited,'run','metric',metrics);
  await stageMissingAds(limited,'run',metrics.map(x=>x.data));
  assert.equal(queries,4);
  assert.equal((await db.prepare("SELECT count(*) n FROM stage WHERE kind='contact'").first()).n,100);
  assert.equal(JSON.parse((await db.prepare("SELECT data FROM stage WHERE kind='contact' AND key='contact-0'").first()).data).undated,1);
  await stageMany(limited,'run','ad',[{key:'ad-0',data:{id:'ad-0',name:'Metadados consultados',status:'ACTIVE'}}]);
  await stageMissingAds(limited,'run',metrics.map(x=>x.data));
  assert.equal(JSON.parse((await db.prepare("SELECT data FROM stage WHERE kind='ad' AND key='ad-0'").first()).data).name,'Metadados consultados');
  assert.equal((await db.prepare("SELECT count(*) n FROM stage WHERE kind='ad'").first()).n,250);
 }finally{db.close();}
});
