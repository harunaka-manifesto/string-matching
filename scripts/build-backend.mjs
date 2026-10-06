import { build } from 'esbuild';
await build({entryPoints:['apps/backend/src/handler.ts'],outfile:'supabase/functions/copy-registry/handler.js',bundle:true,format:'esm',platform:'neutral',target:'es2022'});
