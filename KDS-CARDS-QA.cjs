const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright');
const setup=`
window.qa={UI,STATE:()=>STATE,kdsFit,draw:()=>render()};
STATE={tickets:[],clientes:[],profiles:[],meta:{opsProviders:[]}};AUTH_STATUS='signed_in';
sb={rpc:async()=>({data:true,error:null}),from:()=>({insert:async()=>({error:null}),update:()=>({eq:()=>Object.assign(Promise.resolve({error:null}),{select:async()=>({data:[],error:null})})})})};
refreshFromServer=async()=>{};showToast=()=>{};userError=()=>{};adminNote=()=>{};
render=function(){document.getElementById('app').innerHTML=renderKdsView();kdsFit();};
`;
let html=fs.readFileSync(__dirname+'/index.html','utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,setup);
html=html.replace('<script>','<script>'+fs.readFileSync(__dirname+'/ops-menu.js','utf8')+'</script><script>');
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());await page.setContent(html);
 assert.deepEqual(errors,[]);
 await page.evaluate(()=>{
  const day=n=>{const d=new Date();d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
  const ago=n=>new Date(Date.now()-n*86400000).toISOString();
  const mk=(seq,cli,desc,resp,atender,comp,creado,extra)=>({id:'t'+seq,seq,cliente:cli,estado:'abierto',productos:[{id:'p'+seq,desc:'PRODUCTO/SERVICIO',cantidad:1}],markers:[],thread:(extra&&extra.notas||[]).map((x,i)=>({id:'n'+seq+i,type:'nota',text:x})),fechaCompromiso:comp,tareas:[{id:'k'+seq,desc,estado:'pendiente',tipo:'produccion',area:'planeacion',tipoOperacion:'',actionPath:'',dependsOn:null,responsable:resp,fechaAtencion:atender,createdAt:ago(creado)}]});
  const S=qa.STATE();
  S.tickets=[
   mk(1316,'GRICELDA','CONTACTAR CLIENTE','JONATHAN',day(-13),day(-12),0,{notas:['Quiere cambiar el color']}),
   mk(1330,'ANGELA TORRES','COMPRAR MATERIALES EN LINEA PARA ENTREGA','JONATHAN',day(-11),day(-8),13,{notas:['a','b']}),
   mk(1390,'CLIENTE BUENOS AIRES','CONSEGUIR APROBACION','TANIA',null,day(-2),0),
   mk(1270,'VALE DESKONTROL','ORDENAR EN LINEA','JONATHAN',day(-7),day(3),1),
   mk(1373,'ADVENT','ORDENAR A MONTERREY','JONATHAN',null,null,0),
   mk(1388,'FLOWERS AND CO','CONTACTAR CLIENTE','JONATHAN',null,null,1),
   mk(1388.5,'FLOWERS AND CO','REALIZAR DISENO','MARTIN',null,null,1),
   mk(1309,'PEDRO COSMOS','ESTAMPAR','TANIA',null,day(0),0)
  ];
  S.tickets[1].tareas[0].desc='COMPRAR MATERIALES EN LINEA PARA ENTREGA';
  qa.UI.displayMode='produccion';qa.UI.kds.ready=true;qa.UI.kds.board='planeacion';qa.UI.kds.density=8;
  qa.draw();
 });
 const info=await page.evaluate(()=>[...document.querySelectorAll('.kds-card:not(.kds-card-empty)')].map(c=>{const b=c.querySelector('.kds-body'),a=c.querySelector('.kds-accion');return{accion:a.textContent,clipped:b.scrollHeight>b.clientHeight+1,estado:(c.querySelector('.kds-estado')||{}).textContent||'',fechas:[...c.querySelectorAll('.kds-fechas > div')].map(x=>x.textContent),sin:(c.querySelector('.kds-sinfecha')||{}).textContent||'',cant:(c.querySelector('.kds-cant')||{}).textContent||'',foot:c.querySelector('.kds-foot').textContent};}));
 console.log(JSON.stringify(info,null,1));
 await page.screenshot({path:process.env.SHOT||'/tmp/kds-cards.png'});
 assert(info.length>=7,'tarjetas '+info.length);
 info.forEach(i=>assert(!i.clipped,'texto cortado: '+i.accion));
 assert(info.every(i=>i.estado!=='ENTREGA VENCIDA'&&i.estado!=='ACCIÓN VENCIDA'&&i.estado!=='PENDIENTE'));
 assert(!info.some(i=>/PRODUCTO\/SERVICIO/.test(i.cant)));
 assert(info.some(i=>i.estado==='VENCIDA'));
 assert(info.some(i=>/D TARDE/.test(i.fechas.join())));
 assert(info.some(i=>i.sin==='SIN FECHA'));
 assert(!info.some(i=>/\d\d-[A-Z]{3}/.test(i.fechas.join())));
 console.log('PASS KDS tarjetas: etiquetas cortas, fechas relativas, sin texto cortado');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
