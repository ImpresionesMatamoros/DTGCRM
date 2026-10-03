const path=require('path');
require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../../staging/engine-entry.ts')],outfile:path.resolve(__dirname,'../../supabase/functions/product-engine/engine.js'),bundle:true,platform:'neutral',format:'esm',target:'es2022',external:['node:*','pg','zod','decimal.js'],legalComments:'inline'});
console.log('STEP 10 handlers and pricing bundled without replacing business logic.');
