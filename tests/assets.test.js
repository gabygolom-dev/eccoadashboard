import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {handlePages} from '../src/pages.js';
import {createDB} from '../scripts/local-db.mjs';
import {digest} from '../src/domain.js';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
const publicVisuals=['/login.css','/styles.css','/assets/type.css','/assets/eccoa.png','/assets/rugido-simbolo-oficial.png'];
function nextFor(directory,request){return async()=>{
 const pathname=new URL(request.url).pathname;
 const file=path.join(directory,pathname==='/'?'index.html':pathname);
 try{return new Response(await readFile(file),{headers:{'Content-Type':types[path.extname(file)]||'application/octet-stream'}});}catch{return new Response(null,{status:404});}
};}

test('login mantém CSS e logos em public, dist e publicação pela raiz, mesmo sem sessão',async()=>{
 for(const directory of [root,path.join(root,'dist'),path.join(root,'public')]){
  for(const asset of publicVisuals){
   for(const method of ['GET','HEAD']){
    const request=new Request('https://eccoa.test'+asset,{method});
    const response=await handlePages(request,{},nextFor(directory,request));
    assert.equal(response.status,200,`${directory}: ${method} ${asset}`);
    assert.equal(response.headers.get('Location'),null);
    assert.ok(response.headers.get('Content-Type').startsWith(types[path.extname(asset)].split(';')[0]));
    const body=new Uint8Array(await response.arrayBuffer());assert.ok(body.length>0);
    if(asset.endsWith('.png'))assert.deepEqual([...body.slice(0,8)],[137,80,78,71,13,10,26,10]);
    if(asset.endsWith('.css'))assert.ok(!new TextDecoder().decode(body).includes('<html'));
   }
  }
  const req=new Request('https://eccoa.test/auth/login');const login=await handlePages(req,{},nextFor(directory,req));
  assert.equal(login.status,503);assert.match(await login.text(),/href="\/login\.css"/);
 }
});

test('todos os arquivos carregados pelo painel existem na raiz publicada e espelham a fonte',async()=>{
 const files=['index.html','app.js','styles.css','login.css','_routes.json','_headers','assets/type.css','assets/domain.js','assets/eccoa.png','assets/rugido-simbolo-oficial.png'];
 for(const file of files){const source=await readFile(path.join(root,'public',file));assert.deepEqual(await readFile(path.join(root,file)),source);assert.deepEqual(await readFile(path.join(root,'dist',file)),source);}
 const html=await readFile(path.join(root,'index.html'),'utf8');
 const references=[...html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)].map(m=>m[1]);
 for(const ref of references)assert.ok((await readFile(path.join(root,ref))).length>0,ref);
 assert.match(await readFile(path.join(root,'styles.css'),'utf8'),/@import url\('\/assets\/type\.css'\)/);
});

test('publicar CSS e logos não libera APIs, JavaScript privado ou arquivos do repositório',async()=>{
 const db=createDB();try{
  const token='b'.repeat(64);await db.prepare('INSERT INTO sessions(hash,expires) VALUES(?,?)').bind(await digest(token),Date.now()+60000).run();
  const env={ECCOA_DB:db,PASSWORD_RECORD:'configured',PSEUDONYM_KEY:'test-only-32-character-key-0000000000'};
  for(const pathname of ['/app.js','/assets/domain.js','/api/config']){
   const request=new Request('https://eccoa.test'+pathname);const response=await handlePages(request,env,nextFor(root,request));
   assert.equal(response.status,pathname.startsWith('/api/')?401:303);
  }
  for(const pathname of ['/src/auth.js','/scripts/audit-crm.mjs','/deploy/eccoa-sync-worker.mjs','/package.json','/.env','/migrations/0001.sql']){
   const request=new Request('https://eccoa.test'+pathname,{headers:{Cookie:'__Host-eccoa='+token}});
   assert.equal((await handlePages(request,env,nextFor(root,request))).status,404,pathname);
  }
  const request=new Request('https://eccoa.test/',{headers:{Cookie:'__Host-eccoa='+token}});
  assert.equal((await handlePages(request,env,nextFor(root,request))).status,200);
 }finally{db.close();}
});
