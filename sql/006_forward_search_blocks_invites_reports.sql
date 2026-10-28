-- DarkKnight Messenger — phase: forward, search, invites, reports
-- Idempotent; does not delete user data.

-- Ensure forward column exists (also in 005)
alter table public.messages
  add column if not exists forwarded_from_message_id uuid references public.messages(id) on delete set null;

-- Invite links
create table if not exists public.invite_links (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  code text not null unique,
  created_by uuid not null references public.profiles(id) on delete cascade,
  max_uses int,
  uses int not null default 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists invite_links_conv_idx on public.invite_links (conversation_id);
create index if not exists invite_links_code_idx on public.invite_links (code);

alter table public.invite_links enable row level security;

drop policy if exists invite_links_select on public.invite_links;
create policy invite_links_select on public.invite_links
  for select to authenticated
  using (
    public.is_conversation_admin(conversation_id, auth.uid())
    or (revoked_at is null and (expires_at is null or expires_at > now()))
  );

drop policy if exists invite_links_insert on public.invite_links;
create policy invite_links_insert on public.invite_links
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_conversation_admin(conversation_id, auth.uid())
  );

drop policy if exists invite_links_update on public.invite_links;
create policy invite_links_update on public.invite_links
  for update to authenticated
  using (public.is_conversation_admin(conversation_id, auth.uid()));

-- Reports
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('message', 'user', 'conversation')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 2 and 500),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_id uuid references public.profiles(id) on delete set null
);

create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);
create unique index if not exists reports_unique_open_idx
  on public.reports (reporter_id, target_type, target_id)
  where status = 'open';

alter table public.reports enable row level security;

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = auth.uid());

-- Search messages in a conversation (member only)
create or replace function public.search_messages_in_conversation(
  p_conversation_id uuid,
  p_query text,
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  id uuid,
  body text,
  sender_id uuid,
  created_at timestamptz,
  username text,
  display_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := trim(both from coalesce(p_query, ''));
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.is_conversation_member(p_conversation_id, auth.uid()) then
    raise exception 'forbidden';
  end if;
  if char_length(q) < 1 then return; end if;

  return query
  select m.id, m.body, m.sender_id, m.created_at, p.username, p.display_name
  from public.messages m
  left join public.profiles p on p.id = m.sender_id
  where m.conversation_id = p_conversation_id
    and m.deleted_at is null
    and m.body ilike '%' || q || '%'
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.search_messages_in_conversation(uuid, text, int, int) from public;
grant execute on function public.search_messages_in_conversation(uuid, text, int, int) to authenticated;

-- Create invite link
create or replace function public.create_invite_link(
  p_conversation_id uuid,
  p_max_uses int default null,
  p_expires_hours int default null
)
returns public.invite_links
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  row public.invite_links;
  code text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if not public.is_conversation_admin(p_conversation_id, me) then
    raise exception 'forbidden';
  end if;
  code := encode(gen_random_bytes(9), 'hex');
  insert into public.invite_links (conversation_id, code, created_by, max_uses, expires_at)
  values (
    p_conversation_id,
    code,
    me,
    p_max_uses,
    case when p_expires_hours is null then null else now() + (p_expires_hours || ' hours')::interval end
  )
  returning * into row;
  return row;
end;
$$;

revoke all on function public.create_invite_link(uuid, int, int) from public;
grant execute on function public.create_invite_link(uuid, int, int) to authenticated;

-- Join via invite
create or replace function public.join_by_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  inv public.invite_links;
  ctype text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select * into inv from public.invite_links where code = trim(both from p_code);
  if inv.id is null then raise exception 'invalid_link'; end if;
  if inv.revoked_at is not null then raise exception 'revoked'; end if;
  if inv.expires_at is not null and inv.expires_at < now() then raise exception 'expired'; end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then raise exception 'exhausted'; end if;

  select type into ctype from public.conversations where id = inv.conversation_id;
  if ctype is null then raise exception 'not_found'; end if;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (
    inv.conversation_id,
    me,
    case when ctype = 'channel' then 'subscriber' else 'member' end
  )
  on conflict do nothing;

  update public.invite_links set uses = uses + 1 where id = inv.id;
  return inv.conversation_id;
end;
$$;

revoke all on function public.join_by_invite(text) from public;
grant execute on function public.join_by_invite(text) to authenticated;

create or replace function public.revoke_invite_link(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select conversation_id into cid from public.invite_links where id = p_id;
  if cid is null then raise exception 'not_found'; end if;
  if not public.is_conversation_admin(cid, auth.uid()) then raise exception 'forbidden'; end if;
  update public.invite_links set revoked_at = now() where id = p_id;
end;
$$;

revoke all on function public.revoke_invite_link(uuid) from public;
grant execute on function public.revoke_invite_link(uuid) to authenticated;

-- Forward message into another conversation
create or replace function public.forward_message(p_message_id uuid, p_target_conversation_id uuid)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  src public.messages;
  out_row public.messages;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select * into src from public.messages where id = p_message_id and deleted_at is null;
  if src.id is null then raise exception 'not_found'; end if;
  if not public.is_conversation_member(src.conversation_id, me) then raise exception 'forbidden_source'; end if;
  if not public.is_conversation_member(p_target_conversation_id, me) then raise exception 'forbidden_target'; end if;

  insert into public.messages (
    conversation_id, sender_id, body,
    attachment_path, attachment_name, attachment_mime, attachment_size,
    forwarded_from_message_id, client_id
  ) values (
    p_target_conversation_id, me, coalesce(src.body, ''),
    src.attachment_path, src.attachment_name, src.attachment_mime, src.attachment_size,
    src.id, 'fwd_' || replace(gen_random_uuid()::text, '-', '')
  )
  returning * into out_row;
  return out_row;
end;
$$;

revoke all on function public.forward_message(uuid, uuid) from public;
grant execute on function public.forward_message(uuid, uuid) to authenticated;

-- Block helpers (table already exists)
create or replace function public.block_user(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_blocked_id = auth.uid() then raise exception 'cannot_block_self'; end if;
  insert into public.blocks (blocker_id, blocked_id)
  values (auth.uid(), p_blocked_id)
  on conflict do nothing;
end;
$$;

create or replace function public.unblock_user(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_blocked_id;
end;
$$;

revoke all on function public.block_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from public;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;

-- Report helper
create or replace function public.submit_report(p_target_type text, p_target_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_target_type not in ('message', 'user', 'conversation') then raise exception 'bad_type'; end if;
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (auth.uid(), p_target_type, p_target_id, trim(both from p_reason))
  on conflict do nothing
  returning id into rid;
  if rid is null then
    -- already open report
    select id into rid from public.reports
    where reporter_id = auth.uid() and target_type = p_target_type and target_id = p_target_id and status = 'open'
    limit 1;
  end if;
  return rid;
end;
$$;

revoke all on function public.submit_report(text, uuid, text) from public;
grant execute on function public.submit_report(text, uuid, text) to authenticated;
