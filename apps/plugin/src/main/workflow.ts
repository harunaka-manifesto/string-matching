import { AuthoringDraftSchema, MutationBatchSchema, MutationResultSchema, TargetSchema, CopyRecordSchema, type CopyRecord, type WorkflowAction, type AuthoringDraft } from '@string-binder/contracts';
import { recordFingerprint } from '@string-binder/domain';
import { api, catalog, latestCatalog, settings, WorkflowError } from './registry-api';
import { actual, allTexts, baselineOf, bindRecord, copyIdOf, deliver, localFingerprint as localHash, materialize, preview, refreshUsed, scanLocal, sameValues, stamp } from './delivery';
import { boundVariableId } from './layer-state';
import { selectionInfo, isSupportedRoot } from './selection';

// Private per-device drafts: document marker is routing metadata, not proof of identity.
async function draftKey():Promise<string>{let marker=figma.root.getPluginData('registry:document');if(!marker){marker=`${Date.now()}-${figma.root.id}`;figma.root.setPluginData('registry:document',marker);}return `registry:drafts:${marker}`;}
async function drafts():Promise<Record<string,AuthoringDraft>>{return await figma.clientStorage.getAsync(await draftKey())??{};}
async function checkDestination():Promise<void>{const s=await settings();if(!s.libraryId||!s.fileKey)throw new Error('Register the library URL first');const registered=figma.root.getPluginData('registry:library');if(registered&&registered!==s.fileKey)throw new Error('This document is registered as another library');const vars=await figma.variables.getLocalVariablesAsync('STRING');if(s.fileKey==='azS9vExUzw1IRrrGm3NEfD'&&!vars.some(v=>!v.remote&&v.key==='bdbb89495ff5458dfe42a388e2a68f6eb233839c')&&!registered)throw new Error('Open the registered GoPay Strings file before configuring library sync');figma.root.setPluginData('registry:library',s.fileKey);}
export async function workflow(action:WorkflowAction,raw:unknown):Promise<unknown>{
  const data=(raw??{}) as Record<string,any>;
  switch(action){
    case 'window':figma.ui.resize(data.wide?640:440,data.wide?760:680);return null;
    case 'settings:get':{const s=await settings();return {libraryId:s.libraryId??'',fileKey:s.fileKey??'',hasPublisherToken:!!s.publisherToken,isLibrary:!!figma.root.getPluginData('registry:library')};}
    case 'settings:save':{const s=await settings();await figma.clientStorage.setAsync('registry:settings',{...s,libraryId:data.libraryId,fileKey:data.fileKey,...(data.publisherToken?{publisherToken:data.publisherToken}:{})});await checkDestination();return {saved:true};}
    case 'draft:get':return (await drafts())[data.frameId]??null;
    case 'draft:save':{const draft=AuthoringDraftSchema.parse(data.draft);const all=await drafts();all[draft.frameId]=draft;await figma.clientStorage.setAsync(await draftKey(),all);return null;}
    case 'catalog':return catalog(!data.cached);
    case 'changes':return api(`changes?after=${data.after??0}`);
    case 'request':return api(`request?id=${encodeURIComponent(data.requestId)}`);
    case 'submit':{const batch=MutationBatchSchema.parse(data.batch);const response=MutationResultSchema.parse(await api('submit',batch));await latestCatalog().catch(()=>null);return response;}
    case 'scan':{const root=await figma.getNodeByIdAsync(data.frameId);if(!isSupportedRoot(root))throw new Error('Select a frame');const selection=await selectionInfo(root);const bindings:Record<string,string>={};const variables:Record<string,{en:string;id:string}>={};for(const l of selection.layers){const node=await figma.getNodeByIdAsync(l.id);if(node?.type==='TEXT'){const id=boundVariableId(node);const v=id?await figma.variables.getVariableByIdAsync(id):null;const copy=v?copyIdOf(v):null;if(copy){bindings[l.id]=copy;try{variables[l.id]=await actual(v!);}catch{/* Scanning still exposes the affected row. */}}}}return {selection,bindings,variables};}
    case 'preflight':return preview(data.frameId,data.rows);
    case 'deliver':return deliver(data.records.map((r:unknown)=>CopyRecordSchema.parse(r)),data.targets.map((t:unknown)=>TargetSchema.parse(t)),(await catalog()).products,data.globalIds??[]);
    case 'refresh':{const cat=await catalog(true);if(figma.root.getPluginData('registry:library'))return {catalog:cat,result:{applied:[],failures:[],conflicts:[]}};const protectedIds=Object.values(await drafts()).flatMap(d=>d.rows.filter(r=>r.action!=='keep'&&r.baseline).map(r=>r.baseline!.copyId));return {catalog:cat,result:await refreshUsed(cat.records,cat.products,cat.mappings,protectedIds)};}
    case 'library:scan':await checkDestination();return {catalog:await latestCatalog(),locals:await scanLocal()};
    case 'library:start':{await checkDestination();const s=await settings();const manifest=data.records.map((r:CopyRecord)=>({copyId:r.copyId,revision:r.revision,fingerprint:recordFingerprint(r)}));const response=await api('library',{operation:'start',args:{libraryId:s.libraryId,fileKey:s.fileKey,runId:data.runId,owner:data.owner,manifest}},true);const previous=await figma.clientStorage.getAsync('registry:run');await figma.clientStorage.setAsync('registry:run',{...(previous?.runId===data.runId?previous:{}),...data,libraryId:s.libraryId});return response;}
    case 'library:apply':{
      await checkDestination();const s=await settings();const cat=await catalog();
      const run=await figma.clientStorage.getAsync('registry:run');if(!run||run.runId!==data.runId)throw new Error('Resume the correct sync manifest');
      await api('library',{operation:'start',args:{libraryId:s.libraryId,fileKey:s.fileKey,runId:run.runId,owner:run.owner,manifest:run.records.map((r:CopyRecord)=>({copyId:r.copyId,revision:r.revision,fingerprint:recordFingerprint(r)}))}},true);
      const current=await scanLocal();const mappings:import('@string-binder/contracts').LibraryMapping[]=[];const failures=[];
      let chunk=0;for(const rawRecord of run.records){if(chunk++%20===0)await api('library',{operation:'start',args:{libraryId:s.libraryId,fileKey:s.fileKey,runId:run.runId,owner:run.owner,manifest:run.records.map((r:CopyRecord)=>({copyId:r.copyId,revision:r.revision,fingerprint:recordFingerprint(r)}))}},true);const r=CopyRecordSchema.parse(rawRecord);const entry=run.entries?.find((e:any)=>e.copyId===r.copyId);const local=entry?.variableId?current.find(l=>l.variableId===entry.variableId):current.find(l=>l.copyId===r.copyId);try{
        if(entry?.fingerprint&&(!local||localHash(local)!==entry.fingerprint)&&!(local?.baseline?.revision===r.revision&&sameValues(local,r)))throw new Error('Variable changed since review');
        let explicit=local?await figma.variables.getVariableByIdAsync(local.variableId):undefined;
        const canonicalLocal=current.find(l=>l.copyId===r.copyId&&l.variableId!==local?.variableId);
        const consolidate=!!entry?.reuse&&explicit;
        if(consolidate)explicit=canonicalLocal?await figma.variables.getVariableByIdAsync(canonicalLocal.variableId):undefined;
        const v=await materialize(r,cat.products.find(p=>p.id===r.product)?.displayName??r.product,true,explicit??undefined,!!entry?.overwrite);
        if(consolidate&&local){const texts=await allTexts();for(const n of texts.filter(n=>boundVariableId(n)===local.variableId)){const oldC=await figma.variables.getVariableCollectionByIdAsync((await figma.variables.getVariableByIdAsync(local.variableId))!.variableCollectionId);await bindRecord(n,v,r,oldC?.modes.find(m=>m.modeId===n.resolvedVariableModes[oldC.id])?.name.toUpperCase()==='EN'?'en':'id');}if(!texts.some(n=>boundVariableId(n)===local.variableId))(await figma.variables.getVariableByIdAsync(local.variableId))?.remove();}
        mappings.push({libraryId:s.libraryId!,copyId:r.copyId,variableId:v.id,variableKey:v.key,syncedRevision:r.revision,publishedRevision:null,fingerprint:recordFingerprint(r)});
      }catch(e){failures.push({copyId:r.copyId,reason:e instanceof Error?e.message:String(e)});}}
      // Persist successes across interruption; acknowledgement refers to all verified applied rows.
      const previous=run.applied??[];const allMappings=[...previous.filter((m:any)=>!mappings.some(n=>n.copyId===m.copyId)),...mappings];await figma.clientStorage.setAsync('registry:run',{...run,applied:allMappings});
      await api('library',{operation:'ack',args:{runId:run.runId,owner:run.owner,mappings:allMappings}},true);return {mappings:allMappings,failures};
    }
    case 'library:manifest':return await figma.clientStorage.getAsync('registry:run')??null;
    case 'library:pending':if('value' in data){await figma.clientStorage.setAsync('registry:pending',data.value);return null;}return await figma.clientStorage.getAsync('registry:pending')??null;
    case 'library:ack':return api('library',data,true);
    case 'library:publish':{
      const run=await figma.clientStorage.getAsync('registry:run');if(!run)throw new Error('Apply a sync manifest first');const s=await settings();
      await api('library',{operation:'start',args:{libraryId:s.libraryId,fileKey:s.fileKey,runId:run.runId,owner:run.owner,manifest:run.records.map((r:CopyRecord)=>({copyId:r.copyId,revision:r.revision,fingerprint:recordFingerprint(r)}))}},true);
      if(run.applied?.length!==run.records.length)throw new Error('Finish all outstanding entries before publication');
      for(const r of run.records){const m=run.applied.find((m:any)=>m.copyId===r.copyId);const v=await figma.variables.getVariableByIdAsync(m.variableId);if(!v||await v.getPublishStatusAsync()!=='CURRENT'||!sameValues(await actual(v),r)||baselineOf(v)?.revision!==r.revision)throw new Error(`Publish the exact saved revision of ${r.platformKey} through Figma first`);}
      const result=await api('library',{operation:'publish',args:{runId:run.runId,owner:run.owner}},true);await figma.clientStorage.setAsync('registry:run',{...run,published:true});await latestCatalog();return result;
    }
  }
}
