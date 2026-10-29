const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
let fixture=fs.readFileSync(__dirname+'/CHAT-INBOX-QA.cjs','utf8').match(/const fixture=`([\s\S]*?)`;/)[1];
fixture=fixture.slice(0,fixture.lastIndexOf('render();'))+`
STATE.tickets=['abierto','entregado','cerrado'].map((estado,i)=>({id:'t'+i,seq:i+1,cliente:'Cliente '+estado,responsable:'',entregadoAt:i===1?'2026-10-02T12:00:00Z':null,cierreTipo:i===2?'pagado':null,createdAt:'2026-10-01T12:00:00Z',lastActivityAt:'2026-10-01T12:00:00Z',visibility:'public',productos:[],pagos:[],documentos:[],thread:[],markers:[],workOrders:[],accessProfileIds:[],tareas:[]}));
Object.assign(qa,{boot,goToTickets,loadUi,resetTicketsEntry,deviceResetIdentity,ui:()=>UI,filtered:()=>ticketsExplorerFiltered().map(t=>t.id),snapshot:()=>JSON.parse(UI_INITIAL_SNAPSHOT),ready:()=>{FATAL_ERROR=null;AUTH_STATUS='signed_in';AUTH_SESSION={user:{id:'tania'}};CURRENT_PROFILE={id:'tania',display_name:'Tania',active:true};render();}});
`;
let html=fs.readFileSync(__dirname+'/index.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,fixture);
html=html.replace('<script>','<script>'+fs.readFileSync(__dirname+'/ops-menu.js','utf8')+'</script><script>');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith('http://dtg.test')?r.fulfill({contentType:'text/html',body:html}):r.abort());await page.goto('http://dtg.test');
 assert.deepEqual(await page.evaluate(()=>[qa.snapshot().ticketsView,qa.snapshot().ticketsExplorer.estado]),['details','abierto']);
 // Real boot entry must override old browser preferences, including a stale search.
 for(const saved of [null,'{bad json',JSON.stringify({ticketsView:'kanban',search:'ocultar todo',selectedTicketId:'old',mainView:'cxc'}),JSON.stringify({ticketsView:'invalid'})]){
  await page.evaluate(async saved=>{localStorage.removeItem('dtg_ui');if(saved!==null)localStorage.setItem('dtg_ui',saved);await qa.boot();qa.ready();},saved);
  assert.deepEqual(await page.evaluate(()=>[qa.ui().mainView,qa.ui().ticketsView,qa.ui().ticketsExplorer.estado,qa.ui().search,qa.ui().selectedTicketId]),['tickets','details','abierto','',null]);
  assert.deepEqual(await page.evaluate(()=>qa.filtered()),['t0']);assert.equal(await page.locator('.tickets-details tbody tr').count(),1);assert.equal(await page.locator('[data-action="tickets-view-pick"][data-view="details"]').getAttribute('aria-selected'),'true');
 }
 // Manual choices still work; reentering Tickets removes stale extra filters.
 await page.getByRole('button',{name:'Mostrar vistas y filtros',exact:true}).click();await page.getByRole('tab',{name:'Iconos',exact:true}).click();assert.equal(await page.evaluate(()=>qa.ui().ticketsView),'icons');
 await page.evaluate(()=>{Object.assign(qa.ui().ticketsExplorer,{estado:'todos',responsable:'Otro',clienteId:'missing',marker:'urgent',fecha:'hoy'});qa.ui().search='vieja';qa.goToTickets();});
 assert.deepEqual(await page.evaluate(()=>qa.filtered()),['t0']);assert.equal(await page.locator('.tickets-details tbody tr').count(),1);
 await page.evaluate(()=>{qa.ui().ticketsExplorer.estado='todos';qa.render();});assert((await page.evaluate(()=>qa.filtered())).includes('t2'));
 // Identity reset does not inherit another member's presentation/filter state.
 await page.evaluate(()=>{qa.ui().ticketsView='kanban';qa.deviceResetIdentity();});assert.deepEqual(await page.evaluate(()=>[qa.ui().ticketsView,qa.ui().ticketsExplorer.estado,qa.ui().search]),['details','abierto','']);
 assert.deepEqual(errors,[]);console.log('PASS: boot with absent/old/corrupt preferences, open-only rendered rows, manual view/filter changes, module reentry, and account reset.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
