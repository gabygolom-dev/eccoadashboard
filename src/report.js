import {all,first,run} from './db.js';
import {ECCOA_META} from './connectors/meta-schema.js';
import {validateRange,daySP,addDays,aggregateMetrics,ratio,digest} from './domain.js';
export function selectedSQL(filters) {
  const clauses=[],args=[];
  if(filters.campaign){clauses.push("COALESCE(campaignId,'unknown')=?");args.push(filters.campaign);}
  if(filters.ad){clauses.push('adId=?');args.push(filters.ad);}
  return {sql:`WITH ranked AS (
    SELECT e.id,e.contact_id contactId,e.at,e.day,
      COALESCE(e.campaign_id,json_extract(a.data,'$.campaignId')) campaignId,
      COALESCE(e.adset_id,json_extract(a.data,'$.adsetId')) adsetId,e.ad_id adId,e.evidence,
      ROW_NUMBER() OVER(PARTITION BY e.contact_id ORDER BY e.at,e.id) rn
    FROM events e LEFT JOIN ads a ON a.id=e.ad_id WHERE e.day BETWEEN ? AND ?
  ), chosen AS (SELECT * FROM ranked WHERE rn=1), selected AS (
    SELECT * FROM chosen ${clauses.length?'WHERE '+clauses.join(' AND '):''}
  )`,args};
}
export async function makeReport(env,url) {
  const db=env.ECCOA_DB,now=new Date(),today=daySP(now),p=url.searchParams;
  const {start,end}=validateRange(p.get('start'),p.get('end'),now);
  const filters={campaign:p.get('campaign')||'',ad:p.get('ad')||''};
  const page=Math.max(1,Math.min(100000,Number(p.get('page'))||1));
  const offset=(page-1)*50;
  const sources=await all(db,'SELECT provider,confirmed_at,started_at,error,active_run,completed_runs,identity_json FROM sources');
  const source=Object.fromEntries(sources.map(s=>[s.provider,{...s,identity:s.identity_json?JSON.parse(s.identity_json):null,identity_json:undefined,stale:!s.confirmed_at||Date.now()-Date.parse(s.confirmed_at)>35*60000}]));
  const ads=(await all(db,'SELECT data FROM ads')).map(x=>JSON.parse(x.data));
  const adMap=new Map(ads.map(a=>[a.id,a]));
  const {sql,args}=selectedSQL(filters),bind=[start,end,...args];
  // Materialize the selected cohort once for all CRM summaries and pagination.
  // Repeating its ranking in five independent queries multiplies Free-plan reads.
  const counted=await first(db,`${sql} SELECT totals.*,
    (SELECT json_group_array(json_object('campaignId',campaignId,'adsetId',adsetId,'adId',adId,'contacts',contacts))
      FROM (SELECT campaignId,adsetId,adId,count(*) contacts FROM selected GROUP BY campaignId,adsetId,adId)) groups_json,
    (SELECT json_group_array(json_object('day',day,'contacts',contacts))
      FROM (SELECT day,count(*) contacts FROM selected GROUP BY day ORDER BY day)) daily_json,
    (SELECT json_group_array(json_object('name',name,'contacts',contacts))
      FROM (SELECT COALESCE(c.stage_name,'Etapa não informada') name,count(*) contacts FROM selected s LEFT JOIN contacts c ON c.id=s.contactId GROUP BY name ORDER BY contacts DESC)) funnel_json,
    (SELECT json_group_array(json_object('id',id,'contactId',contactId,'at',at,'day',day,'campaignId',campaignId,'adsetId',adsetId,'adId',adId,'evidence',evidence,'rn',rn,'stage',stage))
      FROM (SELECT s.*,COALESCE(c.stage_name,'Etapa não informada') stage FROM selected s LEFT JOIN contacts c ON c.id=s.contactId ORDER BY at DESC LIMIT 50 OFFSET ?)) contacts_json
    FROM (SELECT count(*) total,count(DISTINCT campaignId) campaigns,count(DISTINCT adId) ads FROM selected) totals`,...bind,offset);
  const groups=JSON.parse(counted.groups_json),daily=JSON.parse(counted.daily_json),funnel=JSON.parse(counted.funnel_json),contacts=JSON.parse(counted.contacts_json);
  const undated=await first(db,'SELECT count(*) total FROM contacts c WHERE undated=1 AND NOT EXISTS(SELECT 1 FROM events e WHERE e.contact_id=c.id)');
  const coverage=await first(db,'SELECT count(*) n FROM meta_coverage WHERE day BETWEEN ? AND ?',start,end);
  const expected=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
  const metaAvailable=!!source.meta?.confirmed_at && coverage.n===expected;
  const clauses=['day BETWEEN ? AND ?'],metricArgs=[start,end];
  if(filters.campaign){clauses.push('campaign_id=?');metricArgs.push(filters.campaign);}
  if(filters.ad){clauses.push('ad_id=?');metricArgs.push(filters.ad);}
  const metrics=metaAvailable?await all(db,`SELECT ad_id adId,campaign_id campaignId,adset_id adsetId,
    SUM(json_extract(data,'$.spend')) spend,SUM(json_extract(data,'$.impressions')) impressions,
    SUM(json_extract(data,'$.clicks')) clicks,SUM(json_extract(data,'$.conversations')) conversations,
    GROUP_CONCAT(DISTINCT json_extract(data,'$.attributionSetting')) reportAttribution,MAX(json_extract(data,'$.campaignName')) campaignName,MAX(json_extract(data,'$.adsetName')) adsetName,MAX(json_extract(data,'$.adName')) adName
    FROM metrics WHERE ${clauses.join(' AND ')} GROUP BY ad_id,campaign_id,adset_id`,...metricArgs):null;
  const totals=aggregateMetrics(metrics,!!source.meta?.identity?.conversationsValidated);
  let reachReport=null,reachRegistrationError=null;
  if(filters.campaign!=='unknown'){
    if(filters.campaign.length>64||filters.ad.length>64)throw new Error('INVALID_SCOPE');
    const reachId=await digest(JSON.stringify([ECCOA_META.accountId,start,end,filters.campaign,filters.ad]));
    try{
      await run(db,'INSERT INTO reach_reports(id,start,end,campaign_id,ad_id,requested_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET requested_at=excluded.requested_at WHERE reach_reports.requested_at<?',reachId,start,end,filters.campaign||null,filters.ad||null,now.toISOString(),new Date(now.getTime()-5*60000).toISOString());
    }catch{reachRegistrationError='REACH_REQUEST_REGISTRATION_FAILED';}
    reachReport=await first(db,'SELECT value,confirmed_at,error FROM reach_reports WHERE id=?',reachId);
  }
  const reachValue=metaAvailable&&reachReport?.confirmed_at?reachReport.value:null;

  const series=[];const dailyMap=new Map(daily.map(r=>[r.day,r.contacts]));
  for(let d=start;d<=end;d=addDays(d,1))series.push({day:d,contacts:source.crm?.confirmed_at?(dailyMap.get(d)||0):null});
  const rows=new Map();
  for(const g of groups){const key=[g.campaignId||'unknown',g.adsetId||'unknown',g.adId||'unknown'].join('|');rows.set(key,{...g});}
  for(const m of metrics||[]){const key=[m.campaignId,m.adsetId,m.adId].join('|');rows.set(key,{...(rows.get(key)||{contacts:0}),...m});}
  const entries=[...rows.values()].map(r=>{
    const ad=adMap.get(r.adId);
    return {...r,campaignId:r.campaignId||'unknown',adsetId:r.adsetId||'unknown',adId:r.adId||null,campaignName:(ad?.campaignId===r.campaignId?ad.campaignName:null)||r.campaignName||(r.campaignId?`Campanha ${r.campaignId}`:'Campanha não identificada'),adsetName:ad?.adsetName||r.adsetName||(r.adsetId?`Conjunto ${r.adsetId}`:'Conjunto não identificado'),adName:ad?.name||r.adName||(r.adId?`Anúncio ${r.adId}`:'Anúncio não identificado'),status:ad?.status||null,format:ad?.format||null,attribution:ad?.attribution||null,preview:null,spend:metaAvailable?(r.spend||0):null,impressions:metaAvailable?(r.impressions||0):null,clicks:metaAvailable?(r.clicks||0):null,conversations:metaAvailable&&source.meta.identity?.conversationsValidated?(r.conversations||0):null,contacts:source.crm?.confirmed_at?(r.contacts||0):null};
  });
  // Include consulted ads with zero metrics/contacts for status/format discovery.
  const campaignOptions=[...new Map(ads.map(a=>[a.campaignId,{id:a.campaignId,name:a.campaignName}])).values()];
  for(const g of groups)if(g.campaignId&&!campaignOptions.some(a=>a.id===g.campaignId))campaignOptions.push({id:g.campaignId,name:`Campanha ${g.campaignId}`});
  if(groups.some(g=>!g.campaignId))campaignOptions.push({id:'unknown',name:'Campanha não identificada'});
  const lastCron=await first(db,"SELECT value FROM settings WHERE key='lastCron'");
  return {client:env.CLIENT_NAME||'Eccoa Saúde',today,start,end,partial:end===today,timezone:'America/Sao_Paulo',source,
    generatedAt:now.toISOString(),lastCron:lastCron?.value||null,nextCron:new Date(Math.floor(Date.now()/900000)*900000+900000).toISOString(),
    crmAvailable:!!source.crm?.confirmed_at,metaAvailable,
    totals:{...totals,contacts:source.crm?.confirmed_at?counted.total:null,campaigns:source.crm?.confirmed_at?counted.campaigns:null,ads:source.crm?.confirmed_at?counted.ads:null,undated:source.crm?.confirmed_at?undated.total:null,reach:reachValue,costContact:source.crm?.confirmed_at?ratio(totals.spend,counted.total):null},
    reachUpdatedAt:reachReport?.confirmed_at||null,reachPending:!reachReport?.confirmed_at,reachError:reachReport?.error||reachRegistrationError,series,funnel,entries,campaignOptions,ads:ads.filter(a=>(!filters.campaign||a.campaignId===filters.campaign)&&(!filters.ad||a.id===filters.ad)),
    contacts:contacts.map(c=>({...c,label:`Contato ${c.contactId.slice(0,10)}`,campaignName:adMap.get(c.adId)?.campaignName||(c.campaignId?`Campanha ${c.campaignId}`:'Campanha não identificada'),adName:adMap.get(c.adId)?.name||(c.adId?`Anúncio ${c.adId}`:'Anúncio não identificado')})),
    pagination:{page,pageSize:50,total:source.crm?.confirmed_at?counted.total:0},
    limitations:{reach:filters.campaign==='unknown'?'Alcance indisponível para campanha não identificada.':reachReport?.error||reachRegistrationError?'Falha ao consultar alcance; a última confirmação desse escopo foi preservada.':reachReport?.confirmed_at?'Alcance obtido em relatório do período e escopo exatos, sem somar dias, campanhas ou anúncios.':'Alcance aguardando relatório do período e escopo exatos no próximo ciclo do servidor; não somamos alcance.',sales:'Vendas, faturamento, conversão em venda e ROAS indisponíveis: nenhuma fonte de vendas validada.',crmCoverage:source.crm?.confirmed_at?'Histórico confirmado pelas listagens paginadas; evidências anteriores não fornecidas pelo CRM não podem ser recuperadas.':'Aguardando primeira importação validada.',metaCoverage:metaAvailable?null:'Período sem cobertura completa confirmada da Meta. Métricas indisponíveis.'}
  };
}
