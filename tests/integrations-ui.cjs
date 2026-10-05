const fs=require('fs'),path=require('path'),assert=require('assert'),{chromium}=require('playwright');
const root=path.join(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],requests=[];let failSend=true,hangStatus=false;
    page.on('pageerror',e=>errors.push(e.message));
    const file={id:'f1',asset_id:'a1',filename:'Original producción.pdf',size_bytes:500*1048576,version:3,stage:'Print Ready',availability:'available',preview_state:'unsupported',usage:{production_approved:true}};
    const box={id:'inbox1',email_alias:'vendors@956print.com',verification_status:'accepted'};
    await page.route('**/*',async route=>{
      const req=route.request();if(!req.url().startsWith('https://example.invalid/'))return route.abort();
      if(req.method()==='GET')return route.fulfill({contentType:'text/html',body:'<html></html>'});
      const body=req.postDataJSON();requests.push(body);if(hangStatus&&body.action==='status')return;let data;
      if(body.action==='status')data={enabled:true,domain:'956print.com',connection:{state:'connected'},inboxes:[box]};
      else if(body.action==='listVendors')data=[{id:'vendor1',name:'Proveedor'}];
      else if(body.action==='listFiles')data=[file,{...file,id:'f2',filename:'Draft.ai',stage:'Draft',usage:{production_approved:false}}];
      else if(body.action==='customerHistory')data=[file];
      else if(body.action==='listLinkedEmails'||body.action==='listEmails')data=[{id:'m1',subject:'Proof <script>bad()</script>',from_address:'client@example.com'}];
      else if(body.action==='getEmail')data={metadata:{id:'m1',rfc_message_id:'<original@example.com>',thread_id:'thread1',from_address:'Cliente <client@example.com>',subject:'Pedido'},message:{payload:{mimeType:'text/plain',body:{data:Buffer.from('Hola <img src=x onerror=bad()>').toString('base64url')}}}};
      else if(body.action==='sendEmail'&&failSend)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'PROVIDER_UNAVAILABLE'})});
      else if(body.action==='sendEmail'||body.action==='sendToVendor')data={operation_id:'op1',state:'queued'};
      else if(body.action==='operationStatus')data={operation_id:'op1',kind:'vendor_delivery',state:'sent'};
      else data={ok:true};
      await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.goto('https://example.invalid/');
    await page.setContent('<meta charset="utf-8"><style>body{margin:0;background:#13151b;color:white;font:14px sans-serif}.btn{padding:8px}</style><button data-dtgi="open" data-ticket="t1" data-customer="c1" data-seq="1842">Archivos y correo</button>');
    await page.addStyleTag({content:fs.readFileSync(path.join(root,'integrations.css'),'utf8')});
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'integrations.js'),'utf8')});
    await page.evaluate(()=>{
      window.testActor='actor1';
      const client={auth:{getSession:async()=>({data:{session:{user:{id:testActor},access_token:'fixture-session'}}})},from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:async()=>({data:[],error:null})};return q;}};
      DTGIntegrations.mount({getClient:()=>client,actor:()=>testActor,url:()=> 'https://example.invalid',publishableKey:()=> 'fixture-publishable',isAdmin:()=>true,members:()=>[{id:'actor1',displayName:'Martin'}],providerKeys:()=>[{key:'ops_provider_v1:print:alan',name:'Alan'}]});
    });
    assert.equal(requests.length,0,'no integration requests during startup');
    await page.getByRole('button',{name:'Archivos y correo',exact:true}).click();
    await page.locator('[data-dtgi-form="vendor-send"] [name=file_id] option[value="f1"]').waitFor({state:'attached'});
    const sendForm=page.locator('[data-dtgi-form="vendor-send"]');assert.equal(await sendForm.locator('[name=file_id] option').count(),1);assert.equal(await sendForm.locator('[name=file_id]').inputValue(),'f1');
    await sendForm.getByRole('button',{name:'Send to Vendor',exact:true}).click();
    try{await page.getByText('queued',{exact:false}).first().waitFor({timeout:3000});}catch(e){console.error(requests,await page.locator('[role=dialog]').innerText());throw e;}assert(requests.some(x=>x.action==='sendToVendor'&&x.file_id==='f1'&&x.ticket_id==='t1'));
    await page.getByRole('button',{name:'Consultar resultado'}).click();await page.getByText('sent',{exact:false}).first().waitFor();
    const mailForm=page.locator('[data-dtgi-form="email-send"]');
    await mailForm.locator('[name=to]').fill('client@example.com');await mailForm.locator('[name=subject]').fill('Mi borrador');await mailForm.locator('[name=body]').fill('Conservar este texto');
    await mailForm.getByRole('button',{name:'Enviar correo'}).click();await page.locator('[role=alert]').waitFor();
    assert.equal(await mailForm.locator('[name=body]').inputValue(),'Conservar este texto');
    const firstKey=requests.filter(x=>x.action==='sendEmail').at(-1).idempotency_key;failSend=false;
    await mailForm.getByRole('button',{name:'Enviar correo'}).click();await page.waitForFunction(()=>!document.querySelector('[role=alert]'));
    assert.equal(requests.filter(x=>x.action==='sendEmail').at(-1).idempotency_key,firstKey);
    await page.getByRole('button',{name:'Consultar bandeja'}).click();await page.getByRole('button',{name:'Leer',exact:true}).first().click();
    await page.locator('.dtgi-mail-body').waitFor();assert.match(await page.locator('.dtgi-mail-body').textContent(),/<img src=x/);assert.equal(await page.locator('.dtgi-mail-body img').count(),0);
    await page.getByRole('button',{name:'Responder',exact:true}).click();assert.equal(await mailForm.locator('[name=to]').inputValue(),'client@example.com');assert.equal(await mailForm.locator('[name=subject]').inputValue(),'Pedido');assert.equal(await mailForm.locator('[name=reply_message_id]').inputValue(),'m1');
    await mailForm.locator('[name=body]').fill('Respuesta al cliente');await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.request().postDataJSON().action==='sendEmail'),mailForm.getByRole('button',{name:'Enviar correo'}).click()]);assert.equal(requests.filter(x=>x.action==='sendEmail').at(-1).reply_message_id,'m1');
    await mailForm.locator('[name=body]').fill('Borrador antes de actualizar');hangStatus=true;await page.evaluate(()=>{const timeout=AbortSignal.timeout.bind(AbortSignal);AbortSignal.timeout=()=>timeout(50);});await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.getByText('La conexión tardó demasiado.',{exact:false}).waitFor();assert.equal(await mailForm.locator('[name=body]').inputValue(),'Borrador antes de actualizar');assert.equal(await page.getByRole('button',{name:'Cerrar',exact:true}).isEnabled(),true);hangStatus=false;
    for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no overflow at '+width);}
    if(process.env.DTG_QA_OUTPUTS){await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(process.env.DTG_QA_OUTPUTS,'integraciones-preview.png')});}
    await page.getByRole('button',{name:'Cerrar',exact:true}).click();assert.equal(await page.locator('[role=dialog]').count(),0);
    await page.evaluate(()=>DTGIntegrations.open({customerId:'c1'}));await page.getByRole('button',{name:'Consultar historial',exact:true}).click();await page.getByText('Original producción.pdf',{exact:true}).waitFor();
    await page.evaluate(()=>{testActor='actor2';DTGIntegrations.reset();});assert.equal(await page.locator('[role=dialog]').count(),0);
    assert.deepEqual(errors,[]);console.log('PASS integration UI: lazy loading, only approved versions offered, vendor command, results, preserved retry draft/key, safe email text, client history, session reset, 320–1280 px.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
