import {all,first,run,statement,stage,stageMany,stageMissingAds} from './db.js';
import {crmConfig,crmRead,verifyWorkspace,pageItems,projectContact,projectEvent,messagePage,projectPipelines,projectConversation} from './connectors/rugido.js';
import {metaConfig,verifyMeta,adsPage,insightPage,syncRange,exactReach} from './connectors/meta.js';
import {getPath,safeId,addDays} from './domain.js';
export async function startCycle(env,scheduledAt=new Date().toISOString()) {
  await run(env.ECCOA_DB,"INSERT INTO settings(key,value) VALUES('lastCron',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",scheduledAt);
  for(const provider of ['crm','meta']) {
    const active=await first(env.ECCOA_DB,"SELECT id FROM runs WHERE provider=? AND state='running'",provider);
    if(active){await env.ECCOA_JOBS.send({runId:active.id,provider});continue;}
    try {if(provider==='crm')crmConfig(env);else metaConfig(env);}
    catch(e){await run(env.ECCOA_DB,'UPDATE sources SET error=? WHERE provider=?',safeError(e),provider);continue;}
    const id=crypto.randomUUID();
    try {
      await env.ECCOA_DB.batch([
        statement(env.ECCOA_DB,"INSERT INTO runs(id,provider,state,cursor_json,started_at) VALUES(?,?,'running','{}',?)",id,provider,scheduledAt),
        statement(env.ECCOA_DB,'UPDATE sources SET active_run=?,started_at=?,error=NULL WHERE provider=?',id,scheduledAt,provider)
      ]);
    } catch {continue;} // Unique active-run index is the cross-invocation lock.
    await env.ECCOA_JOBS.send({runId:id,provider});
  }
  await env.ECCOA_DB.batch([
    statement(env.ECCOA_DB,'DELETE FROM sessions WHERE expires<?',Date.now()),
    statement(env.ECCOA_DB,'DELETE FROM attempts WHERE expires<?',Date.now()),
    statement(env.ECCOA_DB,"DELETE FROM stage WHERE run_id IN (SELECT id FROM runs WHERE state<>'running' AND started_at<?)",new Date(Date.now()-7*86400000).toISOString())
  ]);
}
export function safeError(e) {
  return /^[A-Z][A-Z0-9_]{2,90}$/.test(e?.message||'')?e.message:'SYNC_INTERNAL_ERROR';
}
export async function processJob(env,body) {
  if(!['crm','meta'].includes(body?.provider)||!/^[\da-f-]{36}$/.test(body?.runId||''))return;
  const db=env.ECCOA_DB,owner=crypto.randomUUID(),now=Date.now();
  const claimed=await run(db,"UPDATE runs SET lease_owner=?,lease_until=? WHERE id=? AND provider=? AND state='running' AND lease_until<?",owner,now+90000,body.runId,body.provider,now);
  if(!claimed.meta.changes)return;
  const job=await first(db,'SELECT * FROM runs WHERE id=?',body.runId);
  let cursor=JSON.parse(job.cursor_json);
  try {
    cursor=body.provider==='crm'?await crmStep(env,job,cursor):await metaStep(env,job,cursor);
    if(cursor.done) await publishRun(env,job,cursor);
    else {
      await run(db,'UPDATE runs SET cursor_json=?,pages=pages+1,retries=0,lease_until=0,lease_owner=NULL WHERE id=? AND lease_owner=?',JSON.stringify(cursor),job.id,owner);
      await env.ECCOA_JOBS.send(body);
    }
  }catch(e){
    const error=safeError(e),tries=job.retries+1;
    if(tries>=7 || /MISMATCH|NOT_VALIDATED|CONFIGURATION|BLOCKED|UNVERIFIED/.test(error)) {
      await db.batch([
        statement(db,"UPDATE runs SET state='failed',finished_at=?,error=?,lease_until=0 WHERE id=?",new Date().toISOString(),error,job.id),
        statement(db,'UPDATE sources SET active_run=NULL,error=? WHERE provider=? AND active_run=?',error,job.provider,job.id)
      ]);
    }else{
      await run(db,'UPDATE runs SET retries=?,error=?,lease_until=0,lease_owner=NULL WHERE id=?',tries,error,job.id);
      await env.ECCOA_JOBS.send(body,{delaySeconds:Math.min(3600,Math.max(e.retryAfter||0,2**tries*5))});
    }
  }
}
async function crmStep(env,job,c) {
  const s=crmConfig(env),db=env.ECCOA_DB;
  if(c.page>10000)throw new Error('CRM_PAGE_LIMIT_REACHED');
  if(!c.phase) {const identity=await verifyWorkspace(env,s);await stage(db,job.id,'identity','crm',identity);return {phase:s.pipelines?'pipelines':'contacts',page:1,count:0};}
  if(c.phase==='pipelines'){
    const dictionary=projectPipelines(await crmRead(env,'/pipelines'),s.pipelines,env.CRM_WORKSPACE_ID);
    await stage(db,job.id,'dictionary','stages',dictionary);
    return {phase:'contacts',page:1,count:0};
  }
  if(c.phase==='contacts'){
    const spec={...s.contacts,stageNames:s.stageNames};
    const d=await crmRead(env,'/contacts',{...(spec.params||{}),page:c.page,per_page:spec.perPage||100});
    const p=pageItems(d,spec,c.page);
    if(c.total!==undefined&&c.total!==p.total)throw new Error('CRM_LIST_CHANGED_RETRY');
    const contacts=await Promise.all(p.items.map(raw=>projectContact(raw,spec,env.PSEUDONYM_KEY)));
    await stageMany(db,job.id,'contact',contacts.map(contact=>({key:contact.id,data:contact})));
    const count=c.count+p.items.length;
    if(p.next)return {...c,total:p.total,count,page:p.next};
    const unique=await first(db,"SELECT count(*) n FROM stage WHERE run_id=? AND kind='contact'",job.id);
    if(unique.n!==p.total||count<p.total||(!spec.allowDuplicateIds&&count!==p.total))throw new Error('CRM_CONTACT_COVERAGE_INCOMPLETE');
    return {phase:'conversations',page:1,count:0};
  }
  if(c.phase==='conversations'){
    const spec=s.conversations;
    const d=await crmRead(env,'/conversations',{...(spec.params||{}),page:c.page,per_page:spec.perPage||100});
    const p=pageItems(d,spec,c.page);
    if(c.total!==undefined&&c.total!==p.total)throw new Error('CRM_LIST_CHANGED_RETRY');
    const dictionaryRow=await first(db,"SELECT data FROM stage WHERE run_id=? AND kind='dictionary' AND key='stages'",job.id);
    const dictionary=dictionaryRow?JSON.parse(dictionaryRow.data):{};
    const conversations=await Promise.all(p.items.map(raw=>projectConversation(raw,spec,env.PSEUDONYM_KEY,dictionary)));
    await stageMany(db,job.id,'conversation',conversations.map(conv=>({key:conv.id,data:{id:conv.id,contactId:conv.contactId}})));
    await stageMany(db,job.id,'contact_stage',conversations.flatMap(conv=>conv.stages.map(current=>({key:current.contactId+':'+current.stageId,data:current}))));
    const count=c.count+p.items.length;
    if(p.next)return {...c,total:p.total,count,page:p.next};
    const unique=await first(db,"SELECT count(*) n FROM stage WHERE run_id=? AND kind='conversation'",job.id);
    if(unique.n!==p.total||count<p.total||(!spec.allowDuplicateIds&&count!==p.total))throw new Error('CRM_CONVERSATION_COVERAGE_INCOMPLETE');
    return {phase:'messages',conversationAfter:'',messageCursor:null};
  }
  if(c.phase==='messages'){
    const conv=await first(db,"SELECT key,data FROM stage WHERE run_id=? AND kind='conversation' AND key>? ORDER BY key LIMIT 1",job.id,c.conversationAfter);
    if(!conv)return {...c,done:true};
    const params={...(s.messages.params||{})};if(c.messageCursor)params[s.messages.cursorParam]=c.messageCursor;
    const data=await crmRead(env,`/conversations/${conv.key}/messages`,params);
    const p=messagePage(data,s.messages);
    const context={contactId:JSON.parse(conv.data).contactId,conversationId:conv.key};
    if(p.items.some(raw=>raw.conversation_id!==conv.key))throw new Error('CRM_MESSAGE_CONVERSATION_MISMATCH');
    const projected=await Promise.all(p.items.map(raw=>projectEvent(raw,s.evidence,env.PSEUDONYM_KEY,context)));
    await stageMany(db,job.id,'undated',projected.filter(e=>e?.undatedContact).map(e=>({key:e.undatedContact,data:{id:e.undatedContact}})));
    await stageMany(db,job.id,'event',projected.filter(e=>e&&!e.undatedContact).map(e=>({key:e.id,data:e})));
    if(p.next===c.messageCursor&&p.next)throw new Error('CRM_REPEATED_MESSAGE_CURSOR');
    return {...c,messageCursor:p.next||null,conversationAfter:p.next?c.conversationAfter:conv.key};
  }
  throw new Error('CRM_INVALID_CHECKPOINT');
}
async function metaStep(env,job,c){
  const db=env.ECCOA_DB;
  if(!c.phase){
    const identity=await verifyMeta(env);await stage(db,job.id,'identity','meta',identity);
    const source=await first(db,"SELECT confirmed_at FROM sources WHERE provider='meta'");
    return {phase:'ads',after:null,...syncRange(env,source.confirmed_at)};
  }
  if(c.phase==='ads'){
    const p=await adsPage(env,c.after);
    await stageMany(db,job.id,'ad',p.items.map(ad=>({key:ad.id,data:ad})));
    if(p.next===c.after&&p.next)throw new Error('META_REPEATED_CURSOR');
    return p.next?{...c,after:p.next}:{...c,phase:'insights',windowStart:c.start,windowEnd:[addDays(c.start,6),c.end].sort()[0],after:null};
  }
  if(c.phase==='insights'){
    const p=await insightPage(env,c.windowStart,c.windowEnd,c.after);
    await stageMany(db,job.id,'metric',p.items.map(metric=>({key:`${metric.day}:${metric.adId}`,data:metric})));
    await stageMissingAds(db,job.id,p.items);
    if(p.next===c.after&&p.next)throw new Error('META_REPEATED_CURSOR');
    if(p.next)return {...c,after:p.next};
    if(c.windowEnd===c.end)return {...c,phase:'reach',reachAfter:'',reachCount:0};
    return {...c,after:null,windowStart:addDays(c.windowEnd,1),windowEnd:[addDays(c.windowEnd,7),c.end].sort()[0]};
  }
  if(c.phase==='reach'){
    if(c.reachCount>=100)return {...c,done:true};
    const request=await first(db,"SELECT * FROM reach_reports WHERE id>? AND requested_at>? AND (confirmed_at IS NULL OR confirmed_at<?) ORDER BY id LIMIT 1",c.reachAfter,new Date(Date.now()-30*86400000).toISOString(),job.started_at);
    if(!request)return {...c,done:true};
    let value=null,error=null;
    try{
      if(request.ad_id||request.campaign_id){
        const scope=await first(db,`SELECT 1 found FROM stage WHERE run_id=? AND kind='ad' AND (? IS NULL OR key=?) AND (? IS NULL OR json_extract(data,'$.campaignId')=?) LIMIT 1`,job.id,request.ad_id,request.ad_id,request.campaign_id,request.campaign_id);
        if(!scope)throw new Error('META_REACH_SCOPE_UNVERIFIED');
      }
      value=await exactReach(env,request.start,request.end,{campaign:request.campaign_id,ad:request.ad_id});
    }catch(e){error=safeError(e);}
    await stage(db,job.id,'reach',request.id,{value,error});
    return {...c,reachAfter:request.id,reachCount:c.reachCount+1};
  }
  throw new Error('META_INVALID_CHECKPOINT');
}
export async function publishRun(env,job,c){
  const db=env.ECCOA_DB,at=new Date().toISOString(),stmts=[];
  if(job.provider==='crm'){
    stmts.push(statement(db,"UPDATE contacts SET stage_id=NULL,stage_name='Etapa não informada'"));
    stmts.push(statement(db,`INSERT INTO contacts(id,stage_id,stage_name,undated,updated_at)
      SELECT key,json_extract(data,'$.stageId'),json_extract(data,'$.stageName'),json_extract(data,'$.undated'),? FROM stage WHERE run_id=? AND kind='contact'
      ON CONFLICT(id) DO UPDATE SET stage_id=excluded.stage_id,stage_name=excluded.stage_name,undated=excluded.undated,updated_at=excluded.updated_at`,at,job.id));
    stmts.push(statement(db,`UPDATE contacts SET stage_id=(SELECT group_concat(DISTINCT json_extract(data,'$.stageId')) FROM stage WHERE run_id=? AND kind='contact_stage' AND json_extract(data,'$.contactId')=contacts.id),stage_name=(SELECT group_concat(DISTINCT json_extract(data,'$.stageName')) FROM stage WHERE run_id=? AND kind='contact_stage' AND json_extract(data,'$.contactId')=contacts.id) WHERE id IN (SELECT json_extract(data,'$.contactId') FROM stage WHERE run_id=? AND kind='contact_stage')`,job.id,job.id,job.id));
    stmts.push(statement(db,`INSERT INTO events(id,contact_id,at,day,campaign_id,adset_id,ad_id,evidence)
      SELECT key,json_extract(data,'$.contactId'),json_extract(data,'$.at'),json_extract(data,'$.day'),json_extract(data,'$.campaignId'),json_extract(data,'$.adsetId'),json_extract(data,'$.adId'),json_extract(data,'$.evidence') FROM stage WHERE run_id=? AND kind='event'
      ON CONFLICT(id) DO NOTHING`,job.id));
    stmts.push(statement(db,`INSERT INTO contacts(id,stage_name,undated,updated_at) SELECT key,'Etapa não informada',1,? FROM stage WHERE run_id=? AND kind='undated'
      ON CONFLICT(id) DO UPDATE SET undated=1`,at,job.id));
  }else{
    stmts.push(statement(db,`INSERT INTO ads(id,data) SELECT key,data FROM stage WHERE run_id=? AND kind='ad' ON CONFLICT(id) DO UPDATE SET data=excluded.data`,job.id));
    stmts.push(statement(db,`UPDATE reach_reports SET value=COALESCE((SELECT json_extract(data,'$.value') FROM stage WHERE run_id=? AND kind='reach' AND key=reach_reports.id),value),confirmed_at=CASE WHEN (SELECT json_extract(data,'$.value') FROM stage WHERE run_id=? AND kind='reach' AND key=reach_reports.id) IS NOT NULL THEN ? ELSE confirmed_at END,error=(SELECT json_extract(data,'$.error') FROM stage WHERE run_id=? AND kind='reach' AND key=reach_reports.id) WHERE id IN(SELECT key FROM stage WHERE run_id=? AND kind='reach')`,job.id,job.id,at,job.id,job.id));
    stmts.push(statement(db,'DELETE FROM metrics WHERE day BETWEEN ? AND ?',c.start,c.end));
    stmts.push(statement(db,`INSERT INTO metrics(day,ad_id,campaign_id,adset_id,data,run_id) SELECT json_extract(data,'$.day'),json_extract(data,'$.adId'),json_extract(data,'$.campaignId'),json_extract(data,'$.adsetId'),data,? FROM stage WHERE run_id=? AND kind='metric'`,job.id,job.id));
    stmts.push(statement(db,`INSERT INTO metric_revisions(run_id,day,ad_id,data,confirmed_at) SELECT ?,json_extract(data,'$.day'),json_extract(data,'$.adId'),data,? FROM stage WHERE run_id=? AND kind='metric' ON CONFLICT DO NOTHING`,job.id,at,job.id));
    // One recursive insert, keeping large historical backfills within D1 batch limits.
    stmts.push(statement(db,`WITH RECURSIVE days(day) AS (SELECT ? UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<?)
      INSERT INTO meta_coverage(day,confirmed_at) SELECT day,? FROM days WHERE true ON CONFLICT(day) DO UPDATE SET confirmed_at=excluded.confirmed_at`,c.start,c.end,at));
  }
  stmts.push(statement(db,"UPDATE runs SET state='completed',finished_at=?,cursor_json=?,lease_until=0,lease_owner=NULL WHERE id=?",at,JSON.stringify(c),job.id));
  stmts.push(statement(db,`UPDATE sources SET active_run=NULL,error=NULL,confirmed_at=?,completed_runs=completed_runs+1,
    identity_json=(SELECT data FROM stage WHERE run_id=? AND kind='identity' LIMIT 1) WHERE provider=? AND active_run=?`,at,job.id,job.provider,job.id));
  // D1 batch is transactional: confirmed data remains untouched on any failure.
  await db.batch(stmts);
}
