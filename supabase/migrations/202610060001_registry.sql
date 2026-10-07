create schema if not exists copy_private;
create table copy_private.migration_history(event_index integer primary key,event jsonb not null);
create table copy_private.products(id text primary key, record jsonb not null);
create table copy_private.copies(copy_id text primary key, record jsonb not null);
create table copy_private.key_reservations(key text primary key, copy_id text not null);
create table copy_private.copy_revisions(copy_id text not null, revision integer not null, record jsonb not null, primary key(copy_id,revision));
create table copy_private.requests(request_id text primary key, payload_hash text not null, result jsonb not null);
create table copy_private.registry_head(id boolean primary key default true check(id), seq bigint not null default 0);
insert into copy_private.registry_head values(true,0);
create table copy_private.changes(seq bigint primary key, event jsonb not null);
create table copy_private.rate_limits(credential text not null, bucket bigint not null, count integer not null, primary key(credential,bucket));
create table copy_private.libraries(id text primary key, file_key text unique not null, owner text, lease_until timestamptz);
create table copy_private.library_mappings(library_id text not null references copy_private.libraries(id), copy_id text not null references copy_private.copies(copy_id), record jsonb not null, primary key(library_id,copy_id));
create table copy_private.sync_runs(id text primary key, library_id text not null references copy_private.libraries(id), owner text not null, manifest jsonb not null, applied jsonb not null default '[]', published boolean not null default false);

-- Single statement, hence one MVCC snapshot; aggregates avoid PostgREST's row cap.
create function public.copy_registry_catalog() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('seq',h.seq,'records',coalesce((select jsonb_agg(record - 'legacy' order by copy_id) from copy_private.copies),'[]'::jsonb),'products',coalesce((select jsonb_agg(record order by id) from copy_private.products),'[]'::jsonb),'mappings',coalesce((select jsonb_agg(record order by library_id,copy_id) from copy_private.library_mappings),'[]'::jsonb)) from copy_private.registry_head h;
$$;
create function public.copy_registry_changes(after_seq bigint) returns jsonb language sql stable security invoker set search_path='' as $$
 with page as (select seq,event from copy_private.changes where seq>after_seq order by seq limit 500)
 select jsonb_build_object('seq',coalesce((select max(seq) from page),after_seq),'events',coalesce((select jsonb_agg(event order by seq) from page),'[]'::jsonb),'more',exists(select 1 from copy_private.changes where seq>coalesce((select max(seq) from page),after_seq)));
$$;
create function public.copy_registry_request(request_id text) returns jsonb language sql stable security invoker set search_path='' as $$ select result from copy_private.requests where request_id=$1 $$;
create function public.copy_registry_revision(copy_id text, revision integer) returns jsonb language sql stable security invoker set search_path='' as $$ select record - 'legacy' from copy_private.copy_revisions where copy_id=$1 and revision=$2 $$;
create function public.copy_registry_rate(credential text, allowed integer default 180) returns boolean language plpgsql security invoker set search_path='' as $$
 declare b bigint:=floor(extract(epoch from now())/60); n integer;
 begin
 insert into copy_private.rate_limits values(credential,b,1) on conflict on constraint rate_limits_pkey do update set count=copy_private.rate_limits.count+1 returning count into n;
 delete from copy_private.rate_limits where bucket<b-2;
 return n<=allowed;
 end $$;

create function public.copy_registry_submit(batch jsonb, payload_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare old_request copy_private.requests; op jsonb; current_record jsonb; result_records jsonb:='[]'; conflicts jsonb:='[]'; product_record jsonb; next_record jsonb; key_stem text; allocated text; ending text; prefix text; ordinal integer; head bigint; ids text[]:='{}'; rev integer;
 begin
 select seq into head from copy_private.registry_head where id=true for update;
 select * into old_request from copy_private.requests where request_id=batch->>'requestId';
 if found then
   if old_request.payload_hash<>payload_hash then return jsonb_build_object('error','REQUEST_REUSED','message','Request ID was used for a different payload'); end if;
   return old_request.result;
 end if;
 if jsonb_array_length(batch->'operations')=0 then return jsonb_build_object('error','VALIDATION','message','No operations'); end if;
 -- Validate every operation before any mutation; conflicts leave the whole batch untouched.
 for op in select value from jsonb_array_elements(batch->'operations') loop
   if op->>'copyId'=any(ids) then return jsonb_build_object('error','VALIDATION','message','Resolve multiple actions for one identity'); end if;
   ids:=array_append(ids,op->>'copyId');
   select record into current_record from copy_private.copies where copy_id=op->>'copyId';
   if op->>'action'='create' then
     if current_record is not null then return jsonb_build_object('error','DUPLICATE_COPY_ID','message','Create is create-only'); end if;
     select record into product_record from copy_private.products where id=op->>'product';
     if product_record is null or op->>'stem' !~ '^gopay_[a-z0-9]+(_[a-z0-9]+){1,9}$' or length(op->>'stem')>100 then return jsonb_build_object('error','VALIDATION','message','Invalid product or key'); end if;
     if op ? 'forkedFrom' and not exists(select 1 from copy_private.copies where copy_id=op->>'forkedFrom') then return jsonb_build_object('error','VALIDATION','message','Fork origin is missing'); end if;
   elsif op->>'action' in ('edit','reuse') then
     if current_record is null or (current_record->>'revision')::integer<>(op->>'expectedRevision')::integer then
       conflicts:=conflicts||jsonb_build_array(jsonb_build_object('copyId',op->>'copyId','expectedRevision',op->'expectedRevision','actualRecord',current_record));
     elsif current_record->>'status' not in ('active','deprecated') then return jsonb_build_object('error','VALIDATION','message','Record is not available for authoring'); end if;
   else return jsonb_build_object('error','VALIDATION','message','Unknown operation'); end if;
 end loop;
 if jsonb_array_length(conflicts)>0 then return jsonb_build_object('error','REVISION_CONFLICT','message','Saved copy changed since review','conflicts',conflicts); end if;
 for op in select value from jsonb_array_elements(batch->'operations') loop
   select record into current_record from copy_private.copies where copy_id=op->>'copyId';
   if op->>'action'='reuse' then result_records:=result_records||jsonb_build_array(current_record - 'legacy'); continue; end if;
   if op->>'action'='create' then
     key_stem:=op->>'stem'; allocated:=key_stem; ordinal:=2;
     ending:='_'||(op->'context'->>'role')||case when op->'context' ? 'qualifier' then '_'||(op->'context'->>'qualifier') else '' end;
     prefix:=left(key_stem,length(key_stem)-length(ending));
     while exists(select 1 from copy_private.key_reservations where key=allocated) loop
       allocated:=rtrim(left(prefix,100-length(ending)-length(ordinal::text)-1),'_')||ending||'_'||ordinal; ordinal:=ordinal+1;
     end loop;
     next_record:=jsonb_build_object('copyId',op->>'copyId','platformKey',allocated,'revision',1,'product',op->>'product','context',op->'context','en',op->>'en','id',op->>'id','status','active','aliases','[]'::jsonb);
     if op ? 'forkedFrom' then next_record:=next_record||jsonb_build_object('forkedFrom',op->>'forkedFrom'); end if;
     insert into copy_private.key_reservations values(allocated,op->>'copyId');
   else
     next_record:=current_record||jsonb_build_object('revision',(current_record->>'revision')::integer+1,'context',op->'context','en',op->>'en','id',op->>'id');
   end if;
   rev:=(next_record->>'revision')::integer;
   insert into copy_private.copies values(next_record->>'copyId',next_record) on conflict(copy_id) do update set record=excluded.record;
   insert into copy_private.copy_revisions values(next_record->>'copyId',rev,next_record);
   head:=head+1;
   insert into copy_private.changes values(head,jsonb_build_object('type','copy','record',next_record - 'legacy','attribution',batch->'attribution','requestId',batch->>'requestId'));
   result_records:=result_records||jsonb_build_array(next_record - 'legacy');
 end loop;
 update copy_private.registry_head set seq=head where id=true;
 next_record:=jsonb_build_object('requestId',batch->>'requestId','records',result_records,'seq',head);
 insert into copy_private.requests values(batch->>'requestId',payload_hash,next_record);
 return next_record;
 end $$;

create function public.copy_registry_library(operation text, args jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare lib copy_private.libraries; run copy_private.sync_runs; item jsonb; mapping jsonb; current_record jsonb; head bigint; existing_manifest jsonb;
 begin
 select seq into head from copy_private.registry_head where id=true for update;
 if operation='start' then
   if (select count(*) from jsonb_array_elements(args->'manifest'))<>(select count(distinct m->>'copyId') from jsonb_array_elements(args->'manifest') m) then return jsonb_build_object('error','VALIDATION','message','Manifest identities must be unique'); end if;
   insert into copy_private.libraries(id,file_key) values(args->>'libraryId',args->>'fileKey') on conflict(id) do nothing;
   select * into lib from copy_private.libraries where id=args->>'libraryId' for update;
   if lib.file_key<>args->>'fileKey' then return jsonb_build_object('error','DESTINATION','message','Library URL does not match registration'); end if;
   select * into run from copy_private.sync_runs where id=args->>'runId';
   if found then
     if run.library_id<>lib.id or run.owner<>args->>'owner' then return jsonb_build_object('error','LEASE','message','Sync run belongs to another session'); end if;
     if run.manifest<>args->'manifest' then return jsonb_build_object('error','REQUEST_REUSED','message','Sync manifest is immutable'); end if;
     existing_manifest:=run.manifest;
   else
     existing_manifest:=args->'manifest';
   end if;
   if lib.lease_until>now() and lib.owner<>args->>'owner' then return jsonb_build_object('error','LEASE','message','Another publisher is syncing'); end if;
   for item in select value from jsonb_array_elements(existing_manifest) loop
     select record into current_record from copy_private.copy_revisions where copy_id=item->>'copyId' and revision=(item->>'revision')::integer;
     if current_record is null then return jsonb_build_object('error','VALIDATION','message','Unknown manifest revision'); end if;
   end loop;
   update copy_private.libraries set owner=args->>'owner',lease_until=now()+interval '2 minutes' where id=lib.id;
   insert into copy_private.sync_runs(id,library_id,owner,manifest) values(args->>'runId',lib.id,args->>'owner',existing_manifest) on conflict(id) do nothing;
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
 if run.owner<>args->>'owner' or lib.owner<>run.owner or lib.lease_until<=now() then return jsonb_build_object('error','LEASE','message','Publisher lease expired; check changes and resume'); end if;
 if operation='ack' then
   if (select count(*) from jsonb_array_elements(args->'mappings'))<>(select count(distinct m->>'copyId') from jsonb_array_elements(args->'mappings') m) then return jsonb_build_object('error','VALIDATION','message','Applied mappings must be unique'); end if;
   for item in select value from jsonb_array_elements(args->'mappings') loop
     if not exists(select 1 from jsonb_array_elements(run.manifest) m where m->>'copyId'=item->>'copyId' and m->>'revision'=item->>'syncedRevision' and m->>'fingerprint'=item->>'fingerprint') then return jsonb_build_object('error','VALIDATION','message','Mapping is outside the fixed manifest'); end if;
   end loop;
   for item in select value from jsonb_array_elements(args->'mappings') loop
     select record into mapping from copy_private.library_mappings where library_id=lib.id and copy_id=item->>'copyId';
     if mapping is not null and (mapping->>'syncedRevision')::integer>(item->>'syncedRevision')::integer then continue; end if;
     item:=item||jsonb_build_object('libraryId',lib.id,'publishedRevision',case when mapping->>'variableKey'=item->>'variableKey' then mapping->'publishedRevision' else 'null'::jsonb end);
     insert into copy_private.library_mappings values(lib.id,item->>'copyId',item) on conflict(library_id,copy_id) do update set record=excluded.record;
     head:=head+1; insert into copy_private.changes values(head,jsonb_build_object('type','mapping','record',item));
   end loop;
   update copy_private.sync_runs set applied=args->'mappings' where id=run.id;
 elsif operation='publish' then
   if jsonb_array_length(run.applied)<>jsonb_array_length(run.manifest) then return jsonb_build_object('error','VALIDATION','message','Finish applying every manifest entry before publication'); end if;
   for item in select value from jsonb_array_elements(run.applied) loop
     select record into mapping from copy_private.library_mappings where library_id=lib.id and copy_id=item->>'copyId';
     if mapping->>'syncedRevision'<>item->>'syncedRevision' or mapping->>'fingerprint'<>item->>'fingerprint' then return jsonb_build_object('error','REVISION_CONFLICT','message','Library changed after this manifest was applied'); end if;
   end loop;
   for item in select value from jsonb_array_elements(run.applied) loop
     update copy_private.library_mappings set record=record||jsonb_build_object('publishedRevision',(item->>'syncedRevision')::integer) where library_id=lib.id and copy_id=item->>'copyId' returning record into mapping;
     head:=head+1; insert into copy_private.changes values(head,jsonb_build_object('type','mapping','record',mapping));
   end loop;
   update copy_private.sync_runs set published=true where id=run.id;
 else return jsonb_build_object('error','VALIDATION','message','Unknown library operation'); end if;
 update copy_private.registry_head set seq=head where id=true;
 return jsonb_build_object('seq',head,'runId',run.id);
 end $$;

create function public.copy_registry_products() returns jsonb language sql stable security invoker set search_path='' as $$ select coalesce(jsonb_agg(record order by id),'[]'::jsonb) from copy_private.products $$;
create function public.copy_registry_manifest(manifest jsonb) returns jsonb language sql stable security invoker set search_path='' as $$ select coalesce(jsonb_agg(r.record - 'legacy'),'[]'::jsonb) from jsonb_array_elements(manifest) m join copy_private.copy_revisions r on r.copy_id=m->>'copyId' and r.revision=(m->>'revision')::integer $$;
revoke all on function public.copy_registry_products(), public.copy_registry_manifest(jsonb) from public,anon,authenticated;
grant execute on function public.copy_registry_products(), public.copy_registry_manifest(jsonb) to service_role;
-- Bootstrap only through an administrator's server credential, never the team API.
create function public.copy_registry_bootstrap(records jsonb, products jsonb, history jsonb default '[]', reservations jsonb default '[]') returns jsonb language plpgsql security invoker set search_path='' as $$
 declare r jsonb; p jsonb; k text; head bigint; owner_id text;
 begin
 select seq into head from copy_private.registry_head where id=true for update;
 if exists(select 1 from copy_private.copies) then raise exception 'Bootstrap requires an empty registry'; end if;
 insert into copy_private.migration_history select ordinality::integer,value from jsonb_array_elements(history) with ordinality;
 for p in select value from jsonb_array_elements(products) loop insert into copy_private.products values(p->>'id',p); end loop;
 for r in select value from jsonb_array_elements(records) loop
   insert into copy_private.copies values(r->>'copyId',r);
   insert into copy_private.copy_revisions values(r->>'copyId',(r->>'revision')::integer,r);
   head:=head+1;insert into copy_private.changes values(head,jsonb_build_object('type','copy','record',r - 'legacy'));
 end loop;
 for r in select value from jsonb_array_elements(records) loop
   owner_id:=coalesce(nullif(r->>'mergedInto',''),r->>'copyId');
   for k in select jsonb_array_elements_text(jsonb_build_array(r->>'platformKey')||coalesce(r->'aliases','[]')) loop
     if exists(select 1 from copy_private.key_reservations where key=k and copy_id<>owner_id) then raise exception 'Unresolved key ownership: %',k; end if;
     insert into copy_private.key_reservations values(k,owner_id) on conflict(key) do nothing;
   end loop;
 end loop;
 -- Historically ambiguous keys: reserved forever, yet deliberately no identity's alias.
 for r in select value from jsonb_array_elements(reservations) loop
   if not exists(select 1 from copy_private.copies where copy_id=r->>'copyId') then raise exception 'Unknown reservation owner: %',r->>'key'; end if;
   if exists(select 1 from copy_private.key_reservations where key=r->>'key') then raise exception 'Unresolved key ownership: %',r->>'key'; end if;
   insert into copy_private.key_reservations values(r->>'key',r->>'copyId');
 end loop;
 update copy_private.registry_head set seq=head where id=true;
 return jsonb_build_object('imported',jsonb_array_length(records));
 end $$;

revoke all on schema copy_private from public;
revoke all on all tables in schema copy_private from public;
revoke all on function public.copy_registry_catalog(), public.copy_registry_changes(bigint), public.copy_registry_request(text), public.copy_registry_revision(text,integer), public.copy_registry_rate(text,integer), public.copy_registry_submit(jsonb,text), public.copy_registry_library(text,jsonb), public.copy_registry_bootstrap(jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant usage on schema copy_private to service_role;
grant all on all tables in schema copy_private to service_role;
grant execute on function public.copy_registry_catalog(), public.copy_registry_changes(bigint), public.copy_registry_request(text), public.copy_registry_revision(text,integer), public.copy_registry_rate(text,integer), public.copy_registry_submit(jsonb,text), public.copy_registry_library(text,jsonb), public.copy_registry_bootstrap(jsonb,jsonb,jsonb,jsonb) to service_role;
