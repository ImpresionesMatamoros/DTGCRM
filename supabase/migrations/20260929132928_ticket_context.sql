-- Additive ticket conversations. Existing direct conversations keep their identities.
-- Team remains conversation_id NULL. No message backfill, no data deletion.
alter table public.chat_conversations
 add column kind text not null default 'direct',
 add column ticket_id uuid references public.tickets(id),
 alter column member_a drop not null,
 alter column member_b drop not null;
alter table public.chat_conversations add constraint conversation_scope_check check (
 (kind='direct' and ticket_id is null and member_a is not null and member_b is not null and member_a<member_b)
 or (kind='ticket' and ticket_id is not null and member_a is null and member_b is null));
create unique index chat_conversations_ticket_unique on public.chat_conversations(ticket_id) where kind='ticket';
alter table public.team_posts add column file_storage_path text, add column file_name text, add column file_mime text;

alter policy chat_conversations_read on public.chat_conversations using (
 public.is_active_member() and ((kind='direct' and (member_a=(select auth.uid()) or member_b=(select auth.uid())))
 or (kind='ticket' and public.ticket_is_visible_to_me(ticket_id))));
alter policy chat_conversations_create on public.chat_conversations with check (
 public.is_active_member() and ((kind='ticket' and public.ticket_is_visible_to_me(ticket_id))
 or (kind='direct' and (member_a=(select auth.uid()) or member_b=(select auth.uid()))
 and exists(select 1 from public.profiles p where p.id=member_a and p.active)
 and exists(select 1 from public.profiles p where p.id=member_b and p.active))));
alter policy team_posts_select on public.team_posts using (
 public.is_active_member() and (conversation_id is null or exists(select 1 from public.chat_conversations c where c.id=conversation_id)));
alter policy team_posts_insert on public.team_posts with check (
 public.is_active_member() and author_user_id=(select auth.uid()) and pin_level<>'megapin'
 and (conversation_id is null or exists(select 1 from public.chat_conversations c where c.id=conversation_id)));
alter policy team_posts_update_own_or_admin on public.team_posts
 using (public.is_active_member() and (author_user_id=(select auth.uid()) or public.is_admin())
 and (conversation_id is null or exists(select 1 from public.chat_conversations c where c.id=conversation_id)))
 with check (public.is_active_member() and (author_user_id=(select auth.uid()) or public.is_admin())
 and (pin_level<>'megapin' or public.is_admin())
 and (conversation_id is null or exists(select 1 from public.chat_conversations c where c.id=conversation_id)));

-- Storage lookup uses the conversation's RLS, including ticket visibility.
alter policy chat_private_read on storage.objects using (
 bucket_id='chat-private' and public.is_active_member() and
 (split_part(name,'/',1)='team' or exists(select 1 from public.chat_conversations c where c.id::text=split_part(name,'/',1))));
alter policy chat_private_upload on storage.objects with check (
 bucket_id='chat-private' and public.is_active_member() and
 (split_part(name,'/',1)='team' or exists(select 1 from public.chat_conversations c where c.id::text=split_part(name,'/',1))));

create or replace function public.astra_guard_post() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.conversation_id is distinct from old.conversation_id
       or new.author_user_id is distinct from old.author_user_id
       or new.reply_to_id is distinct from old.reply_to_id
       or new.thread_root_id is distinct from old.thread_root_id
       or new.references_data is distinct from old.references_data then
      raise exception 'Immutable message identity';
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.reply_to_id is not null and not exists (
      select 1 from public.team_posts p where p.id = new.reply_to_id
      and p.conversation_id is not distinct from new.conversation_id
      and p.deleted_at is null
    ) then raise exception 'Reply outside conversation'; end if;
    if new.thread_root_id is not null and not exists (
      select 1 from public.team_posts p where p.id = new.thread_root_id
      and p.thread_root_id is null and p.conversation_id is not distinct from new.conversation_id
      and p.deleted_at is null
    ) then raise exception 'Invalid thread root'; end if;
    if new.thread_root_id is not null and new.reply_to_id is not null and not exists (
      select 1 from public.team_posts p where p.id=new.reply_to_id
      and (p.id=new.thread_root_id or p.thread_root_id=new.thread_root_id)
    ) then raise exception 'Reply outside thread'; end if;
  end if;
  -- The private-chat constraints must apply to UPDATE too: the existing post
  -- UPDATE policy permits authors to edit their own rows.
  if new.conversation_id is not null and (new.pin_level <> 'none' or new.mentions_all
    or new.expires_at is not null or new.ticket_id is not null )
  then raise exception 'Private message cannot broadcast, expire, or use legacy links or images'; end if;
  if new.image_storage_path is not null and new.conversation_id is not null and new.image_storage_path not like (new.conversation_id::text || '/%') then raise exception 'Image outside conversation'; end if;
  if new.file_storage_path is not null and (new.conversation_id is null or new.file_storage_path not like (new.conversation_id::text || '/%')) then raise exception 'File outside conversation'; end if;
  if new.audio_storage_path is not null and
    new.audio_storage_path not like (coalesce(new.conversation_id::text,'team') || '/%')
  then raise exception 'Audio path outside conversation'; end if;
  return new;
end $$;

create or replace function public.push_targets_for_post(p_post_id uuid)
returns table(user_id uuid, endpoint text, p256dh text, auth text, autor text,
  cuerpo text, es_mencion boolean, es_equipo boolean)
language plpgsql security definer set search_path = '' as $$
declare p public.team_posts;
begin
  update public.team_posts set push_sent_at = now()
    where id = p_post_id and push_sent_at is null and deleted_at is null
    returning * into p;
  if not found then return; end if;
  return query
    select s.user_id, s.endpoint, s.p256dh, s.auth,
      coalesce(p.author_name_snapshot, 'Equipo'), left(coalesce(p.text, ''), 140),
      (p.mentions @> jsonb_build_array(jsonb_build_object('id', s.user_id::text))),
      p.mentions_all
    from public.push_subscriptions s
    join public.profiles pr on pr.id = s.user_id
    join public.chat_user_state st on st.user_id = s.user_id
    where pr.active and s.user_id <> p.author_user_id and st.notif_push
      and s.failures < 5
      and (p.conversation_id is null or exists (
        select 1 from public.chat_conversations c
        where c.id = p.conversation_id and (s.user_id in (c.member_a, c.member_b) or (c.kind='ticket' and exists(select 1 from public.tickets t where t.id=c.ticket_id and (t.visibility='team' or exists(select 1 from public.ticket_access a where a.ticket_id=t.id and a.profile_id=s.user_id)))))
      ))
      and (st.notif_mensajes or (st.notif_menciones and (p.mentions_all
        or p.mentions @> jsonb_build_array(jsonb_build_object('id', s.user_id::text)))));
end $$;
