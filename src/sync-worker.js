import {startCycle,processJob} from './sync.js';
import {first} from './db.js';
// Reuse a few sequential steps per invocation. Every step still commits its
// checkpoint and lease. Bounded groups stay below 50 D1/subrequests and reduce
// queue operations; the signing key is reused for contact-page HMAC work.
export async function processQueueJob(env,body,step=processJob){
  if(!['crm','meta'].includes(body?.provider)||!/^[\da-f-]{36}$/.test(body?.runId||''))return;
  const current=await first(env.ECCOA_DB,"SELECT cursor_json FROM runs WHERE id=? AND provider=? AND state='running'",body.runId,body.provider);
  if(!current)return;
  const limit=body.provider==='crm'&&JSON.parse(current.cursor_json).phase==='messages'?5:3;
  let next=body,pending=null;
  const localEnv={...env,ECCOA_JOBS:{async send(job,options){
    if(!options&&job.runId===body.runId&&job.provider===body.provider){pending=job;return;}
    return env.ECCOA_JOBS.send(job,options);
  }}};
  for(let i=0;i<limit&&next;i++){
    pending=null;await step(localEnv,next);next=pending;
  }
  // Enqueue continuation before acknowledging the original message. If sending
  // fails, the queue retries that original and resumes the latest checkpoint.
  if(next)await env.ECCOA_JOBS.send(next);
}
export default {
  async scheduled(event,env,ctx){ctx.waitUntil(startCycle(env,new Date(event.scheduledTime).toISOString()));},
  async queue(batch,env){
    for(const message of batch.messages){try{await processQueueJob(env,message.body);message.ack();}catch{message.retry({delaySeconds:120});}}
  },
  async fetch(){return new Response('Recurso exclusivo de sincronização Eccoa. Sem acesso HTTP.',{status:404,headers:{'Cache-Control':'no-store'}});}
};
