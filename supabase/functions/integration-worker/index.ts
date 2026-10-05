import { service, environment, IntegrationWorker, errorReply } from '../_shared/integrations/runtime.ts';
import { digest, fail } from '../_shared/integrations/core.mjs';

// Scheduler calls with x-dtg-worker-secret. No frontend service key.
Deno.serve(async(req:Request)=>{
  try {
    if(req.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
    const configured=environment().INTEGRATION_WORKER_SECRET,supplied=req.headers.get('x-dtg-worker-secret')||'';
    if(!configured||!supplied||await digest(configured)!==await digest(supplied))fail('AUTH_REQUIRED',401);
    const worker=new IntegrationWorker(await service());return Response.json(await worker.run(),{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorReply(e);}
});
