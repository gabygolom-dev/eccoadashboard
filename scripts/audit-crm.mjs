import {readFile} from 'node:fs/promises';
import {readJSON} from '../src/connectors/http.js';
import {projectEvent} from '../src/connectors/rugido.js';
import {RUGIDO_SCHEMA} from '../src/connectors/rugido-schema.js';
import {pseudonym,daySP,presetRange,pickContacts} from '../src/domain.js';
const credentialPath=process.argv[2];
if(!credentialPath)throw new Error('Informe o caminho do Markdown protegido.');
const secretText=await readFile(credentialPath,'utf8');
const candidates=secretText.split(/\r?\n/).map(x=>x.trim().replace(/^`|`$/g,'')).filter(x=>/^[A-Za-z0-9._~+/-]{32,}=*$/.test(x));
if(candidates.length!==1)throw new Error('CREDENCIAL_AMBIGUA');
const token=candidates[0],origin='https://clientcrm-api.rugido.com',workspaceId='503dc93f-7b19-408b-b714-63e508ede833';
async function get(path){return readJSON(origin+'/api/v1'+path,{origin,token,auth:'api_access_token',headers:{'X-Workspace-Id':workspaceId}});}
const identity=await get('/workspaces/current');
if(identity.data?.id!==workspaceId||identity.data?.name!=='Eccoa Saúde')throw new Error('CRM_WORKSPACE_MISMATCH');
const signatures=new Map(),originSignatures=new Map(),auditKey=crypto.randomUUID(),paidContacts=new Set(),events=new Map();
const suspiciousKey=key=>/referral|externalad|campaign|utm|ad_id|adid|ctwa|source|origin|attribution|contextInfo|^ad$/i.test(key);
function inspect(value,prefix='',found=[]){if(!value||typeof value!=='object')return found;for(const[k,v]of Object.entries(value)){if(!/^[a-zA-Z_][a-zA-Z0-9_]{0,90}$/.test(k))continue;const path=prefix?prefix+'.'+k:k;if(suspiciousKey(k))found.push(path+':'+(v===null?'null':Array.isArray(v)?'array':typeof v));if(v&&typeof v==='object'&&!Array.isArray(v))inspect(v,path,found);}return found;}
async function list(path,metaPath){
 const ids=new Set(),items=[];let pages=0,rows=0,duplicates=0,total=null;
 for(let page=1;page<=10000;page++){
  const d=await get(path+`?page=${page}&per_page=100`+(path==='/conversations'?'&status=all':''));
  const meta=metaPath(d);if(total===null)total=meta.total;
  if(meta.total!==total||!Array.isArray(d.data)||(meta.page??meta.current_page)!==page)throw new Error('CRM_COVERAGE_CHANGED');
  pages++;if(!d.data.length)break;
  for(const item of d.data){
   if(!item.id)throw new Error('CRM_LIST_ID_MISSING');rows++;
   const repeated=ids.has(item.id);if(repeated)duplicates++;else ids.add(item.id);
   if(path==='/conversations'){if(!repeated)items.push({id:item.id,contactId:item.contact?.id});}
   else {if(/^\d{5,25}$/.test(String(item.custom_attributes?.ad_id||'')))paidContacts.add(item.id);for(const sig of inspect(item.additional_attributes,'additional_attributes').concat(inspect(item.custom_attributes,'custom_attributes')))originSignatures.set(sig,(originSignatures.get(sig)||0)+1);}
  }
 }
 if(ids.size!==total)throw new Error('CRM_UNIQUE_COVERAGE_INCOMPLETE');
 console.log(JSON.stringify({step:path,pages,total,rows,unique:ids.size,duplicates,coverageComplete:true}));return {total,pages,items,unique:ids.size,duplicates};
}
const contacts=await list('/contacts',d=>d.meta.pagination);if(process.argv.includes('--contacts-only')){console.log(JSON.stringify({contactOriginAttributeSignatures:Object.fromEntries(originSignatures)}));process.exit(0);}const conversations=await list('/conversations',d=>d.meta);
let conversationIndex=0,messagePages=0,messages=0,inbound=0,paidCandidates=0,completed=0,maxPages=0;
const timestamps={external:0,created:0,missing:0};
const paidPseudonyms=new Set(await Promise.all([...paidContacts].map(id=>pseudonym(auditKey,id))));
async function scan(){while(conversationIndex<conversations.items.length){const conv=conversations.items[conversationIndex++];const contactHash=await pseudonym(auditKey,conv.contactId);let cursor=null,pages=0;const seen=new Set();for(;;){const d=await get(`/conversations/${conv.id}/messages`+(cursor?'?before='+encodeURIComponent(cursor):''));messagePages++;pages++;if(!Array.isArray(d.data))throw new Error('CRM_MESSAGES_SCHEMA_MISMATCH');if(!d.data.length)break;for(let i=0;i<d.data.length;i++){const m=d.data[i];if(m.conversation_id!==conv.id)throw new Error('CRM_MESSAGE_CONVERSATION_MISMATCH');if(seen.has(m.id))throw new Error('CRM_MESSAGE_PAGINATION_OVERLAP');seen.add(m.id);if(i&&Number(m.created_at)<Number(d.data[i-1].created_at))throw new Error('CRM_MESSAGE_ORDER_MISMATCH');messages++;if(m.message_type!=='incoming')continue;inbound++;const projected=await projectEvent(m,RUGIDO_SCHEMA.evidence,auditKey,{contactId:contactHash,conversationId:conv.id});if(projected&&!projected.undatedContact)events.set(projected.id,projected);const attr=inspect(m.content_attributes,'content_attributes').concat(inspect(m.additional_attributes,'additional_attributes'));for(const sig of attr)signatures.set(sig,(signatures.get(sig)||0)+1);if(attr.length)paidCandidates++;if(m.content_attributes?.external_created_at)timestamps.external++;else if(m.created_at)timestamps.created++;else timestamps.missing++;}const next=d.data[0].id;if(cursor===next)throw new Error('CRM_REPEATED_MESSAGE_CURSOR');cursor=next;if(pages>10000)throw new Error('CRM_MESSAGES_PAGE_LIMIT');}maxPages=Math.max(maxPages,pages);completed++;if(completed%100===0)console.log(JSON.stringify({step:'messages',conversationsCompleted:completed,total:conversations.total,messagePages,messages,inbound,paidMetadataCandidates:paidCandidates}));}}
await Promise.all([scan(),scan(),scan(),scan()]);
const eventContacts=new Set([...events.values()].map(e=>e.contactId)),range=presetRange('30',daySP());
console.log(JSON.stringify({validation:'complete',normalized:{uniquePaidEvents:events.size,uniqueContactsWithDatedEvidence:eventContacts.size,paidContactsWithoutDatedEvidence:[...paidPseudonyms].filter(id=>!eventContacts.has(id)).length,selectedPeriod:range,contactsInLast30Days:pickContacts([...events.values()],range.start,range.end).length},workspace:identity.data.name,contacts:{total:contacts.total,pages:contacts.pages},conversations:{total:conversations.total,pages:conversations.pages,scanned:completed},messages:{total:messages,inbound,pages:messagePages,maxPagesPerConversation:maxPages},timestampAvailability:timestamps,paidMetadataCandidates:paidCandidates,messageAttributeSignatures:Object.fromEntries(signatures),contactOriginAttributeSignatures:Object.fromEntries(originSignatures),note:'Somente estrutura e contagens. Nenhum texto, nome ou telefone persistido.'}));
