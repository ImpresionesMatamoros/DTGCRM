-- Reuse existing posts, reactions, scoped read state and push delivery.
alter table public.team_posts add column if not exists file_size bigint check (file_size is null or file_size >= 0);
alter table public.chat_user_state add column if not exists notif_after_hours boolean not null default false;
insert into public.chat_user_state(user_id,notif_after_hours)
select id,true from public.profiles where active and lower(display_name) in ('martin','ceci')
on conflict(user_id) do update set notif_after_hours=true;

alter table public.feed_reactions drop constraint feed_reactions_reaction_type_check;
alter table public.feed_reactions add constraint feed_reactions_reaction_type_check
check(reaction_type in ('celebrate','terrible','surprised','oh_no','im_in','confused','ack'));

create or replace function public.chat_can_view_scope(p_conversation_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select public.is_active_member() and (p_conversation_id is null or exists(
    select 1 from public.chat_conversations c where c.id=p_conversation_id
  ));
$$;
revoke all on function public.chat_can_view_scope(uuid) from public,anon;
grant execute on function public.chat_can_view_scope(uuid) to authenticated;
create policy chat_read_state_visible_scope on public.chat_read_state for select to authenticated
using (public.chat_can_view_scope(conversation_id));

create or replace function public.chat_read_receipts(p_post_ids uuid[])
returns table(post_id uuid,user_id uuid,display_name text)
language sql stable security invoker set search_path='' as $$
  select p.id,r.user_id,pr.display_name
  from public.team_posts p
  join public.chat_read_state r on r.conversation_id is not distinct from p.conversation_id
    and r.last_seen_at >= p.created_at
  join public.profiles pr on pr.id=r.user_id and pr.active
  where public.is_active_member() and p.id=any(p_post_ids[1:250])
    and p.deleted_at is null and r.user_id<>p.author_user_id;
$$;
revoke all on function public.chat_read_receipts(uuid[]) from public,anon;
grant execute on function public.chat_read_receipts(uuid[]) to authenticated;

-- Internal fan-out helper; callers cannot inspect another member's scopes.
create or replace function public.chat_user_can_read_scope(p_scope uuid,p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles pr where pr.id=p_user and pr.active)
  and (p_scope is null or exists(
    select 1 from public.chat_conversations c where c.id=p_scope and (
      (c.kind='direct' and p_user in(c.member_a,c.member_b)) or
      (c.kind='ticket' and exists(
        select 1 from public.tickets t where t.id=c.ticket_id and (
          t.visibility='team' or exists(select 1 from public.ticket_access a where a.ticket_id=t.id and a.profile_id=p_user)
        )
      ))
    )
  ));
$$;
revoke all on function public.chat_user_can_read_scope(uuid,uuid) from public,anon,authenticated;
grant execute on function public.chat_user_can_read_scope(uuid,uuid) to service_role;

create or replace function public.chat_notification_kind_for_user(p_id uuid,p_user uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare p public.team_posts; root uuid;
begin
  select * into p from public.team_posts where id=p_id;
  if not found or p.deleted_at is not null or p.author_user_id=p_user
    or (p.expires_at is not null and p.expires_at<=now())
    or not public.chat_user_can_read_scope(p.conversation_id,p_user) then return null; end if;
  -- File uploads without addressed text are silent, even when unread.
  if coalesce(p.text,'')='' and (p.file_storage_path is not null or p.image_storage_path is not null) then return null; end if;
  if exists(select 1 from public.chat_conversations c where c.id=p.conversation_id and c.kind='direct') then return 'personal'; end if;
  if p.mentions @> jsonb_build_array(jsonb_build_object('id',p_user::text)) then return 'mencion'; end if;
  if exists(select 1 from public.team_posts replied where replied.id=p.reply_to_id
    and replied.author_user_id=p_user and replied.deleted_at is null
    and replied.conversation_id is not distinct from p.conversation_id) then return 'respuesta'; end if;
  root:=coalesce(p.thread_root_id,(select coalesce(q.thread_root_id,q.id) from public.team_posts q
    where q.id=p.reply_to_id and q.conversation_id is not distinct from p.conversation_id));
  if root is not null and exists(select 1 from public.team_posts q
    where (q.id=root or q.thread_root_id=root) and q.deleted_at is null and q.created_at<=p.created_at
      and q.conversation_id is not distinct from p.conversation_id
      and q.mentions @> jsonb_build_array(jsonb_build_object('id',p_user::text))) then return 'respuesta'; end if;
  return null;
end $$;
revoke all on function public.chat_notification_kind_for_user(uuid,uuid) from public,anon,authenticated;
grant execute on function public.chat_notification_kind_for_user(uuid,uuid) to service_role;

create or replace function public.chat_notification_hours(p_at timestamptz,p_all_hours boolean)
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce(p_all_hours,false) or
    ((p_at at time zone 'America/Chicago')::time >= time '07:00'
      and (p_at at time zone 'America/Chicago')::time < time '18:00');
$$;
revoke all on function public.chat_notification_hours(timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.chat_notification_hours(timestamptz,boolean) to service_role;

create or replace function public.push_targets_for_post(p_post_id uuid)
returns table(user_id uuid,endpoint text,p256dh text,auth text,autor text,cuerpo text,es_mencion boolean,es_equipo boolean)
language plpgsql security definer set search_path='' as $$
declare p public.team_posts;
begin
  select * into p from public.team_posts where id=p_post_id for update;
  if not found or p.push_sent_at is not null or p.deleted_at is not null then return; end if;
  return query
    select s.user_id,s.endpoint,s.p256dh,s.auth,coalesce(p.author_name_snapshot,'Equipo'),
      left(coalesce(nullif(p.text,''),'Mensaje de voz'),140),
      k.kind='mencion',false
    from public.push_subscriptions s
    join public.profiles pr on pr.id=s.user_id and pr.active
    join public.chat_user_state st on st.user_id=s.user_id
    cross join lateral (select public.chat_notification_kind_for_user(p.id,s.user_id) kind) k
    where s.failures<5 and st.notif_push and k.kind is not null
      and (case when k.kind='personal' then st.notif_mensajes else st.notif_menciones end)
      and public.chat_notification_hours(now(),st.notif_after_hours)
      and p.created_at>=now()-interval '5 minutes';
  -- Recipient resolution happens before the deduplication marker.
  update public.team_posts set push_sent_at=now() where id=p.id;
end $$;
revoke all on function public.push_targets_for_post(uuid) from public,anon,authenticated;
grant execute on function public.push_targets_for_post(uuid) to service_role;
