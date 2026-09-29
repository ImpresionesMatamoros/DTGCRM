/* DTG operational vocabulary v1. Both indexes are projections of recipes.
   IDs are immutable; saved titles/metadata are snapshots, never recomputed. */
(function(root){
'use strict';
const actions={quote:['Cotizar','planeacion'],buy:['Comprar','planeacion'],design:['Diseñar','planeacion'],order:['Ordenar','planeacion'],send_print:['Enviar a imprimir','planeacion'],print:['Imprimir','produccion'],cut:['Cortar','produccion'],install:['Instalar','produccion'],apply:['Aplicar','produccion'],stamp:['Estampar','produccion'],gang:['Preparar gang sheet','planeacion'],finish:['Dar acabados','produccion'],weed:['Depilar','produccion'],deliver:['Entregar','planeacion'],pack:['Empaquetar','produccion']};
const categories={garments:'Prendas',supplies:'Materiales e insumos',vinyl:'Vinil',cups:'Vasos y tazas',displays:'Displays',stickers:'Stickers',dtf:'DTF',banner:'Lona',cards:'Tarjetas',parcel:'Paquetería',general:'Sin producto específico'};
const providers={garments:['Mi Playera/Vlank','Yazbek','Forprint','S&S Activewear'],online:['Mercado Libre','Amazon','Calzaevento','Grupo Janna','Alibaba'],local:['CARBAJAL','ML Publicidad','Nenas Giftshop','Noreste (Jesús Romero)','Casa de Insumos','Plásticos de Matamoros'],print:['Alan','Impresos del Noreste','ML Publicidad','Togar'],cups:['Grupo Janna','Plásticos de Matamoros','Casa de Insumos'],displays:['Mercado Libre'],parcel:['USPS'],dtf:[],banner:[],cards:[]};
// A recipe is the only place where category/action/title/provider contexts meet.
const recipes=[];
function recipe(category,action,title,groups,variants){ recipes.push({id:action+'.'+category,category,action,title,groups:groups||[],variants:variants||[]}); }
recipe('garments','buy','Comprar prendas',['garments']);
recipe('supplies','buy','Comprar materiales e insumos',['online','local']);
recipe('vinyl','send_print','Enviar vinil a imprimir',['print']); recipe('vinyl','cut','Cortar vinil'); recipe('vinyl','install','Instalar vinil',[ ],[{id:'coroplast',label:'Sobre coroplast',title:'Instalar vinil sobre coroplast'}]);
recipe('cups','buy','Comprar vasos y tazas',['cups']); recipe('cups','design','Diseñar vasos y tazas'); recipe('cups','order','Ordenar DTF para vasos y tazas',['dtf']); recipe('cups','apply','Aplicar DTF en vasos y tazas');
recipe('displays','order','Ordenar displays',['displays']);
recipe('stickers','order','Ordenar impresión de stickers',['print']); recipe('stickers','weed','Depilar stickers'); recipe('stickers','deliver','Entregar stickers');
recipe('dtf','design','Diseñar DTF'); recipe('dtf','gang','Preparar gang sheet de DTF'); recipe('dtf','send_print','Enviar DTF a imprimir',['dtf']); recipe('dtf','cut','Cortar transfers DTF'); recipe('dtf','stamp','Estampar DTF',[],[{id:'shirts',label:'Camisas',title:'Estampar DTF en camisas'}]);
['banner','cards'].forEach(c=>{ const noun=c==='banner'?'lona':'tarjetas'; ['design','order','print','cut','finish'].forEach(a=>recipe(c,a,({design:'Diseñar ',order:'Ordenar impresión de ',print:'Imprimir ',cut:'Cortar ',finish:'Dar acabados a '})[a]+noun,a==='order'?[c]:[])); });
recipe('parcel','deliver','Entregar por paquetería',['parcel']);
// Cotizar is complete on its own, and also reachable from every product.
Object.keys(categories).filter(c=>c!=='parcel'&&c!=='general').forEach(c=>recipe(c,'quote','Cotizar '+categories[c].toLocaleLowerCase('es')));
Object.keys(actions).forEach(a=>recipe('general',a,actions[a][0]));
const groupLabels={garments:'Proveedores de prendas',online:'En línea',local:'Locales',print:'Proveedores de impresión',cups:'Proveedores de vasos y tazas',displays:'Proveedores de displays',parcel:'Paqueterías',dtf:'Proveedores DTF',banner:'Proveedores de lona',cards:'Proveedores de tarjetas'};
function norm(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();}
function providerId(name){return encodeURIComponent(norm(name));}
function providerList(group,custom){ const list=(providers[group]||[]).map(name=>({id:providerId(name),name})); (custom||[]).filter(p=>p.group===group).forEach(p=>{if(!list.some(x=>x.id===p.id))list.push(p);});return list; }
function resolve(s){
 const a=actions[s.action]; if(!a)return null;
 const r=s.category?recipes.find(r=>r.category===s.category&&r.action===s.action):null;
 if(s.category&&!r)return null;
 let title=r?r.title:a[0];
 if(s.variant){const v=r&&r.variants.find(v=>v.id===s.variant);if(!v)return null;title=v.title;}
 if(s.provider){title=s.category==='parcel'?'Entregar por '+s.provider.name:title+(s.category==='garments'||s.category==='displays'?' en ':' con ')+s.provider.name;}
 return {code:r?r.id:s.action,title,area:a[1],selection:JSON.parse(JSON.stringify(s))};
}
function node(label,selection,children){return {label,selection,children:children||[]};}
function tails(r,s,custom){
 if(r.variants.length)return r.variants.map(v=>node(v.label,{...s,variant:v.id}));
 function group(g){return providerList(g,custom).map(p=>node(p.name,{...s,provider:{id:p.id,name:p.name,group:g}})).concat([{label:'+ Agregar nombre…',addGroup:g,selection:s,children:[]}]);}
 if(r.groups.length===1)return group(r.groups[0]);
 return r.groups.map(g=>node(groupLabels[g],{...s,group:g},group(g)));
}
function tree(mode,custom){
 function branch(r){const s={action:r.action,category:r.category};return node(mode==='action'?categories[r.category]:actions[r.action][0],s,tails(r,s,custom));}
 return Object.keys(mode==='action'?actions:categories).map(id=>node(mode==='action'?actions[id][0]:categories[id],mode==='action'?{action:id}:{category:id},recipes.filter(r=>r[mode==='action'?'action':'category']===id).map(branch)));
}
function meta(task){try{const m=JSON.parse(task.actionPath||'');return m.v===1?m:{};}catch(_){return {};}}
function blocked(task,ticket){const id=meta(task).dependsOn;return !!id&&!(ticket.tareas||[]).some(t=>t.id===id&&t.estado==='terminado');}
root.DTGOps={actions,categories,recipes,providers,groupLabels,norm,providerId,providerList,resolve,tree,meta,blocked};
if(typeof module!=='undefined')module.exports=root.DTGOps;
})(typeof window!=='undefined'?window:globalThis);
