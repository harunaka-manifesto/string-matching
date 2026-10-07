-- Library sync fixes:
-- * A library is registered only once a start is accepted, so a rejected first attempt
--   (wrong URL, lease, bad manifest) never locks the library onto that file key.
-- * A second library with an already-registered file key is a clear DESTINATION error,
--   not a unique-violation outage.
-- * ack checks mappings against a set built once from the manifest (was a rescan per mapping).
-- * ack records as applied only the mappings it wrote; publish skips entries superseded by
--   a newer sync instead of failing the run for good, and repeating publish is a no-op.
-- * copy_registry_library_reset lets an administrator correct a library's file key.

create or replace function public.copy_registry_library(operation text, args jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare lib copy_private.libraries; run copy_private.sync_runs; item jsonb; mapping jsonb; current_record jsonb; head bigint; existing_manifest jsonb; allowed text[]; written jsonb:='[]'::jsonb;
 begin
 select seq into head from copy_private.registry_head where id=true for update;
 if operation='start' then
   if (select count(*) from jsonb_array_elements(args->'manifest'))<>(select count(distinct m->>'copyId') from jsonb_array_elements(args->'manifest') m) then return jsonb_build_object('error','VALIDATION','message','Manifest identities must be unique'); end if;
   select * into lib from copy_private.libraries where id=args->>'libraryId' for update;
   if found then
     if lib.file_key<>args->>'fileKey' then return jsonb_build_object('error','DESTINATION','message','Library URL does not match registration'); end if;
   elsif exists(select 1 from copy_private.libraries where file_key=args->>'fileKey') then
     return jsonb_build_object('error','DESTINATION','message','This Figma file is registered under another library ID');
   end if;
   select * into run from copy_private.sync_runs where id=args->>'runId';
   if found then
     if run.library_id<>args->>'libraryId' or run.owner<>args->>'owner' then return jsonb_build_object('error','LEASE','message','Sync run belongs to another session'); end if;
     if run.manifest<>args->'manifest' then return jsonb_build_object('error','REQUEST_REUSED','message','Sync manifest is immutable'); end if;
     existing_manifest:=run.manifest;
   else
     existing_manifest:=args->'manifest';
   end if;
   if lib.id is not null and lib.lease_until>now() and lib.owner<>args->>'owner' then return jsonb_build_object('error','LEASE','message','Another publisher is syncing'); end if;
   for item in select value from jsonb_array_elements(existing_manifest) loop
     select record into current_record from copy_private.copy_revisions where copy_id=item->>'copyId' and revision=(item->>'revision')::integer;
     if current_record is null then return jsonb_build_object('error','VALIDATION','message','Unknown manifest revision'); end if;
   end loop;
   -- Every check passed: only now does this file become the library's registered destination.
   insert into copy_private.libraries(id,file_key,owner,lease_until) values(args->>'libraryId',args->>'fileKey',args->>'owner',now()+interval '2 minutes')
     on conflict(id) do update set owner=excluded.owner,lease_until=excluded.lease_until;
   insert into copy_private.sync_runs(id,library_id,owner,manifest) values(args->>'runId',args->>'libraryId',args->>'owner',existing_manifest) on conflict(id) do nothing;
   return jsonb_build_object('runId',args->>'runId','manifest',existing_manifest);
 end if;
 select * into run from copy_private.sync_runs where id=args->>'runId';
 if not found then return jsonb_build_object('error','VALIDATION','message','Sync run not found'); end if;
 if operation='manifest' then return to_jsonb(run); end if;
 select * into lib from copy_private.libraries where id=run.library_id;
 if operation='renew' then
   if run.owner<>args->>'owner' or (lib.owner<>run.owner and lib.lease_until>now()) then return jsonb_build_object('error','LEASE','message','Publisher lease taken by another session'); end if;
   update copy_private.libraries set owner=run.owner,lease_until=now()+interval '2 minutes' where id=lib.id;return jsonb_build_object('renewed',true);
 end if;
 if operation='publish' and run.published then return jsonb_build_object('seq',head,'runId',run.id); end if;
 if run.owner<>args->>'owner' or lib.owner<>run.owner or lib.lease_until<=now() then return jsonb_build_object('error','LEASE','message','Publisher lease expired; check changes and resume'); end if;
 if operation='ack' then
   if (select count(*) from jsonb_array_elements(args->'mappings'))<>(select count(distinct m->>'copyId') from jsonb_array_elements(args->'mappings') m) then return jsonb_build_object('error','VALIDATION','message','Applied mappings must be unique'); end if;
   select array_agg((m->>'copyId')||':'||(m->>'revision')||':'||(m->>'fingerprint')) into allowed from jsonb_array_elements(run.manifest) m;
   if exists(
     select 1 from jsonb_array_elements(args->'mappings') i
     where not ((i->>'copyId')||':'||(i->>'syncedRevision')||':'||(i->>'fingerprint'))=any(coalesce(allowed,'{}'))
   ) then return jsonb_build_object('error','VALIDATION','message','Mapping is outside the fixed manifest'); end if;
   for item in select value from jsonb_array_elements(args->'mappings') loop
     select record into mapping from copy_private.library_mappings where library_id=lib.id and copy_id=item->>'copyId';
     -- A newer sync already mapped this identity; this run must not claim it.
     if mapping is not null and (mapping->>'syncedRevision')::integer>(item->>'syncedRevision')::integer then continue; end if;
     item:=item||jsonb_build_object('libraryId',lib.id,'publishedRevision',case when mapping->>'variableKey'=item->>'variableKey' then mapping->'publishedRevision' else 'null'::jsonb end);
     insert into copy_private.library_mappings values(lib.id,item->>'copyId',item) on conflict(library_id,copy_id) do update set record=excluded.record;
     head:=head+1; insert into copy_private.changes values(head,jsonb_build_object('type','mapping','record',item));
     written:=written||jsonb_build_array(item);
   end loop;
   -- Acks are cumulative: keep earlier entries this call did not repeat.
   update copy_private.sync_runs set applied=(
     select coalesce(jsonb_agg(value),'[]'::jsonb) from (
       select value from jsonb_array_elements(run.applied) where not exists(select 1 from jsonb_array_elements(written) a where a->>'copyId'=value->>'copyId')
       union all select value from jsonb_array_elements(written)
     ) merged
   ) where id=run.id;
 elsif operation='publish' then
   -- Entries a newer sync took over are no longer this run's to publish.
   select coalesce(jsonb_agg(a),'[]'::jsonb) into written from jsonb_array_elements(run.applied) a
     join copy_private.library_mappings m on m.library_id=lib.id and m.copy_id=a->>'copyId'
     where (m.record->>'syncedRevision')::integer<=(a->>'syncedRevision')::integer;
   if (select count(*) from jsonb_array_elements(run.manifest) e
       where not exists(select 1 from jsonb_array_elements(run.applied) a where a->>'copyId'=e->>'copyId')
         and not exists(select 1 from copy_private.library_mappings m where m.library_id=lib.id and m.copy_id=e->>'copyId' and (m.record->>'syncedRevision')::integer>(e->>'revision')::integer)
      )>0 then return jsonb_build_object('error','VALIDATION','message','Finish applying every manifest entry before publication'); end if;
   for item in select value from jsonb_array_elements(written) loop
     select record into mapping from copy_private.library_mappings where library_id=lib.id and copy_id=item->>'copyId';
     if mapping->>'syncedRevision'<>item->>'syncedRevision' or mapping->>'fingerprint'<>item->>'fingerprint' then return jsonb_build_object('error','REVISION_CONFLICT','message','Library changed after this manifest was applied'); end if;
   end loop;
   for item in select value from jsonb_array_elements(written) loop
     update copy_private.library_mappings set record=record||jsonb_build_object('publishedRevision',(item->>'syncedRevision')::integer) where library_id=lib.id and copy_id=item->>'copyId' returning record into mapping;
     head:=head+1; insert into copy_private.changes values(head,jsonb_build_object('type','mapping','record',mapping));
   end loop;
   update copy_private.sync_runs set published=true where id=run.id;
 else return jsonb_build_object('error','VALIDATION','message','Unknown library operation'); end if;
 update copy_private.registry_head set seq=head where id=true;
 return jsonb_build_object('seq',head,'runId',run.id);
 end $$;

-- Administrator-only: point a library at a corrected Figma file key. Mappings stay, because
-- variable keys survive; a maintainer re-runs Check changes in the correct file afterwards.
create function public.copy_registry_library_reset(library_id text, file_key text) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare lib copy_private.libraries;
 begin
 select * into lib from copy_private.libraries where id=library_id for update;
 if not found then return jsonb_build_object('error','VALIDATION','message','Unknown library'); end if;
 if exists(select 1 from copy_private.libraries l where l.file_key=copy_registry_library_reset.file_key and l.id<>library_id) then
   return jsonb_build_object('error','DESTINATION','message','That file is registered under another library ID');
 end if;
 update copy_private.libraries set file_key=copy_registry_library_reset.file_key, owner=null, lease_until=null where id=library_id;
 return jsonb_build_object('libraryId',library_id,'fileKey',file_key,'previousFileKey',lib.file_key);
 end $$;

revoke all on function public.copy_registry_library_reset(text,text) from public, anon, authenticated;
grant execute on function public.copy_registry_library_reset(text,text) to service_role;
