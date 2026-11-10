export const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
export const first=async(db,sql,...args)=>db.prepare(sql).bind(...args).first();
export const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
export const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
export async function stage(db,runId,kind,key,data) {
  await run(db,'INSERT INTO stage(run_id,kind,key,data) VALUES(?,?,?,?) ON CONFLICT(run_id,kind,key) DO UPDATE SET data=excluded.data',runId,kind,key,JSON.stringify(data));
}

export async function stageMany(db,runId,kind,items) {
  for(let i=0;i<items.length;i+=50){
    await db.batch(items.slice(i,i+50).map(({key,data})=>statement(db,'INSERT INTO stage(run_id,kind,key,data) VALUES(?,?,?,?) ON CONFLICT(run_id,kind,key) DO UPDATE SET data=CASE WHEN excluded.kind=\'contact\' THEN json_set(excluded.data,\'$.undated\',MAX(COALESCE(json_extract(stage.data,\'$.undated\'),0),COALESCE(json_extract(excluded.data,\'$.undated\'),0))) ELSE excluded.data END',runId,kind,key,JSON.stringify(data))));
  }
}

export async function stageMissingAds(db,runId,metrics){
  for(let i=0;i<metrics.length;i+=50){
    await db.batch(metrics.slice(i,i+50).map(m=>statement(db,'INSERT OR IGNORE INTO stage(run_id,kind,key,data) VALUES(?,?,?,?)',runId,'ad',m.adId,JSON.stringify({id:m.adId,name:m.adName,campaignId:m.campaignId,campaignName:m.campaignName,adsetId:m.adsetId,adsetName:m.adsetName,status:null,format:null,attribution:null,preview:null}))));
  }
}
