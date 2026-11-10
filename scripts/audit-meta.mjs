import {loadMetaCredential} from './meta-credential.mjs';
import {verifyMeta,adsPage,insightPage,metaRead,exactReach} from '../src/connectors/meta.js';
import {ECCOA_META} from '../src/connectors/meta-schema.js';
import {daySP,presetRange,aggregateMetrics,metaActions,addDays} from '../src/domain.js';
const env={META_TOKEN:loadMetaCredential(process.argv[2]),META_ACCOUNT_ID:ECCOA_META.accountId,META_ACCOUNT_NAME:ECCOA_META.accountName,META_API_VERSION:ECCOA_META.apiVersion,META_CONVERSATION_ACTION:ECCOA_META.conversationAction,META_METRIC_VALIDATED:'true',HISTORY_START:'2025-12-01'};
const identity=await verifyMeta(env);console.log(JSON.stringify({step:'identity-confirmed',id:identity.id,name:identity.name,version:identity.version,currency:identity.currency,timezone:identity.timezone}));
const ads=new Map(),seenCursors=new Set();let after=null,adPages=0;
do{const p=await adsPage(env,after,5);adPages++;for(const a of p.items){if(ads.has(a.id))throw new Error('META_DUPLICATE_AD');ads.set(a.id,a);}after=p.next;if(after&&seenCursors.has(after))throw new Error('META_CURSOR_REPEATED');if(after)seenCursors.add(after);}while(after);
const known=['120250702823080262','120250703612650262','120242645960360262'];
console.log(JSON.stringify({step:'ad-pagination-complete',ads:ads.size,pages:adPages,crmAdReferencesMatched:known.filter(id=>ads.has(id)).length}));
const today=daySP(),ranges=[['today',presetRange('today',today)],['yesterday',presetRange('yesterday',today)],['30days',presetRange('30',today)],['custom',{start:'2026-11-01',end:'2026-11-09'}]];
for(const [name,{start,end}]of ranges){
 const rows=[],cursors=new Set();let cursor=null,pages=0;
 do{const p=await insightPage(env,start,end,cursor,10);rows.push(...p.items);pages++;cursor=p.next;if(cursor&&cursors.has(cursor))throw new Error('META_CURSOR_REPEATED');if(cursor)cursors.add(cursor);}while(cursor);
 if(new Set(rows.map(r=>r.day+':'+r.adId)).size!==rows.length)throw new Error('META_DUPLICATE_DAY_AD');
 const sum=aggregateMetrics(rows,true);
 const account=await metaRead(env,'/insights',{fields:'account_id,spend,impressions,inline_link_clicks,actions,results,attribution_setting,reach',level:'account',time_range:{since:start,until:end},use_unified_attribution_setting:true,action_report_time:'impression',limit:2});
 if(account.data.length>1||account.paging?.next)throw new Error('META_ACCOUNT_SCOPE_AMBIGUOUS');
 const a=account.data[0]||{account_id:ECCOA_META.accountId};if(a.account_id!==ECCOA_META.accountId)throw new Error('META_ACCOUNT_SCOPE_MISMATCH');
 const conversation=metaActions(a.actions,ECCOA_META.conversationAction);
 const indicator=(a.results||[]).find(x=>x.indicator==='actions:'+ECCOA_META.conversationAction);
 if(indicator&&Number(indicator.values?.[0]?.value)!==conversation)throw new Error('META_CONVERSATION_INDICATOR_MISMATCH');
 if(Math.abs(sum.spend-Number(a.spend||0))>.03||sum.impressions!==Number(a.impressions||0)||sum.clicks!==Number(a.inline_link_clicks||0)||Math.abs(sum.conversations-conversation)>.01)throw new Error('META_TOTALS_DO_NOT_RECONCILE');
 const reach=await exactReach(env,start,end);
 if(reach!==Number(a.reach||0))throw new Error('META_EXACT_REACH_MISMATCH');
 const campaign=rows.find(r=>r.campaignId)?.campaignId,ad=rows.find(r=>r.adId)?.adId;
 if(campaign)await exactReach(env,start,end,{campaign});if(ad)await exactReach(env,start,end,{ad});
 console.log(JSON.stringify({step:'period-validated',name,start,end,rows:rows.length,pages,totals:sum,reach,conversationsMatchResultsIndicator:!!indicator,accountAttribution:a.attribution_setting||null,dailyAttributionSettings:[...new Set(rows.map(r=>r.attributionSetting).filter(Boolean))],campaignAndAdReachQueried:!!campaign&&!!ad}));
}
if(process.argv.includes('--history')){
 let rows=0,pages=0;for(let start=env.HISTORY_START;start<=today;start=addDays(start,7)){
 const end=[addDays(start,6),today].sort()[0];let cursor=null;do{const p=await insightPage(env,start,end,cursor);rows+=p.items.length;pages++;cursor=p.next;}while(cursor);}
 console.log(JSON.stringify({step:'available-history-complete',start:env.HISTORY_START,end:today,rows,pages}));
}
console.log(JSON.stringify({validation:'complete',methods:['GET'],account:ECCOA_META.accountId,credentialsPersisted:false}));
