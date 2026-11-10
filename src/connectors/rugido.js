import {readJSON} from './http.js';
import {getPath,safeId,timestamp,daySP,pseudonym} from '../domain.js';
const ORIGIN='https://clientcrm-api.rugido.com';
// Field paths MUST be confirmed against a real, authorized Eccoa response.
export function crmConfig(env) {
  if(env.CRM_API_ORIGIN_APPROVED!=='true') throw new Error('CRM_ORIGIN_NOT_APPROVED');
  if(!env.CRM_TOKEN||!safeId(env.CRM_WORKSPACE_ID)||!env.CRM_WORKSPACE_NAME||!env.PSEUDONYM_KEY) throw new Error('CRM_CONFIGURATION_REQUIRED');
  let s;try{s=JSON.parse(env.CRM_SCHEMA_JSON);}catch{throw new Error('CRM_SCHEMA_NOT_VALIDATED');}
  if(s.validated!==true||!s.contacts||!s.conversations||!s.messages||!s.workspace||!s.evidence||!s.stageNames) throw new Error('CRM_SCHEMA_NOT_VALIDATED');
  return s;
}
export async function crmRead(env,path,params={}) {
  if(env.CRM_API_ORIGIN_APPROVED!=='true') throw new Error('CRM_ORIGIN_NOT_APPROVED');
  if(!/^\/(workspaces\/current|contacts|conversations(?:\/[A-Za-z0-9_-]+\/messages)?)$/.test(path)) throw new Error('CRM_ENDPOINT_BLOCKED');
  const u=new URL(`/api/v1${path}`,ORIGIN);
  for(const [k,v] of Object.entries(params))if(v!==null&&v!==undefined)u.searchParams.set(k,String(v));
  return readJSON(u,{origin:ORIGIN,token:env.CRM_TOKEN,headers:{'X-Workspace-Id':env.CRM_WORKSPACE_ID}});
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
  if(items.length>per||(items.length!==per&&page*per<total))throw new Error('CRM_PAGINATION_INCOMPLETE');
  return {items,total,next:page*per<total?page+1:null};
}
export async function projectContact(raw,s,key) {
  const id=safeId(getPath(raw,s.id));if(!id)throw new Error('CRM_CONTACT_ID_MISSING');
  const stageId=safeId(getPath(raw,s.stageId));
  // Store only labels from the validated pipeline dictionary, never free patient fields.
  const stageName=stageId&&s.stageNames?.[stageId]||'Etapa não informada';
  const undated=s.paidFlag ? getPath(raw,s.paidFlag)===s.paidValue : false;
  return {id:await pseudonym(key,id),stageId,stageName,undated};
}
export async function projectEvent(raw,s,key) {
  const id=safeId(getPath(raw,s.id)), contactId=safeId(getPath(raw,s.contactId));
  if(!id)throw new Error('CRM_MESSAGE_ID_MISSING');
  // Require inbound + an explicit verified paid-evidence field. Never parse message text.
  if(getPath(raw,s.direction)!==s.incomingValue||getPath(raw,s.paidProof)!==s.paidValue)return null;
  if(!contactId)throw new Error('CRM_EVENT_CONTACT_MISSING');
  const at=timestamp(getPath(raw,s.timestamp),s.timestampUnit);
  const adId=safeId(getPath(raw,s.adId));
  const campaignId=safeId(getPath(raw,s.campaignId));
  const adsetId=safeId(getPath(raw,s.adsetId));
  const contact=await pseudonym(key,contactId);
  if(!at)return {undatedContact:contact};
  return {id:await pseudonym(key,`message:${id}`),contactId:contact,at,day:daySP(at),campaignId,adsetId,adId,evidence:'Mensagem recebida com referência paga'};
}
export function messagePage(data,s) {
  const items=getPath(data,s.items);
  if(!Array.isArray(items))throw new Error('CRM_MESSAGES_SCHEMA_MISMATCH');
  const hasMore=getPath(data,s.hasMore);
  if(typeof hasMore!=='boolean')throw new Error('CRM_MESSAGES_PAGINATION_UNVERIFIED');
  const next=hasMore?getPath(data,s.nextCursor):null;
  if(hasMore&&!next)throw new Error('CRM_MESSAGES_CURSOR_MISSING');
  return {items,next};
}
