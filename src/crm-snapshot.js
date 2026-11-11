import {all,first,statement} from './db.js';

const kinds=new Set(['contact','contact_stage','conversation']);
const snapshotKey='crmContactSnapshotV1';
const order=(a,b)=>a<b?-1:a>b?1:0;

// Parse compact pages in the Worker. SQL json_each/window intermediates used to
// charge thousands of reads while the stored snapshot occupied only ~40 rows.
// Legacy item rows remain readable during a rolling deployment.
export async function readCrmSnapshot(db,runId,kind){
  if(!kinds.has(kind))throw new Error('CRM_SNAPSHOT_KIND_BLOCKED');
  const rows=await all(db,'SELECT kind,key,data FROM stage WHERE run_id=? AND kind IN(?,?) ORDER BY kind,key',runId,kind,kind+'_page');
  const items=new Map();
  for(const row of rows){
    const data=JSON.parse(row.data);
    const page=row.kind===kind?[{key:row.key,data}]:data;
    if(!Array.isArray(page))throw new Error('CRM_SNAPSHOT_SCHEMA_MISMATCH');
    for(const item of page){
      if(typeof item?.key!=='string'||!item.data||typeof item.data!=='object')throw new Error('CRM_SNAPSHOT_SCHEMA_MISMATCH');
      const previous=items.get(item.key);
      items.set(item.key,kind==='contact'?{...item.data,undated:!!(previous?.undated||item.data.undated)}:item.data);
    }
  }
  return items;
}

export async function contactDeltaStatements(db,runId,at){
  const [contacts,stages,cached]=await Promise.all([
    readCrmSnapshot(db,runId,'contact'),readCrmSnapshot(db,runId,'contact_stage'),
    first(db,'SELECT value FROM settings WHERE key=?',snapshotKey)
  ]);
  const byContact=new Map();
  for(const stage of stages.values()){
    if(!byContact.has(stage.contactId))byContact.set(stage.contactId,new Map());
    byContact.get(stage.contactId).set(stage.stageId,stage.stageName);
  }
  const current=[...contacts].sort(([a],[b])=>order(a,b)).map(([id,contact])=>{
    const assigned=[...(byContact.get(id)||[])].sort(([a],[b])=>order(a,b));
    return [id,assigned.length?assigned.map(([key])=>key).join(','):contact.stageId||null,
      assigned.length?[...new Set(assigned.map(([,name])=>name))].join(','):contact.stageName||'Etapa não informada',Number(!!contact.undated)];
  });
  const serialized=JSON.stringify(current);
  if(cached?.value===serialized)return [];
  let previous;
  try{
    previous=cached?JSON.parse(cached.value):null;
    if(previous&&!Array.isArray(previous))previous=null;
    if(previous?.some(row=>!Array.isArray(row)||row.length!==4||typeof row[0]!=='string'))previous=null;
  }catch{previous=null;}
  // Bootstrap once from confirmed data. Oversized caches use this safe path;
  // they never lose coverage or exceed D1's per-value limit.
  if(!previous)previous=(await all(db,'SELECT id,stage_id,stage_name,undated FROM contacts')).map(row=>[row.id,row.stage_id,row.stage_name,Number(row.undated)]);
  const before=new Map(previous.map(row=>[row[0],row])),ids=new Set(current.map(row=>row[0]));
  const changed=current.filter(row=>JSON.stringify(before.get(row[0]))!==JSON.stringify(row));
  const removed=previous.filter(row=>!ids.has(row[0])&&(row[1]!==null||row[2]!=='Etapa não informada')).map(row=>row[0]);
  const statements=[];
  const chunks=[];let chunk=[],bytes=2;
  for(const row of changed){
    const size=new TextEncoder().encode(JSON.stringify(row)).byteLength+1;
    if(bytes+size>500000&&chunk.length){chunks.push(chunk);chunk=[];bytes=2;}
    chunk.push(row);bytes+=size;
  }
  if(chunk.length)chunks.push(chunk);
  for(const rows of chunks)statements.push(statement(db,`INSERT INTO contacts(id,stage_id,stage_name,undated,updated_at)
    SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),? FROM json_each(?) WHERE true
    ON CONFLICT(id) DO UPDATE SET stage_id=excluded.stage_id,stage_name=excluded.stage_name,undated=MAX(contacts.undated,excluded.undated),updated_at=excluded.updated_at
    WHERE contacts.stage_id IS NOT excluded.stage_id OR contacts.stage_name IS NOT excluded.stage_name OR contacts.undated<excluded.undated`,at,JSON.stringify(rows)));
  if(removed.length)statements.push(statement(db,`UPDATE contacts SET stage_id=NULL,stage_name='Etapa não informada'
    WHERE id IN(SELECT value FROM json_each(?)) AND (stage_id IS NOT NULL OR stage_name<>'Etapa não informada')`,JSON.stringify(removed)));
  if(new TextEncoder().encode(serialized).byteLength<1500000)statements.push(statement(db,`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value IS NOT excluded.value`,snapshotKey,serialized));
  else if(cached)statements.push(statement(db,'DELETE FROM settings WHERE key=?',snapshotKey));
  return statements;
}
