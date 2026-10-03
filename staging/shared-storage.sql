-- Empty private buckets and staging-only policies. No production objects copied.
do $$ begin if not exists(select 1 from staging_private.identity where environment='staging' and project_ref='hhzqmqndavqqswerjhxe') then raise exception 'Staging identity mismatch'; end if; end $$;
set search_path=public,extensions,pg_catalog;
insert into storage.buckets(id,name,public,file_size_limit) values ('ticket-files','ticket-files',false,52428800),('chat-private','chat-private',false,52428800),('profile-avatars','profile-avatars',false,5242880) on conflict(id) do nothing;
create policy staging_ticket_files on storage.objects for ALL to authenticated using (((bucket_id = 'ticket-files'::text) AND is_active_member() AND ((storage_ticket_id_from_path(name) IS NULL) OR ticket_is_visible_to_me(storage_ticket_id_from_path(name))))) with check (((bucket_id = 'ticket-files'::text) AND is_active_member() AND ((storage_ticket_id_from_path(name) IS NULL) OR ticket_is_visible_to_me(storage_ticket_id_from_path(name)))));
create policy staging_chat_files on storage.objects for SELECT to authenticated using (((bucket_id = 'chat-private'::text) AND is_active_member() AND ((split_part(name, '/'::text, 1) = 'team'::text) OR (EXISTS ( SELECT 1
   FROM chat_conversations c
  WHERE ((c.id)::text = split_part(objects.name, '/'::text, 1)))))));
create policy staging_chat_upload on storage.objects for INSERT to authenticated with check (((bucket_id = 'chat-private'::text) AND is_active_member() AND ((split_part(name, '/'::text, 1) = 'team'::text) OR (EXISTS ( SELECT 1
   FROM chat_conversations c
  WHERE ((c.id)::text = split_part(objects.name, '/'::text, 1)))))));
create policy staging_chat_delete on storage.objects for DELETE to authenticated using (((bucket_id = 'chat-private'::text) AND is_active_member() AND (owner_id = (auth.uid())::text)));
create policy staging_avatar_read on storage.objects for SELECT to authenticated using (((bucket_id = 'profile-avatars'::text) AND is_active_member()));
create policy staging_avatar_write on storage.objects for INSERT to authenticated with check (((bucket_id = 'profile-avatars'::text) AND is_active_member() AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy staging_avatar_update on storage.objects for UPDATE to authenticated using (((bucket_id = 'profile-avatars'::text) AND is_active_member() AND ((storage.foldername(name))[1] = (auth.uid())::text))) with check (((bucket_id = 'profile-avatars'::text) AND is_active_member() AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy staging_avatar_delete on storage.objects for DELETE to authenticated using (((bucket_id = 'profile-avatars'::text) AND is_active_member() AND ((storage.foldername(name))[1] = (auth.uid())::text)));
do $$ declare t text; begin foreach t in array array['tickets','productos','tareas','pagos','bitacora','team_posts','feed_reactions','chat_read_state','chat_user_state','chat_conversations','client_tasks','client_notes','clientes'] loop if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t); end if; end loop; end $$;

