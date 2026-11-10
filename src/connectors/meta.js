import {readJSON,nextCursor} from './http.js';
import {ECCOA_META} from './meta-schema.js';
import {metaActions,daySP,addDays,validateRange} from '../domain.js';
export const META_ORIGIN='https://graph.facebook.com';
export function metaConfig(env) {
  if(env.META_ACCOUNT_ID!==ECCOA_META.accountId)throw new Error('META_ACCOUNT_SCOPE_BLOCKED');
  if(env.META_API_VERSION!==ECCOA_META.apiVersion)throw new Error('META_API_VERSION_NOT_VALIDATED');
  if(env.META_CONVERSATION_ACTION!==ECCOA_META.conversationAction)throw new Error('META_CONVERSATION_ACTION_NOT_VALIDATED');
  if(!env.META_TOKEN||!/^\d+$/.test(env.META_ACCOUNT_ID||'')||!/^v\d+\.0$/.test(env.META_API_VERSION||'')||!/^\d{4}-\d{2}-\d{2}$/.test(env.HISTORY_START||''))throw new Error('META_CONFIGURATION_REQUIRED');
}
export async function metaRead(env,edge,params={}) {
  metaConfig(env);
  if(!['','/ads','/insights'].includes(edge))throw new Error('META_ENDPOINT_BLOCKED');
  const u=new URL(`/${env.META_API_VERSION}/act_${env.META_ACCOUNT_ID}${edge}`,META_ORIGIN);
  for(const [k,v] of Object.entries(params))if(v!==null&&v!==undefined)u.searchParams.set(k,typeof v==='object'?JSON.stringify(v):String(v));
  return readJSON(u,{origin:META_ORIGIN,token:env.META_TOKEN,expectedVersion:env.META_API_VERSION});
}
export async function verifyMeta(env) {
  const a=await metaRead(env,'',{fields:'id,name,currency,timezone_name,account_status'});
  if(a.id!==`act_${env.META_ACCOUNT_ID}`||a.name!==env.META_ACCOUNT_NAME)throw new Error('META_ACCOUNT_MISMATCH');
  if(a.timezone_name!=='America/Sao_Paulo'||a.currency!=='BRL')throw new Error('META_TIMEZONE_OR_CURRENCY_MISMATCH');
  return {id:a.id,name:a.name,currency:a.currency,timezone:a.timezone_name,version:env.META_API_VERSION,attribution:'use_unified_attribution_setting=true',action:env.META_CONVERSATION_ACTION,conversationsValidated:env.META_METRIC_VALIDATED==='true'};
}
export async function adsPage(env,after,limit=100) {
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('META_PAGE_LIMIT_INVALID');
  const data=await metaRead(env,'/ads',{fields:'id,account_id,name,status,effective_status,campaign{id,name},adset{id,name,attribution_spec},creative{id,object_type}',limit,after});
  if(!Array.isArray(data.data))throw new Error('META_ADS_SCHEMA_MISMATCH');
  if(data.data.some(a=>a.account_id!==ECCOA_META.accountId))throw new Error('META_AD_ACCOUNT_MISMATCH');
  const ads=data.data.map(a=>({id:a.id,name:a.name,campaignId:a.campaign?.id,campaignName:a.campaign?.name,adsetId:a.adset?.id,adsetName:a.adset?.name,status:a.effective_status||a.status,format:a.creative?.object_type||null,attribution:a.adset?.attribution_spec||null,preview:null}));
  if(ads.some(a=>!a.id||!a.campaignId||!a.adsetId))throw new Error('META_AD_HIERARCHY_MISSING');
  return {items:ads,next:nextCursor(data,META_ORIGIN,env.META_ACCOUNT_ID)};
}
export async function insightPage(env,start,end,after,limit=250) {
  if(!Number.isInteger(limit)||limit<1||limit>250)throw new Error('META_PAGE_LIMIT_INVALID');
  const d=await metaRead(env,'/insights',{fields:'account_id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,inline_link_clicks,actions,attribution_setting,date_start,date_stop',level:'ad',time_range:{since:start,until:end},time_increment:1,use_unified_attribution_setting:true,action_report_time:'impression',limit,after});
  if(!Array.isArray(d.data))throw new Error('META_INSIGHTS_SCHEMA_MISMATCH');
  const items=d.data.map(r=>{
    if(r.account_id!==env.META_ACCOUNT_ID||r.date_start!==r.date_stop||r.date_start<start||r.date_start>end)throw new Error('META_SCOPE_MISMATCH');
    if(!r.ad_id||!r.adset_id||!r.campaign_id)throw new Error('META_AD_HIERARCHY_MISSING');
    const number=k=>{const n=Number(r[k]||0);if(!Number.isFinite(n)||n<0)throw new Error('META_INVALID_METRIC');return n;};
    return {day:r.date_start,adId:r.ad_id,adName:r.ad_name,campaignId:r.campaign_id,campaignName:r.campaign_name,adsetId:r.adset_id,adsetName:r.adset_name,spend:number('spend'),impressions:number('impressions'),clicks:number('inline_link_clicks'),attributionSetting:r.attribution_setting||null,conversations:env.META_METRIC_VALIDATED==='true'?metaActions(r.actions,env.META_CONVERSATION_ACTION):null};
  });
  return {items,next:nextCursor(d,META_ORIGIN,env.META_ACCOUNT_ID)};
}
export function syncRange(env,confirmed) {
  const end=daySP();const start=confirmed? [env.HISTORY_START,addDays(end,-35)].sort().at(-1):env.HISTORY_START;
  if(start>end)throw new Error('META_HISTORY_START_IN_FUTURE');
  return {start,end};
}

export async function exactReach(env,start,end,scope={}){
  validateRange(start,end);
  const level=scope.ad?'ad':scope.campaign?'campaign':'account';
  const filtering=[];
  if(scope.campaign)filtering.push({field:'campaign.id',operator:'IN',value:[scope.campaign]});
  if(scope.ad)filtering.push({field:'ad.id',operator:'IN',value:[scope.ad]});
  const d=await metaRead(env,'/insights',{fields:'account_id,campaign_id,ad_id,reach,date_start,date_stop',level,time_range:{since:start,until:end},...(filtering.length?{filtering}:{}),use_unified_attribution_setting:true,action_report_time:'impression',limit:2});
  if(!Array.isArray(d.data)||d.data.length>1||d.paging?.next)throw new Error('META_REACH_SCOPE_AMBIGUOUS');
  if(!d.data.length)return 0;
  const row=d.data[0];
  if(row.account_id!==ECCOA_META.accountId||row.date_start!==start||row.date_stop!==end||(scope.campaign&&row.campaign_id!==scope.campaign)||(scope.ad&&row.ad_id!==scope.ad))throw new Error('META_REACH_SCOPE_MISMATCH');
  const value=Number(row.reach);if(row.reach===undefined||!Number.isSafeInteger(value)||value<0)throw new Error('META_REACH_VALUE_INVALID');
  return value;
}
