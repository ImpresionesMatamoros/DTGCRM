(function(root){'use strict';
var bridge,epoch=0,controller=new AbortController(),pending=new Map();
var design=/\.(cdr|cdt|cpt|cmx|psd|psb|psdt|ai|ait|eps|ps|indd|idml|xd|afdesign|afphoto|afpub|xcf|sketch|pdf|svg|svgz|tif|tiff|raw|dng|nef|cr2|cr3|arw|orf|raf|heic|heif)$/i;
var designMime=/^(image\/(vnd\.adobe\.photoshop|photoshop|x-photoshop|tiff|svg\+xml|heic|heif)|application\/(pdf|postscript|vnd\.corel-draw|x-coreldraw|x-photoshop))$/i;
function shouldDrive(file){return !!file&&(design.test(file.name||'')||designMime.test(file.type||'')||file.size>25*1048576||(/^image\//i.test(file.type||'')||/\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name||''))&&file.size>=5*1048576);}
function reset(){epoch++;controller.abort();controller=new AbortController();pending.clear();}
async function preview(file){if(!/^image\/(jpeg|png|webp)$/i.test(file.type||'')||file.size>25*1048576)return null;var url=URL.createObjectURL(file);try{var img=new Image();img.src=url;await img.decode();var scale=Math.min(1,640/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);var blob=await new Promise(function(done){c.toBlob(done,'image/jpeg',.85);});return blob&&blob.size<=524288?new File([blob],'preview.jpg',{type:'image/jpeg'}):null;}catch{return null;}finally{URL.revokeObjectURL(url);}}
async function upload(file,ticket){
 if(!ticket||!ticket.clienteId)throw Error('Asocia este ticket a un cliente antes de subir originales a Drive.');
 if(!file||!file.size||file.size>2147483648)throw Error('Selecciona un archivo de hasta 2 GB que no esté vacío.');
 var actor=bridge.actor(),revision=epoch,signal=controller.signal;if(!actor)throw Error('Inicia sesión nuevamente.');
 var last=-10;function progress(p){var n=Math.floor(p*100);if(n>=last+10){last=n;bridge.notice(file.name+' · '+n+'%');}}
 async function api(a,i,b){try{return await root.DTGWorkspaceAPI.request(a,i,{actor:actor,signal:signal,binary:b,isCurrent:function(){return epoch===revision&&bridge.actor()===actor;}});}catch(e){if(!e.message)e.message=({LIBRARY_DISABLED:'La biblioteca de Drive está deshabilitada.',GOOGLE_NOT_CONNECTED:'Conecta Google Workspace para guardar este original.',INVALID_FILE_SIZE:'El archivo supera el tamaño permitido.',UPLOAD_BUSY_OR_EXPIRED:'La carga está ocupada o venció. Revisa su estado en la biblioteca.'})[e.code]||root.DTGWorkspaceAPI.message(e);throw e;}}
 bridge.notice('Guardando original en Drive: '+file.name);
 var sha=await root.DTGLibraryTransfer.hash(file,signal),cacheKey=actor+':'+ticket.id+':'+ticket.clienteId+':'+sha+':'+file.name+':'+file.type;
 if(pending.has(cacheKey))return pending.get(cacheKey);
 var operation=(async function(){
  var localKey='dtg-auto-upload:'+cacheKey,key;try{key=localStorage.getItem(localKey);}catch{}var recovered=!!key;if(!key)key=crypto.randomUUID();try{localStorage.setItem(localKey,key);}catch{}
  var s=await api('beginLibraryUpload',{ticket_id:ticket.id,customer_id:ticket.clienteId,filename:file.name,mime_type:file.type||'application/octet-stream',size_bytes:file.size,source_sha256:sha,idempotency_key:key,purpose:design.test(file.name||'')?'production_source':'reference'});
  if(s.state!=='complete'){if(recovered)s=await api('resumeUpload',{session_id:s.session_id});last=-10;await root.DTGLibraryTransfer.upload(file,s,api,signal,progress);}
  if(epoch!==revision||bridge.actor()!==actor)throw Object.assign(new Error(),{name:'AbortError'});
  var thumb=await preview(file);if(thumb){try{await api('previewUpload',{file_id:s.file_id,mime_type:'image/jpeg'},thumb);}catch(e){if(epoch!==revision||signal.aborted)throw e;}}
  return {file_id:s.file_id,filename:file.name,size_bytes:file.size,mime_type:file.type||'application/octet-stream',previewFile:thumb};
 })();if(pending.size>=100)pending.delete(pending.keys().next().value);pending.set(cacheKey,operation);try{return await operation;}catch(e){pending.delete(cacheKey);throw e;}
}
function markup(fileId,name){return '<button type="button" class="chat-file-card" data-drive-attachment="'+String(fileId).replace(/[&<>"']/g,'')+'"><span>📁 '+String(name||'Original en Drive').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];})+'</span><small>Abrir original en Drive</small></button>';}
document.addEventListener('click',async function(e){var b=e.target.closest&&e.target.closest('[data-drive-attachment]');if(!b||!bridge)return;e.preventDefault();var tab=window.open('about:blank','_blank');if(tab)tab.opener=null;try{var revision=epoch,actor=bridge.actor(),r=await root.DTGWorkspaceAPI.request('directFileAccess',{file_id:b.dataset.driveAttachment},{actor:actor,isCurrent:function(){return epoch===revision&&bridge.actor()===actor;}});if(tab)tab.location.replace(r.url);}catch(e){if(tab)tab.close();bridge.notice(e.code==='WORKSPACE_IDENTITY_REQUIRED'?'Vincula tu cuenta Workspace desde la biblioteca del cliente para abrir originales.':root.DTGWorkspaceAPI.message(e));}});
root.DTGAutomaticAttachments={mount:function(b){bridge=b;},shouldDrive:shouldDrive,upload:upload,markup:markup,reset:reset};
})(window);
