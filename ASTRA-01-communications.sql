-- Reviewed against DesignToGoCRM on 2026-09-29 UTC. Apply before deploying index.html.
-- New public tables have broad DEFAULT PRIVILEGES in this project; explicit
-- REVOKE below is as important as their RLS policies.
create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  member_a uuid not null references public.profiles(id),
  member_b uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint distinct_members check (member_a < member_b),
  unique (member_a, member_b)
);
alter table public.chat_conversations enable row level security;
create policy chat_conversations_read on public.chat_conversations for select to authenticated
  using (public.is_active_member() and (member_a = (select auth.uid()) or member_b = (select auth.uid())));
create policy chat_conversations_create on public.chat_conversations for insert to authenticated
  with check (public.is_active_member() and (member_a = (select auth.uid()) or member_b = (select auth.uid()))
    and exists(select 1 from public.profiles p where p.id = member_a and p.active)
    and exists(select 1 from public.profiles p where p.id = member_b and p.active));
revoke all on public.chat_conversations from public, anon, authenticated;
grant select, insert on public.chat_conversations to authenticated;

alter table public.team_posts
  add column conversation_id uuid references public.chat_conversations(id),
  add column reply_to_id uuid references public.team_posts(id),
  add column thread_root_id uuid references public.team_posts(id),
  add column references_data jsonb not null default '[]'::jsonb,
  add column audio_storage_path text,
  add column audio_mime text,
  add column audio_seconds integer,
  add column transcript text,
  add column transcript_status text check (transcript_status in ('transcribing','ready','failed'));
create index team_posts_conversation_time on public.team_posts(conversation_id, created_at);
create index team_posts_thread_time on public.team_posts(thread_root_id, created_at);

-- The original SELECT policy exposed all posts. Replace it; permissive policies OR together.
drop policy if exists team_posts_select on public.team_posts;
create policy team_posts_select on public.team_posts for select to authenticated
  using (public.is_active_member() and (
    conversation_id is null or exists (
      select 1 from public.chat_conversations c where c.id = conversation_id
      and ((select auth.uid()) = c.member_a or (select auth.uid()) = c.member_b)
    )
  ));
drop policy if exists team_posts_insert on public.team_posts;
create policy team_posts_insert on public.team_posts for insert to authenticated
  with check (public.is_active_member() and author_user_id = (select auth.uid())
    and pin_level <> 'megapin' and (
      conversation_id is null or exists (
        select 1 from public.chat_conversations c where c.id = conversation_id
        and ((select auth.uid()) = c.member_a or (select auth.uid()) = c.member_b)
      )
    ));
-- Prevent moving a message to a different conversation, forging its author or rewriting references.
create function public.astra_guard_post() returns trigger language plpgsql set search_path = public as $$
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
    or new.expires_at is not null or new.ticket_id is not null or new.image_storage_path is not null)
  then raise exception 'Private message cannot broadcast, expire, or use legacy links or images'; end if;
  if new.audio_storage_path is not null and
    new.audio_storage_path not like (coalesce(new.conversation_id::text,'team') || '/%')
  then raise exception 'Audio path outside conversation'; end if;
  return new;
end $$;
create trigger astra_guard_post before insert or update on public.team_posts
  for each row execute function public.astra_guard_post();
revoke all on function public.astra_guard_post() from public, anon, authenticated;

-- The pre-existing push RPC runs with SECURITY DEFINER. It must never fan out
-- a private post to all subscribers. Its EXECUTE privilege already belongs
-- only to service_role; CREATE OR REPLACE retains that privilege.
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
        where c.id = p.conversation_id and s.user_id in (c.member_a, c.member_b)
      ))
      and (st.notif_mensajes or (st.notif_menciones and (p.mentions_all
        or p.mentions @> jsonb_build_array(jsonb_build_object('id', s.user_id::text)))));
end $$;

-- Reactions on personal messages would leak authors and message IDs under the old policy.
drop policy if exists feed_reactions_select on public.feed_reactions;
create policy feed_reactions_select on public.feed_reactions for select to authenticated
  using (public.is_active_member() and (target_type <> 'post' or exists (
    select 1 from public.team_posts p where p.id::text = target_id and p.deleted_at is null
  )));
drop policy if exists feed_reactions_insert on public.feed_reactions;
create policy feed_reactions_insert on public.feed_reactions for insert to authenticated
  with check (public.is_active_member() and user_id = (select auth.uid()) and (target_type <> 'post' or exists (
    select 1 from public.team_posts p where p.id::text = target_id and p.deleted_at is null
  )));
drop policy if exists feed_reactions_update_own on public.feed_reactions;
create policy feed_reactions_update_own on public.feed_reactions for update to authenticated
  using (public.is_active_member() and user_id = (select auth.uid()))
  with check (public.is_active_member() and user_id = (select auth.uid()) and
    (target_type <> 'post' or exists (
      select 1 from public.team_posts p where p.id::text = target_id and p.deleted_at is null
    )));

-- A link points at the original message or thread root; replies remain live.
-- Personal threads are deliberately excluded until a reviewed access grant
-- and private-file policy can safely cover every ticket viewer.
create table public.chat_ticket_links (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id),
  post_id uuid not null references public.team_posts(id),
  link_kind text not null check (link_kind in ('message','thread')),
  linked_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(ticket_id,post_id,link_kind)
);
alter table public.chat_ticket_links enable row level security;
create policy chat_ticket_links_read on public.chat_ticket_links for select to authenticated
  using (public.is_active_member() and public.ticket_is_visible_to_me(ticket_id));
create policy chat_ticket_links_write on public.chat_ticket_links for insert to authenticated
  with check (public.is_active_member() and linked_by = (select auth.uid())
    and public.ticket_is_visible_to_me(ticket_id)
    and exists(select 1 from public.team_posts p where p.id=post_id
      and p.conversation_id is null and p.deleted_at is null
      and (link_kind='message' or p.thread_root_id is null)));
revoke all on public.chat_ticket_links from public, anon, authenticated;
grant select, insert on public.chat_ticket_links to authenticated;

create table public.chat_later (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  post_id uuid not null references public.team_posts(id),
  remind_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id,post_id)
);
alter table public.chat_later enable row level security;
create policy chat_later_own on public.chat_later for all to authenticated
  using (public.is_active_member() and user_id=(select auth.uid())
    and exists(select 1 from public.team_posts p where p.id=post_id and p.deleted_at is null))
  with check (public.is_active_member() and user_id=(select auth.uid())
    and exists(select 1 from public.team_posts p where p.id=post_id and p.deleted_at is null));
revoke all on public.chat_later from public, anon, authenticated;
grant select, insert, update, delete on public.chat_later to authenticated;

-- Dedicated private bucket. Existing ticket-files policies allow any authenticated user to read;
-- NEVER place a personal-chat attachment there.
insert into storage.buckets(id,name,public) values ('chat-private','chat-private',false)
on conflict (id) do nothing;
create policy chat_private_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-private' and public.is_active_member() and (
    split_part(name,'/',1)='team' or exists (
    select 1 from public.chat_conversations c where c.id::text = split_part(name,'/',1)
      and ((select auth.uid()) = c.member_a or (select auth.uid()) = c.member_b)
  )));
create policy chat_private_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-private' and public.is_active_member() and (
    split_part(name,'/',1)='team' or exists (
    select 1 from public.chat_conversations c where c.id::text = split_part(name,'/',1)
      and ((select auth.uid()) = c.member_a or (select auth.uid()) = c.member_b)
  )));
create policy chat_private_delete_own on storage.objects for delete to authenticated
  using (bucket_id='chat-private' and public.is_active_member()
    and owner_id=(select auth.uid())::text);
