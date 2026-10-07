const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
const setup=`
window.qa={slashOpenTask,openOpsEditor,getState:()=>STATE,getWrites:()=>writes,setFailure:(v)=>fail=v};
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
 const open=async()=>{await page.evaluate(()=>{qa.getState().tickets[0].tareas=[];qa.setView('kanban');});await page.getByRole('button',{name:/Crear tarea para ticket/}).click();};
 await open();
 // un solo selector: sin chips, con grupos
 assert.equal(await page.locator('.ux-task-choices').count(),0);
 assert.equal(await page.locator('#ops-f-desc optgroup').count(),5);
 const names=await page.locator('#ops-f-desc option').allTextContents();
 for(const gone of ['COBRAR','IMPRIMIR LONA','ENVIAR DTF','ENVIAR DTF UV','ENVIAR TABLOIDES','ORDENAR EN LINEA','ORDENAR A MONTERREY','COMPRAR MATERIAL'])assert(!names.includes(gone),gone);
 for(const here of ['ORDENAR MATERIAL','ENVIAR TRABAJO CON PROVEEDOR','CONTACTAR CLIENTE','CONSEGUIR ARCHIVOS DEL CLIENTE','ENVIAR DISENO','CONSEGUIR APROBACION'])assert(names.includes(here),here);
 // ORDENAR MATERIAL -> vendedores
 await page.locator('#ops-f-desc').selectOption({label:'ORDENAR MATERIAL'});
 await page.waitForSelector('#ops-f-payee');
 let opts=await page.locator('#ops-f-payee option').allTextContents();
 assert(opts.includes('FORPRINT MTY')&&opts.includes('AMAZON USA')&&opts.includes('AGREGAR NUEVO…')&&opts.includes('OTRO'));
 assert(!opts.includes('CARBAJAL IMPRESOS'));
 // sin elegir vendedor no crea
 await page.getByRole('button',{name:'Crear tarea',exact:true}).click();
 assert.equal(await page.evaluate(()=>qa.getState().tickets[0].tareas.length),0);
 await page.locator('#ops-f-payee').selectOption({label:'FORPRINT MTY'});
 await page.getByRole('button',{name:'Crear tarea',exact:true}).click();
 await page.waitForFunction(()=>qa.getState().tickets[0].tareas.length===2);
 let ts=await page.evaluate(()=>qa.getState().tickets[0].tareas);
 assert.equal(ts[0].desc,'ORDENAR MATERIAL');assert.equal(ts[1].desc,'PAGAR Y ENVIAR COMPROBANTE');assert.equal(ts[1].dependsOn,null);
 assert.equal(JSON.parse(ts[1].actionPath).payee.name,'FORPRINT MTY');assert.equal(JSON.parse(ts[0].actionPath).payee.name,'FORPRINT MTY');
 await page.evaluate(()=>qa.setView('kanban'));
 assert.equal(await page.locator('.ws-plan-row.pay').count(),1);
 assert((await page.locator('.ws-plan-row.pay').textContent()).includes('TOTAL AÚN NO DISPONIBLE'));
 // proveedores
 await open();await page.locator('#ops-f-desc').selectOption({label:'ENVIAR TRABAJO CON PROVEEDOR'});await page.waitForSelector('#ops-f-payee');
 opts=await page.locator('#ops-f-payee option').allTextContents();assert(opts.includes('CARBAJAL IMPRESOS')&&opts.includes('SERIGRAFIA PUERTORICO')&&!opts.includes('FORPRINT MTY'));
 await page.locator('#ops-f-payee').selectOption({label:'OTRO'});await page.locator('#ops-f-payee-text').fill('Taller Pepe');
 await page.getByRole('button',{name:'Crear tarea',exact:true}).click();await page.waitForFunction(()=>qa.getState().tickets[0].tareas.length===3);
 ts=await page.evaluate(()=>qa.getState().tickets[0].tareas);assert.equal(ts[1].desc,'RECOGER');assert.equal(ts[1].dependsOn,ts[0].id);assert.equal(ts[2].desc,'PAGAR Y ENVIAR COMPROBANTE');assert.equal(ts[2].dependsOn,ts[1].id);
 // automáticas del cliente
 await open();await page.locator('#ops-f-desc').selectOption({label:'CONSEGUIR ARCHIVOS DEL CLIENTE'});await page.getByRole('button',{name:'Crear tarea',exact:true}).click();
 await page.waitForFunction(()=>qa.getState().tickets[0].tareas.length===2);ts=await page.evaluate(()=>qa.getState().tickets[0].tareas);assert.equal(ts[1].desc,'CONFIRMAR LA CALIDAD (LETS ENHANCE)');assert.equal(ts[1].dependsOn,ts[0].id);
 await open();await page.locator('#ops-f-desc').selectOption({label:'ENVIAR DISENO'});await page.getByRole('button',{name:'Crear tarea',exact:true}).click();
 await page.waitForFunction(()=>qa.getState().tickets[0].tareas.length===2);ts=await page.evaluate(()=>qa.getState().tickets[0].tareas);assert.equal(ts[1].desc,'CONSEGUIR APROBACION');

 // palomita "va después de la anterior"
 await page.evaluate(()=>{qa.getState().tickets[0].tareas=[{id:'x1',desc:'CORTAR',estado:'pendiente',tipo:'produccion',area:'produccion',dependsOn:null,responsable:''}];qa.setView('kanban');});
 await page.getByRole('button',{name:/Crear tarea para ticket/}).click();
 await page.locator('#ops-f-desc').selectOption({label:'FABRICAR'});await page.locator('#ops-f-after').check();
 await page.getByRole('button',{name:'Crear tarea',exact:true}).click();await page.waitForFunction(()=>qa.getState().tickets[0].tareas.length===2);
 assert.equal(await page.evaluate(()=>qa.getState().tickets[0].tareas[1].dependsOn),'x1');
 // /tarea abre el editor con la tarea del catálogo
 await page.evaluate(()=>{qa.getState().tickets[0].tareas=[];qa.setView('kanban');qa.slashOpenTask(qa.getState().tickets[0],'fabri');});
 assert.equal(await page.locator('#ops-f-desc').inputValue(),'FABRICAR');
 console.log('PASS catálogo v2: un selector agrupado, vendedores/proveedores, tareas automáticas encadenadas, total aún no disponible');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
