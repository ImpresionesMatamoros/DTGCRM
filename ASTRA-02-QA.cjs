const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
let source=[...fs.readFileSync(path.join(__dirname,'index.html'),'utf8').matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,
'globalThis.qa={renderKanbanClienteCell,renderWorkOrdersPanel,kdsCantidad,kdsPrioridad,setState:(x)=>{STATE=x}};');
const document={documentElement:{setAttribute(){}},addEventListener(){},getElementById(){return null},querySelectorAll(){return []},createElement(){return {style:{}}}};
const window={addEventListener(){},location:{search:'',hash:'',href:'http://localhost/'},history:{},innerWidth:1200};
const ctx={window,document,console,setTimeout,clearTimeout,setInterval(){return 1},clearInterval(){},URL,Date,Math,Intl,localStorage:{getItem(){return null},setItem(){}},navigator:{onLine:true},crypto:require('crypto').webcrypto};
ctx.DTGOps=require('./ops-menu.js');vm.createContext(ctx);vm.runInContext(source,ctx,{timeout:3000});
const q=ctx.qa;
const ticket={id:'ticket-1',seq:1330,cliente:'Angela',clienteId:null,productos:[{id:'p1',desc:'Playeras negras DTF',cantidad:24},{id:'p2',desc:'Gorras',cantidad:6}],tareas:[],workOrders:[{id:'o1',title:'24 playeras',productId:'p1',instructions:'Arte aprobado'}]};
q.setState({tickets:[ticket],clientes:[],meta:{},profiles:[],workOrdersTableMissing:false});
const card=q.renderKanbanClienteCell(ticket);
assert(card.includes('data-action="open-ticket"'));
assert(card.includes('data-action="details-cell-inline"'));
assert(q.renderWorkOrdersPanel(ticket).includes('24 playeras'));
assert.equal(q.kdsCantidad({t:ticket,task:{workOrderId:'o1'}}),'24 PLAYERAS NEGRAS DTF');
assert.equal(q.kdsCantidad({t:ticket,task:{workOrderId:null}}),'');
console.log('PASS ticket desde título, orden y cantidad KDS sin primer producto arbitrario');
