-- Administrator-only consistent external backups. These functions are not exposed by the Edge router.
create function public.copy_registry_backup() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('schemaVersion',1,'tables',jsonb_build_object(
  'migration_history',coalesce((select jsonb_agg(to_jsonb(t)) from copy_private.migration_history t),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(to_jsonb(t)) from copy_private.products t),'[]'::jsonb),
  'copies',coalesce((select jsonb_agg(to_jsonb(t)) from copy_private.copies t),'[]'::jsonb),
  'key_reservations',coalesce((select jsonb_agg(to_jsonb(t)) from copy_private.key_reservations t),'[]'::jsonb),
  'copy_revisions',coalesce((select jsonb_agg(to_jsonb(t)) from copy_private.copy_revisions t),'[]'::jsonb),
  'requests',coalesce((select jsonb_agg(to_jsonb(t)) from copy_private.requests t),'[]'::jsonb),
  'changes',coalesce((select jsonb_agg(to_jsonb(t)) from copy_private.changes t),'[]'::jsonb),
  'registry_head',coalesce((select jsonb_agg(to_jsonb(t)) from copy_private.registry_head t),'[]'::jsonb),
  'libraries',coalesce((select jsonb_agg(to_jsonb(t)) from copy_private.libraries t),'[]'::jsonb),
  'library_mappings',coalesce((select jsonb_agg(to_jsonb(t)) from copy_private.library_mappings t),'[]'::jsonb),
  'sync_runs',coalesce((select jsonb_agg(to_jsonb(t)) from copy_private.sync_runs t),'[]'::jsonb)));
$$;
create function public.copy_registry_restore(snapshot jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare table_name text;
 begin
 perform seq from copy_private.registry_head where id=true for update;
 if snapshot->>'schemaVersion'<>'1' then raise exception 'Unsupported backup schema'; end if;
 if exists(select 1 from copy_private.copies) or exists(select 1 from copy_private.products) or exists(select 1 from copy_private.requests) then raise exception 'Restore requires a fresh empty registry'; end if;
 delete from copy_private.registry_head;
 foreach table_name in array array['migration_history','products','copies','key_reservations','copy_revisions','requests','changes','registry_head','libraries','library_mappings','sync_runs'] loop
  execute format('insert into copy_private.%I select * from jsonb_populate_recordset(null::copy_private.%I,$1)',table_name,table_name) using snapshot->'tables'->table_name;
 end loop;
 -- Lease ownership does not survive restoration onto a new environment.
 update copy_private.libraries set owner=null,lease_until=null;
 return jsonb_build_object('restored',true);
 end $$;
revoke all on function public.copy_registry_backup(), public.copy_registry_restore(jsonb) from public,anon,authenticated;
grant execute on function public.copy_registry_backup(), public.copy_registry_restore(jsonb) to service_role;
