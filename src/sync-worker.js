import {startCycle,processJob} from './sync.js';
export default {
  async scheduled(event,env,ctx){ctx.waitUntil(startCycle(env,new Date(event.scheduledTime).toISOString()));},
  async queue(batch,env){
    for(const message of batch.messages){try{await processJob(env,message.body);message.ack();}catch{message.retry({delaySeconds:120});}}
  },
  async fetch(){return new Response('Recurso exclusivo de sincronização Eccoa. Sem acesso HTTP.',{status:404,headers:{'Cache-Control':'no-store'}});}
};
