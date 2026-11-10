import test from 'node:test';
import assert from 'node:assert/strict';
import {pseudonym} from '../src/domain.js';

test('páginas concorrentes compartilham importação da chave sem misturar chaves ou IDs',async()=>{
 const key='test-only-cache-key-exclusive-000000000000001',other='test-only-cache-key-exclusive-000000000000002';
 const subtle=crypto.subtle,original=subtle.importKey;let imports=0;
 subtle.importKey=function(...args){imports++;return original.apply(this,args);};
 try{
  const rows=await Promise.all(Array.from({length:300},(_,i)=>pseudonym(key,'contact-'+i)));
  assert.equal(imports,1);assert.equal(new Set(rows).size,300);
  assert.equal(await pseudonym(key,'contact-0'),rows[0]);
  assert.notEqual(await pseudonym(other,'contact-0'),rows[0]);
  assert.equal(await pseudonym(key,'contact-0'),rows[0]);assert.equal(imports,3);
 }finally{subtle.importKey=original;}
});
