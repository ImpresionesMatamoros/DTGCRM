// Local build, real staging Auth/DB; never navigates to production.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),readline=require('node:readline');const {chromium}=require('playwright');const {config,confirm}=require('./scripts/staging/config.cjs');
if(process.stdin.isTTY)process.stdin.setRawMode(true);const input=readline.createInterface({input:process.stdin,terminal:false});console.log('Ready for hidden laboratory UI password');
input.once('line',async line=>{let browser;try{
 const {password}=JSON.parse(line),c=config();confirm(c);const directory=path.resolve('dist/staging'),results=[];
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],failed=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(c.supabaseUrl+'/rest/')&&r.status()>=400)failed.push({status:r.status(),url:r.url()});});
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===new URL(c.appUrl).origin){const file=path.resolve(directory,u.pathname==='/'?'index.html':decodeURIComponent(u.pathname.slice(1)));if(file.startsWith(directory+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file});return route.abort();}if(u.origin===c.supabaseUrl||u.hostname==='cdn.jsdelivr.net'||u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com')return route.continue();return route.abort();});
  await page.goto(c.appUrl);await page.locator('#login-email-input').fill('admin@example.invalid');await page.locator('#login-password-input').fill(password);await page.locator('.login-submit-btn').click();
  await page.waitForFunction(()=>!document.querySelector('#login-email-input'),{},{timeout:30000});await page.waitForTimeout(1500);
  assert(await page.locator('#dtg-staging-banner').isVisible());assert.equal(await page.evaluate(()=>DTG_STAGING_VALIDATED),true);assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  assert((await page.locator('body').innerText()).includes('Administrador STAGING'));await page.screenshot({path:'staging/ui-live-'+width+'.png',fullPage:true});results.push({width,login:true,errors,failedRequests:failed});await context.close();
 }
 fs.writeFileSync('staging/ui-live-results.json',JSON.stringify({results,testedAt:new Date().toISOString()},null,2));console.log('PASS real staging login, startup queries and banner at390/1280');
 }catch(e){console.error('FAIL '+e.message);process.exitCode=1;}finally{if(browser)await browser.close();input.close();}});
