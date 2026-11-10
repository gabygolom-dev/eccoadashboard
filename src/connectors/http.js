// This module is the ONLY upstream transport. No method parameter is accepted.
export class UpstreamError extends Error {
  constructor(code,retryAfter=0) { super(code);this.retryAfter=retryAfter; }
}
export async function readJSON(url, {origin,token,headers={},auth='bearer',expectedVersion=null,fetcher=fetch}) {
  const u=new URL(url);
  if(u.origin!==origin || u.protocol!=='https:' || u.username || u.password || u.searchParams.has('access_token')) throw new UpstreamError('UPSTREAM_ORIGIN_BLOCKED');
  if(!['bearer','api_access_token'].includes(auth))throw new UpstreamError('UPSTREAM_AUTH_SCHEME_BLOCKED');
  const credential=auth==='api_access_token'?{api_access_token:token}:{Authorization:`Bearer ${token}`};
  let response;
  try { response=await fetcher(u.href,{method:'GET',redirect:'error',headers:{Accept:'application/json',...headers,...credential},signal:AbortSignal.timeout(25000)}); }
  catch { throw new UpstreamError('UPSTREAM_NETWORK_ERROR'); }
  if (!response.ok) {
    const retry=Math.min(3600,Math.max(0,Number(response.headers.get('retry-after'))||0));
    throw new UpstreamError(`UPSTREAM_HTTP_${response.status}`,retry);
  }
  if(expectedVersion&&response.headers.get('facebook-api-version')!==expectedVersion)throw new UpstreamError('UPSTREAM_API_VERSION_MISMATCH');
  if (Number(response.headers.get('content-length'))>12000000) throw new UpstreamError('UPSTREAM_RESPONSE_TOO_LARGE');
  // Do not log response bodies: CRM data may contain health information.
  let data;try { data=await response.json(); } catch {throw new UpstreamError('UPSTREAM_INVALID_JSON');}
  if(data?.error) throw new UpstreamError('UPSTREAM_API_ERROR');
  return data;
}
export function nextCursor(data,origin,accountId) {
  const next=data?.paging?.next;
  if(!next) return null;
  const u=new URL(next);
  if(u.origin!==origin || !u.pathname.includes(`/act_${accountId}/`)) throw new UpstreamError('META_PAGINATION_SCOPE_BLOCKED');
  const after=data?.paging?.cursors?.after || u.searchParams.get('after');
  if(!after || after.length>4000) throw new UpstreamError('META_INVALID_CURSOR');
  // Never persist paging.next, which may contain an access token.
  return after;
}
