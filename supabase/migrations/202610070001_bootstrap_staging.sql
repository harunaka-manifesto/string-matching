-- The initial import is far larger than one API request may be. Chunks are staged first,
-- then committed by one call, so the import is still a single all-or-nothing transaction.
create table copy_private.bootstrap_stage(kind text not null check(kind in ('records','products','history','reservations')), chunk integer not null, items jsonb not null, primary key(kind,chunk));
revoke all on copy_private.bootstrap_stage from public;
grant all on copy_private.bootstrap_stage to service_role;

create function public.copy_registry_bootstrap_status() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('copies',(select count(*) from copy_private.copies),'reservations',(select count(*) from copy_private.key_reservations),'stagedChunks',(select count(*) from copy_private.bootstrap_stage));
$$;
create function public.copy_registry_bootstrap_reset() returns jsonb language plpgsql security invoker set search_path='' as $$
 begin
 delete from copy_private.bootstrap_stage where true;
 return jsonb_build_object('reset',true);
 end $$;
-- Re-sending a chunk replaces it, so an uncertain response is safe to retry.
create function public.copy_registry_bootstrap_stage(kind text, chunk integer, items jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
 begin
 if exists(select 1 from copy_private.copies) then raise exception 'Bootstrap requires an empty registry'; end if;
 if jsonb_typeof(items)<>'array' then raise exception 'Staged items must be an array'; end if;
 insert into copy_private.bootstrap_stage values(kind,chunk,items) on conflict on constraint bootstrap_stage_pkey do update set items=excluded.items;
 return jsonb_build_object('staged',jsonb_array_length(items));
 end $$;
create function public.copy_registry_bootstrap_commit(expected jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare staged jsonb; result jsonb; k text;
 begin
 perform seq from copy_private.registry_head where id=true for update;
 select jsonb_object_agg(kinds.kind,coalesce((select jsonb_agg(e.value order by s.chunk,e.ordinality) from copy_private.bootstrap_stage s, jsonb_array_elements(s.items) with ordinality e where s.kind=kinds.kind),'[]'::jsonb)) into staged from unnest(array['records','products','history','reservations']) as kinds(kind);
 foreach k in array array['records','products','history','reservations'] loop
   if jsonb_array_length(staged->k)<>(expected->>k)::integer then raise exception 'Staged import is incomplete: % has % of %',k,jsonb_array_length(staged->k),expected->>k; end if;
 end loop;
 result:=public.copy_registry_bootstrap(staged->'records',staged->'products',staged->'history',staged->'reservations');
 delete from copy_private.bootstrap_stage where true;
 return result;
 end $$;
revoke all on function public.copy_registry_bootstrap_status(), public.copy_registry_bootstrap_reset(), public.copy_registry_bootstrap_stage(text,integer,jsonb), public.copy_registry_bootstrap_commit(jsonb) from public, anon, authenticated;
grant execute on function public.copy_registry_bootstrap_status(), public.copy_registry_bootstrap_reset(), public.copy_registry_bootstrap_stage(text,integer,jsonb), public.copy_registry_bootstrap_commit(jsonb) to service_role;
