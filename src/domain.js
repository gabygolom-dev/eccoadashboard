export const TZ = 'America/Sao_Paulo';
export function daySP(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('INVALID_DATE');
  return new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit'}).format(date);
}
export function addDays(day, n) { return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0,10); }
export function validateRange(start, end, now = new Date()) {
  const valid = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !Number.isNaN(Date.parse(d)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0,10) === d;
  if (!valid(start) || !valid(end) || start > end || end > daySP(now)) throw new Error('INVALID_RANGE');
  if ((Date.parse(end)-Date.parse(start))/86400000 > 1095) throw new Error('RANGE_TOO_LONG');
  return {start, end};
}
export function presetRange(preset, today = daySP()) {
  let start=today,end=today;
  if (preset==='yesterday') start=end=addDays(today,-1);
  if (preset==='7') start=addDays(today,-6);
  if (preset==='30') start=addDays(today,-29);
  if (preset==='month') start=today.slice(0,8)+'01';
  if (preset==='lastMonth') { end=addDays(today.slice(0,8)+'01',-1);start=end.slice(0,8)+'01'; }
  return {start,end};
}
export const ratio = (a,b,m=1) => a === null || a === undefined || !b ? null : a / b * m;
export function pickContacts(events, start, end, filters={}) {
  const first = new Map();
  for (const e of events) {
    if (e.day<start || e.day>end) continue;
    const old=first.get(e.contactId);
    if (!old || e.at<old.at || (e.at===old.at && e.id<old.id)) first.set(e.contactId,e);
  }
  return [...first.values()].filter(e=>(!filters.campaign || (e.campaignId||'unknown')===filters.campaign) && (!filters.ad || e.adId===filters.ad));
}
export function aggregateMetrics(rows, conversationsAvailable = true) {
  if (!rows) return {spend:null,impressions:null,clicks:null,conversations:null,cpc:null,ctr:null,cpm:null,costConversation:null};
  const sum=k=>rows.reduce((s,r)=>s+Number(r[k]||0),0);
  const spend=sum('spend'), impressions=sum('impressions'),clicks=sum('clicks');
  const conversations=conversationsAvailable ? sum('conversations') : null;
  return {spend,impressions,clicks,conversations,cpc:ratio(spend,clicks),ctr:ratio(clicks,impressions,100),cpm:ratio(spend,impressions,1000),costConversation:ratio(spend,conversations)};
}
export function metaActions(actions, actionType) {
  const matches=(actions||[]).filter(x=>x.action_type===actionType);
  if (matches.length>1) throw new Error('META_OVERLAPPING_ACTIONS');
  const n=matches.length?Number(matches[0].value):0;
  if (!Number.isFinite(n)||n<0) throw new Error('META_INVALID_METRIC');
  return n;
}
export function getPath(value,path) {
  if (!path) return undefined;
  return path.split('.').reduce((v,k)=>v?.[k],value);
}
export function safeId(value) {
  if (typeof value!=='number' && typeof value!=='string') return null;
  const s=String(value); return /^[A-Za-z0-9_:-]{1,160}$/.test(s)?s:null;
}
export function timestamp(value, unit='iso') {
  if (value===null || value===undefined || value==='') return null;
  const date=new Date(unit==='seconds'?Number(value)*1000:unit==='milliseconds'?Number(value):value);
  return Number.isFinite(date.getTime())?date.toISOString():null;
}
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const pseudonymKeyCache=new Map();
export async function pseudonym(key,value) {
  if (!key || key.length<32) throw new Error('PSEUDONYM_KEY_REQUIRED');
  let pending=pseudonymKeyCache.get(key);
  if(!pending){
    pending=crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    // One exclusive client's non-extractable key in memory, never persisted.
    // Cache the promise before awaiting so concurrent contact pages share it.
    pseudonymKeyCache.clear();pseudonymKeyCache.set(key,pending);
  }
  const k=await pending;
  return [...new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(String(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
