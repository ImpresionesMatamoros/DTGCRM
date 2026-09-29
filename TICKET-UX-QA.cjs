const fs=require('fs'),assert=require('assert'),{JSDOM,VirtualConsole}=require(process.env.JSDOM_MODULE||'jsdom');
const vc=new VirtualConsole(),errors=[];vc.on('jsdomError',e=>{if(e.type!=='css parsing')errors.push(e.message)});
const setup=`
AUTH_STATUS='signed_in';AUTH_SESSION={user:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}};CURRENT_PROFILE={id:AUTH_SESSION.user.id,active:true,display_name:'QA'};
STATE.meta={teamNames:[],queSigueOptions:[],opsProviders:[]};STATE.conversations=[];STATE.workOrdersTableMissing=false;
STATE.tickets=[{id:'11111111-1111-4111-8111-111111111111',seq:1330,cliente:'Angela',visibility:'team',estado:'abierto',productos:[],tareas:[],workOrders:[],markers:[],bitacora:[],thread:[],pagos:[],documentos:[],createdAt:new Date().toISOString()}];
STATE.clientes=[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',nombre:'Angela',empresa:'Angela Builders'}];
STATE.profiles=[{id:AUTH_SESSION.user.id,displayName:'QA',active:true},{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',displayName:'Alexia',active:true}];
var writes=[], fail=false,n=0;sb={from:table=>{var row=null,op='read',filters=[];var chain={insert(r){row=r;op='insert';return chain},update(r){row=r;op='update';return chain},delete(){op='delete';return chain},select(){return chain},eq(k,v){filters.push([k,v]);return chain},is(){return chain},single(){return chain},then(resolve,reject){if(op!=='read')writes.push({table,op,row});var data=Object.assign({id:'00000000-0000-4000-8000-'+String(++n).padStart(12,'0'),created_at:new Date().toISOString()},row);return Promise.resolve(fail?{error:{message:'QA failure'}}:{data,error:null}).then(resolve,reject)}};return chain},storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://example.test/file'}})})}};
refreshFromServer=async()=>{};hydrateImages=()=>{};astraHydrateAudios=()=>{};syncDeepLinkUrl=()=>{};showToast=()=>{};showActionToast=()=>{};userError=()=>{};adminNote=()=>{};
ASTRA_CONVERSATIONS_AVAILABLE=true;
window.qa={UI,STATE,render,submitForm,submitNote,submitOpsEditor,openTicketById,openOpsEditor,astraOpenThread,abrirChatEnMensaje,renderKeepingLiveInputs,renderMentionPicker,mentionPick,publishChatMessage,ensureTicketConversation,chatUnseenCount,chatNewestTs,setEnabled:v=>TICKET_CHAT_AVAILABLE=v,writes,setFail:v=>fail=v};
UI.selectedTicketId=STATE.tickets[0].id;render();
`;
const html=fs.readFileSync(__dirname+'/index.html','utf8').replace(/<script src="https:[^>]*><\/script>/g,'').replace('<script src="ops-menu.js?v=3"></script>','<script>'+fs.readFileSync(__dirname+'/ops-menu.js','utf8')+'</script>').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,setup);
const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.matchMedia=q=>({matches:q.includes('max-width: 880px'),addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};}});
const w=dom.window,d=w.document,q=w.qa,tick=()=>new Promise(r=>setTimeout(r,30));
const key=(el,key,extra={})=>el.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));
const el=id=>d.getElementById(id);
(async()=>{
assert(q,errors.join('\n'));await tick();
// Live old-schema path remains usable, product flow is independent of migration.
assert(d.querySelector('.ticket-products'));assert(d.body.textContent.includes('pendiente de activación'));
d.querySelector('[data-open-form="producto"]').click();assert.equal(d.activeElement.id,'f-desc');
el('f-desc').value='Playeras negras';key(el('f-desc'),'Enter');assert.equal(d.activeElement.id,'f-cantidad');el('f-cantidad').value='24';key(el('f-cantidad'),'Enter');assert.equal(d.activeElement.id,'f-precio');key(el('f-precio'),'Enter');key(el('f-precio')||d.body,'Enter');await tick();
assert.equal(q.STATE.tickets[0].productos.length,1);assert.equal(q.writes.filter(x=>x.table==='productos').length,1);const p=q.STATE.tickets[0].productos[0];assert.equal(p.precio,null);assert(!p.id.startsWith('tmp'));assert(d.querySelector('.ticket-products').textContent.includes('24 Playeras negras'));assert(!el('f-desc'));
// Product failure leaves draft, no phantom product. Escape cancels safely.
d.querySelector('[data-open-form="producto"]').click();el('f-desc').value='Lona';el('f-cantidad').value='2';el('f-precio').value='35';q.setFail(true);await q.submitForm('producto');assert.equal(el('f-desc').value,'Lona');assert.equal(q.STATE.tickets[0].productos.length,1);q.setFail(false);key(el('f-desc'),'Escape');assert(!el('f-desc'));
// Explicit priced product and multiple tasks from one product.
d.querySelector('[data-open-form="producto"]').click();el('f-desc').value='Lona';el('f-cantidad').value='2';el('f-precio').value='35';await q.submitForm('producto');assert.equal(q.STATE.tickets[0].productos[1].precio,35);
for(let i=0;i<2;i++){d.querySelector('[data-ticket-ux="product-task"]').click();await tick();assert.equal(el('ops-f-product').value,p.id);const button=[...d.querySelectorAll('[data-ops-node]')].find(x=>x.textContent.includes('Cotizar'));button.click();await q.submitOpsEditor();assert.equal(JSON.parse(q.STATE.tickets[0].tareas.at(-1).actionPath).productId,p.id);}
assert.equal(q.STATE.tickets[0].tareas.length,2);assert.equal(q.STATE.tickets[0].estado,'abierto');
// New-schema conversation path, independent of real DB/network.
q.setEnabled(true);q.render();await tick();el('composer-input').value='Mensaje del ticket';key(el('composer-input'),'Enter');await tick();await tick();assert.equal(q.writes.filter(x=>x.table==='chat_conversations').length,1);assert.equal(q.writes.filter(x=>x.table==='team_posts').length,1);const root=q.STATE.teamPosts[0];assert(root.conversationId);assert.equal(root.ticketId,null);assert(d.querySelector('[data-chat-msg="'+root.id+'"]'));
// Shift+Enter and composing Enter never send.
el('composer-input').value='No enviar';key(el('composer-input'),'Enter',{shiftKey:true});key(el('composer-input'),'Enter',{isComposing:true});await tick();assert.equal(q.writes.filter(x=>x.table==='team_posts').length,1);
// Mention selection with Enter does not send; structured refs include user and client.
el('composer-input').value='@Ale';el('composer-input').setSelectionRange(4,4);el('composer-input').dispatchEvent(new w.Event('input',{bubbles:true}));await tick();assert(d.querySelector('#mention-pop'));key(el('composer-input'),'Enter');await tick();assert.equal(q.writes.filter(x=>x.table==='team_posts').length,1);assert(el('composer-input').value.includes('@Alexia'));
q.UI.astraRefPicks=[{kind:'client',id:q.STATE.clientes[0].id,label:'Angela Builders'},{kind:'ticket',id:q.STATE.tickets[0].id,label:'1330'}];el('composer-input').value='@Alexia habló con @Angela Builders para #1330';await q.submitNote();await tick();assert.equal(q.STATE.teamPosts[0].refs.length,3);
// Reply/thread remain in ticket. Inherited ticket in action review.
q.astraOpenThread(root.id);assert.equal(q.UI.selectedTicketId,q.STATE.tickets[0].id);assert.equal(q.UI.astraThreadRoot,root.id);el('composer-input').value='Respuesta del hilo';await q.submitNote();await tick();assert.equal(q.STATE.teamPosts[0].threadRootId,root.id);const child=q.STATE.teamPosts[0];q.abrirChatEnMensaje(child.id);assert.equal(q.UI.selectedTicketId,q.STATE.tickets[0].id);assert.equal(q.UI.astraThreadRoot,root.id);
q.UI.astraReview={postId:child.id,kind:'task'};q.render();assert.equal(el('astra-review-ticket').value,q.STATE.tickets[0].id);q.UI.astraReview=null;
// New ticket starts empty, does not leak another ticket's messages or thread.
q.STATE.tickets.push({...q.STATE.tickets[0],id:'22222222-2222-4222-8222-222222222222',seq:1331,productos:[],tareas:[]});q.openTicketById(q.STATE.tickets[1].id);assert.equal(q.UI.astraThreadRoot,null);assert(!d.querySelector('[data-chat-msg]'));assert(!el('composer-input').value);
assert.deepEqual(errors,[]);console.log('PASS ticket UX: product focus/Enter/price/failure/duplicate guard; product tasks; old schema fallback; ticket messages; IME/Shift+Enter; mentions/refs; reply/thread/context/notification navigation. DOM + mocked DB, not browser layout.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await tick();dom.window.close()});
