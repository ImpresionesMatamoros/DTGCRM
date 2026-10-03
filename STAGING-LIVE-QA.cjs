// Real remote acceptance: only the explicitly confirmed staging project is allowed.
const fs=require('node:fs'),assert=require('node:assert/strict'),readline=require('node:readline');
const {config,confirm}=require('./scripts/staging/config.cjs');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
const input=readline.createInterface({input:process.stdin,terminal:false});console.log('Ready for hidden laboratory QA credentials');
input.once('line',async line=>{try{
 const secrets=JSON.parse(line),c=config();confirm(c);const results=[];
 async function request(path,{method='GET',body,jwt,key=c.supabasePublishableKey}={}){const r=await fetch(c.supabaseUrl+path,{method,headers:{apikey:key,...jwt?{Authorization:'Bearer '+jwt}:{},'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});let data;try{data=await r.json();}catch{data=null;}return {status:r.status,data};}
 const auth=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:'admin@example.invalid',password:secrets.password}});assert.equal(auth.status,200,'Test login');const jwt=auth.data.access_token;results.push('Test account password login');
 const active=await request('/rest/v1/rpc/is_active_member',{method:'POST',body:{},jwt});assert.equal(active.data,true);results.push('Active-member RLS authorization');
 const phase=process.env.STAGING_LIVE_PHASE;
 if(phase==='revision'){
  const report=JSON.parse(fs.readFileSync('staging/live-test-results.json','utf8'));
  const price=await request('/functions/v1/product-engine-proxy',{method:'POST',body:{op:'price',request:report.priceRequest},jwt});assert.equal(price.status,200);assert.equal(price.data.total.amount,process.env.STAGING_EXPECTED_MASTER||'46.00');
  const rows=await request('/rest/v1/productos?id=in.('+report.savedLineIds.join(',')+')&select=precio,cantidad,pe_total_amount',{jwt});assert.equal(rows.status,200);assert(rows.data.every(r=>Number(r.pe_total_amount)===45));assert.deepEqual(rows.data.map(r=>Math.round(Number(r.precio)*Number(r.cantidad))).sort((a,b)=>a-b),[40,45,50]);
  report.results.push('Later PE price revision '+price.data.total.amount+' leaves historical snapshots45 and sold totals45/40/50 unchanged');fs.writeFileSync('staging/live-test-results.json',JSON.stringify(report,null,2));console.log('PASS '+report.results.at(-1));return;
 }
 if(phase==='outage'){
  const health=await request('/functions/v1/product-engine-proxy',{method:'POST',body:{op:'health'},jwt});assert.equal(health.status,503,'Actual PE endpoint must be unavailable during this phase');
  const ticketId=crypto.randomUUID(),lineId=crypto.randomUUID();
  const ticket=await request('/rest/v1/tickets',{method:'POST',body:{id:ticketId,cliente:'CLIENTE FICTICIO — STAGING',cliente_id:'10000000-0000-4000-8000-000000000001',responsable:''},jwt});assert.equal(ticket.status,201,JSON.stringify(ticket.data));
  const manual=await request('/rest/v1/productos',{method:'POST',body:{id:lineId,ticket_id:ticketId,descripcion:'STAGING manual durante caída real PE',cantidad:1,precio:25},jwt});assert.equal(manual.status,201,JSON.stringify(manual.data));
  const report=JSON.parse(fs.readFileSync('staging/live-test-results.json','utf8'));report.results.push('Actual deployed PE outage: CRM saved a new ticket and manual product');report.manualOutageTicketId=ticketId;fs.writeFileSync('staging/live-test-results.json',JSON.stringify(report,null,2));console.log('PASS '+report.results.at(-1));return;
 }
 const anonymous=await request('/functions/v1/product-engine/api/v1/catalog/items');assert.equal(anonymous.status,401);results.push('PE rejects missing server bearer');
 const forbidden=await request('/rest/v1/rpc/staging_engine_runtime_config',{method:'POST',body:{},jwt});assert(forbidden.status>=400);results.push('Runtime secrets RPC denied to authenticated users');
 const forbiddenSchema=await request('/rest/v1/catalog_item?select=id',{jwt});assert(forbiddenSchema.status>=400);results.push('PE catalog not exposed through CRM Data API');
 const proxy=async body=>request('/functions/v1/product-engine-proxy',{method:'POST',body,jwt});
 const health=await proxy({op:'health'});assert.equal(health.status,200,JSON.stringify(health.data));results.push('Authenticated CRM → proxy → PE health');
 const search=await proxy({op:'search',q:'flyers',market:'USA',limit:20});assert.equal(search.status,200,JSON.stringify(search.data));assert(search.data.items.length);results.push('Live catalog search');
 const item=search.data.items.find(i=>i.public_code==='DTG-00003');assert(item);
 const ask={catalog_item_id:item.id,market:'USA',quantity:250,selections:[{option_key:'caras',value_codes:['1']},{option_key:'papel',value_codes:['Bond']},{option_key:'tamano_papel',value_codes:['Media carta']}]};
 const priced=await proxy({op:'price',request:ask});assert.equal(priced.status,200,JSON.stringify(priced.data));assert.equal(priced.data.status,'RESOLVED');assert.equal(priced.data.total.amount,'45.00');results.push('Original authorized Flyers configuration resolves USD45');
 const vm=require('node:vm'),source=fs.readFileSync('index.html','utf8'),sandbox={};vm.createContext(sandbox);vm.runInContext(source.slice(source.indexOf('function peRowColumns('),source.indexOf('function peFromRow(')),sandbox);
 const snapshot=sandbox.peRowColumns({itemId:item.id,code:item.public_code,name:item.canonical_name,desc:'STAGING acceptance',config:{request:ask,selections:ask.selections,contract_version:'1'},quantity:250,market:'USA',status:priced.data.status,total:priced.data.total.amount,currency:priced.data.total.currency,catalogRevision:priced.data.catalog_revision,pricingRevision:priced.data.pricing_revision,effectiveAt:priced.data.effective_at,reason:null,contractVersion:'1',pricedAt:new Date().toISOString()});
 const saved=[];for(const sold of [45,40,50]){const row={id:crypto.randomUUID(),ticket_id:'20000000-0000-4000-8000-000000000001',descripcion:'STAGING venta '+sold,cantidad:250,precio:sold/250,...snapshot};const r=await request('/rest/v1/productos',{method:'POST',body:row,jwt});assert.equal(r.status,201,JSON.stringify(r.data));saved.push(row.id);}
 const reload=await request('/rest/v1/productos?id=in.('+saved.join(',')+')&select=id,precio,cantidad,pe_total_amount,pe_configuration_snapshot',{jwt});assert.equal(reload.status,200);assert.equal(reload.data.length,3);assert.deepEqual(reload.data.map(r=>Math.round(Number(r.precio)*Number(r.cantidad))).sort((a,b)=>a-b),[40,45,50]);assert(reload.data.every(r=>Number(r.pe_total_amount)===45));results.push('Sold totals45/40/50 survive reload; every master snapshot remains45');
 const unchanged=await proxy({op:'price',request:ask});assert.equal(unchanged.data.total.amount,'45.00');results.push('CRM sale edits leave PE master intact');
 const forbiddenWrite=await request('/rest/v1/productos?id=eq.'+saved[0],{method:'PATCH',body:{pe_total_amount:999},jwt});assert(forbiddenWrite.status>=400);results.push('Snapshot rewrite blocked by database trigger');
 const quoted=await proxy({op:'price',request:{catalog_item_id:item.id,market:'USA',quantity:251,selections:ask.selections}});assert.equal(quoted.status,200);assert.equal(quoted.data.status,'QUOTE_ONLY');assert.equal(quoted.data.total,undefined);results.push('Unpriced exact quantity returns QUOTE_ONLY without inventing total');
 const quoteRow={id:crypto.randomUUID(),ticket_id:'20000000-0000-4000-8000-000000000001',descripcion:'STAGING QUOTE_ONLY provisional',cantidad:251,precio:60/251,...snapshot,pe_quantity:251,pe_configuration_snapshot:{request:{...ask,quantity:251},selections:ask.selections,contract_version:'1'},pe_pricing_status_snapshot:'QUOTE_ONLY',pe_total_amount:null,pe_currency:null,pe_reason_code:quoted.data.reason_code,pe_effective_at:quoted.data.effective_at};
 const quotedSave=await request('/rest/v1/productos',{method:'POST',body:quoteRow,jwt});assert.equal(quotedSave.status,201,JSON.stringify(quotedSave.data));results.push('QUOTE_ONLY accepts manual provisional sale with null master total');
 fs.writeFileSync('staging/live-test-results.json',JSON.stringify({projectRef:c.crmProjectRef,results,savedLineIds:saved,quoteLineId:quoteRow.id,priceRequest:ask,originalPrice:'45.00',testedAt:new Date().toISOString()},null,2));
 console.log('PASS '+results.join('; '));
 }catch(e){console.error('FAIL '+e.message);process.exitCode=1;}finally{input.close();}});
