-- DarkKnight Messenger — advanced chat features
-- Safe to re-run. Does not drop user data.

-- Reply / forward metadata
alter table public.messages
  add column if not exists reply_to_id uuid references public.messages(id) on delete set null;

alter table public.messages
  add column if not exists forwarded_from_message_id uuid references public.messages(id) on delete set null;

create index if not exists messages_reply_to_idx on public.messages (reply_to_id)
  where reply_to_id is not null;

-- Archive / pin per membership
alter table public.conversation_members
  add column if not exists archived boolean not null default false;

alter table public.conversation_members
  add column if not exists pinned_at timestamptz;

create index if not exists conv_members_archived_idx
  on public.conversation_members (user_id, archived);

-- Reactions
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists message_reactions_msg_idx on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

drop policy if exists reactions_select on public.message_reactions;
create policy reactions_select on public.message_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id, auth.uid())
    )
  );

drop policy if exists reactions_insert on public.message_reactions;
create policy reactions_insert on public.message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and m.deleted_at is null
        and public.is_conversation_member(m.conversation_id, auth.uid())
    )
  );

drop policy if exists reactions_delete on public.message_reactions;
create policy reactions_delete on public.message_reactions
  for delete to authenticated
  using (user_id = auth.uid());

-- Soft-delete own message
create or replace function public.soft_delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  sid uuid;
  cid uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select sender_id, conversation_id into sid, cid from public.messages where id = p_message_id;
  if sid is null then raise exception 'not_found'; end if;
  if sid <> me and not public.is_conversation_admin(cid, me) then
    raise exception 'forbidden';
  end if;
  update public.messages
  set deleted_at = now(), body = '', attachment_path = null, attachment_name = null
  where id = p_message_id;
end;
$$;

revoke all on function public.soft_delete_message(uuid) from public;
grant execute on function public.soft_delete_message(uuid) to authenticated;

-- Edit own message
create or replace function public.edit_message(p_message_id uuid, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  row public.messages;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  update public.messages
  set body = trim(both from coalesce(p_body, '')),
      edited_at = now()
  where id = p_message_id
    and sender_id = me
    and deleted_at is null
    and char_length(trim(both from coalesce(p_body, ''))) > 0
  returning * into row;
  if row.id is null then raise exception 'forbidden_or_empty'; end if;
  return row;
end;
$$;

revoke all on function public.edit_message(uuid, text) from public;
grant execute on function public.edit_message(uuid, text) to authenticated;

-- Toggle archive
create or replace function public.set_conversation_archived(p_conversation_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.conversation_members
  set archived = coalesce(p_archived, false)
  where conversation_id = p_conversation_id and user_id = auth.uid();
  if not found then raise exception 'not_member'; end if;
end;
$$;

revoke all on function public.set_conversation_archived(uuid, boolean) from public;
grant execute on function public.set_conversation_archived(uuid, boolean) to authenticated;

-- Toggle mute
create or replace function public.set_conversation_muted(p_conversation_id uuid, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.conversation_members
  set muted = coalesce(p_muted, false)
  where conversation_id = p_conversation_id and user_id = auth.uid();
  if not found then raise exception 'not_member'; end if;
end;
$$;

revoke all on function public.set_conversation_muted(uuid, boolean) from public;
grant execute on function public.set_conversation_muted(uuid, boolean) to authenticated;
