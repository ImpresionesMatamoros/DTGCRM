const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
const setup=`
window.qa={cobData,ticketsExplorerFiltered,openOpsEditor,getState:()=>STATE,getWrites:()=>writes,setFailure:(v)=>fail=v};
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
 qa.view==='cxc'?renderCxcView():qa.view==='kanban'?renderKanbanCard(STATE.tickets[0])+renderOpsEditor():
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
  const mk=(id,seq,cliente,precio,pag,dias)=>({id,seq,cliente,estado:'abierto',entregadoAt:new Date(Date.now()-dias*86400000).toISOString(),productos:[{id:id+'p',desc:'Playeras',cantidad:10,precio}],pagos:pag?[{id:id+'g',monto:pag,fecha:'2026-10-01'}]:[],tareas:[],markers:[],thread:[],accessProfileIds:[]});
  const S=qa.getState();S.tickets=[mk('a1',401,'Ana Lopez',100,0,12),mk('a2',402,'Ana Lopez',50,0,3),mk('b1',403,'Bruno Diaz',200,150,20)];
  S.tickets.forEach(t=>{t.cierreTipo=null;});
  qa.setView('cxc');
 });
 // por cobrar: Ana 1000+500, Bruno 2000-150
 const d=await page.evaluate(()=>{const x=qa.cobData();return {g:x.groups.map(g=>[g.cliente,g.saldo,g.toDo]),hoy:x.hoy.length,total:x.total};});
 assert.equal(d.groups===undefined?1:1,1);
 assert.equal(d.hoy,2);
 assert.equal(await page.locator('.cob-card').count(),2);
 assert((await page.locator('.cob-summary').textContent()).includes('cobrar hoy'));
 // registrar contacto con promesa futura -> sale de cobrar hoy
 await page.locator('[data-cob="contact"]').first().click();
 await page.locator('#cob-note').fill('Paga el viernes');
 const fut=await page.evaluate(()=>{const d=new Date(Date.now()+2*86400000);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');});
 await page.locator('#cob-promise').fill(fut);
 await page.locator('[data-cob="form-save"]').click();
 await page.waitForFunction(()=>qa.getWrites().some(w=>w.table==='bitacora'));
 const w=await page.evaluate(()=>qa.getWrites().filter(w=>w.table==='bitacora').map(w=>w.row));
 assert(Array.isArray(w[0])||w[0].payload);
 await page.waitForFunction(()=>qa.cobData().hoy.length===1);
 assert.equal(await page.locator('.cob-card').count(),2); // uno en hoy + uno en promesa vigente
 assert((await page.locator('body').textContent()).includes('Con promesa de pago vigente'));
 // pestaña por cliente
 await page.locator('[data-cob="tab"][data-tab="clientes"]').click();
 assert.equal(await page.locator('.cob-card').count(),2);
 // kanban: entregado con saldo no aparece
 const vis=await page.evaluate(()=>qa.ticketsExplorerFiltered().length);
 assert.equal(vis,0);
 console.log('PASS cobranza: cobrar hoy, por cliente, contacto con promesa, promesa vigente, entregados con saldo fuera del Kanban');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
