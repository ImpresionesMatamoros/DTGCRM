const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
const fixture=`
AUTH_SESSION={user:{id:'qa'}};CURRENT_PROFILE={id:'qa',display_name:'QA',active:true};AUTH_STATUS='signed_in';
window.reads=[];window.accessRows=[];window.ticketRows=[{id:'t1',seq:1,created_at:'2026-10-01',visibility:'team'}];window.signCalls=0;window.failSign=false;window.receiptCalls=[];
selectAll=async function(table){reads.push(table);await new Promise(r=>setTimeout(r,5));return table==='ticket_access'?accessRows.slice():table==='tickets'?ticketRows.slice():[];};
sb={from:function(table){var q={select(){return q;},eq(){return q;},maybeSingle(){return q;},then(resolve,reject){reads.push(table);return Promise.resolve({data:table==='chat_user_state'?null:[],error:null}).then(resolve,reject);}};return q;},
rpc:async function(name,args){receiptCalls.push(args.p_post_ids);return {data:[],error:null};},
storage:{from:function(){return {createSignedUrl:async function(){signCalls++;await new Promise(r=>setTimeout(r,20));return failSign?{error:Error('fixture failure')}:{data:{signedUrl:'https://example.invalid/image?v='+signCalls},error:null};}};}}};
window.qa={load:fetchAllState,read:dtgStateRead,url:cachedStorageUrl,receipts:chatRefreshReceipts,invalidate:chatReceiptInvalidated,merge:dtgMergeRefresh,eventOptions:dtgRealtimeRefreshOptions,
setPosts:function(posts){STATE.teamPosts=posts;},setScope:function(scope){UI.astraConversationId=scope;},
expire:function(){signedUrlExpires={};},reset:function(){AUTH_EPOCH++;signedUrlCache={};signedUrlPending={};signedUrlExpires={};},
receiptReset:function(){CHAT_RECEIPTS_LAST=0;CHAT_RECEIPTS_SCOPE=null;},cache:function(){return DTG_STATE_CACHE;}};
`;
let html=fs.readFileSync(__dirname+'/index.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,fixture);
html=html.replace('<script>','<script>'+fs.readFileSync(__dirname+'/ops-menu.js','utf8')+'</script><script>');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());await page.setContent(html);
  const initial=await page.evaluate(async()=>{await qa.load();return reads.length;});assert.equal(initial,21);
  const ticketEvents=await page.evaluate(()=>[
    qa.eventOptions('tickets',{eventType:'UPDATE',new:{id:'t1',visibility:'team'}}),
    qa.eventOptions('tickets',{eventType:'UPDATE',new:{id:'t1',visibility:'private'}}),
    qa.eventOptions('tickets',{eventType:'DELETE',old:{id:'t1'}}),
    qa.eventOptions('tickets',{eventType:'INSERT',new:{id:'t2',visibility:'team'}}),
    qa.eventOptions('tickets',{eventType:'UPDATE',new:{id:'t1'}})
  ]);assert.deepEqual(ticketEvents[0].tables,['tickets']);ticketEvents.slice(1).forEach(x=>assert.equal(x.tables,undefined));
  const targeted=await page.evaluate(async()=>{reads=[];await qa.load({tables:['team_posts']});return reads;});
  assert.equal(targeted.length,8);assert(targeted.includes('team_posts'));assert(!targeted.includes('bitacora'));assert(!targeted.includes('productos'));
  const notes=await page.evaluate(async()=>{reads=[];await qa.load({tables:['client_notes']});return reads;});assert(notes.includes('client_notes'));assert(!notes.includes('client_tasks'));
  const permissions=await page.evaluate(async()=>{reads=[];accessRows=[{ticket_id:'t1',profile_id:'qa'}];await qa.load({tables:['team_posts']});return reads;});assert(permissions.includes('tickets'));assert(permissions.includes('bitacora'));
  const hiddenTicket=await page.evaluate(async()=>{reads=[];ticketRows=[];var state=await qa.load({tables:['team_posts']});return {reads,tickets:state.tickets};});assert.equal(hiddenTicket.tickets.length,0);assert(hiddenTicket.reads.includes('bitacora'));
  const merge=await page.evaluate(()=>[qa.merge({background:true,tables:['team_posts']},{background:true,tables:['feed_reactions']}),qa.merge({background:true,tables:['team_posts']},{background:false})]);
  assert.deepEqual(merge[0].tables,['team_posts','feed_reactions']);assert.equal(merge[1].tables,undefined);assert.equal(merge[1].background,false);
  assert.equal(await page.evaluate(async()=>{reads=[];qa.reset();await qa.load({tables:['team_posts']});return reads.length;}),21);
  const signing=await page.evaluate(async()=>{signCalls=0;await Promise.all(Array.from({length:30},()=>qa.url('profile-avatars','same.jpg')));await qa.url('profile-avatars','same.jpg');return signCalls;});assert.equal(signing,1);
  assert.equal(await page.evaluate(async()=>{qa.expire();await qa.url('profile-avatars','same.jpg');return signCalls;}),2);
  assert.equal(await page.evaluate(async()=>{failSign=true;await qa.url('profile-avatars','retry.jpg').catch(()=>{});failSign=false;return !!await qa.url('profile-avatars','retry.jpg');}),true);
  assert.equal(await page.evaluate(async()=>{var pending=qa.url('profile-avatars','old-session.jpg');qa.reset();return await pending;}),null);
  const closed=await page.evaluate(async()=>{qa.setPosts([{id:'visible',conversationId:null},{id:'old',conversationId:null}]);document.getElementById('app').innerHTML='';await qa.receipts(true);return receiptCalls.length;});assert.equal(closed,0);
  const receipts=await page.evaluate(async()=>{document.getElementById('app').innerHTML='<div id="chat-scroll"><small data-chat-seen="visible"></small></div>';await qa.receipts();await qa.receipts();return receiptCalls;});assert.deepEqual(receipts,[['visible']]);
  assert.equal(await page.evaluate(async()=>{qa.setScope('dm');qa.setPosts([{id:'dm-post',conversationId:'dm'}]);document.querySelector('[data-chat-seen]').setAttribute('data-chat-seen','dm-post');await qa.receipts();return receiptCalls.length;}),2);
  await page.evaluate(()=>{qa.receiptReset();for(var i=0;i<20;i++)qa.invalidate();});await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>receiptCalls.length),3);
  assert.deepEqual(errors,[]);
  console.log('PASS: startup 21 reads; targeted chat refresh 8 reads (62% fewer); client notes refresh; access changes force reconciliation; queued refresh union/full priority; session isolation; 30 simultaneous avatars sign once; expiry, failed signing retry and stale session response; closed chat zero RPCs; rendered posts only; throttle, scope change and receipt event coalescing.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
