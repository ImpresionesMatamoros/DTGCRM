const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
const fixture=`
STATE.teamPosts=[{id:'post-1',autor:'Jonathan',authorUserId:'user-1',createdAt:new Date().toISOString(),text:'Revisar el diseño para mañana',pinLevel:'none',ticketId:'ticket-1'}];
STATE.tickets=[{id:'ticket-1',seq:1324,cliente:'Yesenia Sauceda',productos:[{desc:'Camisetas de personal',cantidad:12}],thread:[]}];
STATE.feedReactions=[];STATE.conversations=[];STATE.profiles=[];
UI.feedFilter='todo';UI.astraLaterOpen=false;UI.waChatOpen=true;
render=function(){document.getElementById('app').innerHTML=renderInicioFeed();};
window.qa={UI,render,renderAiBridgePanel,renderAiBridgeMenu,renderAiBridgeFallback,renderAiBridgeSubir,renderAiBridgeBajar,dtgPatchPreviewPopover};
render();
`;
const html=fs.readFileSync(__dirname+'/index.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,fixture);
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.abort());
  await page.setContent(html);
  assert.deepEqual(errors,[]);
  assert.equal(await page.locator('[data-action^="aibridge-"],[data-action="feed-filter"]').count(),0);
  assert.equal(await page.evaluate(()=>qa.UI.feedFilter),'todo');
  assert(await page.getByText('Este mensaje es parte del ticket #1324 · Yesenia Sauceda — 12 Camisetas de personal').count());
  await page.locator('.chat-msg').hover();
  await page.getByRole('button',{name:'Reaccionar',exact:true}).click();
  assert.equal(await page.locator('.chat-react-opt').count(),7);
  await page.getByRole('button',{name:'Opciones del mensaje',exact:true}).click();
  assert.equal(await page.locator('.chat-msg-menu [data-action="chat-react-open"]').count(),0);
  assert.equal(await page.getByRole('menuitem',{name:'Adjuntar a ticket',exact:true}).count(),1);
  assert.equal(await page.getByRole('menuitem',{name:'Vincular a un ticket',exact:true}).count(),0);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{qa.UI.astraLaterOpen=true;qa.render();});
  assert.equal(await page.locator('.astra-utilities').isVisible(),false);

  const react=page.getByRole('button',{name:'Reaccionar',exact:true});
  assert(await react.isVisible());
  await react.click();
  const box=await page.locator('.chat-react-palette').boundingBox();
  assert(box.x>=0 && box.x+box.width<=390);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert(await page.evaluate(()=>['renderAiBridgePanel','renderAiBridgeMenu','renderAiBridgeFallback','renderAiBridgeSubir','renderAiBridgeBajar','dtgPatchPreviewPopover'].every(k=>qa[k]()==='')));
  assert.deepEqual(errors,[]);
  await page.screenshot({path:__dirname+'/chat-mobile.png'});
  console.log('PASS: desktop/mobile, bridge dormido, filtros eliminados, utilidades móviles ocultas, reacción directa y paleta, menú sin duplicados, vínculo de ticket y sin overflow.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
