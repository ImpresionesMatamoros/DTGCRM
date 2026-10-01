alter table public.profiles add column if not exists avatar_storage_path text;
alter table public.profiles add constraint profile_avatar_own_folder check
 (avatar_storage_path is null or split_part(avatar_storage_path,'/',1)=id::text);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-avatars','profile-avatars',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy profile_avatars_read_team on storage.objects for select to authenticated
 using(bucket_id='profile-avatars' and public.is_active_member());
create policy profile_avatars_insert_own on storage.objects for insert to authenticated
 with check(bucket_id='profile-avatars' and public.is_active_member() and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy profile_avatars_delete_own on storage.objects for delete to authenticated
 using(bucket_id='profile-avatars' and public.is_active_member() and (storage.foldername(name))[1]=(select auth.uid())::text);
alter table public.feed_reactions drop constraint feed_reactions_reaction_type_check;
alter table public.feed_reactions add constraint feed_reactions_reaction_type_check
 check(reaction_type in('celebrate','terrible','surprised','oh_no','im_in','confused','ack','laugh','love'));
