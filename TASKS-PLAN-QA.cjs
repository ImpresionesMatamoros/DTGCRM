const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
const setup=`
window.qa={updateTareaCore:(...a)=>updateTareaCore(...a),findTicket,openOpsEditor,getState:()=>STATE,getWrites:()=>writes,setFailure:(v)=>fail=v};
var writes=[],fail=false;
STATE={tickets:[{id:'11111111-1111-4111-8111-111111111111',seq:1330,cliente:'Angela',estado:'abierto',productos:[{id:'p1',desc:'Camisas',cantidad:24}],tareas:[{id:'a',desc:'ESTAMPAR DTF',responsable:'Israel',estado:'pendiente',tipo:'produccion',area:'produccion',dependsOn:null},{id:'b',desc:'EMPAQUETAR',responsable:'Alexia',estado:'pendiente',tipo:'produccion',area:'produccion',dependsOn:'a'},{id:'c',desc:'ENTREGAR',responsable:'Alexia',estado:'pendiente',tipo:'produccion',area:'planeacion',dependsOn:'b'},{id:'d',desc:'PEDIR ANTICIPO',responsable:'Alexia',estado:'pendiente',tipo:'produccion',area:'planeacion',dependsOn:null}],markers:[],thread:[]}],clientes:[],profiles:[],meta:{opsProviders:[]}};
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
 // chain a->b->c numbered 1,2,3; d is a parallel dot; b,c in DESPUÉS
 assert.equal(await page.locator('.ws-plan-step').count(),3);
 assert.equal(await page.locator('.ws-plan-dot').count(),1);
 assert.equal(await page.locator('.ws-plan-row:not(.later)').count(),2);
 assert.equal(await page.locator('.ws-plan-row.later').count(),2);
 assert.equal((await page.locator('.ws-plan-step').allTextContents()).join(''),'123');
 // no tasks -> SIN TAREA
 await page.evaluate(()=>{qa.getState().tickets[0].tareas=[];qa.setView('kanban');});
 assert.equal(await page.locator('.ws-plan-alert').count(),1);
 // restore, cycle guard + parallel drop
 await page.evaluate(()=>{const T=qa.getState().tickets[0];T.tareas=[{id:'a',desc:'A',estado:'pendiente',tipo:'produccion',area:'produccion',dependsOn:null},{id:'b',desc:'B',estado:'pendiente',tipo:'produccion',area:'produccion',dependsOn:'a'}];qa.setView('kanban');});
 await page.evaluate(()=>{const dt=new DataTransfer();const src=document.querySelector('[data-plan-task="a"]'),dst=document.querySelector('[data-plan-task="b"]');src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));dst.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));});
 assert.equal(await page.evaluate(()=>qa.getState().tickets[0].tareas[0].dependsOn),null);
 // drag b onto free zone -> parallel
 await page.evaluate(()=>{const dt=new DataTransfer();const src=document.querySelector('[data-plan-task="b"]'),z=document.querySelector('[data-plan-free]');src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));z.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));});
 await page.waitForFunction(()=>qa.getState().tickets[0].tareas[1].dependsOn===null);
 // drag b onto a -> chain
 await page.evaluate(()=>{const dt=new DataTransfer();const src=document.querySelector('[data-plan-task="b"]'),dst=document.querySelector('[data-plan-task="a"]');src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));dst.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));});
 await page.waitForFunction(()=>qa.getState().tickets[0].tareas[1].dependsOn==='a');
 const w=await page.evaluate(()=>qa.getWrites());
 // "agregar siguiente" prefilled
 await page.locator('[data-plan="next"]').first().click();
 assert.equal(await page.evaluate(()=>qa.UI.operaciones.editor.dependsOn),'a');
 console.log('PASS tareas plan: numbered chains, dots, SIN TAREA, drag chain/parallel, add-next');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
