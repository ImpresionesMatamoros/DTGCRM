(function(root){
  'use strict';
  const productionRefs=Object.freeze(['jpjpnxamiclvhmcywyhx','imskdujyquefsgndqled','qrllwqoobqkfcqviquhz','ltqyuylmkawfkwoquqod','tecxlkywsanxaxyogqof']);
  function https(value,label){
    if(!value||/OWNER_|REPLACE_|<|>/.test(value))throw Error(label+': OWNER ACTION REQUIRED');
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error(label+': HTTPS limpio requerido');
    if(productionRefs.some(r=>u.href.includes(r))||u.hostname==='impresionesmatamoros.github.io')throw Error(label+': destino de producción prohibido');
    return u;
  }
  function ref(value,label){if(!/^[a-z]{20}$/.test(value||'')||productionRefs.includes(value))throw Error(label+': proyecto staging nuevo requerido');return value;}
  function validate(c){
    if(!c||c.environment!=='staging')throw Error('Solo STAGING está habilitado en este paquete');
    const crm=ref(c.crmProjectRef,'CRM'),pe=ref(c.peProjectRef,'PE');
    const shared=c.databaseIsolation==='shared-staging-project';
    if(crm===pe&&(!shared||c.crmSchema!=='public'||c.peSchema!=='dtg_pe'))throw Error('Proyecto compartido requiere esquemas public/dtg_pe explícitos');
    if(shared&&crm!==pe)throw Error('Configuración de proyecto compartido inconsistente');
    const db=https(c.supabaseUrl,'Supabase'),app=https(c.appUrl,'App'),engine=https(c.productEngineUrl,'Product Engine');
    if(db.origin!=='https://'+crm+'.supabase.co'||db.pathname!=='/')throw Error('URL Supabase no corresponde al proyecto CRM');
    if(shared){
      if(engine.origin!==db.origin||engine.pathname!=='/functions/v1/product-engine'||app.origin===db.origin)throw Error('Motor compartido debe usar exclusivamente su Edge Function staging');
    }else if(new Set([app.origin,db.origin,engine.origin]).size!==3)throw Error('App, API CRM y PE necesitan orígenes distintos');
    if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(c.supabasePublishableKey||''))throw Error('Usa una clave publishable del proyecto staging');
    const effects=c.externalEffects||{};
    for(const k of ['whatsapp','email','push','payments','webhooks','transcription'])if(effects[k]!==false)throw Error(k+': debe permanecer OFF');
    if(c.ownerConfirmedIsolation!==true)throw Error('Propietario debe confirmar origen, proyectos y clave staging');
    if(c.productionOrigins&&!Array.isArray(c.productionOrigins))throw Error('productionOrigins debe ser una lista');
    for(const raw of c.productionOrigins||[]){const p=new URL(raw);if([app.origin,db.origin,engine.origin].includes(p.origin))throw Error('Origen coincide con producción');}
    return Object.freeze({...c,externalEffects:Object.freeze({...effects}),productionOrigins:Object.freeze([...(c.productionOrigins||[])])});
  }
  const api=Object.freeze({validate,https,ref,productionRefs});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DTGStagingPolicy=api;
})(typeof window!=='undefined'?window:globalThis);
