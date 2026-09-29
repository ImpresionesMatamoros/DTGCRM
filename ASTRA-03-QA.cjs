// Browser integration with the real editor/save/KDS functions and an isolated DB double.
const fs=require('fs'),path=require('path'),assert=require('assert'),http=require('http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const catalog=require('./ops-menu.js');
const cases=[
 [{action:'quote'},'Cotizar','planeacion'],
 [{action:'buy',category:'garments',provider:{id:'yazbek',name:'Yazbek',group:'garments'}},'Comprar prendas en Yazbek','planeacion'],
 [{action:'send_print',category:'vinyl',provider:{id:'alan',name:'Alan',group:'print'}},'Enviar vinil a imprimir con Alan','planeacion'],
 [{action:'stamp',category:'dtf',variant:'shirts'},'Estampar DTF en camisas','produccion'],
 [{action:'cut',category:'cards'},'Cortar tarjetas','produccion'],
 [{action:'order',category:'displays',provider:{id:'mercado%20libre',name:'Mercado Libre',group:'displays'}},'Ordenar displays en Mercado Libre','planeacion'],
 [{action:'weed',category:'stickers'},'Depilar stickers','produccion'],
 [{action:'deliver',category:'parcel',provider:{id:'usps',name:'USPS',group:'parcel'}},'Entregar por USPS','planeacion']];
function leaves(nodes){return nodes.flatMap(n=>[n,...leaves(n.children)]);}
for(const [selection,title,area] of cases){assert.equal(catalog.resolve(selection).title,title);assert.equal(catalog.resolve(selection).area,area);for(const mode of ['action','category']){assert(leaves(catalog.tree(mode)).some(n=>catalog.resolve(n.selection||{})?.title===title),mode+': '+title);}}
const setup=`
window.qa={openOpsEditor,submitOpsEditor,addTareaCore,updateTareaCore,deleteTareaCore,kdsTasks,kdsVista,kdsAccion,kdsCantidad,taskArea,renderKanbanClienteCell,renderWorkOrdersPanel,getState:()=>STATE,getUI:()=>UI,getWrites:()=>writes,getErrors:()=>errors,setFailure:(v)=>fail=v};
var writes=[],errors=[],fail=false;
STATE={tickets:[{id:'11111111-1111-4111-8111-111111111111',seq:1330,cliente:'Angela',estado:'abierto',productos:[{id:'p1',desc:'Camisas',cantidad:24},{id:'p2',desc:'Tarjetas',cantidad:500}],tareas:[],workOrders:[],markers:[],bitacora:[]}],clientes:[],profiles:[],meta:{opsProviders:[]},workOrdersTableMissing:false};
AUTH_STATUS='signed_in';
sb={from:(table)=>({insert:async row=>{writes.push({table,row});return fail?{error:{message:'fallo simulado'}}:{error:null}},update:row=>({eq:async()=>({error:null})}),delete:()=>({eq:async()=>({error:null})})})};
refreshFromServer=async()=>{};showToast=m=>errors.push(m);userError=(m,e)=>errors.push(m+': '+e.message);adminNote=()=>{};
render=function(){document.getElementById('app').innerHTML=renderOpsEditor();};
qa.open=()=>openOpsEditor('create',null,STATE.tickets[0].id);
qa.open();
`;
let html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8').replace(/<script src="https:[^>]*><\/script>/g,'').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,setup);
const server=http.createServer((req,res)=>{const name=req.url.split('?')[0];res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(name==='/'?html:fs.readFileSync(path.join(__dirname,name)));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/tmp/dtg-browser/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}});const runtimeErrors=[];page.on('pageerror',e=>runtimeErrors.push(e.message));await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.ops-progressive');
 const option=label=>page.getByRole('button',{name:label,exact:true});
 // Desktop hover opens without selecting; pointer crosses into adjacent child.
 await option('Comprar').hover();await page.waitForSelector('[data-level="1"]');assert.equal(await page.locator('#ops-f-desc').inputValue(),'');await option('Prendas').hover();await page.waitForSelector('[data-level="2"]');await option('Yazbek').click();assert.equal(await page.locator('#ops-f-desc').inputValue(),'Comprar prendas en Yazbek');assert.equal(await page.locator('#ops-f-area').inputValue(),'planeacion');
 await page.screenshot({path:'/tmp/dtg-menu-desktop.png',fullPage:true});
 // Submit the real editor for all cases through both projections.
 for(const mode of ['action','category'])for(const [selection,title,area] of cases){
  
  await page.evaluate(()=>qa.open());await page.locator('[data-ops-mode="'+mode+'"]').click();
  let route=mode==='action'?[catalog.actions[selection.action][0]]:[catalog.categories[selection.category]||'Sin producto específico'];
  if(selection.category||mode==='category')route.push(mode==='action'?catalog.categories[selection.category]:catalog.actions[selection.action][0]);
  if(selection.variant)route.push('Camisas');if(selection.provider)route.push(selection.provider.name);
  for(const label of route)await option(label).click();
  assert.equal(await page.locator('#ops-f-desc').inputValue(),title);assert.equal(await page.locator('#ops-f-area').inputValue(),area);
  await page.evaluate(()=>qa.submitOpsEditor());const task=await page.evaluate(()=>qa.getState().tickets[0].tareas.at(-1));assert.equal(task.desc,title);assert.equal(task.area,area);assert.equal(task.tipo,'produccion');assert.equal(task.ticket_id,undefined);const write=await page.evaluate(()=>qa.getWrites().filter(w=>w.table==='tareas').at(-1).row);assert.equal(write.ticket_id,'11111111-1111-4111-8111-111111111111');assert.equal(write.area,area);
 }
 // Keyboard: right opens; Enter selects; Escape closes child, not editor.
 await page.evaluate(()=>qa.open());await option('Comprar').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');assert.equal(await page.locator('#ops-f-desc').inputValue(),'Comprar prendas');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.equal(await page.locator('#ops-f-desc').inputValue(),'Comprar prendas en Yazbek');await page.keyboard.press('Escape');assert.equal(await page.locator('.ops-editor').count(),1);
 // Category without action cannot save. Free form requires explicit area.
 await page.evaluate(()=>qa.open());await page.locator('[data-ops-mode="category"]').click();await option('DTF').click();assert(await page.locator('[data-action="ops-ed-save"]').isDisabled());await page.locator('[data-ops-mode="free"]').click();await page.locator('#ops-f-desc').fill('Caso excepcional');await page.locator('#ops-f-area').selectOption('planeacion');await page.evaluate(()=>qa.submitOpsEditor());assert.equal(await page.evaluate(()=>qa.getState().tickets[0].tareas.at(-1).area),'planeacion');
 // Sequence atomic payload, KDS gating and guard in shared mutation core.
 await page.evaluate(()=>qa.open());for(const label of ['Entregar','Paquetería','USPS'])await option(label).click();await page.locator('#ops-f-pack').check();await page.evaluate(()=>qa.submitOpsEditor());const pair=await page.evaluate(()=>qa.getWrites().filter(w=>w.table==='tareas').at(-1).row);assert(Array.isArray(pair)&&pair.length===2);assert.equal(JSON.parse(pair[1].action_path).dependsOn,pair[0].id);
 assert.equal(await page.evaluate(id=>qa.kdsTasks('planeacion').some(i=>i.id===id),pair[1].id),false);
 assert.equal(await page.evaluate(id=>qa.updateTareaCore(qa.getState().tickets[0],id,{estado:'terminado'}),pair[1].id),false);
 await page.evaluate(id=>qa.updateTareaCore(qa.getState().tickets[0],id,{estado:'terminado'}),pair[0].id);
 assert.equal(await page.evaluate(id=>qa.kdsTasks('planeacion').some(i=>i.id===id),pair[1].id),true);
 // No guessed first product; explicit product and details persist.
 await page.evaluate(()=>qa.open());await option('Cortar').click();await option('Tarjetas').click();await page.locator('#ops-f-product').selectOption('p2');await page.locator('#ops-f-details').fill('Usar arte aprobado');await page.evaluate(()=>qa.submitOpsEditor());assert.equal(await page.evaluate(()=>{let t=qa.getState().tickets[0];return qa.kdsCantidad({t,task:t.tareas.at(-1)})}),'500 TARJETAS');assert.equal(await page.evaluate(()=>{let t=qa.getState().tickets[0];return qa.kdsAccion({t,task:t.tareas.at(-1)})}),'CORTAR TARJETAS');
 // Failure retains draft and creates no phantom task. Retrying logs separately.
 await page.evaluate(()=>qa.open());await option('Cotizar').click();const count=await page.evaluate(()=>qa.getState().tickets[0].tareas.length);await page.evaluate(()=>{qa.setFailure(true);return qa.submitOpsEditor()});assert.equal(await page.evaluate(()=>qa.getState().tickets[0].tareas.length),count);assert.equal(await page.locator('.ops-editor').count(),1);await page.evaluate(()=>qa.setFailure(false));
 // Legacy operation producer opens review instead of saving missing area.
 await page.evaluate(()=>qa.addTareaCore(qa.getState().tickets[0],'produccion','Cotizar tapetes','',''));assert.equal(await page.locator('#ops-f-desc').inputValue(),'Cotizar tapetes');assert.equal(await page.evaluate(()=>qa.getState().tickets[0].tareas.length),count);
 assert.equal(await page.evaluate(()=>qa.taskArea({area:'',tipoOperacion:'Otro',desc:'Cotizar tapetes'})),'produccion');
 // Custom provider saved once; whitespace/case duplicate reuses canonical option.
 await page.evaluate(()=>qa.open());for(const label of ['Comprar','Prendas','+ Agregar nombre…'])await option(label).click();await page.locator('#ops-provider-name').fill('  Proveedor QA  ');await page.locator('[data-ops-add-provider]').click();assert.equal(await page.locator('#ops-f-desc').inputValue(),'Comprar prendas en Proveedor QA');assert.equal(await page.evaluate(()=>qa.getWrites().filter(w=>w.table==='app_settings').length),1);
 await page.evaluate(()=>qa.open());for(const label of ['Comprar','Prendas','+ Agregar nombre…'])await option(label).click();await page.locator('#ops-provider-name').fill('proveedor qa');await page.locator('[data-ops-add-provider]').click();assert.equal(await page.evaluate(()=>qa.getWrites().filter(w=>w.table==='app_settings').length),1);
 assert.deepEqual(runtimeErrors,[]);
 const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const touch=await mobile.newPage();await touch.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort());await touch.goto('http://127.0.0.1:'+server.address().port);await touch.locator('[data-ops-mode="category"]').tap();for(const label of ['DTF','Estampar','Camisas'])await touch.getByRole('button',{name:label,exact:true}).tap();assert.equal(await touch.locator('#ops-f-desc').inputValue(),'Estampar DTF en camisas');await touch.screenshot({path:'/tmp/dtg-menu-mobile.png',fullPage:true});await mobile.close();
 console.log('PASS: 16 creations via both routes; actual editor + mocked persistence; hover, click, keyboard, touch emulation; areas; USPS atomic pair/gating; details/product; failure retention; legacy guard; provider dedupe. No production writes.');
 }finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
