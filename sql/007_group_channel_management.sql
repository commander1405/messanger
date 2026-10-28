-- Phase 2: group/channel management RPCs
-- Idempotent; does not delete user data.

alter table public.conversations
  add column if not exists pinned_message_id uuid references public.messages(id) on delete set null;

alter table public.conversations
  add column if not exists avatar_url text;

-- Update group/channel metadata (admin/owner only)
create or replace function public.update_conversation_meta(
  p_conversation_id uuid,
  p_title text default null,
  p_description text default null,
  p_is_public boolean default null,
  p_avatar_url text default null
)
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  row public.conversations;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if not public.is_conversation_admin(p_conversation_id, me) then
    raise exception 'forbidden';
  end if;
  update public.conversations
  set
    title = coalesce(nullif(trim(both from p_title), ''), title),
    description = case when p_description is null then description else left(p_description, 500) end,
    is_public = coalesce(p_is_public, is_public),
    avatar_url = case when p_avatar_url is null then avatar_url else p_avatar_url end,
    updated_at = now()
  where id = p_conversation_id
  returning * into row;
  if row.id is null then raise exception 'not_found'; end if;
  return row;
end;
$$;

revoke all on function public.update_conversation_meta(uuid, text, text, boolean, text) from public;
grant execute on function public.update_conversation_meta(uuid, text, text, boolean, text) to authenticated;

-- Set member role (owner only for admin promotion; admin can demote member)
create or replace function public.set_member_role(
  p_conversation_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_role text;
  target_role text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_role not in ('admin', 'member', 'subscriber') then raise exception 'bad_role'; end if;
  if p_user_id = me then raise exception 'cannot_change_self'; end if;

  select role into my_role from public.conversation_members
  where conversation_id = p_conversation_id and user_id = me;
  if my_role is null then raise exception 'not_member'; end if;

  select role into target_role from public.conversation_members
  where conversation_id = p_conversation_id and user_id = p_user_id;
  if target_role is null then raise exception 'target_not_member'; end if;
  if target_role = 'owner' then raise exception 'cannot_change_owner'; end if;

  -- only owner can set/remove admin
  if p_role = 'admin' and my_role <> 'owner' then raise exception 'owner_only'; end if;
  if target_role = 'admin' and my_role <> 'owner' then raise exception 'owner_only'; end if;
  if my_role not in ('owner', 'admin') then raise exception 'forbidden'; end if;

  update public.conversation_members
  set role = p_role
  where conversation_id = p_conversation_id and user_id = p_user_id;
end;
$$;

revoke all on function public.set_member_role(uuid, uuid, text) from public;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;

-- Remove member (admin/owner; cannot remove owner)
create or replace function public.remove_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_role text;
  target_role text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select role into my_role from public.conversation_members
  where conversation_id = p_conversation_id and user_id = me;
  if my_role not in ('owner', 'admin') then raise exception 'forbidden'; end if;
  select role into target_role from public.conversation_members
  where conversation_id = p_conversation_id and user_id = p_user_id;
  if target_role is null then return; end if;
  if target_role = 'owner' then raise exception 'cannot_remove_owner'; end if;
  if target_role = 'admin' and my_role <> 'owner' then raise exception 'owner_only'; end if;
  delete from public.conversation_members
  where conversation_id = p_conversation_id and user_id = p_user_id;
end;
$$;

revoke all on function public.remove_member(uuid, uuid) from public;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- Pin / unpin message
create or replace function public.pin_message(p_conversation_id uuid, p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  mid uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if not public.is_conversation_admin(p_conversation_id, me) then
    raise exception 'forbidden';
  end if;
  if p_message_id is null then
    update public.conversations set pinned_message_id = null, updated_at = now()
    where id = p_conversation_id;
    return;
  end if;
  select id into mid from public.messages
  where id = p_message_id and conversation_id = p_conversation_id and deleted_at is null;
  if mid is null then raise exception 'not_found'; end if;
  update public.conversations
  set pinned_message_id = mid, updated_at = now()
  where id = p_conversation_id;
end;
$$;

revoke all on function public.pin_message(uuid, uuid) from public;
grant execute on function public.pin_message(uuid, uuid) to authenticated;

-- Member count (for UI)
create or replace function public.conversation_member_count(p_conversation_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_conversation_member(p_conversation_id, auth.uid())
      or exists (
        select 1 from public.conversations c
        where c.id = p_conversation_id and c.type = 'channel' and c.is_public = true
      )
    then (select count(*)::int from public.conversation_members where conversation_id = p_conversation_id)
    else 0
  end;
$$;

revoke all on function public.conversation_member_count(uuid) from public;
grant execute on function public.conversation_member_count(uuid) to authenticated;

-- Upload conversation avatar path is client-side; ensure select on conversations includes avatar_url (already *)
