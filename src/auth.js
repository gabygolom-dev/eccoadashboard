import {digest} from './domain.js';
const enc=new TextEncoder();
export const SESSION_SECONDS=8*60*60;
export const MIN_PASSWORD_LENGTH=9;
export async function passwordRecord(password,salt=crypto.getRandomValues(new Uint8Array(16))) {
  if(typeof password!=='string'||password.length<MIN_PASSWORD_LENGTH||password.length>512) throw new Error('PASSWORD_TOO_SHORT');
  const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);
  const hex=a=>[...new Uint8Array(a)].map(x=>x.toString(16).padStart(2,'0')).join('');
  return `pbkdf2-sha256$100000$${hex(salt)}$${hex(bits)}`;
}
export async function verifyPassword(password,record) {
  if(typeof password!=='string'||password.length>512||!record) return false;
  const [kind,rounds,salt,expected]=record.split('$');
  if(kind!=='pbkdf2-sha256'||rounds!=='100000'||!/^[a-f0-9]{32}$/.test(salt||'')||!/^[a-f0-9]{64}$/.test(expected||'')) return false;
  if(password.length<MIN_PASSWORD_LENGTH) return false;
  const actual=(await passwordRecord(password,Uint8Array.from(salt.match(/../g),h=>parseInt(h,16)))).split('$')[3];
  let diff=0;for(let i=0;i<expected.length;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);
  return diff===0;
}
export function sessionToken(request) {
  return (request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-eccoa='))?.slice(13)||null;
}
export const cookie=(token,maxAge=SESSION_SECONDS)=>`__Host-eccoa=${token}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`;
export function sameOrigin(request) {
  return request.headers.get('Origin')===new URL(request.url).origin && !['cross-site','none'].includes(request.headers.get('Sec-Fetch-Site'));
}
export {digest};
