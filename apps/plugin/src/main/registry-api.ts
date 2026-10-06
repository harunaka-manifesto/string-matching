import type { Catalog } from '@string-binder/contracts';
import { CatalogSchema, MappingSchema } from '@string-binder/contracts';
declare const REGISTRY_URL: string;
declare const REGISTRY_TOKEN: string;
export class WorkflowError extends Error { constructor(public code: string,message: string,public details?: unknown){super(message);} }
export type Settings = {publisherToken?:string;libraryId?:string;fileKey?:string};
export const settings = async (): Promise<Settings> => (await figma.clientStorage.getAsync('registry:settings') ?? {}) as Settings;
export async function api(action: string, data?: unknown, publisher=false): Promise<unknown> {
  if (!REGISTRY_URL) throw new WorkflowError('NOT_CONFIGURED','Registry is not configured. Existing Figma bindings remain available.');
  const token=publisher ? (await settings()).publisherToken : REGISTRY_TOKEN;
  if (!token) throw new WorkflowError('NOT_CONFIGURED',publisher?'Enter a publisher credential in Library sync.':'Team token is not configured.');
  let response;
  try { response=await fetch(`${REGISTRY_URL}/${action}`,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-copy-token':token},...(data===undefined?{}:{body:JSON.stringify(data)})}); }
  catch { throw new WorkflowError('UNAVAILABLE','Registry unavailable. Your draft and request ID are preserved.'); }
  const body=await response.json();
  if (!response.ok) throw new WorkflowError(body?.error ?? 'UNAVAILABLE',body?.message ?? 'Registry request failed',body);
  return body;
}
let cached: Catalog | null=null;
export async function catalog(force=false): Promise<Catalog> {
  if(!cached) cached=await figma.clientStorage.getAsync('registry:catalog') ?? null;
  if(force||!cached) {
    if(!cached) cached=CatalogSchema.parse(await api('catalog'));
    else {
      let more=true;
      while(more) {
        const delta=await api(`changes?after=${cached.seq}`) as {seq:number;events:{type:string;record:unknown}[];more:boolean};
        for(const event of delta.events) {
          if(event.type==='copy') { const r=CatalogSchema.shape.records.element.parse(event.record);cached.records=cached.records.filter(old=>old.copyId!==r.copyId).concat(r); }
          if(event.type==='mapping') {const m=MappingSchema.parse(event.record);cached.mappings=cached.mappings.filter(old=>old.copyId!==m.copyId||old.libraryId!==m.libraryId).concat(m);}
        }
        cached.seq=delta.seq;more=delta.more;
      }
    }
    await figma.clientStorage.setAsync('registry:catalog',cached);
  }
  return cached;
}
export async function latestCatalog(): Promise<Catalog> {cached=CatalogSchema.parse(await api('catalog'));await figma.clientStorage.setAsync('registry:catalog',cached);return cached;}
