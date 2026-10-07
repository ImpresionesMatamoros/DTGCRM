const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
const setup=`
window.qa={UI,STATE:()=>STATE,writes:[],ticketSinTarea,createTicketCore,nextTaskPrompt,payAlert30,payOpen,payCurfewDate,
  draw:()=>render(),hoy:()=>todayLocalYYYYMMDD(),addTareaCore:(t,d)=>addTareaCore(t,'produccion',d,'Jonathan','',{}),
  filtered:()=>ticketsExplorerFiltered().map(t=>t.id),openEd:()=>UI.operaciones.editor};
STATE={tickets:[],clientes:[],profiles:[],meta:{opsProviders:[],payeeDetails:{}}};AUTH_STATUS='signed_in';
sb={rpc:async()=>({data:true,error:null}),from:table=>({insert:row=>{qa.writes.push({table,row});const r={error:null,data:{id:'new-1',seq:99}};return Object.assign(Promise.resolve(r),{select:()=>({single:async()=>r})})},update:()=>({eq:()=>Object.assign(Promise.resolve({error:null}),{select:async()=>({data:[],error:null})})})})};
refreshFromServer=async()=>{};showToast=m=>{qa.toasts=(qa.toasts||[]).concat(m)};userError=()=>{};adminNote=()=>{};
render=function(){};
`;
let html=fs.readFileSync(__dirname+'/index.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,setup);
html=html.replace('<script>','<script>'+fs.readFileSync(__dirname+'/ops-menu.js','utf8')+'</script><script>');
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());await page.setContent(html);
 assert.deepEqual(errors,[]);
 // 1) ticket nuevo nace con CONTACTAR CLIENTE para hoy
 const w=await page.evaluate(async()=>{await qa.createTicketCore({cliente:'Ana'});return qa.writes.filter(x=>x.table==='tareas').map(x=>x.row);});
 assert.equal(w.length,1);assert.equal(w[0].descripcion,'CONTACTAR CLIENTE');assert.equal(w[0].area,'planeacion');assert.equal(w[0].estado,'pendiente');assert(/^\d{4}-\d\d-\d\d$/.test(w[0].fecha_atencion));
 // 2) aviso al terminar la última tarea
 await page.evaluate(()=>{qa.nextTaskPrompt.call(null,'t1');});
 assert.equal(await page.locator('#nt-prompt').count(),0,'sin ticket no hay aviso');
 await page.evaluate(()=>{const S=qa.STATE();S.tickets=[{id:'t1',seq:1,cliente:'Ana',estado:'abierto',productos:[],markers:[],thread:[],tareas:[]}];qa.nextTaskPrompt('t1');});
 assert.equal(await page.locator('#nt-prompt [data-nt]').count(),3);
 assert((await page.locator('#nt-prompt').textContent()).includes('Ya no tiene tareas pendientes'));
 await page.locator('[data-nt="later"]').click();assert.equal(await page.locator('#nt-prompt').count(),0);
 await page.evaluate(()=>qa.nextTaskPrompt('t1'));await page.locator('[data-nt="task"]').click();
 assert.equal(await page.locator('#nt-prompt').count(),0);assert(await page.evaluate(()=>!!qa.UI.operaciones.editor&&qa.UI.operaciones.editor.ticketId==='t1'));
 // 3) filtro del número rojo
 await page.evaluate(()=>{const S=qa.STATE();const task={id:'k',desc:'FABRICAR',estado:'pendiente',tipo:'produccion',dependsOn:null,responsable:'A'};S.tickets=[{id:'a',seq:1,cliente:'A',estado:'abierto',productos:[],markers:[],thread:[],tareas:[task]},{id:'b',seq:2,cliente:'B',estado:'abierto',productos:[],markers:[],thread:[],tareas:[]}];qa.UI.ticketsView='kanban';});
 assert.equal(await page.evaluate(()=>qa.filtered().length),2);
 await page.evaluate(()=>{document.body.insertAdjacentHTML('beforeend','<span class="kanban-sintarea" id="bd">1</span>');});
 await page.locator('#bd').click();assert.equal(await page.evaluate(()=>qa.UI.kanbanSinTarea),true);
 assert.deepEqual(await page.evaluate(()=>qa.filtered()),['b']);
 await page.locator('#bd').click();assert.equal(await page.evaluate(()=>qa.UI.kanbanSinTarea),false);
 // 4) fecha por defecto: la que pide addTareaCore sin fecha = hoy (se ve en el insert)
 await page.evaluate(async()=>{qa.writes.length=0;await qa.addTareaCore(qa.STATE().tickets[0],'CONTACTAR CLIENTE');});
 const ins=await page.evaluate(()=>qa.writes.filter(x=>x.table==='tareas').map(x=>x.row));
 assert(ins.length>=1);assert.equal(ins[0].fecha_atencion,await page.evaluate(()=>qa.hoy()));
 // 5) aviso a 30 minutos
 const al=await page.evaluate(()=>{
  const S=qa.STATE(),hm=d=>new Intl.DateTimeFormat('en-GB',{timeZone:'America/Matamoros',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d);
  S.meta.payeeDetails={'vendor:v1':{name:'V1',group:'vendor',curfew:hm(new Date(Date.now()+20*60000))}};
  S.meta.opsProviders=[{group:'vendor',id:'v1',name:'V1'}];
  const task={id:'p',desc:'PAGAR Y ENVIAR COMPROBANTE',estado:'pendiente',tipo:'produccion',dependsOn:null,createdAt:new Date().toISOString(),actionPath:JSON.stringify({v:1,auto:true,payee:{id:'v1',name:'V1',group:'vendor'},amount:500})};
  S.tickets=[{id:'a',seq:1,cliente:'A',estado:'abierto',productos:[],markers:[],thread:[],tareas:[task]}];
  qa.toasts=[];qa.payAlert30();qa.payAlert30();
  return {n:qa.toasts.length,t:qa.toasts[0]||'',open:qa.payOpen().length};
 });
 console.log(JSON.stringify(al));
 if(al.open){assert.equal(al.n,1,'avisa una sola vez');assert(/CIERRA EN 30 MIN/.test(al.t));}
 console.log('PASS flujo: tarea por defecto, aviso de siguiente tarea, filtro rojo, fecha hoy'+(al.open?', aviso 30 min':''));
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
