-- Non-destructive deployment check. Full behavior is covered in CLIENT-FORMS-DB-QA.cjs.
begin;
do $$
begin
 assert (select relrowsecurity from pg_class where oid='public.client_form_requests'::regclass);
 assert not has_table_privilege('anon','public.client_form_requests','SELECT');
 assert not has_column_privilege('authenticated','public.client_form_requests','token_hash','SELECT');
 assert has_column_privilege('authenticated','public.client_form_requests','answers','SELECT');
 assert not has_table_privilege('authenticated','public.client_form_requests','INSERT');
 assert not has_table_privilege('authenticated','public.client_form_requests','UPDATE');
 assert not has_table_privilege('authenticated','public.client_form_requests','DELETE');
 assert has_function_privilege('anon','public.client_form_get(text)','EXECUTE');
 assert has_function_privilege('anon','public.client_form_submit(text,uuid,jsonb)','EXECUTE');
 assert not has_function_privilege('anon','public.client_form_create(uuid,uuid,text,text,text,text[],integer)','EXECUTE');
 assert not has_function_privilege('anon','public.client_form_manage(uuid,text,text)','EXECUTE');
 assert public.client_form_get('invalid')='{"state":"unavailable"}'::jsonb;
end $$;
rollback;
