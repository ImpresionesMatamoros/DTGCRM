-- Authenticated RLS checks, no durable files or profile edits. Run with an admin connection.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"dca2fa19-de95-43c0-a3bf-89bb16fa4d7d","role":"authenticated"}',true);
insert into storage.objects(bucket_id,name,owner_id)
values('profile-avatars','dca2fa19-de95-43c0-a3bf-89bb16fa4d7d/qa-rollback.jpg','dca2fa19-de95-43c0-a3bf-89bb16fa4d7d');
update public.profiles set avatar_storage_path=id::text||'/qa-rollback.jpg' where id=auth.uid();
do $$declare affected int;begin
assert (select avatar_storage_path from public.profiles where id=auth.uid())=auth.uid()::text||'/qa-rollback.jpg';
update public.profiles set avatar_storage_path='6045aa25-c6e0-4b0b-9703-b99763b08628/qa-rollback.jpg' where id='6045aa25-c6e0-4b0b-9703-b99763b08628';
get diagnostics affected=row_count;assert affected=0;
begin
insert into storage.objects(bucket_id,name,owner_id) values('profile-avatars','6045aa25-c6e0-4b0b-9703-b99763b08628/qa-invalid.jpg','dca2fa19-de95-43c0-a3bf-89bb16fa4d7d');
raise exception 'Cross-owner upload unexpectedly allowed';
exception when insufficient_privilege then null;end;
begin
update public.profiles set avatar_storage_path='6045aa25-c6e0-4b0b-9703-b99763b08628/wrong.jpg' where id=auth.uid();
raise exception 'Cross-owner metadata unexpectedly allowed';
exception when check_violation then null;end;
end$$;
select set_config('request.jwt.claims','{"sub":"6045aa25-c6e0-4b0b-9703-b99763b08628","role":"authenticated"}',true);
do $$begin
assert exists(select 1 from storage.objects where bucket_id='profile-avatars' and name='dca2fa19-de95-43c0-a3bf-89bb16fa4d7d/qa-rollback.jpg');
end$$;
rollback;
select 'PASS avatar owner update/upload, cross-owner writes denied, active team reads, rollback' qa;
