// Only the dedicated staging project's service role can call this RPC.
export const PROJECT_REF='hhzqmqndavqqswerjhxe';
export const PROJECT_URL='https://'+PROJECT_REF+'.supabase.co';
let cached: {password:string;token:string}|undefined;
export async function runtimeConfig(){
 if(Deno.env.get('SUPABASE_URL')!==PROJECT_URL)throw Error('Staging project mismatch');
 if(cached)return cached;
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!key)throw Error('Server credential unavailable');
 const response=await fetch(PROJECT_URL+'/rest/v1/rpc/staging_engine_runtime_config',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}'});
 if(!response.ok)throw Error('Staging runtime configuration unavailable');
 const data=await response.json();
 if(!/^[a-f0-9]{64}$/.test(data.password)||!/^[a-f0-9]{64}$/.test(data.token))throw Error('Invalid staging credentials');
 cached=data;return cached!;
}
