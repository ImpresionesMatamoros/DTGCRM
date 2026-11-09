const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
let fixture=fs.readFileSync(__dirname+'/CHAT-INBOX-QA.cjs','utf8').match(/const fixture=`([\s\S]*?)`;/)[1];
fixture=fixture.slice(0,fixture.lastIndexOf('render();'))+`
STATE.tickets=['abierto','entregado','cerrado'].map((estado,i)=>({id:'t'+i,seq:i+1,cliente:'Cliente '+estado,responsable:'',entregadoAt:i===1?'2026-10-02T12:00:00Z':null,cierreTipo:i===2?'pagado':null,createdAt:'2026-10-01T12:00:00Z',lastActivityAt:'2026-10-01T12:00:00Z',visibility:'public',productos:[],pagos:[],documentos:[],thread:[],markers:[],workOrders:[],accessProfileIds:[],tareas:[]}));
Object.assign(qa,{mockListWrites:()=>{
 STATE.profiles=[{id:'ceci',displayName:'Ceci',active:true}];
 dcPersistDates=async(t,date)=>{t.fechaCompromiso=date;return true;};
 updateTicketFieldCore=async(t,field,value)=>{t.responsable=value;return true;};
 updateQueSigueCore=async(t,value)=>{t.queSigue=value;return true;};
 addProductoCore=async(t,desc,cantidad,precio)=>{t.productos.push({id:'p1',desc,cantidad,precio});return true;};
 updateProductoCore=async(t,id,patch)=>{Object.assign(t.productos.find(p=>p.id===id),patch);return true;};
 addPagoCore=async(t,monto,fecha,metodo,concepto,opts)=>{
   window.paymentAttempts=(window.paymentAttempts||[]).concat(opts.opId);
   if(window.paymentAttempts.length===1)return false;
   t.pagos.push({monto,fecha,metodo,concepto});return true;
 };
 marcarEntregadoCore=async(t,opts)=>{t.entregadoAt='2026-11-09T12:00:00Z';window.deliveryOptions=opts;return true;};
 cerrarTicketCore=async(t,tipo,reason)=>{t.cierreTipo=tipo;t.razonCierre=reason;return true;};
}});
Object.assign(qa,{boot,goToTickets,loadUi,resetTicketsEntry,deviceResetIdentity,ui:()=>UI,filtered:()=>ticketsExplorerFiltered().map(t=>t.id),snapshot:()=>JSON.parse(UI_INITIAL_SNAPSHOT),ready:()=>{FATAL_ERROR=null;AUTH_STATUS='signed_in';AUTH_SESSION={user:{id:'tania'}};CURRENT_PROFILE={id:'tania',display_name:'Tania',active:true};render();}});
`;
let html=fs.readFileSync(__dirname+'/index.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,fixture);
html=html.replace('<script>','<script>'+fs.readFileSync(__dirname+'/ops-menu.js','utf8')+'</script><script>');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith('http://dtg.test')?r.fulfill({contentType:'text/html',body:html}):r.abort());await page.goto('http://dtg.test');
 assert.deepEqual(await page.evaluate(()=>[qa.snapshot().ticketsView,qa.snapshot().ticketsExplorer.estado]),['list','abierto']);
 // Real boot entry must override old browser preferences, including a stale search.
 for(const saved of [null,'{bad json',JSON.stringify({ticketsView:'kanban',search:'ocultar todo',selectedTicketId:'old',mainView:'cxc'}),JSON.stringify({ticketsView:'invalid'})]){
  await page.evaluate(async saved=>{localStorage.removeItem('dtg_ui');if(saved!==null)localStorage.setItem('dtg_ui',saved);await qa.boot();qa.ready();},saved);
  assert.deepEqual(await page.evaluate(()=>[qa.ui().mainView,qa.ui().ticketsView,qa.ui().ticketsExplorer.estado,qa.ui().search,qa.ui().selectedTicketId]),['tickets','list','abierto','',null]);
  assert.deepEqual(await page.evaluate(()=>qa.filtered()),['t0']);assert.equal(await page.locator('.tickets-list-table tbody tr').count(),1);assert.equal(await page.locator('[data-action="tickets-view-pick"][data-view="list"]').getAttribute('aria-selected'),'true');
 }
 // Manual choices still work; reentering Tickets removes stale extra filters.
 assert.equal(await page.locator('.work-discover').isVisible(),false);
 await page.getByRole('tab',{name:'Responsables',exact:true}).click();
 await page.getByRole('tab',{name:'Lista',exact:true}).click();
 assert.equal(await page.evaluate(()=>qa.ui().ticketsView),'list');
 assert.equal(await page.locator('.work-discover').isVisible(),false);
 assert(await page.locator('.tickets-list-table').isVisible());
 for(const width of [390,320]){
   await page.setViewportSize({width,height:844});
   await page.locator('.ticket-mobile-card').waitFor();
   assert.equal(await page.locator('.tickets-list-table').count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 await page.evaluate(()=>qa.mockListWrites());
 const card=page.locator('.ticket-mobile-card');
 const more=page.getByRole('button',{name:'Acciones rápidas de la orden #1'});
 const menu=page.getByRole('dialog',{name:'Acciones rápidas'});
 await card.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:1,isPrimary:true,clientX:30,clientY:80});
 await card.dispatchEvent('pointermove',{pointerType:'touch',pointerId:1,isPrimary:true,clientX:30,clientY:120});
 await page.waitForTimeout(550);
 assert.equal(await menu.count(),0);
 await card.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:2,isPrimary:true,clientX:30,clientY:80});
 await menu.waitFor();
 assert.equal(await page.evaluate(()=>qa.ui().selectedTicketId),null);
 await menu.getByRole('button',{name:'Editar pedido'}).click();
 const products=page.getByRole('dialog',{name:'Editar pedido'});
 await products.getByRole('textbox',{name:'Descripción del nuevo producto'}).fill('Lona');
 await products.getByRole('spinbutton',{name:'Precio unitario del nuevo producto'}).fill('50');
 await products.getByRole('button',{name:'Agregar'}).click();
 await products.getByRole('spinbutton',{name:'Cantidad',exact:true}).fill('2');
 await products.getByRole('spinbutton',{name:'Cantidad',exact:true}).press('Tab');
 await page.waitForFunction(()=>qa.STATE.tickets[0].productos[0].cantidad===2);
 await products.getByRole('button',{name:'Cerrar',exact:true}).click();
 await page.waitForFunction(()=>document.activeElement.id==="ticket-list-more-t0");
 await more.click();
 await menu.getByRole('button',{name:'Cambiar entrega'}).click();
 const delivery=page.getByRole('dialog',{name:'Cambiar entrega'});
 await delivery.getByLabel('Fecha de entrega').fill('2026-11-16');
 await delivery.getByRole('button',{name:'Guardar'}).click();
 await page.waitForFunction(()=>qa.STATE.tickets[0].fechaCompromiso==='2026-11-16');
 await more.click();
 await menu.getByRole('button',{name:'Cambiar entrega'}).click();
 await delivery.getByRole('button',{name:'Quitar fecha'}).click();
 await page.waitForFunction(()=>qa.STATE.tickets[0].fechaCompromiso==='');
 await more.click();
 await menu.getByRole('button',{name:'Actualizar seguimiento'}).click();
 const tracking=page.getByRole('dialog',{name:'Actualizar seguimiento'});
 await tracking.getByLabel('Responsable').selectOption('Ceci');
 await tracking.getByLabel('Qué sigue').fill('Confirmar diseño');
 await tracking.getByRole('button',{name:'Guardar'}).click();
 await page.waitForFunction(()=>qa.STATE.tickets[0].queSigue==='Confirmar diseño'&&qa.STATE.tickets[0].responsable==='Ceci');
 await more.click();
 await menu.getByRole('button',{name:'Registrar pago'}).click();
 const payment=page.getByRole('dialog',{name:'Registrar pago'});
 await payment.getByLabel('Monto').fill('25');
 await payment.getByRole('button',{name:'Registrar',exact:true}).click();
 await payment.getByRole('alert').waitFor();
 assert.equal(await payment.getByLabel('Monto').inputValue(),'25');
 await payment.getByRole('button',{name:'Registrar',exact:true}).click();
 await payment.getByRole('button',{name:'Listo'}).click();
 assert(await page.evaluate(()=>paymentAttempts.length===2&&paymentAttempts[0]===paymentAttempts[1]));
 assert.equal(await page.evaluate(()=>qa.STATE.tickets[0].pagos[0].monto),25);
 await more.click();
 await menu.getByRole('button',{name:'Finalizar orden'}).click();
 const finalize=page.getByRole('dialog',{name:'Finalizar orden'});
 assert(await finalize.getByText('Todavía aparece un saldo de $75.00.').isVisible());
 await finalize.getByRole('button',{name:'Cerrar como pendiente de pago'}).click();
 await page.waitForFunction(()=>qa.STATE.tickets[0].entregadoAt&&deliveryOptions.pendingPayment);
 assert.equal(await page.evaluate(()=>qa.STATE.tickets[0].cierreTipo||null),null);
 assert.equal(await card.count(),0);
 for(const [label,status] of [['Cerrar como pagada','pagado'],['Cancelar orden','cancelado']]){
   await page.evaluate(()=>{qa.STATE.tickets[0].entregadoAt=null;qa.STATE.tickets[0].cierreTipo=null;qa.render();});
   await more.click();
   await menu.getByRole('button',{name:'Finalizar orden'}).click();
   await finalize.getByRole('button',{name:label}).click();
   await page.waitForFunction(status=>qa.STATE.tickets[0].cierreTipo===status,status);
 }
 await page.evaluate(()=>{qa.STATE.tickets[0].cierreTipo=null;qa.render();});
 const savedScroll=await page.evaluate(()=>{
   const t=qa.STATE.tickets[0];
   for(let i=10;i<30;i++)qa.STATE.tickets.push({...t,id:'scroll'+i,seq:i});
   qa.render();
   const list=document.getElementById('tickets-explorer-scroll');
   const btn=document.getElementById('ticket-list-more-scroll20');
   list.scrollTop=btn.getBoundingClientRect().top-list.getBoundingClientRect().top-100;
   return list.scrollTop;
 });
 assert(savedScroll>0);
 await page.getByRole('button',{name:'Acciones rápidas de la orden #20'}).click();
 await menu.getByRole('button',{name:'Cerrar',exact:true}).click();
 assert.equal(await page.locator('#tickets-explorer-scroll').evaluate(el=>el.scrollTop),savedScroll);
 await page.evaluate(()=>{qa.STATE.tickets=qa.STATE.tickets.slice(0,3);qa.render();});
 await page.locator('.ticket-mobile-card').click();
 assert.equal(await page.evaluate(()=>qa.ui().selectedTicketId),'t0');
 await page.evaluate(()=>qa.goToTickets());
 await page.getByRole('combobox',{name:'Vista de tickets'}).selectOption({label:'Detalles'});
 assert.equal(await page.evaluate(()=>qa.ui().ticketsView),'details');
 await page.setViewportSize({width:1440,height:900});
 await page.evaluate(()=>qa.render());
 await page.getByRole('tab',{name:'Iconos',exact:true}).click();assert.equal(await page.evaluate(()=>qa.ui().ticketsView),'icons');
 await page.evaluate(()=>{Object.assign(qa.ui().ticketsExplorer,{estado:'todos',responsable:'Otro',clienteId:'missing',marker:'urgent',fecha:'hoy'});qa.ui().search='vieja';qa.goToTickets();});
 assert.deepEqual(await page.evaluate(()=>qa.filtered()),['t0']);assert.equal(await page.locator('.tickets-list-table tbody tr').count(),1);
 await page.evaluate(()=>{qa.ui().ticketsExplorer.estado='todos';qa.render();});assert((await page.evaluate(()=>qa.filtered())).includes('t2'));
 // Identity reset does not inherit another member's presentation/filter state.
 await page.evaluate(()=>{qa.ui().ticketsView='kanban';qa.deviceResetIdentity();});assert.deepEqual(await page.evaluate(()=>[qa.ui().ticketsView,qa.ui().ticketsExplorer.estado,qa.ui().search]),['list','abierto','']);
 assert.deepEqual(errors,[]);console.log('PASS: boot with absent/old/corrupt preferences, open-only rendered rows, manual view/filter changes, module reentry, and account reset.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
