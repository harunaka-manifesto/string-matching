-- One committing transaction for the whole import exceeds the API statement timeout.
-- Each staged chunk is applied in its own short transaction instead. An import is "in
-- progress" exactly while staged chunks remain; only then may it be aborted and wiped.
drop function public.copy_registry_bootstrap_commit(jsonb);
create or replace function public.copy_registry_bootstrap_status() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('copies',(select count(*) from copy_private.copies),'reservations',(select count(*) from copy_private.key_reservations),'history',(select count(*) from copy_private.migration_history),'products',(select count(*) from copy_private.products),'stagedChunks',(select count(*) from copy_private.bootstrap_stage));
$$;
create or replace function public.copy_registry_bootstrap_stage(kind text, chunk integer, items jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
 begin
 if exists(select 1 from copy_private.copies) and not exists(select 1 from copy_private.bootstrap_stage) then raise exception 'Bootstrap requires an empty registry'; end if;
 if jsonb_typeof(items)<>'array' then raise exception 'Staged items must be an array'; end if;
 insert into copy_private.bootstrap_stage values(kind,chunk,items) on conflict on constraint bootstrap_stage_pkey do update set items=excluded.items;
 return jsonb_build_object('staged',jsonb_array_length(items));
 end $$;
-- Applying removes the staged chunk in the same transaction, so a retry after a lost
-- response finds nothing left to do.
create function public.copy_registry_bootstrap_apply(stage_kind text, stage_chunk integer) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare staged jsonb; r jsonb; k text; head bigint; owner_id text; base integer;
 begin
 select seq into head from copy_private.registry_head where id=true for update;
 select s.items into staged from copy_private.bootstrap_stage s where s.kind=stage_kind and s.chunk=stage_chunk;
 if staged is null then return jsonb_build_object('applied',0); end if;
 if stage_kind='products' then
   insert into copy_private.products select e.value->>'id',e.value from jsonb_array_elements(staged) e;
 elsif stage_kind='records' then
   for r in select value from jsonb_array_elements(staged) loop
     insert into copy_private.copies values(r->>'copyId',r);
     insert into copy_private.copy_revisions values(r->>'copyId',(r->>'revision')::integer,r);
     head:=head+1;insert into copy_private.changes values(head,jsonb_build_object('type','copy','record',r - 'legacy'));
     owner_id:=coalesce(nullif(r->>'mergedInto',''),r->>'copyId');
     for k in select jsonb_array_elements_text(jsonb_build_array(r->>'platformKey')||coalesce(r->'aliases','[]')) loop
       if exists(select 1 from copy_private.key_reservations where key=k and copy_id<>owner_id) then raise exception 'Unresolved key ownership: %',k; end if;
       insert into copy_private.key_reservations values(k,owner_id) on conflict(key) do nothing;
     end loop;
   end loop;
   update copy_private.registry_head set seq=head where id=true;
 elsif stage_kind='reservations' then
   for r in select value from jsonb_array_elements(staged) loop
     if not exists(select 1 from copy_private.copies where copy_id=r->>'copyId') then raise exception 'Unknown reservation owner: %',r->>'key'; end if;
     if exists(select 1 from copy_private.key_reservations where key=r->>'key') then raise exception 'Unresolved key ownership: %',r->>'key'; end if;
     insert into copy_private.key_reservations values(r->>'key',r->>'copyId');
   end loop;
 elsif stage_kind='history' then
   select coalesce(max(event_index),0) into base from copy_private.migration_history;
   insert into copy_private.migration_history select base+e.ordinality::integer,e.value from jsonb_array_elements(staged) with ordinality e;
 else raise exception 'Unknown staged kind'; end if;
 delete from copy_private.bootstrap_stage s where s.kind=stage_kind and s.chunk=stage_chunk;
 return jsonb_build_object('applied',jsonb_array_length(staged));
 end $$;
-- Wipes a half-finished import. Refused for a finished or live registry.
create function public.copy_registry_bootstrap_abort() returns jsonb language plpgsql security invoker set search_path='' as $$
 begin
 perform seq from copy_private.registry_head where id=true for update;
 if not exists(select 1 from copy_private.bootstrap_stage) then raise exception 'No import is in progress'; end if;
 if exists(select 1 from copy_private.requests) or exists(select 1 from copy_private.libraries) then raise exception 'Registry is already in use'; end if;
 delete from copy_private.changes where true;
 delete from copy_private.copy_revisions where true;
 delete from copy_private.key_reservations where true;
 delete from copy_private.copies where true;
 delete from copy_private.products where true;
 delete from copy_private.migration_history where true;
 delete from copy_private.bootstrap_stage where true;
 update copy_private.registry_head set seq=0 where id=true;
 return jsonb_build_object('aborted',true);
 end $$;
revoke all on function public.copy_registry_bootstrap_apply(text,integer), public.copy_registry_bootstrap_abort() from public, anon, authenticated;
grant execute on function public.copy_registry_bootstrap_apply(text,integer), public.copy_registry_bootstrap_abort() to service_role;
