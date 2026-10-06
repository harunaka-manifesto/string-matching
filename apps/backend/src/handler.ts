import { MutationBatchSchema, CopyRecordSchema } from '@string-binder/contracts';
import { bilingualErrors, canonical, copyKeyStem, isCopyId, recordFingerprint, sha256 } from '@string-binder/domain';
export type BackendDependencies = { rpc: (name: string,args?: Record<string,unknown>) => Promise<unknown>; tokens: {hash:string;role:'writer'|'publisher'}[] };
const statuses: Record<string,number> = {VALIDATION:422,REQUEST_REUSED:409,REVISION_CONFLICT:409,DUPLICATE_COPY_ID:409,LEASE:409,DESTINATION:409};
export function registryHandler(deps: BackendDependencies) {
  return async (request: Request): Promise<Response> => {
    const respond = (value: unknown,status=200) => Response.json(value,{status});
    const hash = sha256(request.headers.get('x-copy-token') ?? '');
    const credential = deps.tokens.find(t => t.hash.length===hash.length && [...hash].reduce((n,c,i) => n|(c.charCodeAt(0)^t.hash.charCodeAt(i)),0)===0);
    if (!credential) return respond({error:'UNAUTHORIZED',message:'Team access token is missing or revoked'},401);
    try {
      if (!await deps.rpc('copy_registry_rate',{credential:hash,allowed:180})) return respond({error:'RATE_LIMIT',message:'Too many requests; retry shortly'},429);
      const url = new URL(request.url);
      const action = url.pathname.split('/').at(-1);
      const args = request.method==='GET' ? {} : await request.json();
      let result: unknown;
      switch(action) {
        case 'catalog': result=await deps.rpc('copy_registry_catalog');break;
        case 'changes': result=await deps.rpc('copy_registry_changes',{after_seq:Number(url.searchParams.get('after') ?? 0)});break;
        case 'request': result=await deps.rpc('copy_registry_request',{request_id:url.searchParams.get('id')});break;
        case 'revision': result=await deps.rpc('copy_registry_revision',{copy_id:url.searchParams.get('id'),revision:Number(url.searchParams.get('revision'))});break;
        case 'submit': {
          const batch=MutationBatchSchema.parse(args);
          const products=await deps.rpc('copy_registry_products') as {id:string;keyToken:string}[];
          const operations=batch.operations.map(op => {
            if (!isCopyId(op.copyId)) throw new Error('Invalid Copy ID');
            if (op.action==='reuse') return op;
            const errors=bilingualErrors(op.en,op.id);
            if (errors.length) throw new Error(errors.join('; '));
            if (op.action==='edit') return op;
            const p=products.find(p=>p.id===op.product);
            if (!p) throw new Error('Choose a configured product');
            return {...op,stem:copyKeyStem({product:p.keyToken,...op.context})};
          });
          result=await deps.rpc('copy_registry_submit',{batch:{...batch,operations},payload_hash:sha256(canonical(batch))});break;
        }
        case 'library': {
          if (credential.role!=='publisher') return respond({error:'FORBIDDEN',message:'Publisher credential required'},403);
          if (args.operation==='start') {
            const saved=await deps.rpc('copy_registry_manifest',{manifest:args.args.manifest}) as unknown[];
            const byId=new Map(saved.map(value=>{const r=CopyRecordSchema.parse(value);return [r.copyId+':'+r.revision,r];}));
            for (const entry of args.args.manifest) {
              const r=byId.get(entry.copyId+':'+entry.revision);if(!r)throw new Error('Manifest revision is missing');
              if (entry.fingerprint!==recordFingerprint(r)) throw new Error('Manifest fingerprint does not match saved revision');
            }
          }
          result=await deps.rpc('copy_registry_library',args);break;
        }
        default:return respond({error:'NOT_FOUND'},404);
      }
      if (result && typeof result==='object' && 'error' in result) return respond(result,statuses[String(result.error)] ?? 422);
      return respond(result);
    } catch(error) {
      if (error instanceof Error && (error.name==='ZodError'||/Invalid|Choose|EN|ID|placeholder|Manifest/u.test(error.message))) return respond({error:'VALIDATION',message:error.message},422);
      return respond({error:'UNAVAILABLE',message:'Registry operation unavailable; keep the request ID and retry'},503);
    }
  };
}
