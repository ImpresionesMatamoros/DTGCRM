const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
const setup=`
window.qa={kdsItemsForBoard,openOpsEditor,getState:()=>STATE,getWrites:()=>writes,setFailure:(v)=>fail=v};
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
 qa.view==='kds'?renderKdsMenuView():qa.view==='kanban'?renderKanbanCard(STATE.tickets[0])+renderOpsEditor():
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
  const S=qa.getState(),T=S.tickets[0];const mk=(id,desc,area,extra)=>Object.assign({id,desc,estado:'pendiente',tipo:'produccion',area,dependsOn:null,responsable:'',tipoOperacion:'',actionPath:'',createdAt:new Date().toISOString()},extra||{});
  T.tareas=[mk('k1','CORTAR','produccion'),mk('k2','FABRICAR','produccion'),mk('k3','EMPAQUETAR','produccion'),mk('k4','ENTREGAR','planeacion')];
  qa.setView('kds');
 });
 // cuatro botones de TV + previews
 assert.equal(await page.locator('.kds-menu-top a[href^="?display="]').count(),4);
 const hrefs=await page.locator('.kds-menu-top a').evaluateAll(a=>a.map(x=>x.getAttribute('href')));
 for(const k of ['produccion','planeacion','pagos','cxc'])assert(hrefs.includes('?display='+k),k);
 assert.equal(await page.locator('.kds-menu-board').count(),4);
 assert((await page.locator('.kds-menu-board').first().textContent()).includes('Ver TV de PRODUCCIÓN'));
 assert.equal(await page.locator('.kds-menu-board').first().locator('.kds-mini').count(),3);
 // orden: bajar la primera
 const before=await page.evaluate(()=>qa.kdsItemsForBoard('produccion').map(i=>i.id));
 await page.locator('.kds-menu-board').first().locator('summary').click();
 await page.locator('.kds-menu-board').first().locator('[data-kdsm="down"]').first().click();
 await page.waitForFunction(()=>qa.getState().meta.kdsOrder&&qa.getState().meta.kdsOrder.produccion);
 const after=await page.evaluate(()=>qa.kdsItemsForBoard('produccion').map(i=>i.id));
 assert.equal(after[0],before[1]);assert.equal(after[1],before[0]);
 assert(await page.evaluate(()=>qa.getWrites().some(w=>w.table==='app_settings'&&w.row.key==='kds_order_v1:produccion')));
 // drag: soltar la última sobre la primera
 await page.evaluate(()=>{const rows=document.querySelectorAll('.kds-menu-board')[0].querySelectorAll('.kds-ord-row'),dt=new DataTransfer();rows[2].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));rows[0].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));});
 await page.waitForFunction(a=>qa.getState().meta.kdsOrder.produccion[0]===a,after[2]);
 console.log('PASS KDS menu: 4 botones de TV, vistas previas, orden por flechas y arrastre guardado');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
