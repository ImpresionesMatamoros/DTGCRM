const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
const wa=fs.existsSync(__dirname+'/wa-inbox-qa.cjs')?'wa-inbox-qa.cjs':'CHAT-INBOX-QA.cjs',mobile=fs.existsSync(__dirname+'/mobile-app-qa.cjs')?'mobile-app-qa.cjs':'MOBILE-APP-QA.cjs';
let fixture=fs.readFileSync(__dirname+'/'+wa,'utf8').match(/const fixture=`([\s\S]*?)`;/)[1];fixture=fixture.slice(0,fixture.lastIndexOf('render();'))+fs.readFileSync(__dirname+'/'+mobile,'utf8').match(/fixture=fixture.slice[^`]+`([\s\S]*?)`;/)[1]+`
var realCreateTicket=createTicketCore;createTicketCore=async input=>{window.forwarded=input;return null;};window.rows=[];
sb.from=table=>{var row,q={insert:r=>{row=r;if(table==='tickets')rows.push(r);return q;},select:()=>q,single:async()=>({data:{id:'probe',...row},error:null}),then:resolve=>resolve({error:null})};return q;};
Object.assign(qa,{realCreateTicket,submitTicketQuickCreate});qa.view('tickets');
`;
let html=fs.readFileSync(__dirname+'/index.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,fixture).replace('<script>','<script>'+fs.readFileSync(__dirname+'/ops-menu.js','utf8')+'</script><script>');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());await page.setContent(html);
await page.evaluate(()=>qa.submitTicketQuickCreate({cliente:'Cliente de prueba 0',clienteId:'client0',telefono:''}));assert.equal(await page.evaluate(()=>forwarded.clienteId),'client0');
await page.evaluate(()=>qa.realCreateTicket({cliente:'Nombre anterior',clienteId:'client0'}));assert.equal(await page.evaluate(()=>rows[0].cliente_id),'client0');assert.equal(await page.evaluate(()=>rows[0].cliente),'Cliente de prueba 0');
await page.evaluate(()=>qa.realCreateTicket({cliente:'Cliente nuevo automático'}));assert.equal(await page.evaluate(()=>rows[1].cliente),'Cliente nuevo automático');assert.deepEqual(errors,[]);console.log('PASS: Quick Create forwards explicit client selection, creation uses the selected identity and preserves new names for transactional database resolution.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
