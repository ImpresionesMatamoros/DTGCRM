begin;
create temporary table qa_ids as select coalesce((select id from public.chat_conversations where member_a='6045aa25-c6e0-4b0b-9703-b99763b08628' and member_b='dca2fa19-de95-43c0-a3bf-89bb16fa4d7d'),gen_random_uuid()) dm,gen_random_uuid() post,gen_random_uuid() general,gen_random_uuid() mention,gen_random_uuid() upload;
insert into public.chat_conversations(id,member_a,member_b,kind)
select dm,'6045aa25-c6e0-4b0b-9703-b99763b08628','dca2fa19-de95-43c0-a3bf-89bb16fa4d7d','direct' from qa_ids on conflict(member_a,member_b) do nothing;
insert into public.team_posts(id,author_user_id,author_name_snapshot,text,conversation_id)
select post,'dca2fa19-de95-43c0-a3bf-89bb16fa4d7d','QA','QA privado',dm from qa_ids;
insert into public.team_posts(id,author_user_id,author_name_snapshot,text,mentions_all)
select general,'dca2fa19-de95-43c0-a3bf-89bb16fa4d7d','QA','QA general',true from qa_ids;
insert into public.team_posts(id,author_user_id,author_name_snapshot,text,mentions)
select mention,'dca2fa19-de95-43c0-a3bf-89bb16fa4d7d','QA','QA mencion','[{"id":"6045aa25-c6e0-4b0b-9703-b99763b08628"}]' from qa_ids;
insert into public.team_posts(id,author_user_id,author_name_snapshot,text,conversation_id,file_storage_path)
select upload,'dca2fa19-de95-43c0-a3bf-89bb16fa4d7d','QA','',dm,dm::text||'/qa.pdf' from qa_ids;
insert into public.chat_read_state(user_id,conversation_id,last_seen_at)
select '6045aa25-c6e0-4b0b-9703-b99763b08628',dm,now()+interval '1 second' from qa_ids on conflict(user_id,scope_key) do update set last_seen_at=excluded.last_seen_at;
do $$declare x record;begin
select * into x from qa_ids;
assert public.chat_notification_kind_for_user(x.post,'6045aa25-c6e0-4b0b-9703-b99763b08628')='personal';
assert public.chat_notification_kind_for_user(x.post,'5d6b45e6-20e2-4f86-a87b-15bafaa9714b') is null;
assert public.chat_notification_kind_for_user(x.general,'6045aa25-c6e0-4b0b-9703-b99763b08628') is null;
assert public.chat_notification_kind_for_user(x.mention,'6045aa25-c6e0-4b0b-9703-b99763b08628')='mencion';
assert public.chat_notification_kind_for_user(x.upload,'6045aa25-c6e0-4b0b-9703-b99763b08628') is null;
assert public.chat_notification_hours('2026-07-01 12:00Z',false);
assert not public.chat_notification_hours('2026-07-01 23:00Z',false);
assert public.chat_notification_hours('2026-12-01 13:00Z',false);
assert not public.chat_notification_hours('2026-12-01 12:59Z',false);
assert public.chat_notification_hours('2026-12-01 03:00Z',true);
end$$;

insert into public.team_posts(id,author_user_id,author_name_snapshot,text,reply_to_id)
select gen_random_uuid(),'6045aa25-c6e0-4b0b-9703-b99763b08628','QA','QA respuesta',general from qa_ids;
insert into public.team_posts(id,author_user_id,author_name_snapshot,text,thread_root_id)
select gen_random_uuid(),'5d6b45e6-20e2-4f86-a87b-15bafaa9714b','QA','QA hilo',mention from qa_ids;
insert into public.push_subscriptions(user_id,endpoint,p256dh,auth)
values('6045aa25-c6e0-4b0b-9703-b99763b08628','https://qa.invalid/rollback-only','qa','qa');
insert into public.chat_user_state(user_id,notif_push,notif_mensajes,notif_menciones,notif_after_hours)
values('6045aa25-c6e0-4b0b-9703-b99763b08628',true,true,true,true)
on conflict(user_id) do update set notif_push=true,notif_mensajes=true,notif_menciones=true,notif_after_hours=true;
do $$declare x record;begin
select * into x from qa_ids;
assert public.chat_notification_kind_for_user((select id from public.team_posts where reply_to_id=x.general),'dca2fa19-de95-43c0-a3bf-89bb16fa4d7d')='respuesta';
assert public.chat_notification_kind_for_user((select id from public.team_posts where thread_root_id=x.mention),'6045aa25-c6e0-4b0b-9703-b99763b08628')='respuesta';
assert (select count(*) from public.push_targets_for_post(x.post) where endpoint='https://qa.invalid/rollback-only')=1;
assert (select count(*) from public.push_targets_for_post(x.post))=0;
assert (select count(*) from public.push_targets_for_post(x.general))=0;
assert (select count(*) from public.push_targets_for_post(x.upload))=0;
end$$;

grant select on qa_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"dca2fa19-de95-43c0-a3bf-89bb16fa4d7d","role":"authenticated"}',true);
do $$begin
assert (select count(*) from public.chat_read_receipts(array[(select post from qa_ids)]))=1;
assert (select display_name from public.chat_read_receipts(array[(select post from qa_ids)]))='Ceci';
end$$;
select set_config('request.jwt.claims','{"sub":"6045aa25-c6e0-4b0b-9703-b99763b08628","role":"authenticated"}',true);
do $$begin assert exists(select 1 from public.team_posts where id=(select post from qa_ids));end$$;
insert into public.feed_reactions(target_type,target_id,user_id,user_name_snapshot,reaction_type) select 'post',post::text,'6045aa25-c6e0-4b0b-9703-b99763b08628','Ceci','ack' from qa_ids;
do $$begin assert exists(select 1 from public.feed_reactions where target_id=(select post::text from qa_ids) and reaction_type='ack');end$$;
select set_config('request.jwt.claims','{"sub":"5d6b45e6-20e2-4f86-a87b-15bafaa9714b","role":"authenticated"}',true);
do $$begin
assert not exists(select 1 from public.team_posts where id=(select post from qa_ids));
assert not exists(select 1 from public.chat_read_state where conversation_id=(select dm from qa_ids));
assert (select count(*) from public.chat_read_receipts(array[(select post from qa_ids)]))=0;
end$$;
select set_config('request.jwt.claims','{"sub":"7d28d473-a430-40ab-8750-128e2bea68fd","role":"authenticated"}',true);
do $$begin
assert not exists(select 1 from public.chat_conversations where id=(select dm from qa_ids));
assert not exists(select 1 from public.chat_read_state where conversation_id=(select dm from qa_ids));
end$$;
rollback;
select 'PASS: scoped DM/read receipts under four authenticated identities; recipient classification/replies/thread/ack/fan-out dedup; Chicago winter/summer boundaries; all QA records rolled back' qa;
