import test from 'node:test';
import assert from 'node:assert/strict';
import {readJSON} from '../src/connectors/http.js';

test('Workers bloqueia todo redirecionamento sem consultar o destino ou ler o corpo',async()=>{
 for(const status of [301,302,303,307,308]){
  let calls=0,bodyRead=false;
  await assert.rejects(()=>readJSON('https://clientcrm-api.rugido.com/api/v1/workspaces/current',{
   origin:'https://clientcrm-api.rugido.com',token:'test-only-token',auth:'api_access_token',
   fetcher:async(url,options)=>{
    calls++;assert.equal(calls,1);assert.equal(new URL(url).origin,'https://clientcrm-api.rugido.com');
    assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
    assert.equal(options.headers.api_access_token,'test-only-token');
    return {status,ok:false,headers:new Headers({Location:'https://unauthorized.invalid/collect'}),json(){bodyRead=true;throw Error('PRIVATE_BODY');}};
   }
  }),/UPSTREAM_REDIRECT_BLOCKED/);
  assert.equal(calls,1);assert.equal(bodyRead,false);
 }
});
