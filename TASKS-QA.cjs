const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
const setup=`
window.qa={openOpsEditor,getState:()=>STATE,getWrites:()=>writes,setFailure:(v)=>fail=v};
var writes=[],fail=false;
STATE={tickets:[{id:'11111111-1111-4111-8111-111111111111',seq:1330,cliente:'Angela',estado:'abierto',productos:[{id:'p1',desc:'Camisas',cantidad:24}],tareas:[],markers:[],thread:[]}],clientes:[],profiles:[],meta:{opsProviders:[]}};
AUTH_STATUS='signed_in';UI.waChatOpen=true;
sb={rpc:async(name,args)=>({data:true,error:fail?{message:"fallo simulado"}:null}),from:table=>({insert:async row=>{writes.push({table,row});return fail?{error:{message:'fallo simulado'}}:{error:null}},update:row=>({eq:async()=>({error:null})})})};
refreshFromServer=async()=>{};showToast=()=>{};userError=()=>{};adminNote=()=>{};
STATE.meta.teamNames=[];STATE.feedReactions=[];STATE.conversations=[];
STATE.teamPosts=[{id:'post-1',autor:'Jonathan',authorUserId:'user-1',createdAt:new Date().toISOString(),text:'Ocupo más vinil negro',ticketId:STATE.tickets[0].id,pinLevel:'none'}];
Object.assign(qa,{UI,setAccountMenuOpen,astraConfirmReview,renderKanbanCard,setView:(v)=>{qa.view=v;render();}});
openTicketById=id=>{qa.opened=id;render();};
qa.renders=0;
render=function(){
 qa.renders++;
 document.getElementById('app').innerHTML=qa.view==='chat'?renderInicioFeed()+renderOpsEditor()+astraReviewOverlay():
 qa.view==='kanban'?renderKanbanCard(STATE.tickets[0])+renderOpsEditor():
 qa.view==='account'?'<div id="account-scroll" style="height:600px;overflow:auto"><div style="height:1400px"></div><div class="sidebar-account-wrap" style="position:relative"><button data-action="toggle-account-menu" aria-expanded="false">Mi nombre</button></div></div>':
 renderOpsEditor();
};
qa.view='kanban';render();
`;
let html=fs.readFileSync(__dirname+'/index.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,setup);
html=html.replace('<script>','<script>'+fs.readFileSync(__dirname+'/ops-menu.js','utf8')+'</script><script>');
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());await page.setContent(html);
 assert.deepEqual(errors,[]);

 await page.getByRole('button',{name:/Crear tarea para ticket/}).click();
 assert.equal(await page.locator('.ops-editor details,[data-ops-node]').count(),0);
 await page.locator('#ops-f-desc').selectOption({label:'CONTACTAR CLIENTE'});await page.locator('#ux-task-note').fill('Pedir vinil negro');
 await page.getByRole('button',{name:'Crear tarea',exact:true}).click();await page.waitForFunction(()=>qa.getState().tickets[0].tareas.length===1);
 let task=await page.evaluate(()=>qa.getState().tickets[0].tareas[0]);assert.equal(task.desc,'CONTACTAR CLIENTE');assert.equal(task.area,'planeacion');assert.equal(JSON.parse(task.actionPath).note,'Pedir vinil negro');
 await page.evaluate(()=>{const t=qa.getState().tickets[0].tareas[0];t.progreso=45;t.estado='en_proceso';t.fechaAtencion='2026-10-02';t.actionPath=JSON.stringify({v:1,details:'conservar contexto'});qa.view='editor';qa.openOpsEditor('edit',t.id,qa.getState().tickets[0].id);});
 await page.locator('#ops-f-desc').selectOption({label:'FABRICAR'});await page.getByRole('button',{name:'Guardar',exact:true}).click();task=await page.evaluate(()=>qa.getState().tickets[0].tareas[0]);assert.equal(task.desc,'FABRICAR');assert.equal(task.progreso,45);assert.equal(task.estado,'en_proceso');assert.equal(task.fechaAtencion,'2026-10-02');assert.equal(JSON.parse(task.actionPath).details,'conservar contexto');
 await page.evaluate(()=>qa.setView('chat'));await page.locator('.chat-msg').hover();await page.getByRole('button',{name:'Opciones del mensaje',exact:true}).click();await page.getByRole('menuitem',{name:'Crear tarea',exact:true}).click();assert.equal(await page.locator('#ops-f-desc option').count(),12);await page.locator('#ops-f-desc').selectOption({label:'CONTACTAR CLIENTE'});await page.getByRole('button',{name:'Crear tarea',exact:true}).click();await page.waitForFunction(()=>qa.getState().tickets[0].tareas.length===2);assert.deepEqual(await page.evaluate(()=>JSON.parse(qa.getState().tickets[0].tareas[1].actionPath).sourcePostIds),['post-1']);
 await page.evaluate(()=>{qa.setView('kanban');qa.setFailure(true);});await page.getByRole('button',{name:/Crear tarea para ticket/}).click();await page.locator('#ops-f-desc').selectOption({label:'FABRICAR'});await page.getByRole('button',{name:'Crear tarea',exact:true}).click();assert.equal(await page.locator('#ops-f-desc').inputValue(),'FABRICAR');assert.equal(await page.evaluate(()=>qa.getState().tickets[0].tareas.length),2);await page.evaluate(()=>qa.setFailure(false));await page.getByRole('button',{name:'Crear tarea',exact:true}).click();await page.waitForFunction(()=>qa.getState().tickets[0].tareas.length===3);
 await page.evaluate(()=>{qa.getState().teamPosts[0].ticketId=null;qa.setView('chat');});await page.locator('.chat-msg').hover();await page.getByRole('button',{name:'Opciones del mensaje',exact:true}).click();await page.getByRole('menuitem',{name:'Crear tarea',exact:true}).click();assert(await page.locator('#ops-f-ticket-q').isEditable());await page.locator('#ops-f-desc').selectOption({label:'RECOGER'});await page.getByRole('button',{name:'Crear tarea',exact:true}).click();assert.equal(await page.evaluate(()=>qa.getState().tickets[0].tareas.length),3);await page.locator('[data-action="ops-ed-pick-ticket"]').first().click();assert(await page.locator('#ux-ticket-full').isVisible());await page.locator('[data-ux="preview-select"]').click();await page.getByRole('button',{name:'Crear tarea',exact:true}).click();await page.waitForFunction(()=>qa.getState().tickets[0].tareas.length===4);
 // Mobile account menu keeps the scroll container and current offset intact.
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{qa.setView('account');document.getElementById('account-scroll').scrollTop=1400;qa.before=qa.renders;window.originalScroll=document.getElementById('account-scroll');});
 const before=await page.locator('#account-scroll').evaluate(el=>el.scrollTop);
 await page.getByRole('button',{name:'Mi nombre',exact:true}).click();
 assert.equal(await page.evaluate(()=>qa.renders),await page.evaluate(()=>qa.before));
 assert(await page.evaluate(()=>originalScroll===document.getElementById('account-scroll')));
 assert.equal(await page.locator('#account-scroll').evaluate(el=>el.scrollTop),before);
 assert.equal(await page.locator('[data-action="toggle-account-menu"]').getAttribute('aria-expanded'),'true');
 assert(await page.locator('[data-action="logout"]').isVisible());
 await page.getByRole('button',{name:'Mi nombre',exact:true}).click();
 assert.equal(await page.locator('.sidebar-account-menu').count(),0);
  await page.getByRole('button',{name:'Mi nombre',exact:true}).click();
  await page.locator('#account-scroll').click({position:{x:350,y:10}});
  assert.equal(await page.locator('.sidebar-account-menu').count(),0);
  assert.equal(await page.locator('#account-scroll').evaluate(el=>el.scrollTop),before);
 await page.evaluate(()=>{qa.setView('kanban');});
 await page.getByRole('button',{name:/Crear tarea para ticket/}).click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 if(process.env.QA_SCREENSHOT)await page.screenshot({path:process.env.QA_SCREENSHOT});
 assert.deepEqual(errors,[]);
 console.log('PASS: simple catalogue task creation from Kanban and linked message menu, real save/source context, edits preserve hidden data, failed save/retry, mobile account scroll unchanged, mobile form.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
