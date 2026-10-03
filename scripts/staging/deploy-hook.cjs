const {config}=require('./config.cjs');const {https}=require('../../staging/policy.js');
async function main(){
 const c=config();
 if(process.env.GITHUB_REF!=='refs/heads/staging'||process.env.STAGING_DEPLOYMENT_ENABLED!=='true')throw Error('Deployment is staging-only and disabled by default');
 const hook=https(process.env.STAGING_DEPLOY_HOOK_URL,'Staging deploy hook');
 const allowed=https(process.env.STAGING_DEPLOY_HOOK_ORIGIN,'Approved staging hook origin');
 if(hook.origin!==allowed.origin||c.productionOrigins.some(p=>new URL(p).origin===hook.origin))throw Error('Hook origin not approved');
 if(process.env.STAGING_HOSTING_PROJECT_CONFIRMED!=='true')throw Error('Owner must verify a dedicated hosting project builds branch staging using the staging build configuration');
 // Provider must be configured to build this branch with the same staging config.
 // This requests a deploy; it does not claim the published app is ready.
 const response=await fetch(hook,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Staging hosting rejected deployment request');
 console.log('Dedicated STAGING deployment requested; run remote smoke tests after hosting completes.');
}
main().catch(e=>{console.error('STAGING hook failed (no URL/token logged): '+(e.message.includes('OWNER')?'owner configuration missing':'check dedicated staging hosting configuration'));process.exitCode=1;});
