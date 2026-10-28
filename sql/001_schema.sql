-- DarkKnight Messenger — Schema
-- Apply in Supabase SQL Editor (in order: 001 → 002 → 003)

create extension if not exists "pgcrypto";

-- Profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null default '',
  bio text default '',
  avatar_url text default '',
  phone_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz default now(),
  constraint username_format check (
    username is null or username ~ '^[a-z0-9_]{3,24}$'
  )
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username)) where username is not null;

-- Conversations: private | group | channel
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('private', 'group', 'channel')),
  title text default '',
  description text default '',
  avatar_url text default '',
  is_public boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz default now()
);

create index if not exists conversations_last_msg_idx on public.conversations (last_message_at desc);
create index if not exists conversations_public_idx on public.conversations (is_public) where type = 'channel' and is_public = true;

-- Members / participants
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'subscriber')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz default now(),
  muted boolean not null default false,
  primary key (conversation_id, user_id)
);

create index if not exists conv_members_user_idx on public.conversation_members (user_id);

-- Messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text default '',
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  attachment_size bigint,
  client_id text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists messages_conv_created_idx
  on public.messages (conversation_id, created_at desc);

create unique index if not exists messages_client_id_uidx
  on public.messages (conversation_id, sender_id, client_id)
  where client_id is not null;

-- Typing (ephemeral-ish, overwritten)
create table if not exists public.typing_status (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- Blocks
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- Helper: is member
create or replace function public.is_conversation_member(cid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = cid and m.user_id = uid
  );
$$;

create or replace function public.is_conversation_admin(cid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = cid and m.user_id = uid
      and m.role in ('owner', 'admin')
  );
$$;

-- Auto profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', 'کاربر جدید'),
    null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Touch conversation last_message_at
create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at, updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists on_message_insert on public.messages;
create trigger on_message_insert
  after insert on public.messages
  for each row execute function public.touch_conversation_on_message();

-- Secure private conversation creation
create or replace function public.create_private_conversation(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing uuid;
  new_id uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if other_user is null or other_user = me then
    raise exception 'invalid peer';
  end if;
  if exists (select 1 from public.blocks b where (b.blocker_id = me and b.blocked_id = other_user) or (b.blocker_id = other_user and b.blocked_id = me)) then
    raise exception 'blocked';
  end if;

  select c.id into existing
  from public.conversations c
  join public.conversation_members m1 on m1.conversation_id = c.id and m1.user_id = me
  join public.conversation_members m2 on m2.conversation_id = c.id and m2.user_id = other_user
  where c.type = 'private'
  limit 1;

  if existing is not null then
    return existing;
  end if;

  insert into public.conversations (type, created_by)
  values ('private', me)
  returning id into new_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (new_id, me, 'member'), (new_id, other_user, 'member');

  return new_id;
end;
$$;

create or replace function public.create_group_conversation(p_title text, p_member_ids uuid[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  new_id uuid;
  mid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if length(trim(coalesce(p_title, ''))) < 2 then raise exception 'title required'; end if;

  insert into public.conversations (type, title, created_by)
  values ('group', trim(p_title), me)
  returning id into new_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (new_id, me, 'owner');

  if p_member_ids is not null then
    foreach mid in array p_member_ids loop
      if mid is distinct from me then
        insert into public.conversation_members (conversation_id, user_id, role)
        values (new_id, mid, 'member')
        on conflict do nothing;
      end if;
    end loop;
  end if;
  return new_id;
end;
$$;

create or replace function public.create_channel(p_title text, p_description text default '', p_is_public boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  new_id uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if length(trim(coalesce(p_title, ''))) < 2 then raise exception 'title required'; end if;

  insert into public.conversations (type, title, description, is_public, created_by)
  values ('channel', trim(p_title), coalesce(p_description, ''), coalesce(p_is_public, true), me)
  returning id into new_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (new_id, me, 'owner');

  return new_id;
end;
$$;
