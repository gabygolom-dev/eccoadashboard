import {all,first,run,statement} from './db.js';
import {digest,verifyPassword,sessionToken,cookie,sameOrigin,SESSION_SECONDS} from './auth.js';
import {pseudonym} from './domain.js';
import {makeReport} from './report.js';
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const secureHeaders={
  'Cache-Control':'no-store, private',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security':'max-age=31536000; includeSubDomains'
};
export function secure(response) {
  const r=new Response(response.body,response);for(const [k,v]of Object.entries(secureHeaders))r.headers.set(k,v);return r;
}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});
export function loginPage(message='',ready=true){
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acesso · Eccoa</title><link rel="stylesheet" href="/login.css"></head><body><main><div class="brand">ECCOA<span>INTELIGÊNCIA DE RESULTADOS</span></div><div class="lock" aria-hidden="true">↗</div><p class="eyebrow">ACESSO RESTRITO</p><h1>Os resultados,<br>com clareza.</h1><p>Acompanhe o investimento em mídia e os contatos rastreados no CRM.</p>${message?`<p class="notice" role="alert">${escapeHTML(message)}</p>`:''}${ready?'<form method="post" action="/auth/login"><label for="password">Senha de acesso</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="512" placeholder="Digite sua senha"><button type="submit">Acessar dashboard <span>→</span></button></form>':'<p class="notice">Acesso em configuração. Nenhum dado foi disponibilizado.</p>'}<footer>Eccoa Saúde · Ambiente protegido<br>Dados de contatos anonimizados</footer></main><aside><span>ECCOA / MÍDIA & CRM</span><h2>Da primeira conversa<br>à visão completa.</h2><p>Métricas de mídia e evidências do CRM,<br>cada uma com seu contexto.</p><div class="orbit"></div><small>PAINEL EXCLUSIVO DO CLIENTE</small></aside></body></html>`,{status:ready?200:503,headers:{'Content-Type':'text/html; charset=utf-8'}});
}
export async function handlePages(request,env,next) {
  try{return secure(await route(request,env,next));}
  catch{return secure(json({error:'Não foi possível consultar os dados. A última versão confirmada está preservada.'},503));}
}
async function route(request,env,next) {
  const url=new URL(request.url),path=url.pathname;
  if(path==='/login.css'&&request.method==='GET')return next();
  if(/(?:^|\/)\.|\.(?:sql|md|jsonc|map|env|pdf)$/.test(path)||['/src','/scripts','/migrations','/functions','/docs','/artifacts'].some(p=>path===p||path.startsWith(p+'/')))return new Response('Não encontrado',{status:404});
  const ready=!!env.ECCOA_DB&&!!env.PASSWORD_RECORD&&!!env.PSEUDONYM_KEY;
  if(path==='/auth/login'){
    if(request.method==='GET')return loginPage('',ready);
    if(request.method!=='POST')return new Response(null,{status:405});
    if(!sameOrigin(request))return json({error:'Origem inválida.'},403);
    if(!ready)return loginPage('',false);
    if(Number(request.headers.get('content-length'))>4096)return json({error:'Formulário inválido.'},413);
    const type=request.headers.get('content-type')||'';
    if(!type.startsWith('application/x-www-form-urlencoded'))return json({error:'Formulário inválido.'},415);
    const ip=request.headers.get('CF-Connecting-IP')||'local';
    const ipKey=await pseudonym(env.PSEUDONYM_KEY,`login:${ip}`),now=Date.now();
    // Increment atomically before checking the password to prevent parallel attempts.
    await run(env.ECCOA_DB,`INSERT INTO attempts(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END`,ipKey,now+15*60000,now,now);
    const attempt=await first(env.ECCOA_DB,'SELECT count FROM attempts WHERE id=?',ipKey);
    if(attempt.count>5)return new Response('Muitas tentativas. Tente novamente em 15 minutos.',{status:429,headers:{'Retry-After':'900'}});
    const body=await request.text();
    if(body.length>4096)return json({error:'Formulário inválido.'},413);
    const form=new URLSearchParams(body);
    if(!await verifyPassword(form.get('password'),env.PASSWORD_RECORD))return loginPage('Senha incorreta. Confira e tente novamente.');
    const token=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
    await env.ECCOA_DB.batch([
      statement(env.ECCOA_DB,'INSERT INTO sessions(hash,expires) VALUES(?,?)',await digest(token),now+SESSION_SECONDS*1000),
      statement(env.ECCOA_DB,'DELETE FROM attempts WHERE id=?',ipKey)
    ]);
    return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':cookie(token)}});
  }
  const token=sessionToken(request);
  const session=ready&&token&&/^[a-f0-9]{64}$/.test(token)?await first(env.ECCOA_DB,'SELECT hash FROM sessions WHERE hash=? AND expires>?',await digest(token),Date.now()):null;
  if(!session){
    if(path.startsWith('/api/'))return json({error:'Sessão ausente ou expirada.'},401);
    return new Response(null,{status:303,headers:{Location:'/auth/login'}});
  }
  if(path==='/auth/logout'){
    if(request.method!=='POST')return new Response(null,{status:405});
    if(!sameOrigin(request))return json({error:'Origem inválida.'},403);
    await run(env.ECCOA_DB,'DELETE FROM sessions WHERE hash=?',session.hash);
    return new Response(null,{status:303,headers:{Location:'/auth/login','Set-Cookie':cookie('',0)}});
  }
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405});
  if(path==='/api/report'){
    try{return json(await makeReport(env,url));}
    catch(e){if(['INVALID_RANGE','RANGE_TOO_LONG'].includes(e.message))return json({error:'Escolha um período válido, de até 3 anos e até hoje em São Paulo.'},400);throw e;}
  }
  if(path==='/api/contact-history'){
    const id=url.searchParams.get('id');if(!/^[a-f0-9]{64}$/.test(id||''))return json({error:'Contato inválido.'},400);
    const rows=await all(env.ECCOA_DB,'SELECT at,day,campaign_id campaignId,adset_id adsetId,ad_id adId,evidence FROM events WHERE contact_id=? ORDER BY at DESC LIMIT 200',id);
    return json({events:rows,limit:200});
  }
  if(path==='/api/config')return json({client:env.CLIENT_NAME||'Eccoa Saúde',brandsReady:env.BRANDS_READY==='true',crmWorkspace:env.CRM_WORKSPACE_NAME||null,metaAccount:env.META_ACCOUNT_ID?`act_${env.META_ACCOUNT_ID}`:null,metaVersion:env.META_API_VERSION||null,timezone:'America/Sao_Paulo',schedule:'A cada 15 minutos, quando Worker e fila estiverem configurados.',passwordHours:8});
  if(path.startsWith('/api/'))return json({error:'Não encontrado.'},404);
  if(!['/','/index.html','/app.js','/styles.css'].includes(path)&&!/^\/assets\/[A-Za-z0-9_.-]+$/.test(path))return new Response('Não encontrado',{status:404});
  return next();
}
