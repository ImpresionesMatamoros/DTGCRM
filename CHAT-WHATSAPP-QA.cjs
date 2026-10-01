const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
const fixture=`
UI.waChatOpen=true;AUTH_STATUS='signed_in';AUTH_SESSION={user:{id:'martin'}};CURRENT_PROFILE={id:'martin',display_name:'Martin'};
STATE.teamPosts=[];STATE.feedReactions=[];STATE.profiles=[];STATE.tickets=[];STATE.clientes=[];STATE.conversations=[{id:'dm',kind:'direct',member_a:'martin',member_b:'ceci'}];
var writes=[],uploads=[],removals=[],failFile='',failInsert=false;
sb={storage:{from:bucket=>({upload:async(path,file)=>{uploads.push({bucket,path,name:file.name});return file.name===failFile?{error:{message:'QA fallo parcial'}}:{error:null};},remove:async paths=>{removals.push({bucket,paths});return {error:null};}})},from:table=>({insert:row=>({select:()=>({single:async()=>{if(failInsert)return {error:{message:'QA insert fail'}};var r=Object.assign({id:'sent-'+writes.length,created_at:new Date().toISOString()},row);writes.push(r);return {data:r,error:null};}})})}),rpc:async()=>({data:[],error:null})};
resizeImageToBlob=async f=>f;refreshFromServer=async()=>{};showToast=()=>{};
render=function(){document.getElementById('app').innerHTML=renderInicioFeed()+renderComposer();};
window.qa={UI,STATE,render,chatQueueFiles,chatQueuedFiles,chatPublishBatch,mapTeamPostRow,renderChatMessage,chatRelevantKind,chatWithinNotificationHours,chatSeenLabel,chatMarkScopeSeen,captureComposerDraft,restoreComposerDraft,chatClientPicker,resolveClienteExactMatch,createTeamPostCore,applyTeamPostRealtime,handleComposerPasteEvent,createTicketCore,renderChatReactions,
setFailure:v=>failFile=v,setInsertFailure:v=>failInsert=v,writes,uploads,removals,setReceipts:(id,names)=>CHAT_RECEIPTS[id]=names,enableTicket:()=>TICKET_CHAT_AVAILABLE=true};
render();
`;
const html=fs.readFileSync(__dirname+'/index.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,fixture);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());await page.setContent(html);
  assert.deepEqual(errors,[]);
  for(const scope of [null,'dm']){
   await page.evaluate(scope=>{qa.UI.astraConversationId=scope;qa.render();},scope);
   assert.equal(await page.locator('#feed-composer-photo-input').getAttribute('multiple'),'');
   const result=await page.evaluate(async scope=>{
    const extensions=['pdf','ai','eps','svg','psd','zip','doc','docx','xls','xlsx','txt','csv'];
    qa.chatQueueFiles(extensions.map(e=>new File(['test'],'archivo.'+e,{type:'application/octet-stream'})));
    qa.chatQueueFiles([new File(['image'],'uno.png',{type:'image/png'}),new File(['image'],'dos.jpg',{type:'image/jpeg'})]);
    const count=qa.chatQueuedFiles().length;await qa.chatPublishBatch('Lote');
    return {count,remaining:qa.chatQueuedFiles().length,rows:qa.writes.slice(-14),uploads:qa.uploads.slice(-14)};
   },scope);
   assert.equal(result.count,14);assert.equal(result.remaining,0);assert.equal(result.rows.length,14);
   assert(result.rows.every(r=>r.no_ticket_required&&r.ticket_id===null&&(r.conversation_id||null)===scope));
   assert.equal(result.rows.filter(r=>r.text==='Lote').length,1);
   if(scope)assert(result.uploads.every(u=>u.bucket==='chat-private'&&u.path.startsWith(scope+'/')));
  }
  const partial=await page.evaluate(async()=>{
   qa.setFailure('fail.pdf');qa.chatQueueFiles([new File(['a'],'ok.pdf'),new File(['b'],'fail.pdf'),new File(['c'],'last.zip')]);
   await qa.chatPublishBatch('Parcial');const first={remaining:qa.chatQueuedFiles().map(x=>({name:x.file.name,status:x.status})),count:qa.writes.length};
   qa.setFailure('');await qa.chatPublishBatch('');return {first,remaining:qa.chatQueuedFiles().length,count:qa.writes.length};
  });
  assert.deepEqual(partial.first.remaining,[{name:'fail.pdf',status:'failed'}]);assert.equal(partial.remaining,0);assert.equal(partial.count-partial.first.count,1);
  const ten=await page.evaluate(async()=>{qa.chatQueueFiles(Array.from({length:10},(_,i)=>new File(['a'],'photo'+i+'.png',{type:'image/png'})));await qa.chatPublishBatch('');return qa.chatQueuedFiles().length;});assert.equal(ten,0);
  const ticket=await page.evaluate(async()=>{qa.enableTicket();qa.STATE.tickets=[{id:'ticket-qa',seq:1330,cliente:'Cliente',productos:[],thread:[]}];qa.STATE.conversations.push({id:'ticket-scope',kind:'ticket',ticket_id:'ticket-qa'});qa.UI.selectedTicketId='ticket-qa';qa.chatQueueFiles([new File(['a'],'ticket.pdf'),new File(['b'],'ticket.png',{type:'image/png'})]);await qa.chatPublishBatch('Ticket');const rows=qa.writes.slice(-2);qa.UI.selectedTicketId=null;qa.UI.astraConversationId='dm';return rows;});assert(ticket.every(r=>r.conversation_id==='ticket-scope'));
  const orphan=await page.evaluate(async()=>{qa.setInsertFailure(true);try{await qa.createTeamPostCore({photoFile:new File(['a'],'qa.png',{type:'image/png'}),conversationId:'dm'});}catch(e){}qa.setInsertFailure(false);return qa.removals;});assert(orphan.some(x=>x.bucket==='chat-private'));
  const sanitized=await page.evaluate(()=>{
   const p=qa.mapTeamPostRow({id:'deleted',author_name_snapshot:'Ceci',created_at:new Date().toISOString(),deleted_at:new Date().toISOString(),text:'SECRETO',file_name:'privado.pdf',file_storage_path:'dm/privado',image_storage_path:'dm/foto'});
   return {p,html:qa.renderChatMessage({kind:'post',post:p})};
  });
  assert.equal(sanitized.p.text,'');assert(!sanitized.html.includes('SECRETO'));assert(!sanitized.html.includes('privado.pdf'));assert(sanitized.html.includes('MENSAJE ELIMINADO'));assert(!sanitized.html.includes('data-action='));
  const logic=await page.evaluate(()=>{
   const now=new Date().toISOString(),base={id:'p',authorUserId:'ceci',createdAt:now,text:'Hola',pinLevel:'none'};
   qa.STATE.teamPosts=[{id:'mine',authorUserId:'martin',createdAt:now,text:'Propio'},{id:'root',authorUserId:'ceci',createdAt:now,mentions:[{id:'martin'}]}];
   qa.setReceipts('p',['Jonathan','Alexia','Ceci','Israel','Martin']);
   return {general:qa.chatRelevantKind(base,'martin'),dm:qa.chatRelevantKind({...base,conversationId:'dm'},'martin'),mention:qa.chatRelevantKind({...base,mentions:[{id:'martin'}],replyToId:'mine'},'martin'),reply:qa.chatRelevantKind({...base,replyToId:'mine'},'martin'),thread:qa.chatRelevantKind({...base,threadRootId:'root'},'martin'),upload:qa.chatRelevantKind({...base,conversationId:'dm',text:'',filePath:'dm/test'},'martin'),deleted:qa.chatRelevantKind({...base,deletedAt:now},'martin'),hours:['2026-07-01T12:00Z','2026-07-01T23:00Z','2026-12-01T13:00Z','2026-12-01T12:59Z'].map(d=>qa.chatWithinNotificationHours(new Date(d),false)),allHours:qa.chatWithinNotificationHours(new Date('2026-12-01T03:00Z'),true),seen:qa.chatSeenLabel('p')};
  });
  assert.equal(logic.general,null);assert.equal(logic.dm,'personal');assert.equal(logic.mention,'mencion');assert.equal(logic.reply,'respuesta');assert.equal(logic.thread,'respuesta');assert.equal(logic.upload,null);assert.equal(logic.deleted,null);assert.deepEqual(logic.hours,[true,false,true,false]);assert(logic.allHours);assert.equal(logic.seen,'Visto por Jonathan, Alexia y 3 más');
  const drafts=await page.evaluate(()=>{qa.UI.astraConversationId=null;qa.render();let el=document.getElementById('composer-input');el.value='Borrador equipo';const snapshot=qa.captureComposerDraft();qa.UI.astraConversationId='dm';qa.render();qa.restoreComposerDraft(snapshot);const dm=document.getElementById('composer-input').value;qa.UI.astraConversationId=null;qa.render();qa.restoreComposerDraft(null);return {dm,team:document.getElementById('composer-input').value};});assert.equal(drafts.dm,'');assert.equal(drafts.team,'Borrador equipo');
  const clipboard=await page.evaluate(async()=>{qa.UI.astraConversationId=null;qa.UI.selectedTicketId=null;let prevented=false;qa.handleComposerPasteEvent({clipboardData:{items:[{kind:'file',type:'image/png',getAsFile:()=>new File(['paste'],'clipboard.png',{type:'image/png'})}]},preventDefault:()=>prevented=true});const n=qa.chatQueuedFiles().length;await qa.chatPublishBatch('');return {prevented,n,row:qa.writes.at(-1)};});assert(clipboard.prevented);assert.equal(clipboard.n,1);assert.equal(clipboard.row.ticket_id,null);assert(clipboard.row.no_ticket_required);
  const clients=await page.evaluate(async()=>{qa.STATE.clientes=[{id:'existing-client',nombre:'Yesenia Sauceda',empresa:'Yesenia',telefono:'8681234567'}];await qa.createTicketCore({cliente:'Yesenia Sauceda'});const existing=qa.writes.at(-1);await qa.createTicketCore({cliente:'Cliente nuevo'});const fresh=qa.writes.at(-1);return {existing,fresh,picker:qa.chatClientPicker({clientQuery:'Yesenia'},null)};});assert.equal(clients.existing.cliente_id,'existing-client');assert.equal(clients.fresh.cliente,'Cliente nuevo');assert(clients.picker.includes('existing-client'));
  const reactions=await page.evaluate(()=>{qa.STATE.feedReactions=[{targetType:'post',targetId:'p',userId:'jonathan',autor:'Jonathan',reactionType:'ack'},{targetType:'post',targetId:'p',userId:'alexia',autor:'Alexia',reactionType:'ack'}];return qa.renderChatReactions({id:'p'});});assert(reactions.includes('Jonathan, Alexia'));
  const unread=await page.evaluate(()=>{qa.STATE.chatReadState=[];qa.STATE.teamPosts=[{id:'recent',createdAt:new Date().toISOString(),authorUserId:'ceci',text:'No visto'}];qa.UI.astraConversationId=null;qa.render();const el=document.getElementById('chat-scroll');el.setAttribute('data-read-scope','team');Object.defineProperty(el,'scrollHeight',{value:2000});Object.defineProperty(el,'clientHeight',{value:400});Object.defineProperty(el,'scrollTop',{value:0,writable:true});qa.chatMarkScopeSeen(null);const before=qa.STATE.chatReadState.length;el.scrollTop=1600;qa.chatMarkScopeSeen(null);return {before,after:qa.STATE.chatReadState.length};});assert.equal(unread.before,0);assert.equal(unread.after,1);
  const realtime=await page.evaluate(()=>{qa.applyTeamPostRealtime({eventType:'UPDATE',new:{id:'recent',author_name_snapshot:'Ceci',created_at:new Date().toISOString(),deleted_at:new Date().toISOString(),text:'Texto borrado'}});return {p:qa.STATE.teamPosts[0],text:document.getElementById('chat-scroll').textContent};});assert(realtime.p.deletedAt);assert(realtime.text.includes('MENSAJE ELIMINADO'));assert(!realtime.text.includes('Texto borrado'));
  await page.evaluate(()=>{qa.STATE.teamPosts=[{id:'gesture',authorUserId:'ceci',autor:'Ceci',createdAt:new Date().toISOString(),text:'Deslizar para responder',pinLevel:'none'}];qa.UI.astraConversationId=null;qa.render();});
  await page.locator('.chat-msg[data-post-id="gesture"]').dispatchEvent('pointerdown',{pointerType:'touch',clientX:50,clientY:100});await page.locator('.chat-msg[data-post-id="gesture"]').dispatchEvent('pointerup',{pointerType:'touch',clientX:130,clientY:105});assert.equal(await page.evaluate(()=>qa.UI.astraReplyTo),'gesture');
  await page.locator('.chat-msg[data-post-id="gesture"]').dispatchEvent('pointerdown',{pointerType:'touch',clientX:50,clientY:100});await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>qa.UI.chatMenuFor),'gesture');
  const menuBox=await page.locator('.chat-msg-menu').boundingBox();assert(menuBox&&menuBox.y>=0&&menuBox.y+menuBox.height<=844);
  await page.screenshot({path:__dirname+'/chat-whatsapp-mobile.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log('PASS: public/DM mixed uploads and 12 file types, 2/10 images, partial retry without duplicate sends, image orphan cleanup, deleted content sanitization, notifications/DST, named receipts, independent drafts, mobile layout.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
