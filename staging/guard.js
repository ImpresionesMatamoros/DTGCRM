(function(){
  'use strict';
  let config,error;
  try{
    config=window.DTGStagingPolicy.validate(window.DTG_ENV);
    if(location.origin!==new URL(config.appUrl).origin)throw Error('Este origen no está autorizado para STAGING');
  }catch(e){error=e.message;}
  window.DTG_STAGING_VALIDATED=!error;
  window.DTG_STAGING_ERROR=error||'';
  const nativeFetch=window.fetch.bind(window),nativeOpen=window.open.bind(window);
  function allowed(raw){
    try{
      const u=new URL(raw,location.href);
      if(u.protocol==='blob:'||u.protocol==='data:')return true;
      if(u.origin===location.origin)return true;
      if(!config)return false;
      if(u.origin!==new URL(config.supabaseUrl).origin)return false;
      if(/\/auth\/v1\/(signup|recover|otp|magiclink|invite)/.test(u.pathname))return false;
      if(u.pathname.includes('/functions/v1/'))return /\/functions\/v1\/product-engine-proxy$/.test(u.pathname);
      return ['https:','wss:'].includes(u.protocol);
    }catch(e){return false;}
  }
  window.DTGStagingAllowed=allowed;
  window.fetch=function(input,init){const url=typeof input==='string'||input instanceof URL?String(input):input.url;if(!allowed(url))return Promise.reject(Error('STAGING: conexión externa bloqueada'));return nativeFetch(input,init);};
  window.open=function(url,...args){if(!allowed(url))return null;return nativeOpen(url,...args);};
  document.addEventListener('click',function(e){const a=e.target.closest&&e.target.closest('a[href]');if(a&&!allowed(a.href)){e.preventDefault();e.stopImmediatePropagation();if(window.DTGStagingNotice)window.DTGStagingNotice();}},true);
  document.addEventListener('submit',function(e){if(e.target.action&&!allowed(e.target.action)){e.preventDefault();e.stopImmediatePropagation();}},true);
  // Other browser transports cannot bypass the fetch policy.
  if(window.XMLHttpRequest){const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...rest){if(!allowed(url))throw Error('STAGING: XHR externo bloqueado');return open.call(this,method,url,...rest);};}
  if(window.WebSocket){const WS=window.WebSocket;window.WebSocket=function(url,protocols){const u=new URL(url);if(!config||u.protocol!=='wss:'||u.hostname!==new URL(config.supabaseUrl).hostname)throw Error('STAGING: WebSocket externo bloqueado');return protocols?new WS(url,protocols):new WS(url);};window.WebSocket.prototype=WS.prototype;Object.assign(window.WebSocket,{CONNECTING:WS.CONNECTING,OPEN:WS.OPEN,CLOSING:WS.CLOSING,CLOSED:WS.CLOSED});}
  if(navigator.sendBeacon)navigator.sendBeacon=function(){return false;};
  document.addEventListener('DOMContentLoaded',function(){
    const banner=document.createElement('div');banner.id='dtg-staging-banner';banner.setAttribute('role','status');banner.textContent='DTG CRM — STAGING · Datos de prueba · Envíos externos OFF';
    banner.style.cssText='position:fixed;inset:0 0 auto;z-index:2147483647;background:#ffcf66;color:#24200e;font:700 12px/24px system-ui;text-align:center;min-height:24px;padding:0 8px;pointer-events:none';document.body.appendChild(banner);
    document.documentElement.style.setProperty('--staging-banner-height','24px');
    document.title='DTG CRM — STAGING';
  });
})();
