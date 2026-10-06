const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
const setup=`
window.qa={payItems,payUrgentBar,kdsTasks,openOpsEditor,getState:()=>STATE,getWrites:()=>writes,setFailure:(v)=>fail=v};
var writes=[],fail=false;
STATE={tickets:[{id:'11111111-1111-4111-8111-111111111111',seq:1330,cliente:'Angela',estado:'abierto',productos:[{id:'p1',desc:'Camisas',cantidad:24}],tareas:[],markers:[],thread:[]}],clientes:[],profiles:[],meta:{opsProviders:[]}};
AUTH_STATUS='signed_in';UI.waChatOpen=true;
sb={rpc:async(name,args)=>({data:true,error:fail?{message:"fallo simulado"}:null}),from:table=>({insert:async row=>{writes.push({table,row});return fail?{error:{message:'fallo simulado'}}:{error:null}},update:row=>({eq:()=>Object.assign(Promise.resolve({error:null}),{select:async()=>({data:[],error:null})})})})};
refreshFromServer=async()=>{};showToast=()=>{};userError=()=>{};adminNote=()=>{};
STATE.meta.teamNames=[];STATE.feedReactions=[];STATE.conversations=[];
STATE.teamPosts=[{id:'post-1',autor:'Jonathan',authorUserId:'user-1',createdAt:new Date().toISOString(),text:'Ocupo más vinil negro',ticketId:STATE.tickets[0].id,pinLevel:'none'}];
Object.assign(qa,{UI,setAccountMenuOpen,astraConfirmReview,renderKanbanCard,setView:(v)=>{qa.view=v;render();}});
openTicketById=id=>{qa.opened=id;render();};
qa.renders=0;
render=function(){
 qa.renders++;
 document.getElementById('app').innerHTML=qa.view==='chat'?renderInicioFeed()+renderOpsEditor()+astraReviewOverlay():
 qa.view==='pagos'?renderPagosView():qa.view==='kanban'?renderKanbanCard(STATE.tickets[0])+renderOpsEditor():
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
 await page.evaluate(()=>{
  
  const T=qa.getState().tickets[0];
  const vendor={id:DTGOps.providerId('FORPRINT MTY'),name:'FORPRINT MTY',group:'vendor'},prov={id:DTGOps.providerId('CARBAJAL IMPRESOS'),name:'CARBAJAL IMPRESOS',group:'provider'};
  const d=new Date(Date.now()+3600000),hh=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  qa.getState().meta.payeeDetails={['vendor:'+vendor.id]:{bank:'BBVA',holder:'Forprint SA',clabe:'012345678901234567',curfew:hh}};
  T.tareas=[
   {id:'p1',desc:'ORDENAR MATERIAL',estado:'pendiente',tipo:'produccion',area:'planeacion',dependsOn:null,actionPath:JSON.stringify({v:1,payee:vendor})},
   {id:'p2',desc:'PAGAR Y ENVIAR COMPROBANTE',estado:'pendiente',tipo:'produccion',area:'planeacion',dependsOn:null,createdAt:new Date().toISOString(),actionPath:JSON.stringify({v:1,payee:vendor})},
   {id:'r1',desc:'RECOGER',estado:'pendiente',tipo:'produccion',area:'planeacion',dependsOn:null,actionPath:JSON.stringify({v:1,payee:prov})},
   {id:'p3',desc:'PAGAR Y ENVIAR COMPROBANTE',estado:'pendiente',tipo:'produccion',area:'planeacion',dependsOn:'r1',createdAt:new Date().toISOString(),actionPath:JSON.stringify({v:1,payee:prov,amount:1250})}];
  qa.setView('pagos');
 });
 // vendedor visible sin total; proveedor bloqueado hasta RECOGER
 assert.equal(await page.locator('.pay-card').count(),1);
 const txt=await page.locator('.pay-card').textContent();
 assert(txt.includes('FORPRINT MTY')&&txt.includes('TOTAL AÚN NO DISPONIBLE')&&txt.includes('BBVA')&&txt.includes('CIERRA EN 0:'));
 assert(await page.locator('.pay-card.noamt').count()===1);
 // total
 await page.locator('[data-pay="amount"]').click();await page.locator('#pay-amt').fill('1,250.50');await page.locator('[data-pay="amount-save"]').click();
 await page.waitForFunction(()=>JSON.parse(qa.getState().tickets[0].tareas[1].actionPath).amount===1250.5);
 assert((await page.locator('.pay-card').textContent()).includes('1,250.50'));
 // urgente -> barra
 await page.locator('[data-pay="urgent"]').click();
 await page.waitForFunction(()=>JSON.parse(qa.getState().tickets[0].tareas[1].actionPath).urgent===true);
 await page.evaluate(()=>qa.payUrgentBar());
 assert.equal(await page.locator('#pay-urgent-bar').count(),1);assert((await page.locator('#pay-urgent-bar').textContent()).includes('FORPRINT MTY'));
 // proveedor aparece al terminar RECOGER
 await page.evaluate(()=>{qa.getState().tickets[0].tareas[2].estado='terminado';qa.setView('pagos');});
 assert.equal(await page.locator('.pay-card').count(),2);
 // ya pagué
 await page.locator('[data-pay="paid"]').first().click();
 await page.waitForFunction(()=>qa.getState().tickets[0].tareas[1].estado==='terminado');
 assert.equal(await page.locator('.pay-card.paid').count(),1);
 // ficha nueva
 await page.locator('[data-pay="new-payee"]').click();
 await page.locator('#pf-name').fill('Taller Pepe');await page.locator('#pf-group').selectOption('provider');await page.locator('#pf-clabe').fill('999');await page.locator('#pf-curfew').fill('17:00');
 await page.locator('[data-pay="form-save"]').click();
 await page.waitForFunction(()=>Object.keys(qa.getState().meta.payeeDetails).some(k=>k.startsWith('provider:')&&qa.getState().meta.payeeDetails[k].clabe==='999'));
 assert(await page.evaluate(()=>qa.getWrites().some(w=>w.table==='app_settings'&&w.row.key&&w.row.key.indexOf('ops_provider_v1:provider:')===0)));
 assert((await page.locator('.pay-fichas').textContent()).includes('Taller Pepe'));
 // la tarea de pago no sale en la TV de producción
 assert.equal(await page.evaluate(()=>qa.kdsTasks('planeacion').filter(i=>i.task.desc==='PAGAR Y ENVIAR COMPROBANTE').length),0);
 console.log('PASS pagos: cards, total aún no disponible, curfew, total, urgente + barra, proveedor tras RECOGER, ya pagué, fichas');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
