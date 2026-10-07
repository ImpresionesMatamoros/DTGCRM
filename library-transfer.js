(function(root){'use strict';
function abort(){throw Object.assign(new Error('Transferencia cancelada'),{name:'AbortError'});}
function validURI(value){var u=new URL(value);if(u.origin!=='https://www.googleapis.com'||!u.pathname.startsWith('/upload/drive/')||!u.searchParams.has('upload_id'))throw Error('Sesión de carga inválida');return u.href;}
async function hash(file,signal,progress){
 return new Promise(function(resolve,reject){var worker=new Worker('library-hash-worker.js?v=2');function cleanup(){worker.terminate();if(signal)signal.removeEventListener('abort',stop);}function stop(){cleanup();reject(Object.assign(new Error(),{name:'AbortError'}));}if(signal&&signal.aborted){stop();return;}if(signal)signal.addEventListener('abort',stop,{once:true});worker.onerror=function(){cleanup();reject(Error('No pudimos verificar este archivo.'));};worker.onmessage=function(e){if(e.data.error){cleanup();reject(Error('No pudimos leer este archivo.'));}else if(e.data.sha256){cleanup();resolve(e.data.sha256);}else if(progress)progress(e.data.progress);};worker.postMessage({file:file});});
}
async function transfer(file,session,api,signal,onProgress){
 if(file.size!==session.size_bytes)throw Error('Selecciona el mismo archivo para reanudar.');
 var s=Object.assign({},session),prepared=await api('directUploadSession',{session_id:s.session_id});
 if(prepared.state==='complete')return prepared;
 var uri=validURI(prepared.upload_url),offset=Number(s.confirmed_offset)||0,retries=0;
 while(offset<file.size){
  if(signal&&signal.aborted)abort();
  var end=Math.min(offset+4194304,file.size),response;
  try{
   response=await fetch(uri,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream','Content-Range':'bytes '+offset+'-'+(end-1)+'/'+file.size},body:file.slice(offset,end),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000),credentials:'omit',referrerPolicy:'no-referrer'});
   if(response.status!==308&&!response.ok)throw Error('Carga interrumpida');
   // Range is not exposed by every Google CORS response. Reconcile metadata
   // through the backend rather than guessing which bytes Google accepted.
   var range=response.headers.get('range'),confirmed;
   if(response.status===308&&range&&/bytes=0-\d+$/.test(range))confirmed=Number(range.split('-')[1])+1;
   else if(response.ok)confirmed=file.size;
   else confirmed=Number((await api('resumeUpload',{session_id:s.session_id})).confirmed_offset);
   if(!Number.isSafeInteger(confirmed)||confirmed<=offset||confirmed>file.size)throw Error('La carga no avanzó.');
   offset=confirmed;retries=0;if(onProgress)onProgress(offset/file.size);
  }catch(e){
   if(signal&&signal.aborted)abort();if(++retries>3)throw Error('La carga se pausó. Puedes reanudar seleccionando el mismo archivo.');
   var resumed=await api('resumeUpload',{session_id:s.session_id});offset=Number(resumed.confirmed_offset);
   if(resumed.state==='complete')return resumed;
   prepared=await api('directUploadSession',{session_id:s.session_id});uri=validURI(prepared.upload_url);
  }
 }
 return api('completeUpload',{session_id:s.session_id});
}
root.DTGLibraryTransfer={hash:hash,upload:transfer,validURI:validURI};
})(window);
