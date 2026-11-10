import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createDB} from './local-db.mjs';
import {handlePages} from '../src/pages.js';
import {passwordRecord} from '../src/auth.js';
// Local preview only. No CRM/Meta token is read or imported. No invented metrics.
const db=createDB();const previewPassword=crypto.randomUUID();
const env={ECCOA_DB:db,PASSWORD_RECORD:await passwordRecord(previewPassword),PSEUDONYM_KEY:crypto.randomUUID(),CLIENT_NAME:'Eccoa Saúde'};
// Browser QA uses this one local session. It is not a deployment credential.
const {digest}=await import('../src/domain.js');const previewSession=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
await db.prepare('INSERT INTO sessions(hash,expires) VALUES(?,?)').bind(await digest(previewSession),Date.now()+8*3600000).run();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const server=http.createServer(async(req,res)=>{
 try{
 const headers=new Headers();for(const[k,v]of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(', '):v);
 if(req.method==='GET'&&req.url==='/__local_preview'){res.writeHead(303,{'Set-Cookie':`__Host-eccoa=${previewSession}; Path=/; Secure; HttpOnly; SameSite=Strict`,'Location':'/'});res.end();return;}
 // Secure cookies are accepted on localhost by modern browsers. Local QA keeps the same session validation.
 const chunks=[];for await(const c of req)chunks.push(c);
 const request=new Request('http://localhost:8787'+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
 const response=await handlePages(request,env,async()=>{
  const pathname=new URL(request.url).pathname;const file=path.join(process.cwd(),'public',pathname==='/'?'index.html':pathname);
  try{const info=await stat(file);if(!info.isFile())return new Response('Não encontrado',{status:404});return new Response(await readFile(file),{headers:{'Content-Type':types[path.extname(file)]||'application/octet-stream'}});}catch{return new Response('Não encontrado',{status:404});}
 });
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Falha no servidor local.');}
});
server.listen(8787,'127.0.0.1',()=>console.log('Prévia local sem dados de demonstração: http://localhost:8787/__local_preview'));
