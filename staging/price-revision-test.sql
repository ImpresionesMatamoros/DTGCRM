-- Laboratory-only acceptance fixture; respects original immutable price revision guards.
-- Caller sets dtg.staging_test_amount to 46 (test) or 45 (restore via another revision).
set local search_path = dtg_pe, extensions, pg_catalog;
do $test$
declare predecessor price_definition; successor uuid:=gen_random_uuid(); at_time timestamptz:=now(); new_amount numeric;
begin
 if not exists(select 1 from staging_private.identity where environment='staging' and project_ref='hhzqmqndavqqswerjhxe') then raise exception 'Not the laboratory'; end if;
 new_amount:=current_setting('dtg.staging_test_amount')::numeric;
 if new_amount not in (45,46) then raise exception 'Only the accepted fixture values are allowed'; end if;
 select * into strict predecessor from price_definition where lineage_id='75322a4c-325f-5d0f-ae1f-dee9fcf869b5' and status='AUTHORIZED' for update;
 perform set_config('dtg.actor','STAGING acceptance',true);perform set_config('dtg.reason','Historical snapshot acceptance fixture',true);
 insert into price_definition select (jsonb_populate_record(null::price_definition,to_jsonb(predecessor)||jsonb_build_object('id',successor,'status','DRAFT','version',predecessor.version+1,'supersedes_id',predecessor.id,'valid_from',at_time,'valid_to',null,'authorized_by',null,'authorized_at',null,'superseded_by_id',null,'superseded_at',null,'created_at',at_time,'updated_at',at_time))).*;
 insert into price_break(price_definition_id,quantity,amount,amount_basis) select successor,quantity,case when quantity=250 then new_amount else amount end,amount_basis from price_break where price_definition_id=predecessor.id;
 insert into price_condition(id,price_definition_id,price_rule_id,kind,option_definition_id,option_value_id,decoration_method_id) select gen_random_uuid(),successor,null,kind,option_definition_id,option_value_id,decoration_method_id from price_condition where price_definition_id=predecessor.id;
 update price_definition set status='AUTHORIZED',authorized_by='STAGING acceptance',authorized_at=at_time where id=successor;
 update price_definition set status='SUPERSEDED',valid_to=at_time,superseded_by_id=successor,superseded_at=at_time where id=predecessor.id;
end $test$;
