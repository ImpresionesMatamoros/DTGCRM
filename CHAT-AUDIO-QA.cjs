const fs=require('fs'),assert=require('assert'),http=require('http'),{chromium}=require('playwright');
const fixture=`
AUTH_STATUS='signed_in';AUTH_SESSION={user:{id:'martin'}};CURRENT_PROFILE={id:'martin',display_name:'Martin',active:true};
ASTRA_CONVERSATIONS_AVAILABLE=true;TICKET_CHAT_AVAILABLE=true;UI.waChatOpen=true;UI.astraConversationId='dm';
STATE.profiles=[{id:'martin',displayName:'Martin',active:true},{id:'ceci',displayName:'Ceci',active:true}];STATE.conversations=[{id:'dm',kind:'direct',member_a:'ceci',member_b:'martin'}];STATE.teamPosts=[];STATE.feedReactions=[];STATE.tickets=[];STATE.clientes=[];STATE.chatReadState=[];STATE.meta.teamNames=[];
var audioWrites=[],audioUploads=[];
sb={rpc:async()=>({data:[],error:null}),from:table=>({insert:row=>({select:()=>({single:async()=>{audioWrites.push(row);return {data:Object.assign({id:'audio-'+audioWrites.length,created_at:new Date().toISOString()},row),error:null};}})})}),storage:{from:bucket=>({upload:async(path,blob,opts)=>{audioUploads.push({bucket,path,size:blob.size,mime:opts.contentType});return {error:null};},remove:async()=>({error:null}),createSignedUrl:async()=>({data:{signedUrl:''},error:null})})}};
refreshFromServer=async()=>{};astraRequestTranscript=async()=>{};
window.qa={UI,STATE,writes:audioWrites,uploads:audioUploads,syncDeepLinkUrl,resolveChatNotificationDeepLink,resolveDeepLinkIfNeeded,setDeepLinkFlags:()=>{deepLinkResolved=false;chatNotificationDeepLinkResolved=false;},spyOpenTicket:()=>openTicketById=id=>qa.openedTicket=id};render();
`;
let html=fs.readFileSync(__dirname+'/index.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,fixture);
html=html.replace('<script>','<script>'+fs.readFileSync(__dirname+'/ops-menu.js','utf8')+'</script><script>');
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port,browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort());await page.goto('http://127.0.0.1:'+port);
  await page.getByRole('button',{name:'Grabar mensaje de voz',exact:true}).click();await page.waitForSelector('#tk-rec-wave');await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>qa.UI.astraRecording),true);
  await page.getByRole('button',{name:'Pausar grabación',exact:true}).click();const paused=await page.locator('#tk-rec-time').textContent();await page.waitForTimeout(1200);assert.equal(await page.locator('#tk-rec-time').textContent(),paused);
  await page.getByRole('button',{name:'Continuar grabación',exact:true}).click();await page.waitForTimeout(1100);await page.screenshot({path:__dirname+'/wa-recording-mobile.png'});
  await page.getByRole('button',{name:'Enviar audio',exact:true}).click();await page.waitForFunction(()=>qa.writes.length===1);assert.equal(await page.evaluate(()=>qa.writes[0].conversation_id),'dm');assert((await page.evaluate(()=>qa.uploads[0].size))>0);assert((await page.evaluate(()=>qa.writes[0].audio_seconds))<=4);
  await page.waitForSelector('#composer-mic');await page.getByRole('button',{name:'Grabar mensaje de voz',exact:true}).click();await page.waitForSelector('#tk-rec-wave');await page.getByRole('button',{name:'Descartar audio',exact:true}).click();await page.waitForFunction(()=>!qa.UI.astraRecording);assert.equal(await page.evaluate(()=>qa.writes.length),1);assert.deepEqual(errors,[]);
  await page.evaluate(()=>{qa.setDeepLinkFlags();history.replaceState(null,'','?chat_post=audio-1');qa.syncDeepLinkUrl(null);});assert(page.url().includes('chat_post=audio-1'));await page.evaluate(()=>qa.resolveChatNotificationDeepLink());await page.waitForTimeout(220);assert.equal(await page.evaluate(()=>qa.UI.astraConversationId),'dm');assert(await page.locator('.wa-conversation-header').isVisible());
  await page.evaluate(()=>{qa.setDeepLinkFlags();qa.STATE.tickets=[{id:'ticket-link'}];qa.spyOpenTicket();history.replaceState(null,'','?t=ticket-link');qa.syncDeepLinkUrl(null);});assert(page.url().includes('t=ticket-link'));await page.evaluate(()=>qa.resolveDeepLinkIfNeeded());assert.equal(await page.evaluate(()=>qa.openedTicket),'ticket-link');
  console.log('PASS: actual Chromium MediaRecorder via synthetic microphone; one-click start, waveform, timer, pause/resume excluding paused duration, persisted send in DM, cancel without upload. No external network or real microphone used.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
