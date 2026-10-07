-- Backups and restores in pages. The single-request backup carried every table at once
-- (records, revisions, changes and history are tens of MB each), which outgrows request and
-- statement limits. Pages are ordered by primary key; the backup script re-reads the head
-- sequence at the end and starts over if anything was written meanwhile, so a finished
-- backup is still one consistent snapshot.

create table copy_private.restore_marker(id boolean primary key default true check(id), started timestamptz not null default now());

create function public.copy_registry_backup_page(table_name text, page_offset integer, page_size integer) returns jsonb language plpgsql stable security invoker set search_path='' as $$
 declare keys text; rows jsonb;
 begin
 keys:=case table_name
   when 'migration_history' then 'event_index' when 'products' then 'id' when 'copies' then 'copy_id'
   when 'key_reservations' then 'key' when 'copy_revisions' then 'copy_id,revision' when 'requests' then 'request_id'
   when 'changes' then 'seq' when 'registry_head' then 'id' when 'libraries' then 'id'
   when 'library_mappings' then 'library_id,copy_id' when 'sync_runs' then 'id' end;
 if keys is null then raise exception 'Unknown backup table %',table_name; end if;
 if page_size<1 or page_size>5000 or page_offset<0 then raise exception 'Invalid backup page'; end if;
 execute format('select coalesce(jsonb_agg(r),''[]''::jsonb) from (select to_jsonb(t) r from copy_private.%I t order by %s limit $1 offset $2) p',table_name,keys)
   into rows using page_size, page_offset;
 return jsonb_build_object('rows',rows,'head',(select seq from copy_private.registry_head));
 end $$;

-- Starts (or restarts) a paged restore into a fresh registry. A restore that stopped midway
-- leaves its marker, so running it again wipes the partial data instead of refusing.
create function public.copy_registry_restore_begin() returns jsonb language plpgsql security invoker set search_path='' as $$
 begin
 perform seq from copy_private.registry_head where id=true for update;
 if not exists(select 1 from copy_private.restore_marker) and (exists(select 1 from copy_private.copies) or exists(select 1 from copy_private.products) or exists(select 1 from copy_private.requests)) then
   raise exception 'Restore requires a fresh empty registry';
 end if;
 delete from copy_private.sync_runs where true;
 delete from copy_private.library_mappings where true;
 delete from copy_private.libraries where true;
 delete from copy_private.changes where true;
 delete from copy_private.requests where true;
 delete from copy_private.copy_revisions where true;
 delete from copy_private.key_reservations where true;
 delete from copy_private.copies where true;
 delete from copy_private.products where true;
 delete from copy_private.migration_history where true;
 delete from copy_private.registry_head where true;
 insert into copy_private.restore_marker values(true,now()) on conflict(id) do update set started=now();
 return jsonb_build_object('started',true);
 end $$;

create function public.copy_registry_restore_page(table_name text, rows jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
 begin
 if not exists(select 1 from copy_private.restore_marker) then raise exception 'Begin a restore first'; end if;
 if table_name not in ('migration_history','products','copies','key_reservations','copy_revisions','requests','changes','registry_head','libraries','library_mappings','sync_runs') then raise exception 'Unknown backup table %',table_name; end if;
 execute format('insert into copy_private.%I select * from jsonb_populate_recordset(null::copy_private.%I,$1)',table_name,table_name) using rows;
 return jsonb_build_object('inserted',jsonb_array_length(rows));
 end $$;

create function public.copy_registry_restore_finish() returns jsonb language plpgsql security invoker set search_path='' as $$
 begin
 if not exists(select 1 from copy_private.restore_marker) then raise exception 'No restore is in progress'; end if;
 if not exists(select 1 from copy_private.registry_head) then insert into copy_private.registry_head values(true,0); end if;
 -- Lease ownership does not survive restoration onto a new environment.
 update copy_private.libraries set owner=null,lease_until=null;
 delete from copy_private.restore_marker where true;
 return jsonb_build_object('restored',true,'seq',(select seq from copy_private.registry_head));
 end $$;

revoke all on table copy_private.restore_marker from public, anon, authenticated;
grant all on table copy_private.restore_marker to service_role;
revoke all on function public.copy_registry_backup_page(text,integer,integer), public.copy_registry_restore_begin(), public.copy_registry_restore_page(text,jsonb), public.copy_registry_restore_finish() from public, anon, authenticated;
grant execute on function public.copy_registry_backup_page(text,integer,integer), public.copy_registry_restore_begin(), public.copy_registry_restore_page(text,jsonb), public.copy_registry_restore_finish() to service_role;
