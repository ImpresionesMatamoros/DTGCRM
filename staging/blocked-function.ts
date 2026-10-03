// Deploy this file as push-fanout and transcribe-chat-audio in STAGING only.
// No DB access, no service-role use, no imports, no outbound fetch.
Deno.serve((req) => new Response(JSON.stringify({error:{code:'STAGING_SIDE_EFFECT_DISABLED',message:'Servicio externo desactivado en STAGING'}}), {
  status:req.method==='OPTIONS'?200:503,
  headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type'}
}));
