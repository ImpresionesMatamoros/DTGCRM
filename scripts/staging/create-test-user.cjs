const {config,confirm}=require('./config.cjs');
async function main(){
 const c=config();confirm(c);
 const key=process.env.STAGING_SERVICE_ROLE_KEY,password=process.env.STAGING_TEST_PASSWORD;
 if(!key||!password||password.length<16)throw Error('Staging-only admin key and 16+ character test password required');
 const email=process.env.STAGING_TEST_EMAIL||'operador@example.invalid';
 if(!/^[a-z0-9._+-]+@example\.invalid$/i.test(email))throw Error('Only example.invalid test addresses are allowed');
 const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
 const result=await fetch(c.supabaseUrl+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password,email_confirm:true}),redirect:'error'});
 if(!result.ok)throw Error('Auth rejected test-user creation; check staging admin access. No email was requested.');
 const user=await result.json();if(!user.id)throw Error('Missing test user identity');
 // Existing profile trigger may have created it; merge only this fictitious identity.
 const response=await fetch(c.supabaseUrl+'/rest/v1/profiles?on_conflict=id',{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates'},body:JSON.stringify({id:user.id,display_name:'Operador ficticio STAGING',active:true,role:'member'}),redirect:'error'});
 if(!response.ok)throw Error('Test Auth user created, but profile activation requires staging-schema review; do not retry user creation blindly');
 console.log('Confirmed fictitious staging user created and activated. Credentials are not printed. No email invitation/reset used.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
