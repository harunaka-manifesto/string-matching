// Generated handler is bundled by pnpm build:backend; database keys never ship to Figma.
// @ts-ignore Generated deployment artifact.
import { registryHandler } from './handler.js';
const tokens = [
  ...(Deno.env.get('COPY_TEAM_TOKEN_HASHES') ?? '').split(',').filter(Boolean).map(hash=>({hash,role:'writer'})),
  ...(Deno.env.get('COPY_PUBLISHER_TOKEN_HASHES') ?? '').split(',').filter(Boolean).map(hash=>({hash,role:'publisher'})),
];
const secrets=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
const key=secrets.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
Deno.serve(registryHandler({tokens,rpc:async (name,args={})=>{
  const response=await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json',apikey:key,...(key?.startsWith('eyJ')?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify(args)});
  if(!response.ok) throw new Error('Database operation failed');
  return response.json();
}}));
