import {readJSON} from './http.js';
import {RUGIDO_SCHEMA} from './rugido-schema.js';
import {getPath,safeId,timestamp,daySP,pseudonym,digest} from '../domain.js';
const ORIGIN='https://clientcrm-api.rugido.com';
// Field paths MUST be confirmed against a real, authorized Eccoa response.
export function crmConfig(env) {
  if(env.CRM_API_ORIGIN_APPROVED!=='true') throw new Error('CRM_ORIGIN_NOT_APPROVED');
  if(!env.CRM_TOKEN||!safeId(env.CRM_WORKSPACE_ID)||!env.CRM_WORKSPACE_NAME||!env.PSEUDONYM_KEY) throw new Error('CRM_CONFIGURATION_REQUIRED');
  let s;try{s=env.CRM_SCHEMA_JSON?JSON.parse(env.CRM_SCHEMA_JSON):structuredClone(RUGIDO_SCHEMA);}catch{throw new Error('CRM_SCHEMA_NOT_VALIDATED');}
  if(s.validated!==true||!s.contacts||!s.conversations||!s.messages||!s.workspace||!s.evidence||!s.stageNames) throw new Error('CRM_SCHEMA_NOT_VALIDATED');
  return s;
}
export async function crmRead(env,path,params={}) {
  if(env.CRM_API_ORIGIN_APPROVED!=='true') throw new Error('CRM_ORIGIN_NOT_APPROVED');
  if(!/^\/(workspaces\/current|pipelines|contacts|conversations(?:\/[A-Za-z0-9_-]+\/messages)?)$/.test(path)) throw new Error('CRM_ENDPOINT_BLOCKED');
  const u=new URL(`/api/v1${path}`,ORIGIN);
  for(const [k,v] of Object.entries(params))if(v!==null&&v!==undefined)u.searchParams.set(k,String(v));
  return readJSON(u,{origin:ORIGIN,token:env.CRM_TOKEN,auth:'api_access_token',headers:{'X-Workspace-Id':env.CRM_WORKSPACE_ID}});
}
export async function verifyWorkspace(env,s) {
  const data=await crmRead(env,'/workspaces/current');
  const id=String(getPath(data,s.workspace.id)||'');const name=getPath(data,s.workspace.name);
  if(id!==env.CRM_WORKSPACE_ID||name!==env.CRM_WORKSPACE_NAME)throw new Error('CRM_WORKSPACE_MISMATCH');
  return {id,name,origin:ORIGIN,schemaConfirmed:true};
}
export function pageItems(data,s,page) {
  const items=getPath(data,s.items);
  const total=Number(getPath(data,s.total));
  if(!Array.isArray(items)||!Number.isInteger(total)||total<0)throw new Error('CRM_PAGINATION_SCHEMA_MISMATCH');
  const per=s.perPage||100;
  if(s.responsePage&&Number(getPath(data,s.responsePage))!==page)throw new Error('CRM_RESPONSE_PAGE_MISMATCH');
  if(s.paginationMode==='until-empty'){
    if(items.length>per)throw new Error('CRM_PAGINATION_SCHEMA_MISMATCH');
    return {items,total,next:items.length?page+1:null};
  }
  if(items.length>per||(items.length!==per&&page*per<total))throw new Error('CRM_PAGINATION_INCOMPLETE');
  return {items,total,next:page*per<total?page+1:null};
}
export async function projectContact(raw,s,key) {
  const id=safeId(getPath(raw,s.id));if(!id)throw new Error('CRM_CONTACT_ID_MISSING');
  const stageId=safeId(getPath(raw,s.stageId));
  // Store only labels from the validated pipeline dictionary, never free patient fields.
  const stageName=stageId&&s.stageNames?.[stageId]||'Etapa não informada';
  const undated=s.paidIdPath ? /^\d{5,25}$/.test(String(getPath(raw,s.paidIdPath)||'')) : s.paidFlag ? getPath(raw,s.paidFlag)===s.paidValue : false;
  return {id:await pseudonym(key,id),stageId,stageName,undated};
}
export async function projectEvent(raw,s,key,context={}) {
  const id=safeId(getPath(raw,s.id)), contactId=safeId(getPath(raw,s.contactId));
  if(!id)throw new Error('CRM_MESSAGE_ID_MISSING');
  // Require inbound + an explicit verified paid-evidence field. Never parse message text.
  if(raw.private===true||getPath(raw,s.direction)!==s.incomingValue)return null;
  const paid=s.paidIdPath?/^\d{5,25}$/.test(String(getPath(raw,s.paidIdPath)||'')):!!s.paidProof&&getPath(raw,s.paidProof)===s.paidValue;
  if(!paid)return null;
  if(!contactId)throw new Error('CRM_EVENT_CONTACT_MISSING');
  const primary=getPath(raw,s.timestamp);
  const at=primary!==undefined&&primary!==null?timestamp(primary,s.timestampUnit):timestamp(getPath(raw,s.timestampFallback),s.timestampFallbackUnit);
  const adId=safeId(getPath(raw,s.adId));
  const campaignId=safeId(getPath(raw,s.campaignId));
  const adsetId=safeId(getPath(raw,s.adsetId));
  const contact=await pseudonym(key,contactId);
  if(context.contactId&&context.contactId!==contact)throw new Error('CRM_MESSAGE_CONTACT_MISMATCH');
  if(context.conversationId&&raw.conversation_id!==context.conversationId)throw new Error('CRM_MESSAGE_CONVERSATION_MISMATCH');
  if(!at)return {undatedContact:contact};
  const external=s.externalId?getPath(raw,s.externalId):null;
  const eventKey=typeof external==='string'&&external.length>0&&external.length<=2048?`external:${contact}:${external}`:`message:${id}`;
  return {id:await pseudonym(key,eventKey),contactId:contact,at,day:daySP(new Date(at)),campaignId,adsetId,adId,evidence:'Mensagem recebida com referência paga'};
}
export function messagePage(data,s) {
  const items=getPath(data,s.items);
  if(!Array.isArray(items))throw new Error('CRM_MESSAGES_SCHEMA_MISMATCH');
  if(s.paginationMode==='before-empty'){
    if(!items.length)return {items,next:null};
    if(s.orderTimestamp&&items.some((m,i)=>i>0&&Number(getPath(m,s.orderTimestamp))<Number(getPath(items[i-1],s.orderTimestamp))))throw new Error('CRM_MESSAGE_ORDER_MISMATCH');
    const next=safeId(getPath(items[0],s.id));
    if(!next)throw new Error('CRM_MESSAGES_CURSOR_MISSING');
    return {items,next};
  }
  const hasMore=getPath(data,s.hasMore);
  if(typeof hasMore!=='boolean')throw new Error('CRM_MESSAGES_PAGINATION_UNVERIFIED');
  const next=hasMore?getPath(data,s.nextCursor):null;
  if(hasMore&&!next)throw new Error('CRM_MESSAGES_CURSOR_MISSING');
  return {items,next};
}

export function projectPipelines(data,s,workspaceId){
  const items=getPath(data,s.items);if(!Array.isArray(items))throw new Error('CRM_PIPELINE_SCHEMA_MISMATCH');
  const stages={};
  for(const p of items){
    if(p.workspace_id!==workspaceId||!Array.isArray(p.stages))throw new Error('CRM_PIPELINE_WORKSPACE_MISMATCH');
    for(const stage of p.stages){
      if(stage.pipeline_id!==p.id||!safeId(stage.id)||typeof stage.name!=='string'||typeof p.name!=='string')throw new Error('CRM_STAGE_SCHEMA_MISMATCH');
      stages[stage.id]={id:stage.id,name:stage.name,pipelineId:p.id,pipelineName:p.name};
    }
  }
  return stages;
}
export async function projectConversation(raw,s,key,dictionary){
  const id=safeId(getPath(raw,s.id)),rawContact=safeId(getPath(raw,s.contactId));
  if(!id||!rawContact)throw new Error('CRM_CONVERSATION_CONTACT_MISSING');
  const contactId=await pseudonym(key,rawContact),stages=[];
  for(const pipeline of raw.pipelines||[])for(const current of pipeline.stages||[]){
    const stage=dictionary[current.id];
    if(!stage||stage.pipelineId!==pipeline.id)throw new Error('CRM_CURRENT_STAGE_MISMATCH');
    stages.push({contactId,stageId:stage.id,stageName:stage.pipelineName+' · '+stage.name});
  }
  return {id,contactId,stages,...await conversationVersion(raw)};
}

async function conversationVersion(raw){
  const missing={fingerprint:null,versionAt:null};
  if(!Object.hasOwn(raw,'last_non_activity_message'))return missing;
  const parse=value=>timestamp(value,typeof value==='number'||/^\d+(?:\.\d+)?$/.test(String(value||''))?'seconds':'iso');
  const updated=parse(raw.updated_at),activity=parse(raw.last_activity_at);
  const last=raw.last_non_activity_message;
  if(!updated||!activity||(last!==null&&!safeId(last?.id)))return missing;
  // Keep only a hash of operational version markers, never message content.
  const latestMessage=last?parse(last.created_at):null;
  if(last&&Object.hasOwn(last,'created_at')&&last.created_at!==null&&!latestMessage)return missing;
  return {fingerprint:await digest(JSON.stringify([updated,activity,last?.id||null])),versionAt:[updated,activity,latestMessage].filter(Boolean).sort().at(-1)};
}
export function conversationNeedsScan(cached,fingerprint,startedAt){
  if(!fingerprint||cached?.fingerprint!==fingerprint)return true;
  const age=Date.parse(startedAt)-Date.parse(cached?.full_scan_at);
  return !Number.isFinite(age)||age<0||age>=24*3600000;
}
