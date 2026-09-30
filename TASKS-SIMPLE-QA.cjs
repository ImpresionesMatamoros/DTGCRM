const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
const setup=`
window.qa={openOpsEditor,getState:()=>STATE,getWrites:()=>writes,setFailure:(v)=>fail=v};
var writes=[],fail=false;
STATE={tickets:[{id:'11111111-1111-4111-8111-111111111111',seq:1330,cliente:'Angela',estado:'abierto',productos:[{id:'p1',desc:'Camisas',cantidad:24}],tareas:[],markers:[],thread:[]}],clientes:[],profiles:[],meta:{opsProviders:[]}};
AUTH_STATUS='signed_in';
sb={from:table=>({insert:async row=>{writes.push({table,row});return fail?{error:{message:'fallo simulado'}}:{error:null}},update:row=>({eq:async()=>({error:null})})})};
refreshFromServer=async()=>{};showToast=()=>{};userError=()=>{};adminNote=()=>{};
STATE.meta.teamNames=[];STATE.feedReactions=[];STATE.conversations=[];
STATE.teamPosts=[{id:'post-1',autor:'Jonathan',authorUserId:'user-1',createdAt:new Date().toISOString(),text:'Ocupo más vinil negro',ticketId:STATE.tickets[0].id,pinLevel:'none'}];
Object.assign(qa,{UI,setAccountMenuOpen,astraConfirmReview,renderKanbanCard,setView:(v)=>{qa.view=v;render();}});
openTicketById=id=>{qa.opened=id;render();};
qa.renders=0;
render=function(){
 qa.renders++;
 document.getElementById('app').innerHTML=qa.view==='chat'?renderInicioFeed()+astraReviewOverlay():
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
 assert(await page.locator('#ops-f-desc').isEditable());
 assert.equal(await page.locator('#ops-f-area').inputValue(),'planeacion');
 assert.equal(await page.locator('[data-ops-node]').first().isVisible(),false);
 await page.locator('#ops-f-desc').fill('Comprar vinil negro');
 await page.getByRole('button',{name:'Crear tarea',exact:true}).click();
 await page.waitForFunction(()=>qa.getState().tickets[0].tareas.length===1);
 let task=await page.evaluate(()=>qa.getState().tickets[0].tareas[0]);
 assert.equal(task.desc,'Comprar vinil negro');assert.equal(task.area,'planeacion');
 assert.equal(task.estado,'pendiente');assert.equal(await page.locator('#ops-editor-overlay').count(),0);
 // Editing preserves hidden fields and saved metadata.
 await page.evaluate(()=>{const t=qa.getState().tickets[0].tareas[0];t.progreso=45;t.estado='en_proceso';t.fechaAtencion='2026-10-02';qa.view='editor';qa.openOpsEditor('edit',t.id,qa.getState().tickets[0].id);});
 await page.locator('#ops-f-desc').fill('Comprar dos rollos de vinil negro');
 await page.getByRole('button',{name:'Guardar',exact:true}).click();
 task=await page.evaluate(()=>qa.getState().tickets[0].tareas[0]);
 assert.equal(task.desc,'Comprar dos rollos de vinil negro');assert.equal(task.progreso,45);assert.equal(task.estado,'en_proceso');assert.equal(task.fechaAtencion,'2026-10-02');
 // One click on the message action, one on Create; real persistence and source snapshot.
 await page.evaluate(()=>qa.setView('chat'));
 await page.locator('.chat-msg').hover();
 await page.getByRole('button',{name:'Crear tarea desde mensaje',exact:true}).click();
 assert.equal(await page.locator('#astra-review-desc').inputValue(),'Ocupo más vinil negro');
 assert.equal(await page.locator('#astra-review-ticket').inputValue(),await page.evaluate(()=>qa.getState().tickets[0].id));
 assert.equal(await page.locator('#astra-review-date').isVisible(),false);
 await page.getByRole('button',{name:'Crear tarea',exact:true}).click();
 await page.waitForFunction(()=>qa.getState().tickets[0].tareas.length===2);
 assert.equal(await page.evaluate(()=>qa.getState().tickets[0].tareas[1].area),'planeacion');
 assert.equal(await page.locator('.chat-scroll').count(),1);
 assert(await page.evaluate(()=>qa.getWrites().some(w=>w.table==='bitacora'&&w.row.payload.source_post_id==='post-1')));
 // Failed persistence keeps draft; double clicks cannot create a second request.
 await page.evaluate(()=>{qa.setView('kanban');qa.setFailure(true);});
 await page.getByRole('button',{name:/Crear tarea para ticket/}).click();
 await page.locator('#ops-f-desc').fill('Borrador ante fallo');
 await page.getByRole('button',{name:'Crear tarea',exact:true}).click();
 assert.equal(await page.locator('#ops-f-desc').inputValue(),'Borrador ante fallo');
 assert.equal(await page.evaluate(()=>qa.getState().tickets[0].tareas.length),2);
 await page.evaluate(()=>qa.setFailure(false));
 await page.getByRole('button',{name:'Crear tarea',exact:true}).click();
 await page.waitForFunction(()=>qa.getState().tickets[0].tareas.length===3);
 // Advanced action catalog remains available when explicitly expanded.
 await page.getByRole('button',{name:/Crear tarea para ticket/}).click();
 await page.locator('.ops-editor summary').click();
 await page.getByRole('button',{name:'Por acción',exact:true}).click();
 await page.locator('[data-ops-node]').filter({hasText:'Cotizar'}).click();
 assert.equal(await page.locator('#ops-f-desc').inputValue(),'Cotizar');
 await page.getByRole('button',{name:'Crear tarea',exact:true}).click();
 await page.waitForFunction(()=>qa.getState().tickets[0].tareas.length===4);
 assert.equal(await page.evaluate(()=>qa.getState().tickets[0].tareas[3].area),'planeacion');
 // An unlinked message must ask for a ticket; it never guesses one.
 await page.evaluate(()=>{qa.getState().teamPosts[0].ticketId=null;qa.setView('chat');});
 await page.locator('.chat-msg').hover();
 await page.getByRole('button',{name:'Crear tarea desde mensaje',exact:true}).click();
 assert.equal(await page.locator('#astra-review-ticket').inputValue(),'');
 await page.getByRole('button',{name:'Crear tarea',exact:true}).click();
 assert.equal(await page.evaluate(()=>qa.getState().tickets[0].tareas.length),4);
 assert.equal(await page.locator('#astra-review-desc').inputValue(),'Ocupo más vinil negro');
 await page.locator('#astra-review-ticket').selectOption(await page.evaluate(()=>qa.getState().tickets[0].id));
 await page.getByRole('button',{name:'Crear tarea',exact:true}).click();
 await page.waitForFunction(()=>qa.getState().tickets[0].tareas.length===5);
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
  await page.locator('#account-scroll').click({position:{x:10,y:10}});
  assert.equal(await page.locator('.sidebar-account-menu').count(),0);
  assert.equal(await page.locator('#account-scroll').evaluate(el=>el.scrollTop),before);
 await page.evaluate(()=>{qa.setView('kanban');});
 await page.getByRole('button',{name:/Crear tarea para ticket/}).click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 if(process.env.QA_SCREENSHOT)await page.screenshot({path:process.env.QA_SCREENSHOT});
 assert.deepEqual(errors,[]);
 console.log('PASS: task creation in two clicks from Kanban and linked messages, real save/source context, edits preserve hidden data, failed save/retry, mobile account scroll unchanged, mobile form.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
