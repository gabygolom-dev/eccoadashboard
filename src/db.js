export const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
export const first=async(db,sql,...args)=>db.prepare(sql).bind(...args).first();
export const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
export const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
export async function stage(db,runId,kind,key,data) {
  await run(db,'INSERT INTO stage(run_id,kind,key,data) VALUES(?,?,?,?) ON CONFLICT(run_id,kind,key) DO UPDATE SET data=excluded.data',runId,kind,key,JSON.stringify(data));
}

const snapshotKinds=new Set(['contact','contact_stage','conversation','metric']);
export async function stagePage(db,runId,kind,sequence,items){
  if(!snapshotKinds.has(kind)||!Number.isSafeInteger(sequence)||sequence<0)throw new Error('STAGE_PAGE_CONFIGURATION');
  await stage(db,runId,kind+'_page',String(sequence).padStart(10,'0'),items);
}
// Read old item snapshots and compact page snapshots during rolling upgrades.
// Later pages win by sequence; paid flags are unioned across duplicate contacts.
export function stagedRowsSQL(kind){
  if(!snapshotKinds.has(kind))throw new Error('STAGE_KIND_BLOCKED');
  const data=kind==='contact'?"json_set(data,'$.undated',MAX(COALESCE(json_extract(data,'$.undated'),0)) OVER(PARTITION BY key))":'data';
  return `SELECT key,data FROM (
    SELECT key,${data} data,ROW_NUMBER() OVER(PARTITION BY key ORDER BY representation DESC,page_key DESC) version_rank
    FROM (
      SELECT key,data,0 representation,'' page_key FROM stage WHERE run_id=? AND kind='${kind}'
      UNION ALL
      SELECT json_extract(item.value,'$.key'),json_extract(item.value,'$.data'),1,s.key
      FROM stage s,json_each(s.data) item WHERE s.run_id=? AND s.kind='${kind}_page'
    )
  ) WHERE version_rank=1`;
}

export async function stageMany(db,runId,kind,items) {
  // One SQL query per bounded page, rather than one per item. A 100-contact
  // page otherwise exceeds the Free-plan limit of 50 D1 queries per invocation.
  for(let i=0;i<items.length;i+=250){
    await run(db,`INSERT INTO stage(run_id,kind,key,data)
      SELECT ?,?,json_extract(value,'$.key'),json_extract(value,'$.data') FROM json_each(?) WHERE true
      ON CONFLICT(run_id,kind,key) DO UPDATE SET data=CASE WHEN excluded.kind='contact'
      THEN json_set(excluded.data,'$.undated',MAX(COALESCE(json_extract(stage.data,'$.undated'),0),COALESCE(json_extract(excluded.data,'$.undated'),0)))
      ELSE excluded.data END`,runId,kind,JSON.stringify(items.slice(i,i+250)));
  }
}

export async function stageMissingAds(db,runId,metrics){
  for(let i=0;i<metrics.length;i+=250){
    const rows=metrics.slice(i,i+250).map(m=>({key:m.adId,data:{id:m.adId,name:m.adName,campaignId:m.campaignId,campaignName:m.campaignName,adsetId:m.adsetId,adsetName:m.adsetName,status:null,format:null,attribution:null,preview:null}}));
    await run(db,`INSERT OR IGNORE INTO stage(run_id,kind,key,data)
      SELECT ?,'ad',json_extract(value,'$.key'),json_extract(value,'$.data') FROM json_each(?)`,runId,JSON.stringify(rows));
  }
}
