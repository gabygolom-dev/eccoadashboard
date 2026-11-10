import {handlePages} from '../src/pages.js';
export async function onRequest(context) {
  return handlePages(context.request,context.env,()=>context.next());
}
