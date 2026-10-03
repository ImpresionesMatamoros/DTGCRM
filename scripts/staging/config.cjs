const fs=require('fs');const policy=require('../../staging/policy.js');
function config(){const file=process.env.STAGING_CONFIG_FILE;if(!file)throw Error('STAGING_CONFIG_FILE required');return policy.validate(JSON.parse(fs.readFileSync(file,'utf8')));}
function confirm(c){if(process.env.STAGING_CONFIRMED_PROJECT_REF!==c.crmProjectRef)throw Error('STAGING_CONFIRMED_PROJECT_REF must exactly match CRM staging project');}
function connection(raw,expected){if(!raw)throw Error('Staging-only DATABASE_URL required');const u=new URL(raw);const direct=u.hostname==='db.'+expected+'.supabase.co';const pooled=u.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(u.username)==='postgres.'+expected;if(!['postgres:','postgresql:'].includes(u.protocol)||!u.password||(!direct&&!pooled)||policy.productionRefs.some(r=>raw.includes(r)))throw Error('Database destination refused');return raw;}
module.exports={config,confirm,connection};
