import { service, errorReply } from '../_shared/integrations/runtime.ts';
import { fail } from '../_shared/integrations/core.mjs';

// Public callback: one-use server-side state + PKCE, NOT an unauthenticated API.
Deno.serve(async(req:Request)=>{
  try {
    if(req.method!=='GET')fail('METHOD_NOT_ALLOWED',405);
    const url=new URL(req.url);if(url.searchParams.has('error'))fail('GOOGLE_CONSENT_DENIED',409);
    const s=await service();await s.completeOAuth(url.searchParams.get('code'),url.searchParams.get('state'));
    return new Response('<!doctype html><meta charset="utf-8"><title>Google conectado</title><p>Google Workspace conectado. Puedes cerrar esta pestaña y actualizar Integraciones en el CRM.</p>',{
      headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'}});
  }catch(e){return errorReply(e,{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});}
});
