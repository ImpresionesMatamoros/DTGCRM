const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {validate}=require('../../staging/policy.js');
const root=path.resolve(__dirname,'../..');
function build(config,destination=path.join(root,'dist/staging')){
  config=validate(config);
  const output=path.resolve(destination);
  if(!output.startsWith(path.join(root,'dist')+path.sep))throw Error('Output must stay within repository dist directory');
  if(fs.existsSync(output))fs.rmSync(output,{recursive:true,force:true});
  fs.mkdirSync(output,{recursive:true});
  const files=['index.html','mobile-viewport.js','mobile-ux.css','ticket-ux.css','ops-menu.js','ops-menu.css','manifest.webmanifest','environment.js'];
  for(const f of files)fs.copyFileSync(path.join(root,f),path.join(output,f));
  for(const d of ['assets','icons'])fs.cpSync(path.join(root,d),path.join(output,d),{recursive:true});
  fs.mkdirSync(path.join(output,'staging'));for(const f of ['policy.js','guard.js'])fs.copyFileSync(path.join(root,'staging',f),path.join(output,'staging',f));
  fs.writeFileSync(path.join(output,'environment.js'),'window.DTG_ENV = Object.freeze('+JSON.stringify(config)+');\n');
  fs.writeFileSync(path.join(output,'sw.js'),'"use strict";self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",e=>e.waitUntil(self.registration.unregister()));\n');
  let manifest=JSON.parse(fs.readFileSync(path.join(output,'manifest.webmanifest'),'utf8'));manifest.name='DTG CRM — STAGING';manifest.short_name='DTG TEST';fs.writeFileSync(path.join(output,'manifest.webmanifest'),JSON.stringify(manifest,null,2));
  const html=fs.readFileSync(path.join(output,'index.html'),'utf8');
  if(html.includes('sb_publishable_PlY_')||html.includes('var SUPABASE_URL = "https://jpj'))throw Error('Production configuration leaked');
  const sb=new URL(config.supabaseUrl),csp="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: "+sb.origin+"; media-src 'self' blob: "+sb.origin+"; connect-src 'self' "+sb.origin+' wss://'+sb.hostname+"; object-src 'none'; base-uri 'self'; form-action 'self'";
  fs.writeFileSync(path.join(output,'index.html'),html.replace('<head>','<head>\n<meta http-equiv="Content-Security-Policy" content="'+csp+'">'));
  fs.writeFileSync(path.join(output,'_headers'),'/*\n  Content-Security-Policy: '+csp+'\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  Permissions-Policy: payment=()\n  Cache-Control: no-store\n');
  const entry=fs.readFileSync(path.join(output,'index.html'));fs.writeFileSync(path.join(output,'build-manifest.json'),JSON.stringify({environment:'staging',crmProjectRef:config.crmProjectRef,peProjectRef:config.peProjectRef,indexSha256:crypto.createHash('sha256').update(entry).digest('hex'),externalEffects:config.externalEffects},null,2));
  return output;
}
if(require.main===module){try{const file=process.argv[2]||process.env.STAGING_CONFIG_FILE;if(!file)throw Error('STAGING_CONFIG_FILE required; start from staging/environment.example.json');console.log(build(JSON.parse(fs.readFileSync(file,'utf8'))));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={build};
