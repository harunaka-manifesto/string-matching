-- An import can stop after products (or history) are applied but before any record lands.
-- The earlier abort refused that state once the stage was cleared, leaving an import that
-- could never finish. Abort now also accepts a registry holding only partial import data:
-- no live requests or libraries, and no finished import (copies present without staged work).
create or replace function public.copy_registry_bootstrap_abort() returns jsonb language plpgsql security invoker set search_path='' as $$
 begin
 perform seq from copy_private.registry_head where id=true for update;
 if exists(select 1 from copy_private.requests) or exists(select 1 from copy_private.libraries) then raise exception 'Registry is already in use'; end if;
 if not exists(select 1 from copy_private.bootstrap_stage) and (
   exists(select 1 from copy_private.copies)
   or not (exists(select 1 from copy_private.products) or exists(select 1 from copy_private.migration_history) or exists(select 1 from copy_private.key_reservations))
 ) then raise exception 'No import is in progress'; end if;
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
