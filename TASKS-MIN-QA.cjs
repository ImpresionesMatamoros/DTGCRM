const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
const setup=`
window.qa={v2Canon,v2Area,kanbanSinTareaBadge,ticketSinTarea,renderKanbanColumn,payCurfewDate,payTick,kdsNotas:(it)=>kdsNotas(it),kdsTaskLines,STATE:()=>STATE,WORK_TASK_NAMES,V2_GROUPS};
STATE={tickets:[],clientes:[],profiles:[],meta:{opsProviders:[]}};AUTH_STATUS='signed_in';
sb={rpc:async()=>({data:true,error:null}),from:()=>({insert:async()=>({error:null}),update:()=>({eq:()=>Object.assign(Promise.resolve({error:null}),{select:async()=>({data:[],error:null})})})})};
refreshFromServer=async()=>{};showToast=()=>{};userError=()=>{};adminNote=()=>{};render=function(){};
`;
let html=fs.readFileSync(__dirname+'/index.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,setup);
html=html.replace('<script>','<script>'+fs.readFileSync(__dirname+'/ops-menu.js','utf8')+'</script><script>');
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());await page.setContent(html);
 assert.deepEqual(errors,[]);
 const r=await page.evaluate(()=>{
  const out={};
  out.groups=qa.V2_GROUPS.reduce((n,g)=>n+g[1].length,0);
  out.admin=qa.V2_GROUPS.some(g=>g[1].includes('TAREA ADMINISTRATIVA'));
  out.c1=qa.v2Canon('COMPRAR MATERIAL');out.c2=qa.v2Canon('Estampar DTF');out.c3=qa.v2Canon('Pirate ship');out.c4=qa.v2Canon('ORDENAR A MONTERREY');out.c5=qa.v2Canon('IMPRIMIR LONA');
  out.areas=[qa.v2Area('FABRICAR'),qa.v2Area('ENTREGAR'),qa.v2Area('TAREA ADMINISTRATIVA')];
  const mk=(id,extra)=>Object.assign({id,seq:id,cliente:'C'+id,estado:'abierto',productos:[],markers:[],thread:[],tareas:[]},extra||{});
  const task={id:'x',desc:'FABRICAR',estado:'pendiente',tipo:'produccion',dependsOn:null,responsable:'A'};
  const done=Object.assign({},task,{id:'y',estado:'terminado'});
  const tickets=[mk(1,{tareas:[task]}),mk(2),mk(3,{tareas:[done]}),mk(4,{entregadoAt:new Date().toISOString()}),mk(5,{cierreTipo:'cancelado'})];
  out.sinTarea=tickets.map(qa.ticketSinTarea);
  out.badge=qa.kanbanSinTareaBadge(tickets);
  out.badge0=qa.kanbanSinTareaBadge([tickets[0]]);
  // rollover del curfew
  const hm=d=>new Intl.DateTimeFormat('en-GB',{timeZone:'America/Matamoros',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d);
  const past=new Date(Date.now()-3600000),fut=new Date(Date.now()+3600000);
  const dp=qa.payCurfewDate({curfew:hm(past)}),df=qa.payCurfewDate({curfew:hm(fut)});
  out.pastMs=dp.getTime()-Date.now();out.futMs=df.getTime()-Date.now();
  const n=document.createElement('span');n.className='pay-card-cd';n.setAttribute('data-cd',String(Date.now()-5000));document.body.appendChild(n);qa.payTick();
  out.tick=n.textContent;out.tickCd=+n.dataset.cd-Date.now();
  // notas de la tarea en la TV
  out.lines=qa.kdsTaskLines({legacyName:'Estampar DTF',actionPath:JSON.stringify({note:'ya llegó el DTF'})});
  return out;
 });
 assert.equal(r.groups,11);assert(r.admin);
 assert.equal(r.c1.name,'ORDENAR MATERIAL');assert.equal(r.c1.keep,'');
 assert.equal(r.c2.name,'FABRICAR');assert.equal(r.c2.keep,'Estampar DTF');
 assert.equal(r.c3,null);assert.equal(r.c4.name,'ORDENAR MATERIAL');assert.equal(r.c5.name,'ENVIAR TRABAJO CON PROVEEDOR');
 assert.deepEqual(r.areas,['produccion','planeacion','planeacion']);
 assert.deepEqual(r.sinTarea,[false,true,true,false,false]);
 assert(/kanban-sintarea[^>]*>2</.test(r.badge),r.badge);assert.equal(r.badge0,'');
 assert(r.pastMs>20*3600000&&r.pastMs<24*3600000,'pasó la hora → mañana: '+r.pastMs);
 assert(r.futMs>0&&r.futMs<=3600000+1000,'todavía hoy: '+r.futMs);
 assert(/^CIERRA EN \d+:\d\d:\d\d$/.test(r.tick),r.tick);assert(r.tickCd>20*3600000);
 assert.deepEqual(r.lines,['ESTAMPAR DTF','ya llegó el DTF']);
 console.log('PASS tareas mínimas: 11 tareas, alias de nombres viejos, destino por nombre, número rojo sin tarea, cuenta regresiva pasa a mañana, notas en TV');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
