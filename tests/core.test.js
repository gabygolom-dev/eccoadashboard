import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {daySP,presetRange,validateRange,pickContacts,aggregateMetrics,metaActions,digest} from '../src/domain.js';
import {readJSON,nextCursor} from '../src/connectors/http.js';
import {projectEvent,pageItems,messagePage,crmRead} from '../src/connectors/rugido.js';
import {passwordRecord,verifyPassword,cookie,sessionToken} from '../src/auth.js';
import {handlePages} from '../src/pages.js';
import {publishRun,processJob,startCycle} from '../src/sync.js';
import {makeReport} from '../src/report.js';
import {stage} from '../src/db.js';
import {createDB} from '../scripts/local-db.mjs';
const secret='test-only-pseudonym-key-0000000000000000';
const event=(id,contactId,at,campaignId='A',adId='ad1')=>({id,contactId,at,day:daySP(at),campaignId,adId,adsetId:'set1',evidence:'Mensagem recebida com referência paga'});
async function completedRun(db,id,provider){await db.prepare("INSERT INTO runs(id,provider,state,cursor_json,started_at) VALUES(?,?,'running','{}',?)").bind(id,provider,new Date().toISOString()).run();await db.prepare('UPDATE sources SET active_run=? WHERE provider=?').bind(id,provider).run();await stage(db,id,'identity',provider,{id:'test-account',conversationsValidated:true});}

test('datas em São Paulo, inclusivas, atuais e virada de mês',()=>{
 assert.equal(daySP('2026-11-10T02:59:59Z'),'2026-11-09');assert.equal(daySP('2026-11-10T03:00:00Z'),'2026-11-10');
 assert.deepEqual(presetRange('7','2026-11-09'),{start:'2026-11-03',end:'2026-11-09'});
 assert.deepEqual(presetRange('lastMonth','2026-03-01'),{start:'2026-02-01',end:'2026-02-28'});
 assert.deepEqual(validateRange('2026-11-09','2026-11-09',new Date('2026-11-10T02:00Z')),{start:'2026-11-09',end:'2026-11-09'});
 assert.throws(()=>validateRange('2026-02-30','2026-03-01'));assert.throws(()=>validateRange('2026-11-10','2026-11-10',new Date('2026-11-09T15:00Z')));
});
test('deduplicação acontece antes de campanha e mantém retorno de contato antigo',()=>{
 const events=[event('0','p1','2026-10-01T12:00Z'),event('1','p1','2026-11-03T12:00Z','A'),event('2','p1','2026-11-04T12:00Z','B'),event('3','p2','2026-11-04T12:00Z','B'),event('4','p3','2026-11-09T12:00Z',null)];
 assert.equal(pickContacts(events,'2026-11-03','2026-11-09').length,3);
 assert.deepEqual(pickContacts(events,'2026-11-03','2026-11-09',{campaign:'B'}).map(e=>e.contactId),['p2']);
 assert.equal(pickContacts(events,'2026-11-03','2026-11-09',{campaign:'unknown'}).length,1);
});
test('custos e taxas são razões dos totais; conversas não somam ações sobrepostas',()=>{
 const a=aggregateMetrics([{spend:100,clicks:10,impressions:1000,conversations:2},{spend:20,clicks:20,impressions:100,conversations:1}]);
 assert.equal(a.cpc,4);assert.equal(a.costConversation,40);assert.equal(a.ctr,30/1100*100);
 assert.equal(aggregateMetrics(null).spend,null);assert.equal(aggregateMetrics([],false).conversations,null);
 assert.equal(metaActions([{action_type:'link_click',value:'800'},{action_type:'conversation',value:'3'},{action_type:'other_message',value:'10'}],'conversation'),3);
 assert.throws(()=>metaActions([{action_type:'x',value:1},{action_type:'x',value:2}],'x'));
});
test('transporte exclusivamente GET, sem redirecionamento nem tokens na URL',async()=>{
 let called=0;const fetcher=async(url,opts)=>{called++;assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(new URL(url).origin,'https://graph.facebook.com');assert.equal(opts.headers.Authorization,'Bearer test');return Response.json({data:[]});};
 await readJSON('https://graph.facebook.com/v99.0/act_1/ads',{origin:'https://graph.facebook.com',token:'test',fetcher});assert.equal(called,1);
 await assert.rejects(()=>readJSON('https://evil.invalid/',{origin:'https://graph.facebook.com',token:'test',fetcher}),/ORIGIN_BLOCKED/);
 await assert.rejects(()=>readJSON('https://graph.facebook.com/?access_token=test',{origin:'https://graph.facebook.com',token:'test',fetcher}),/ORIGIN_BLOCKED/);
 const c=nextCursor({paging:{next:'https://graph.facebook.com/v99.0/act_1/ads?access_token=secret&after=cursor'}},'https://graph.facebook.com','1');assert.equal(c,'cursor');
 assert.throws(()=>nextCursor({paging:{next:'https://evil.invalid/act_1/ads?after=x'}},'https://graph.facebook.com','1'));
 await assert.rejects(()=>crmRead({CRM_API_ORIGIN_APPROVED:'true'},'/conversations/1/update_last_seen'),/ENDPOINT_BLOCKED/);
});
test('projeção de mensagem não usa cadastro, nome, telefone ou conteúdo',async()=>{
 const spec={id:'id',contactId:'contact',direction:'direction',incomingValue:'incoming',paidProof:'referral.paid',paidValue:true,timestamp:'sentAt',timestampUnit:'iso',adId:'referral.adId'};
 const raw={id:3,contact:1,direction:'incoming',referral:{paid:true,adId:'123'},created_at:'2026-01-01',content:'CONTEUDO_PRIVADO',name:'NOME_PRIVADO',phone:'TELEFONE_PRIVADO'};
 const missing=await projectEvent(raw,spec,secret);assert.ok(missing.undatedContact);assert.equal(missing.at,undefined);
 const projected=await projectEvent({...raw,sentAt:'2026-11-09T15:00Z'},spec,secret);
 assert.equal(projected.day,'2026-11-09');assert.equal(projected.campaignId,null);assert.ok(!JSON.stringify(projected).includes('PRIVADO'));
 assert.equal(await projectEvent({...raw,direction:'outgoing'},spec,secret),null);
 assert.throws(()=>pageItems({items:[1],total:100},{items:'items',total:'total',perPage:10},1)===null);
});
test('publicação é atômica, reimportações não duplicam eventos e histórico permanece',async()=>{
 const db=createDB();try{
 await completedRun(db,'crm1','crm');await stage(db,'crm1','contact','p1',{id:'p1',stageId:'1',stageName:'Contato',undated:false});await stage(db,'crm1','event','e1',event('e1','p1','2026-11-09T12:00Z'));
 await publishRun({ECCOA_DB:db},{id:'crm1',provider:'crm'},{done:true});
 await completedRun(db,'crm2','crm');await stage(db,'crm2','event','e1',event('e1','p1','2026-11-09T12:00Z'));await stage(db,'crm2','event','e2',event('e2','p1','2026-11-09T13:00Z','B'));
 await publishRun({ECCOA_DB:db},{id:'crm2',provider:'crm'},{done:true});
 assert.equal((await db.prepare('SELECT count(*) n FROM events').first()).n,2);
 const report=await makeReport({ECCOA_DB:db},new URL('https://test/api/report?start=2026-11-09&end=2026-11-09'));
 assert.equal(report.totals.contacts,1);assert.equal(report.entries.reduce((s,e)=>s+e.contacts,0),1);
 const filtered=await makeReport({ECCOA_DB:db},new URL('https://test/api/report?start=2026-11-09&end=2026-11-09&campaign=B'));assert.equal(filtered.totals.contacts,0);
 await completedRun(db,'broken','meta');await stage(db,'broken','metric','bad',{day:'2026-11-09',adId:null});
 await assert.rejects(()=>publishRun({ECCOA_DB:db},{id:'broken',provider:'meta'},{start:'2026-11-09',end:'2026-11-09',done:true}));
 assert.equal((await db.prepare("SELECT confirmed_at FROM sources WHERE provider='meta'").first()).confirmed_at,null);
 assert.equal((await db.prepare('SELECT count(*) n FROM events').first()).n,2);
 }finally{db.close();}
});
test('revisões Meta substituem o intervalo confirmado sem somar versões e mantêm auditoria',async()=>{
 const db=createDB();try{
 for(const [id,spend]of [['m1',20],['m2',30]]){await completedRun(db,id,'meta');await stage(db,id,'metric','2026-11-09:ad1',{day:'2026-11-09',adId:'ad1',campaignId:'A',adsetId:'S',spend,impressions:100,clicks:5,conversations:1});await publishRun({ECCOA_DB:db},{id,provider:'meta'},{start:'2026-11-09',end:'2026-11-09',done:true});}
 assert.equal((await db.prepare('SELECT count(*) n FROM metric_revisions').first()).n,2);assert.equal((await db.prepare('SELECT count(*) n FROM metrics').first()).n,1);
 const report=await makeReport({ECCOA_DB:db},new URL('https://test/api/report?start=2026-11-09&end=2026-11-09'));assert.equal(report.totals.spend,30);assert.equal(report.totals.reach,null);
 const uncovered=await makeReport({ECCOA_DB:db},new URL('https://test/api/report?start=2026-11-08&end=2026-11-09'));assert.equal(uncovered.totals.spend,null);
 }finally{db.close();}
});
test('autenticação, cookie seguro, CSRF, arquivos privados, logout e rate limiting',async()=>{
 const db=createDB();try{
 const password='senha-local-de-teste-12345';const record=await passwordRecord(password);
 assert.equal(await verifyPassword(password,record),true);assert.equal(await verifyPassword('outra-senha-incorreta',record),false);
 const env={ECCOA_DB:db,PASSWORD_RECORD:record,PSEUDONYM_KEY:secret};
 const next=async()=>new Response('static');
 const req=(path,opts={})=>new Request('https://eccoa.test'+path,opts);
 assert.equal((await handlePages(req('/api/config'),env,next)).status,401);
 assert.equal((await handlePages(req('/app.js'),env,next)).status,303);
 assert.equal((await handlePages(req('/src/auth.js'),env,next)).status,404);
 assert.equal((await handlePages(req('/auth/login',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/x-www-form-urlencoded'},body:'password='+password}),env,next)).status,403);
 const login=await handlePages(req('/auth/login',{method:'POST',headers:{Origin:'https://eccoa.test','Content-Type':'application/x-www-form-urlencoded'},body:'password='+password}),env,next);
 assert.equal(login.status,303);const setCookie=login.headers.get('Set-Cookie');assert.match(setCookie,/Secure; HttpOnly; SameSite=Strict/);
 const requestCookie=setCookie.split(';')[0],token=sessionToken(req('/',{headers:{Cookie:requestCookie}}));assert.equal(token.length,64);
 assert.equal((await handlePages(req('/api/config',{headers:{Cookie:requestCookie}}),env,next)).status,200);
 assert.equal((await handlePages(req('/package.json',{headers:{Cookie:requestCookie}}),env,next)).status,404);
 const logout=await handlePages(req('/auth/logout',{method:'POST',headers:{Origin:'https://eccoa.test',Cookie:requestCookie}}),env,next);assert.equal(logout.status,303);
 assert.equal((await handlePages(req('/api/config',{headers:{Cookie:requestCookie}}),env,next)).status,401);
 for(let i=0;i<6;i++){const r=await handlePages(req('/auth/login',{method:'POST',headers:{Origin:'https://eccoa.test','Content-Type':'application/x-www-form-urlencoded'},body:'password=errada'}),env,next);if(i===5)assert.equal(r.status,429);}
 await db.prepare('INSERT INTO sessions(hash,expires) VALUES(?,?)').bind(await digest('a'.repeat(64)),Date.now()-1).run();assert.equal((await handlePages(req('/api/config',{headers:{Cookie:cookie('a'.repeat(64))}}),env,next)).status,401);
 }finally{db.close();}
});
test('agendamento não inicia ciclos duplicados e falha preserva confirmação',async()=>{
 const db=createDB();try{
 const id=crypto.randomUUID();await completedRun(db,id,'crm');
 await db.prepare("UPDATE sources SET confirmed_at='2026-11-09T10:00:00Z' WHERE provider='crm'").run();
 const messages=[];const env={ECCOA_DB:db,ECCOA_JOBS:{send:async body=>messages.push(body)}};
 await startCycle(env);assert.equal((await db.prepare("SELECT count(*) n FROM runs WHERE provider='crm' AND state='running'").first()).n,1);
 assert.equal(messages.length,1);
 await processJob(env,{runId:id,provider:'crm'});
 assert.equal((await db.prepare("SELECT confirmed_at FROM sources WHERE provider='crm'").first()).confirmed_at,'2026-11-09T10:00:00Z');
 }finally{db.close();}
});


test('Rugido usa api_access_token sem enviar Bearer de sessão',async()=>{
 await readJSON('https://clientcrm-api.rugido.com/api/v1/workspaces/current',{origin:'https://clientcrm-api.rugido.com',token:'test-only-rugido',auth:'api_access_token',fetcher:async(url,opts)=>{assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(opts.headers.api_access_token,'test-only-rugido');assert.equal(opts.headers.Authorization,undefined);return Response.json({success:true,data:{}});}});
 await assert.rejects(()=>readJSON('https://clientcrm-api.rugido.com/api/v1/workspaces/current',{origin:'https://clientcrm-api.rugido.com',token:'x',auth:'query'}),/AUTH_SCHEME_BLOCKED/);
});

test('paginação Rugido não para no total_pages incorreto e exige página retornada correta',()=>{
 const spec={items:'data',total:'meta.total',responsePage:'meta.page',perPage:2,paginationMode:'until-empty'};
 assert.equal(pageItems({data:[{id:'1'},{id:'1'}],meta:{total:2,page:2}},spec,2).next,3);
 assert.equal(pageItems({data:[{id:'2'}],meta:{total:2,page:3}},spec,3).next,4);
 assert.equal(pageItems({data:[],meta:{total:2,page:4}},spec,4).next,null);
 assert.throws(()=>pageItems({data:[],meta:{total:2,page:1}},spec,4),/RESPONSE_PAGE_MISMATCH/);
});

test('mensagens Rugido usam before até resposta vazia e validam a ordenação',()=>{
 const spec={items:'data',paginationMode:'before-empty',id:'id',orderTimestamp:'created_at'};
 const page=messagePage({data:[{id:'first',created_at:10},{id:'last',created_at:20}]},spec);
 assert.equal(page.next,'first');assert.equal(messagePage({data:[]},spec).next,null);
 assert.throws(()=>messagePage({data:[{id:'last',created_at:20},{id:'first',created_at:10}]},spec),/ORDER_MISMATCH/);
});

test('origem_anuncio usa data original e identificador externo na deduplicação',async()=>{
 const {RUGIDO_SCHEMA}=await import('../src/connectors/rugido-schema.js');
 const raw={id:'message_1',source_id:'external_stable',sender_id:'contact_1',message_type:'incoming',created_at:Date.parse('2026-11-08T15:00Z')/1000,content_attributes:{external_created_at:Date.parse('2026-11-06T15:00Z')/1000,origem_anuncio:{ad_id:'123456789012345',source_app:'instagram'}}};
 const first=await projectEvent(raw,RUGIDO_SCHEMA.evidence,secret),reimport=await projectEvent({...raw,id:'message_2'},RUGIDO_SCHEMA.evidence,secret);
 assert.equal(first.day,'2026-11-06');assert.equal(first.id,reimport.id);assert.equal(first.campaignId,null);
 await assert.rejects(()=>projectEvent(raw,RUGIDO_SCHEMA.evidence,secret,{contactId:'other-contact'}),/CONTACT_MISMATCH/);
 assert.equal(await projectEvent({...raw,private:true},RUGIDO_SCHEMA.evidence,secret),null);
 assert.equal(await projectEvent({...raw,content_attributes:{origem_anuncio:{ad_id:'not-an-ad'}}},RUGIDO_SCHEMA.evidence,secret),null);
});

test('etapas do CRM vêm do dicionário oficial e preservam múltiplos funis',async()=>{
 const {projectPipelines,projectConversation}=await import('../src/connectors/rugido.js');
 const dictionary=projectPipelines({data:[{id:'funnel_1',name:'Funil de Vendas',workspace_id:'workspace_1',stages:[{id:'stage_1',pipeline_id:'funnel_1',name:'Contato iniciado'}]}]},{items:'data'},'workspace_1');
 const conv=await projectConversation({id:'conv_1',contact:{id:'contact_1'},pipelines:[{id:'funnel_1',stages:[{id:'stage_1',name:'NOME_NAO_CONFIAVEL'}]}]},{id:'id',contactId:'contact.id'},secret,dictionary);
 assert.equal(conv.stages[0].stageName,'Funil de Vendas · Contato iniciado');
 assert.throws(()=>projectPipelines({data:[{workspace_id:'other',stages:[]}]},{items:'data'},'workspace_1'),/WORKSPACE_MISMATCH/);
});

test('linhas de contato repetidas preservam origem paga e publicação de etapas é atômica',async()=>{
 const {stageMany}=await import('../src/db.js');const db=createDB();try{
 await completedRun(db,'crm_stages','crm');
 await stageMany(db,'crm_stages','contact',[{key:'p1',data:{id:'p1',stageId:null,stageName:'Etapa não informada',undated:true}},{key:'p1',data:{id:'p1',stageId:null,stageName:'Etapa não informada',undated:false}}]);
 await stageMany(db,'crm_stages','contact_stage',[{key:'p1:s1',data:{contactId:'p1',stageId:'s1',stageName:'Funil · Contato iniciado'}},{key:'p1:s2',data:{contactId:'p1',stageId:'s2',stageName:'Pacientes · Retorno agendado'}}]);
 await publishRun({ECCOA_DB:db},{id:'crm_stages',provider:'crm'},{done:true});
 const contact=await db.prepare('SELECT * FROM contacts WHERE id=?').bind('p1').first();assert.equal(contact.undated,1);assert.match(contact.stage_name,/Contato iniciado/);assert.match(contact.stage_name,/Retorno agendado/);
 }finally{db.close();}
});
