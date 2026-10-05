(function(root){
  'use strict';
  var bridge=null,panel=null,context=null,actor=null,controller=null,returnFocus=null,generation=0;
  var state={files:[],vendors:[],inboxes:[],messages:[],deliveries:[],operations:[],status:null,error:'',busy:false,progress:'',history:[],upload:null,drafts:{},formKeys:{}};
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function key(){return crypto.randomUUID();}
  var errors={INTEGRATIONS_DISABLED:'Las integraciones están preparadas, pero aún no se han activado.',GOOGLE_NOT_CONNECTED:'Google Workspace todavía no está conectado.',REAUTH_REQUIRED:'Un administrador debe reconectar Google Workspace.',ALIAS_NOT_VERIFIED:'Este alias aún no está habilitado para enviar en Gmail.',PRODUCTION_APPROVAL_REQUIRED:'Selecciona un archivo Print Ready aprobado para este ticket.',AUTH_REQUIRED:'Inicia sesión nuevamente.',WORKSPACE_DOMAIN_MISMATCH:'La cuenta de Google debe pertenecer a 956print.com.',SECRETS_NOT_CONFIGURED:'Falta configurar el backend.',OAUTH_NOT_CONFIGURED:'Falta configurar OAuth en el backend.',SEND_RECONCILIATION_REQUIRED:'El resultado del envío es incierto. Revisa Gmail antes de reenviar.',GRANT_RECONCILIATION_REQUIRED:'El permiso necesita revisión administrativa antes de continuar.',PREEXISTING_VENDOR_ACCESS:'El proveedor ya tenía acceso externo; revisa ese permiso antes de continuar.',NATIVE_EXPIRY_UNCONFIRMED:'Drive no confirmó el vencimiento del permiso. El correo no se envió.'};
  function message(e){if(e.name==='TimeoutError')return 'La conexión tardó demasiado. Conservamos tu borrador; comprueba el resultado antes de reintentar un envío.';return errors[e.code]||(e instanceof TypeError||e instanceof ReferenceError?'No fue posible completar esta operación. El ticket sigue disponible.':e.message)||'No fue posible completar esta operación. El ticket sigue disponible.';}
  async function api(action,input,binary,raw){
    var owner=actor,revision=generation,client=bridge.getClient();if(!client||owner!==bridge.actor())throw new Error('La sesión cambió.');
    var auth=await client.auth.getSession(),session=auth.data&&auth.data.session;
    if(!session||session.user.id!==owner||owner!==bridge.actor())throw new Error('La sesión cambió.');
    var url=bridge.url()+'/functions/v1/integration-api',body;
    if(binary){var q=new URLSearchParams(Object.assign({binary:action},input));url+='?'+q;body=binary;}
    else body=JSON.stringify(Object.assign({action:action},input||{}));
    var res=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:bridge.publishableKey(),'Content-Type':binary?(input.mime_type||'application/octet-stream'):'application/json'},body:body,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(binary?120000:20000)])});
    if(owner!==bridge.actor()||owner!==actor||revision!==generation)throw new Error('La sesión cambió.');
    if(raw&&res.ok)return res;
    var json;try{json=await res.json();}catch(e){throw new Error('El backend de integraciones todavía no está disponible.');}
    if(!res.ok){var error=new Error(errors[json.error]||'La integración no está disponible por ahora.');error.code=json.error;throw error;}return json;
  }
  function button(action,label,data){return '<button type="button" class="btn btn-ghost" data-dtgi="'+action+'" '+(data||'')+(state.busy&&action!=='close'?' disabled':'')+'>'+esc(label)+'</button>';}
  function options(rows,label){return rows.map(function(r){return '<option value="'+esc(r.id)+'">'+esc(r[label])+'</option>';}).join('');}
  function fileRows(files,reuse){return files.map(function(f){var approved=f.stage==='Print Ready'&&f.usage&&f.usage.production_approved;return '<article class="dtgi-file"><div><strong>'+esc(f.filename)+'</strong><small>v'+f.version+' · '+esc(f.stage)+' · '+(Number(f.size_bytes)/1048576).toFixed(1)+' MiB · '+esc(f.availability)+'</small></div>'+button('open-file','Descargar','data-id="'+f.id+'"')+(reuse?button('reuse','Usar en este ticket','data-id="'+f.id+'"'):button('current','Usar como versión actual','data-id="'+f.id+'"'))+(f.thumbnail_path?button('preview','Ver preview','data-id="'+f.id+'"'):'<span class="muted">Preview '+esc(f.preview_state)+'</span>')+(!reuse&&bridge.isAdmin()?button('proof','Proof','data-id="'+f.id+'"')+button('print-ready','Print Ready','data-id="'+f.id+'"')+button('approve','Aprobar producción','data-id="'+f.id+'"'):'')+(approved?'<span>✓ Aprobado para este ticket</span>':'')+'</article>';}).join('')||'<p class="muted">Sin archivos registrados.</p>';}
  function render(){
    if(!panel||actor!==bridge.actor())return close();
    var cfg=state.status,admin=bridge.isAdmin(),ticket=context&&context.ticketId;
    var eligible=state.files.filter(function(f){return f.availability==='available'&&f.stage==='Print Ready'&&f.usage&&f.usage.production_approved;});
    panel.innerHTML='<section class="dtgi-dialog" role="dialog" aria-modal="true" aria-label="Archivos y correo"><header><h2>Archivos y correo'+(ticket?' · #'+esc(context.seq):'')+'</h2>'+button('close','Cerrar')+'</header>'+
      (state.error?'<p class="dtgi-error" role="alert">'+esc(state.error)+'</p>':'')+(state.progress?'<p role="status">'+esc(state.progress)+'</p>':'')+(state.oauthUrl?'<p><a class="btn" href="'+esc(state.oauthUrl)+'" target="_blank" rel="noopener noreferrer">Autorizar Google Workspace</a></p>':'')+
      '<div class="dtgi-actions">'+button('refresh','Actualizar')+(admin?button('oauth','Conectar Google Workspace')+button('validate','Validar aliases')+button('sync','Sincronizar correo'):'')+'</div>'+
      (cfg?'<p>'+esc(cfg.domain)+' · '+(cfg.enabled?'Integraciones activas':'Pendiente de activación')+' · '+esc(cfg.connection?cfg.connection.state:'Bandejas autorizadas')+'</p>':'')+
      (admin&&cfg&&cfg.setup?'<p role="status">'+(cfg.setup.configured?'Backend de correo configurado.': 'Configuración pendiente en el servidor: '+esc(cfg.setup.missing.join(', ')))+'</p>':'')+
      (ticket?'<section><h3>Archivos del ticket</h3><form data-dtgi-form="upload"><label>Original<input type="file" name="file" required></label><label>Propósito<select name="purpose"><option value="reference">Referencia</option><option value="production_source">Original de producción</option><option value="print_ready">Print Ready</option><option value="gang_sheet">Gang sheet</option></select></label><label>Nueva versión de<select name="asset_id"><option value="">Nuevo archivo independiente</option>'+options(state.files.filter(function(f,i,a){return a.findIndex(function(x){return x.asset_id===f.asset_id;})===i;}).map(function(f){return {id:f.asset_id,filename:f.filename};}),'filename')+'</select></label><button class="btn btn-primary"'+(state.busy?' disabled':'')+'>Subir original</button></form>'+fileRows(state.files,false)+
      '<h3>Reutilizar del historial del cliente</h3>'+button('history','Consultar historial')+fileRows(state.history,true)+'</section>':'')+
      (ticket?'<section><h3>Send to Vendor</h3><form data-dtgi-form="vendor-send"><label>Archivo aprobado<select name="file_id" required>'+options(eligible,'filename')+'</select></label><label>Proveedor<select name="vendor_id" required>'+options(state.vendors,'name')+'</select></label><label>Remitente<select name="inbox_id" required>'+options(state.inboxes.filter(function(b){return b.verification_status==='accepted';}),'email_alias')+'</select></label><label>Acceso (horas)<input name="access_hours" type="number" min="1" max="8760" value="168" required></label><button class="btn btn-primary"'+(!eligible.length||state.busy?' disabled':'')+'>Send to Vendor</button></form><div>'+state.deliveries.map(function(d){return '<article class="dtgi-file"><strong>'+esc(d.recipient_email)+'</strong><small>'+esc(d.email_state)+' · Hasta '+esc(new Date(d.access_expires_at).toLocaleString())+'</small>'+button('resend','Reenviar enlace','data-id="'+d.id+'"')+(admin?button('revoke','Revocar acceso','data-id="'+d.id+'"'):'')+(d.last_error?'<p>'+esc(errors[d.last_error]||d.last_error)+'</p>':'')+'</article>';}).join('')+'</div></section>':'')+
      '<section><h3>Correo</h3><p>Enviar registra el correo en una cola. Consulta Operaciones para confirmar que Google lo aceptó; no confirma que el cliente lo haya leído.</p><label>Bandeja<select id="dtgi-inbox">'+options(state.inboxes,'email_alias')+'</select></label>'+button('emails','Consultar bandeja')+'<div>'+state.messages.map(function(m){return '<article class="dtgi-file"><strong>'+esc(m.subject||'(Sin asunto)')+'</strong><small>'+esc(m.from_address)+'</small>'+button('email-view','Leer','data-id="'+m.id+'"')+(ticket?button('email-link','Vincular al ticket','data-id="'+m.id+'"'):'')+'</article>';}).join('')+'</div><form data-dtgi-form="email-send"><input type="hidden" name="reply_message_id">'+(state.drafts['email-send']&&state.drafts['email-send'].reply_message_id?'<p>Respuesta al hilo seleccionado.</p>'+button('new-email','Preparar correo nuevo'):'')+'<label>Desde<select name="inbox_id" required>'+options(state.inboxes.filter(function(b){return b.verification_status==='accepted';}),'email_alias')+'</select></label><label>Para<input name="to" type="email" required></label><label>Asunto<input name="subject" maxlength="300" required'+(state.drafts['email-send']&&state.drafts['email-send'].reply_message_id?' readonly':'')+'></label><label>Mensaje<textarea name="body" maxlength="100000" required></textarea></label><button class="btn btn-primary"'+(state.busy||!cfg||!cfg.enabled||!state.inboxes.some(function(b){return b.verification_status==='accepted';})?' disabled':'')+'>Enviar correo</button></form></section>'+
      (admin?'<details><summary>Configuración</summary><form data-dtgi-form="configure"><label>Umbral de Drive (MiB)<input name="threshold" type="number" min="1" max="50" value="'+(cfg?Number(cfg.threshold_bytes||26214400)/1048576:25)+'" required></label><label><input name="enabled" type="checkbox"'+(cfg&&cfg.enabled?' checked':'')+'> Activar integraciones</label><button class="btn">Guardar configuración</button></form><h3>Proveedor</h3><form data-dtgi-form="vendor-save"><label>Nombre<input name="name" required></label><label>Email<input name="email" type="email" required></label><label>Tipo de producción<input name="production_type" required></label><label>Catálogo operativo<select name="ops_provider_key"><option value="">Sin vínculo existente</option>'+bridge.providerKeys().map(function(x){return '<option value="'+esc(x.key)+'">'+esc(x.name)+'</option>';}).join('')+'</select></label><button class="btn">Guardar proveedor</button></form><h3>Alias</h3><form data-dtgi-form="inbox-save"><label>Email<input name="email_alias" type="email" required></label><label>Nombre de bandeja<input name="display_name" required></label><label>Identificador de bandeja<input name="logical_inbox" required></label><label>Propósito<input name="purpose" required></label><label>Remitente<input name="default_from_name" value="956 Print" required></label><label>Firma<textarea name="default_signature"></textarea></label><button class="btn">Guardar alias</button></form><h3>Acceso interno a bandejas</h3><form data-dtgi-form="inbox-access"><label>Empleado<select name="user_id">'+options(bridge.members(),'displayName')+'</select></label><label>Bandeja<select name="inbox_id">'+options(state.inboxes,'email_alias')+'</select></label><label><input type="checkbox" name="can_read" checked> Puede leer</label><label><input type="checkbox" name="can_send"> Puede enviar</label><button class="btn">Guardar permiso</button></form></details>':'')+
      (!ticket&&context.customerId?'<section><h3>Historial de archivos</h3>'+button('history','Consultar historial')+fileRows(state.history,false)+'</section>':'')+
      (state.emailBody?'<pre class="dtgi-mail-body">'+esc(state.emailBody)+'</pre>'+(state.readMail&&state.readMail.rfc_message_id?button('email-reply','Responder'):''):'')+
      '<section><h3>Operaciones</h3>'+state.operations.map(function(o){return '<article class="dtgi-file"><strong>'+esc(o.kind||'Operación')+'</strong><small>'+esc(o.state)+' '+esc(o.last_error?errors[o.last_error]||o.last_error:'')+'</small>'+button('operation','Consultar resultado','data-id="'+o.operation_id+'"')+(['failed','unknown'].includes(o.state)?button('retry','Reintentar','data-id="'+o.operation_id+'" data-state="'+o.state+'"'):'')+'</article>';}).join('')+'</section></section>';
    if(context.ticketId||context.customerId){
      var related=document.createElement('section');related.innerHTML='<h3>Correo relacionado</h3>'+button('related-emails','Consultar historial de correo')+(state.relatedMessages||[]).map(function(m){return '<article class="dtgi-file"><strong>'+esc(m.subject||'(Sin asunto)')+'</strong><small>'+esc(m.from_address)+'</small>'+button('email-view','Leer','data-id="'+m.id+'"')+'</article>';}).join('');panel.querySelector('.dtgi-dialog').appendChild(related);
    }
    if(state.historyHasMore){var more=document.createElement('div');more.innerHTML=button('history-more','Ver archivos anteriores');panel.querySelector('.dtgi-dialog').appendChild(more);}
    if(context.ticketId){var manual=document.createElement('section');manual.innerHTML='<h3>Preview complementario</h3><p class="muted">Puedes añadir una imagen ligera si el original no tiene preview.</p><form data-dtgi-form="manual-preview"><label>Archivo<select name="file_id" required>'+options(state.files,'filename')+'</select></label><label>Imagen<input type="file" name="file" accept="image/jpeg,image/png,image/webp" required></label><button class="btn">Registrar preview</button></form>';panel.querySelector('.dtgi-dialog').appendChild(manual);}
    panel.querySelectorAll('form[data-dtgi-form]').forEach(function(form){var draft=state.drafts[form.dataset.dtgiForm];if(!draft)return;form.querySelectorAll('[name]').forEach(function(field){if(field.type==='file'||!(field.name in draft))return;if(field.type==='checkbox')field.checked=!!draft[field.name];else field.value=draft[field.name];});});
  }
  async function load(){
    state.status=await api('status');state.inboxes=state.status.inboxes;state.vendors=await api('listVendors');
    if(context.ticketId){state.files=await api('listFiles',{ticket_id:context.ticketId});var r=await bridge.getClient().from('dtg_vendor_deliveries').select('*').eq('ticket_id',context.ticketId).order('created_at',{ascending:false}).limit(50);if(r.error)throw new Error('No se pudieron consultar los envíos.');state.deliveries=r.data||[];}
  }
  function captureDrafts(){if(!panel)return;panel.querySelectorAll('form[data-dtgi-form]').forEach(function(form){var draft={};form.querySelectorAll('[name]').forEach(function(f){if(f.type==='file'||(f.tagName==='SELECT'&&!f.value))return;draft[f.name]=f.type==='checkbox'?f.checked:f.value;});state.drafts[form.dataset.dtgiForm]=draft;});}
  async function action(fn){if(state.busy)return;captureDrafts();var revision=generation;state.busy=true;state.error='';render();try{await fn();}catch(e){if(revision===generation&&e.name!=='AbortError')state.error=message(e);}finally{if(revision===generation){state.busy=false;render();}}}
  function remember(op){state.operations=state.operations.filter(function(x){return x.operation_id!==op.operation_id;});state.operations.unshift(op);state.progress='Operación registrada. Consulta el resultado; el ticket sigue disponible.';}
  async function open(ctx){close();context=ctx||{};actor=bridge.actor();if(!actor)return;if(context.draftEmail)state.drafts['email-send']={to:context.draftEmail.to||'',subject:context.draftEmail.subject||'',body:context.draftEmail.body||''};controller=new AbortController();returnFocus=document.activeElement;panel=document.createElement('div');panel.className='dtgi-overlay';document.body.appendChild(panel);render();await action(load);var b=panel&&panel.querySelector('[data-dtgi="close"]');if(b)b.focus();}
  function close(){generation++;if(controller)controller.abort();if(panel)panel.remove();panel=null;context=null;actor=null;state={files:[],vendors:[],inboxes:[],messages:[],deliveries:[],operations:[],status:null,error:'',busy:false,progress:'',history:[],upload:null,drafts:{},formKeys:{}};if(returnFocus&&returnFocus.isConnected)returnFocus.focus();}
  function showPlainMail(message){
    function plain(p){if(p.mimeType==='text/plain'&&p.body&&p.body.data){try{var s=p.body.data.replace(/-/g,'+').replace(/_/g,'/');return new TextDecoder().decode(Uint8Array.from(atob(s),function(c){return c.charCodeAt(0);}));}catch(e){return '';}}return(p.parts||[]).map(plain).filter(Boolean).join('\n');}
    state.emailBody=plain(message.payload||{})||'Este mensaje no tiene una versión de texto. Su contenido HTML no se ejecuta en el CRM.';
  }
  async function preview(file){
    if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>26214400)return null;
    var bitmap=await createImageBitmap(file),scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return new Promise(function(resolve){canvas.toBlob(resolve,'image/jpeg',.75);});
  }
  async function upload(file,purpose,asset){
    var sample=await new Blob([String(file.lastModified),file.slice(0,65536),file.slice(Math.max(0,file.size-65536))]).arrayBuffer();
    var fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',sample))).map(function(n){return n.toString(16).padStart(2,'0');}).join('');
    var s=state.upload;
    if(s&&s.filename===file.name&&s.size_bytes===file.size&&s.fingerprint!==fingerprint)throw new Error('Este archivo cambió. Selecciona el mismo original para reanudar, o cierra el panel para iniciar otra subida.');
    if(!s||s.filename!==file.name||s.size_bytes!==file.size||s.purpose!==purpose||s.asset_id_input!==asset){s=await api('beginUpload',{ticket_id:context.ticketId,filename:file.name,mime_type:file.type||'application/octet-stream',size_bytes:file.size,purpose:purpose,production_source_file:purpose!=='reference',asset_id:asset||null,idempotency_key:key()});Object.assign(s,{filename:file.name,purpose:purpose,asset_id_input:asset,fingerprint:fingerprint});state.upload=s;}
    s=Object.assign(s,await api('resumeUpload',{session_id:s.session_id}));
    if(s.provider==='SUPABASE'&&s.confirmed_offset!==file.size)await api('smallUpload',{session_id:s.session_id,mime_type:file.type||'application/octet-stream'},file);
    if(s.provider==='GOOGLE_DRIVE'){
      while(s.confirmed_offset<file.size){var end=Math.min(s.confirmed_offset+s.chunk_bytes,file.size);state.progress='Subiendo original: '+Math.floor(s.confirmed_offset/file.size*100)+'%';render();
        try{Object.assign(s,await api('uploadChunk',{session_id:s.session_id,offset:s.confirmed_offset},file.slice(s.confirmed_offset,end)));}
        catch(e){Object.assign(s,await api('resumeUpload',{session_id:s.session_id}));throw e;}
      }
    }
    await api('completeUpload',{session_id:s.session_id});state.upload=null;state.progress='Original guardado. El preview se procesa por separado.';
    try{var thumb=await preview(file);if(thumb)await api('previewUpload',{file_id:s.file_id,mime_type:'image/jpeg'},thumb);}catch(e){state.progress+=' Preview pendiente; el original está disponible.';}
    await load();
  }
  document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-dtgi]');if(!b||!bridge)return;var a=b.dataset.dtgi,id=b.dataset.id;
    if(a==='open'){open({ticketId:b.dataset.ticket,customerId:b.dataset.customer||null,seq:b.dataset.seq});return;}
    if(a==='customer-open'){open({customerId:b.dataset.customer});return;}
    if(a==='close'){close();return;}
    if(!panel)return;
    var selectedInbox=panel.querySelector('#dtgi-inbox');var inboxId=selectedInbox&&selectedInbox.value;
    action(async function(){
      if(a==='refresh')await load();
      else if(a==='oauth'){var auth=await api('beginOAuth');if(!auth.url.startsWith('https://accounts.google.com/'))throw new Error('No pudimos preparar la conexión con Google.');state.oauthUrl=auth.url;state.progress='Abre Autorizar Google Workspace y después pulsa Actualizar.';}
      else if(a==='sync')remember(await api('syncEmails',{idempotency_key:key()}));
      else if(a==='validate'){await api('validateAliases');await load();}
      else if(a==='history'){if(!context.customerId)throw new Error('Relaciona primero el ticket con un cliente.');state.history=await api('customerHistory',{customer_id:context.customerId});state.historyHasMore=state.history.length===50;}
      else if(a==='history-more'){var older=await api('customerHistory',{customer_id:context.customerId,before:state.history[state.history.length-1].uploaded_at});state.history=state.history.concat(older);state.historyHasMore=older.length===50;}
      else if(a==='related-emails')state.relatedMessages=await api('listLinkedEmails',context.ticketId?{ticket_id:context.ticketId}:{customer_id:context.customerId});
      else if(a==='reuse'){await api('reuseFile',{file_id:id,ticket_id:context.ticketId});await load();}
      else if(a==='proof'||a==='print-ready'){await api('setFileStage',{file_id:id,stage:a==='proof'?'Proof':'Print Ready'});await load();}
      else if(a==='approve'){await api('approveForProduction',{file_id:id,ticket_id:context.ticketId});await load();}
      else if(a==='current'){await api('setCurrentVersion',{file_id:id});await load();}
      else if(a==='preview'){var p=await api('getFileAccess',{file_id:id,preview:true});if(p.url)window.open(p.url,'_blank','noopener');}
      else if(a==='open-file'){var f=await api('getFileAccess',{file_id:id});if(f.url)window.open(f.url,'_blank','noopener');else {
        if(!window.showSaveFilePicker)throw new Error('Para descargar originales grandes usa Chrome o Edge con soporte para guardar archivos.');
        var handle=await window.showSaveFilePicker({suggestedName:f.filename});var output=await handle.createWritable();
        try{var response=await api('downloadFile',{file_id:id},new Uint8Array(0),true);await response.body.pipeTo(output);state.progress='Original descargado.';}catch(e){try{await output.abort();}catch(ignore){}throw e;}
      }}
      else if(a==='emails')state.messages=await api('listEmails',{inbox_id:inboxId});
      else if(a==='email-view'){var mail=await api('getEmail',{message_id:id});state.readMail=mail.metadata;showPlainMail(mail.message);}
      else if(a==='email-reply'){var original=state.readMail;if(!original)return;var match=String(original.from_address||'').match(/[^<>\s,]+@[^<>\s,]+/);if(!match)throw new Error('No pudimos identificar el correo del remitente.');var draft=state.drafts['email-send']||{};state.drafts['email-send']=Object.assign({},draft,{reply_message_id:original.id,to:match[0],subject:original.subject||'(Sin asunto)'});delete state.formKeys['email-send'];state.progress='Borrador de respuesta preparado. Revisa destinatario y mensaje antes de enviar.';}
      else if(a==='new-email'){if(state.drafts['email-send'])state.drafts['email-send'].reply_message_id='';delete state.formKeys['email-send'];}
      else if(a==='email-link')await api('attachEmailToTicket',{message_id:id,ticket_id:context.ticketId});
      else if(a==='resend')remember(await api('resendVendorLink',{delivery_id:id,idempotency_key:key()}));
      else if(a==='revoke'){remember(await api('revokeVendorAccess',{delivery_id:id,idempotency_key:key()}));await load();}
      else if(a==='operation'){var op=await api('operationStatus',{operation_id:id});remember(op);}
      else if(a==='retry'){if(b.dataset.state==='unknown')throw new Error('Resultado incierto: un administrador debe conciliar Gmail o el permiso antes de reenviar.');remember(await api('retryOperation',{operation_id:id}));}
    });
  });
  document.addEventListener('submit',function(e){var form=e.target;if(!form.dataset||!form.dataset.dtgiForm||!panel)return;e.preventDefault();var kind=form.dataset.dtgiForm,data=new FormData(form),input=Object.fromEntries(data);
    var draft=Object.fromEntries(Array.from(data).filter(function(x){return typeof x[1]==='string';}));form.querySelectorAll('input[type=checkbox][name]').forEach(function(x){draft[x.name]=x.checked;});state.drafts[kind]=draft;var commandKey=state.formKeys[kind]||(state.formKeys[kind]=key());
    action(async function(){
    if(kind==='upload'){await upload(data.get('file'),data.get('purpose'),data.get('asset_id'));}
    else if(kind==='vendor-send')remember(await api('sendToVendor',Object.assign(input,{ticket_id:context.ticketId,idempotency_key:commandKey})));
    else if(kind==='email-send')remember(await api('sendEmail',{inbox_id:input.inbox_id,to:[input.to],subject:input.subject,body:input.body,reply_message_id:input.reply_message_id||null,ticket_id:context.ticketId||null,idempotency_key:commandKey}));
    else if(kind==='vendor-save'){await api('saveVendor',input);await load();}
    else if(kind==='inbox-save'){await api('saveInbox',input);await load();}
    else if(kind==='configure'){await api('configure',{threshold_bytes:Number(input.threshold)*1048576,enabled:data.has('enabled')});await load();}
    else if(kind==='inbox-access')await api('setInboxAccess',{user_id:input.user_id,inbox_id:input.inbox_id,can_read:data.has('can_read'),can_send:data.has('can_send')});
    else if(kind==='manual-preview'){var thumb=await preview(data.get('file'));if(!thumb)throw new Error('Selecciona una imagen JPG, PNG o WebP de menos de 25 MiB.');await api('previewUpload',{file_id:input.file_id,mime_type:'image/jpeg'},thumb);await load();}
    delete state.drafts[kind];delete state.formKeys[kind];
  });});
  document.addEventListener('keydown',function(e){if(!panel)return;if(e.key==='Escape'){close();return;}if(e.key==='Tab'){var fields=Array.from(panel.querySelectorAll('button:not(:disabled),input,select,textarea')).filter(function(x){return x.getClientRects().length;});if(!fields.length)return;var first=fields[0],last=fields[fields.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  root.DTGIntegrations={mount:function(b){bridge=b;},reset:close,open:open};
})(window);
