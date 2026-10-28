-- DarkKnight Messenger — Phase 2
-- Apply AFTER 001, 002, 003. Do not re-run older migrations.

-- Profile extras
alter table public.profiles
  add column if not exists gender text
    check (gender is null or gender in ('male', 'female', 'other', 'unspecified')),
  add column if not exists country text default '',
  add column if not exists show_last_seen boolean not null default true,
  add column if not exists show_online boolean not null default true;

-- Message delivery / read tracking (per-recipient for private; optional for groups)
create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz default now(),
  read_at timestamptz,
  primary key (message_id, user_id)
);

create index if not exists message_receipts_user_idx on public.message_receipts (user_id);

alter table public.message_receipts enable row level security;

drop policy if exists receipts_select on public.message_receipts;
create policy receipts_select on public.message_receipts
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.messages m
      where m.id = message_id and m.sender_id = auth.uid()
    )
  );

drop policy if exists receipts_insert_self on public.message_receipts;
create policy receipts_insert_self on public.message_receipts
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      join public.conversation_members cm
        on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
      where m.id = message_id
    )
  );

drop policy if exists receipts_update_self on public.message_receipts;
create policy receipts_update_self on public.message_receipts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Prevent role self-escalation: members may only update last_read_at / muted for self
drop policy if exists members_update_self_read on public.conversation_members;
create policy members_update_self_read on public.conversation_members
  for update to authenticated
  using (
    user_id = auth.uid()
    or public.is_conversation_admin(conversation_id, auth.uid())
  )
  with check (
    (
      user_id = auth.uid()
      and role = (select m.role from public.conversation_members m
                  where m.conversation_id = conversation_id and m.user_id = auth.uid())
    )
    or public.is_conversation_admin(conversation_id, auth.uid())
  );

-- Safe public profile fields only
create or replace function public.get_public_profile(p_id uuid)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  country text,
  gender text,
  created_at timestamptz,
  last_seen_at timestamptz,
  is_online boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  return query
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio,
    p.country,
    p.gender,
    p.created_at,
    case when p.show_last_seen then p.last_seen_at else null end,
    case
      when p.show_online and p.last_seen_at is not null
        and p.last_seen_at > now() - interval '2 minutes'
      then true
      when p.show_online then false
      else null
    end
  from public.profiles p
  where p.id = p_id;
end;
$$;

revoke all on function public.get_public_profile(uuid) from public;
grant execute on function public.get_public_profile(uuid) to authenticated;

-- Username search (limited columns, no email/phone)
create or replace function public.search_profiles(p_query text, p_limit int default 20)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := lower(trim(both from coalesce(p_query, '')));
  lim int := least(greatest(coalesce(p_limit, 20), 1), 30);
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if char_length(q) < 2 then
    return;
  end if;
  return query
  select p.id, p.username, p.display_name, p.avatar_url, p.bio
  from public.profiles p
  where p.username is not null
    and (
      p.username ilike '%' || q || '%'
      or p.display_name ilike '%' || q || '%'
    )
  order by
    case when p.username = q then 0
         when p.username like q || '%' then 1
         else 2 end,
    p.username
  limit lim;
end;
$$;

revoke all on function public.search_profiles(text, int) from public;
grant execute on function public.search_profiles(text, int) to authenticated;

-- Heartbeat last_seen
create or replace function public.touch_last_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  update public.profiles
  set last_seen_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.touch_last_seen() from public;
grant execute on function public.touch_last_seen() to authenticated;

-- Group: add member (admin/owner only)
create or replace function public.group_add_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_conversation_admin(p_conversation_id, auth.uid()) then
    raise exception 'forbidden';
  end if;
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and c.type = 'group'
  ) then
    raise exception 'not a group';
  end if;
  insert into public.conversation_members (conversation_id, user_id, role)
  values (p_conversation_id, p_user_id, 'member')
  on conflict do nothing;
end;
$$;

revoke all on function public.group_add_member(uuid, uuid) from public;
grant execute on function public.group_add_member(uuid, uuid) to authenticated;

-- Group: leave
create or replace function public.group_leave(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_role text;
  owners int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select role into my_role from public.conversation_members
  where conversation_id = p_conversation_id and user_id = auth.uid();
  if my_role is null then raise exception 'not a member'; end if;
  if my_role = 'owner' then
    select count(*) into owners from public.conversation_members
    where conversation_id = p_conversation_id and role = 'owner';
    if owners <= 1 then
      raise exception 'owner_must_transfer';
    end if;
  end if;
  delete from public.conversation_members
  where conversation_id = p_conversation_id and user_id = auth.uid();
end;
$$;

revoke all on function public.group_leave(uuid) from public;
grant execute on function public.group_leave(uuid) to authenticated;

-- List members for a conversation you belong to
create or replace function public.list_conversation_members(p_conversation_id uuid)
returns table (
  user_id uuid,
  role text,
  username text,
  display_name text,
  avatar_url text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(p_conversation_id, auth.uid()) then
    raise exception 'forbidden';
  end if;
  return query
  select m.user_id, m.role, p.username, p.display_name, p.avatar_url, m.joined_at
  from public.conversation_members m
  join public.profiles p on p.id = m.user_id
  where m.conversation_id = p_conversation_id
  order by
    case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    m.joined_at;
end;
$$;

revoke all on function public.list_conversation_members(uuid) from public;
grant execute on function public.list_conversation_members(uuid) to authenticated;

-- Mark messages read + receipts
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_member(p_conversation_id, auth.uid()) then
    raise exception 'forbidden';
  end if;
  update public.conversation_members
  set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid();

  insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
  select m.id, auth.uid(), now(), now()
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.sender_id is distinct from auth.uid()
    and m.deleted_at is null
  on conflict (message_id, user_id) do update
    set read_at = coalesce(public.message_receipts.read_at, excluded.read_at),
        delivered_at = coalesce(public.message_receipts.delivered_at, excluded.delivered_at);
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- Claim username at registration (atomic)
create or replace function public.claim_username(p_username text, p_display_name text default '', p_gender text default null, p_country text default '')
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  u text := lower(trim(both from coalesce(p_username, '')));
  dn text := trim(both from coalesce(p_display_name, ''));
  g text := nullif(trim(both from coalesce(p_gender, '')), '');
  c text := trim(both from coalesce(p_country, ''));
  rec public.profiles;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if u !~ '^[a-z0-9_]{3,24}$' then raise exception 'invalid_username'; end if;
  if g is not null and g not in ('male', 'female', 'other', 'unspecified') then
    g := 'unspecified';
  end if;
  if dn = '' then dn := u; end if;

  insert into public.profiles (id, username, display_name, gender, country)
  values (auth.uid(), u, dn, g, c)
  on conflict (id) do update set
    username = excluded.username,
    display_name = excluded.display_name,
    gender = coalesce(excluded.gender, public.profiles.gender),
    country = coalesce(nullif(excluded.country, ''), public.profiles.country),
    updated_at = now()
  where public.profiles.username is null
     or public.profiles.username = excluded.username
  returning * into rec;

  if rec.id is null then
    -- row exists with different username already set
    update public.profiles
    set display_name = coalesce(nullif(dn, ''), display_name),
        gender = coalesce(g, gender),
        country = coalesce(nullif(c, ''), country),
        updated_at = now()
    where id = auth.uid()
    returning * into rec;
  end if;

  if rec.username is distinct from u then
    -- try set username if free
    begin
      update public.profiles set username = u, updated_at = now()
      where id = auth.uid()
      returning * into rec;
    exception when unique_violation then
      raise exception 'username_taken';
    end;
  end if;

  return rec;
end;
$$;

revoke all on function public.claim_username(text, text, text, text) from public;
grant execute on function public.claim_username(text, text, text, text) to authenticated;
