-- DTG CRM · Chat notifications / unread state / push plumbing
-- Applied to DesignToGoCRM on 2026-09-29. Non-destructive and reproducible.

create table if not exists public.chat_read_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.chat_conversations(id) on delete cascade,
  scope_key text generated always as (coalesce(conversation_id::text, 'team')) stored,
  last_seen_at timestamptz,
  last_mention_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope_key)
);
alter table public.chat_read_state enable row level security;
drop policy if exists chat_read_state_own on public.chat_read_state;
create policy chat_read_state_own on public.chat_read_state
  for all to authenticated
  using (public.is_active_member() and user_id = (select auth.uid()))
  with check (public.is_active_member() and user_id = (select auth.uid()) and (
    conversation_id is null or exists (
      select 1 from public.chat_conversations c where c.id = conversation_id
    )
  ));
revoke all on public.chat_read_state from public, anon, authenticated;
grant select, insert, update on public.chat_read_state to authenticated;

create or replace function public.chat_mark_scope_seen(
  p_conversation_id uuid,
  p_seen timestamptz,
  p_mention_seen timestamptz default null
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_seen timestamptz := coalesce(p_seen, now());
  v_mention timestamptz := coalesce(p_mention_seen, p_seen, now());
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_conversation_id is not null and not exists (
    select 1 from public.chat_conversations c where c.id = p_conversation_id
  ) then raise exception 'Conversation not available'; end if;

  insert into public.chat_read_state(user_id, conversation_id, last_seen_at, last_mention_seen_at, updated_at)
  values (v_uid, p_conversation_id, v_seen, v_mention, now())
  on conflict (user_id, scope_key) do update set
    last_seen_at = greatest(coalesce(public.chat_read_state.last_seen_at, '-infinity'::timestamptz), excluded.last_seen_at),
    last_mention_seen_at = greatest(coalesce(public.chat_read_state.last_mention_seen_at, '-infinity'::timestamptz), excluded.last_mention_seen_at),
    updated_at = now();
end $$;
revoke all on function public.chat_mark_scope_seen(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.chat_mark_scope_seen(uuid,timestamptz,timestamptz) to authenticated;

create or replace function public.chat_unread_count_for_user(p_user_id uuid)
returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*)::bigint
  from public.team_posts p
  where p.deleted_at is null
    and (p.expires_at is null or p.expires_at > now())
    and p.author_user_id is distinct from p_user_id
    and (
      p.conversation_id is null
      or exists (
        select 1 from public.chat_conversations c
        where c.id = p.conversation_id
          and (
            (c.kind = 'direct' and p_user_id in (c.member_a, c.member_b))
            or
            (c.kind = 'ticket' and exists (
              select 1 from public.tickets t
              where t.id = c.ticket_id
                and (
                  t.visibility = 'team'
                  or exists (
                    select 1 from public.ticket_access a
                    where a.ticket_id = t.id and a.profile_id = p_user_id
                  )
                )
            ))
          )
      )
    )
    and p.created_at > coalesce(
      (
        select rs.last_seen_at from public.chat_read_state rs
        where rs.user_id = p_user_id
          and rs.conversation_id is not distinct from p.conversation_id
      ),
      case when p.conversation_id is null then (
        select st.last_seen_at from public.chat_user_state st where st.user_id = p_user_id
      ) end,
      (
        select nullif(s.values[1], '')::timestamptz
        from public.app_settings s where s.key = 'chat_unread_baseline'
      ),
      '1970-01-01 00:00:00+00'::timestamptz
    );
$$;
revoke all on function public.chat_unread_count_for_user(uuid) from public, anon, authenticated;
grant execute on function public.chat_unread_count_for_user(uuid) to service_role;

create or replace function public.push_delivery_config()
returns table(webhook_secret text, vapid_public text, vapid_private text, vapid_subject text)
language sql stable security definer set search_path = '' as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'dtg_push_webhook_secret'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'dtg_vapid_public'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'dtg_vapid_private'),
    coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'dtg_vapid_subject'), 'https://example.com');
$$;
revoke all on function public.push_delivery_config() from public, anon, authenticated;
grant execute on function public.push_delivery_config() to service_role;

create or replace function public.push_initialize_config(
  p_webhook_secret text,
  p_vapid_public text,
  p_vapid_private text,
  p_vapid_subject text,
  p_function_url text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'service role required';
  end if;
  if exists(select 1 from vault.secrets where name='dtg_vapid_private') then return; end if;
  perform vault.create_secret(p_webhook_secret,'dtg_push_webhook_secret','DTG push webhook shared secret');
  perform vault.create_secret(p_vapid_public,'dtg_vapid_public','DTG Web Push public VAPID key');
  perform vault.create_secret(p_vapid_private,'dtg_vapid_private','DTG Web Push private VAPID key');
  perform vault.create_secret(p_vapid_subject,'dtg_vapid_subject','DTG Web Push VAPID subject');
  perform vault.create_secret(p_function_url,'dtg_push_function_url','DTG push fanout Edge Function URL');
end $$;
revoke all on function public.push_initialize_config(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.push_initialize_config(text,text,text,text,text) to service_role;

create or replace function public.push_note_failure(p_endpoint text)
returns void language sql security definer set search_path='' as $$
  update public.push_subscriptions
  set failures = least(32767, failures + 1)
  where endpoint = p_endpoint;
$$;
revoke all on function public.push_note_failure(text) from public, anon, authenticated;
grant execute on function public.push_note_failure(text) to service_role;

create or replace function public.team_posts_push_webhook()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  if new.deleted_at is not null then return new; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'dtg_push_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'dtg_push_webhook_secret';
  if coalesce(v_url,'') = '' or coalesce(v_secret,'') = '' then
    raise warning 'DTG push no configurado: faltan secretos de Vault';
    return new;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-dtg-secret',v_secret),
    body := jsonb_build_object('record', jsonb_build_object('id', new.id, 'deleted_at', new.deleted_at)),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  raise warning 'push-fanout no se pudo invocar: %', sqlerrm;
  return new;
end $$;
revoke all on function public.team_posts_push_webhook() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='chat_read_state'
  ) then
    alter publication supabase_realtime add table public.chat_read_state;
  end if;
end $$;
