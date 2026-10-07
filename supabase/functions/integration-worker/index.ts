import { service, environment, IntegrationWorker, errorReply, jsonBody } from '../_shared/integrations/runtime.ts';
import { digest, fail } from '../_shared/integrations/core.mjs';

// Scheduler calls with x-dtg-worker-secret. No frontend service key.
Deno.serve(async(req:Request)=>{
  try {
    if(req.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
    const s=await service();const configured=s.env.INTEGRATION_WORKER_SECRET,supplied=req.headers.get('x-dtg-worker-secret')||'';
    if(!configured||!supplied||await digest(configured)!==await digest(supplied))fail('AUTH_REQUIRED',401);
    const input=await jsonBody(req,1000);
    if(input.action==='library_readiness')return Response.json(await (s as unknown as {libraryReadiness:()=>Promise<unknown>}).libraryReadiness(),{headers:{'Cache-Control':'no-store'}});
    const worker=new IntegrationWorker(s);return Response.json(await worker.run(),{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorReply(e);}
});
