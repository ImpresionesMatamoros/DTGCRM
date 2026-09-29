const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
let source=[...fs.readFileSync(path.join(__dirname,'index.html'),'utf8').matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/,
'globalThis.astraTests={mentionTokenAt,mentionFilter,astraRefsForText,buildChatTimeline,buildActivityFeed,astraRenderStructuredText,astraRenderConversation,astraThreadCount,claseAlAparecer,aparecidoPaseInicio,aparecidoPaseFin,setState:(x)=>{STATE=x},setUi:(x)=>{UI=x},getState:()=>STATE,getUi:()=>UI,setProfile:(x)=>{CURRENT_PROFILE=x}};');
const document={documentElement:{setAttribute(){}},addEventListener(){},getElementById(){return null},querySelectorAll(){return []},createElement(){return {style:{}}}};
const window={addEventListener(){},location:{search:'',hash:'',href:'http://localhost/'},history:{},innerWidth:1200};
const context={window,document,console,setTimeout,clearTimeout,setInterval(){return 1},clearInterval(){},URL,Date,Math,Intl,localStorage:{getItem(){return null},setItem(){}},navigator:{onLine:true},crypto:require('crypto').webcrypto};
vm.createContext(context);vm.runInContext(source,context,{timeout:3000});
const api=context.astraTests;
const client='11111111-1111-1111-1111-111111111111', ticket='22222222-2222-2222-2222-222222222222', user='33333333-3333-3333-3333-333333333333';
api.setState({tickets:[{id:ticket,seq:1330,cliente:'Angela'}],clientes:[{id:client,empresa:'Angela Top Builders',nombre:'Angela'}],profiles:[{id:user,displayName:'Alexia',active:true}],teamPosts:[],feedReactions:[],meta:{teamNames:[]},conversations:[]});
api.setUi({chatMention:null,chatMentionPicks:[],astraRefPicks:[],astraConversationId:null,astraThreadRoot:null,feedFilter:'posts',astraSearch:''});
assert.equal(api.mentionTokenAt('@Ale',4).query,'Ale');
assert.equal(api.mentionTokenAt('#1330',5).symbol,'#');
assert.equal(api.mentionTokenAt('correo@dominio',13),null);
assert.equal(api.mentionFilter('Ang').some(x=>x.kind==='client'),true);
api.getUi().chatMention={symbol:'#',query:'1330'};
assert.equal(api.mentionFilter('1330')[0].id,ticket);
api.getUi().chatMention=null;
api.getUi().astraRefPicks=[{kind:'client',id:client,label:'Angela Top Builders'},{kind:'ticket',id:ticket,label:'1330'}];
api.getUi().chatMentionPicks=[{id:user,name:'Alexia'}];
let refs=api.astraRefsForText('@Alexia revisa @Angela Top Builders para #1330');
assert.deepEqual(Array.from(refs,r=>r.kind),['user','client','ticket']);
let html=api.astraRenderStructuredText({text:'@Angela Top Builders <script> #1330',refs:[{kind:'client',id:client,label:'Angela Top Builders',start:0,length:20}]});
assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));
api.getState().teamPosts=[{id:'general',conversationId:null,threadRootId:null,text:'equipo',createdAt:new Date().toISOString(),pinLevel:'none'},
{id:'private',conversationId:'private-id',threadRootId:null,text:'secreto',createdAt:new Date().toISOString(),pinLevel:'none'},
{id:'thread',conversationId:null,threadRootId:'general',text:'detalle',createdAt:new Date().toISOString(),pinLevel:'none'}];
assert.equal(api.buildChatTimeline('posts').filter(x=>x.kind==='post').length,1);
assert.equal(api.buildActivityFeed().items.filter(x=>x.kind==='post').length,1);
assert.equal(api.astraThreadCount('general'),1);
assert.equal(api.claseAlAparecer('qa-warning','dq-aparece'),' dq-aparece');
assert.equal(api.claseAlAparecer('qa-warning','dq-aparece'),'');
api.aparecidoPaseInicio();
api.aparecidoPaseFin();
assert.equal(api.claseAlAparecer('qa-warning','dq-aparece'),' dq-aparece');
console.log('PASS @/#, referencias estructuradas, escape HTML, aislamiento visual del feed, hilo, animación por aparición');
