-- Request performance:
-- * The catalog (20k records, about 10 MB) was rebuilt from every row on each request, stripping
--   each record's legacy block, and took 6–10 s to answer. It is now built once per registry
--   sequence and kept as JSON text. Any write to a table it reads drops the copy; a copy built
--   before a concurrent write carries the older seq and is rebuilt on the next request.
-- * copy_registry_rate_pair counts the device and the token in one call instead of two.

create table copy_private.catalog_cache(id boolean primary key default true check(id), seq bigint not null, body json not null);

create function copy_private.catalog_cache_drop() returns trigger language plpgsql security invoker set search_path='' as $$
 begin
 delete from copy_private.catalog_cache where true;
 return null;
 end $$;

create trigger catalog_cache_drop after insert or update or delete or truncate on copy_private.copies for each statement execute function copy_private.catalog_cache_drop();
create trigger catalog_cache_drop after insert or update or delete or truncate on copy_private.products for each statement execute function copy_private.catalog_cache_drop();
create trigger catalog_cache_drop after insert or update or delete or truncate on copy_private.library_mappings for each statement execute function copy_private.catalog_cache_drop();
create trigger catalog_cache_drop after insert or update or delete or truncate on copy_private.registry_head for each statement execute function copy_private.catalog_cache_drop();

-- Volatile: it writes the cache, so it must not run in a read-only transaction.
create function public.copy_registry_catalog_cached() returns json language plpgsql volatile security invoker set search_path='' as $$
 declare head bigint; cached copy_private.catalog_cache; built json;
 begin
 select seq into head from copy_private.registry_head where id=true;
 select * into cached from copy_private.catalog_cache where id=true;
 if found and cached.seq=head then return cached.body; end if;
 -- One statement, so the seq and the records come from the same snapshot.
 select h.seq, public.copy_registry_catalog()::json into head, built from copy_private.registry_head h where h.id=true;
 insert into copy_private.catalog_cache values(true,head,built) on conflict(id) do update set seq=excluded.seq, body=excluded.body;
 return built;
 end $$;

-- The device limit first: a throttled device does not use up the token's allowance.
create function public.copy_registry_rate_pair(device text, device_allowed integer, token text, token_allowed integer) returns boolean language plpgsql security invoker set search_path='' as $$
 begin
 if not public.copy_registry_rate(device, device_allowed) then return false; end if;
 return public.copy_registry_rate(token, token_allowed);
 end $$;

revoke all on table copy_private.catalog_cache from public, anon, authenticated;
grant all on table copy_private.catalog_cache to service_role;
revoke all on function copy_private.catalog_cache_drop(), public.copy_registry_catalog_cached(), public.copy_registry_rate_pair(text,integer,text,integer) from public, anon, authenticated;
grant execute on function copy_private.catalog_cache_drop(), public.copy_registry_catalog_cached(), public.copy_registry_rate_pair(text,integer,text,integer) to service_role;
