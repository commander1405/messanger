-- Row Level Security policies for DarkKnight Messenger

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.typing_status enable row level security;
alter table public.blocks enable row level security;

-- Profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

-- Conversations: member can see; public channels visible
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select to authenticated
  using (
    public.is_conversation_member(id, auth.uid())
    or (type = 'channel' and is_public = true)
  );

drop policy if exists conversations_update_admin on public.conversations;
create policy conversations_update_admin on public.conversations
  for update to authenticated
  using (public.is_conversation_admin(id, auth.uid()))
  with check (public.is_conversation_admin(id, auth.uid()));

-- Members
drop policy if exists members_select on public.conversation_members;
create policy members_select on public.conversation_members
  for select to authenticated
  using (
    public.is_conversation_member(conversation_id, auth.uid())
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.type = 'channel' and c.is_public = true
    )
  );

drop policy if exists members_update_self_read on public.conversation_members;
create policy members_update_self_read on public.conversation_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists members_delete_self_or_admin on public.conversation_members;
create policy members_delete_self_or_admin on public.conversation_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    or public.is_conversation_admin(conversation_id, auth.uid())
  );

drop policy if exists members_insert_admin on public.conversation_members;
create policy members_insert_admin on public.conversation_members
  for insert to authenticated
  with check (
    public.is_conversation_admin(conversation_id, auth.uid())
    or (
      -- join public channel as subscriber
      exists (
        select 1 from public.conversations c
        where c.id = conversation_id and c.type = 'channel' and c.is_public = true
      )
      and user_id = auth.uid()
      and role = 'subscriber'
    )
  );

-- Messages
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id, auth.uid())
    and (
      -- channels: only owner/admin can publish
      not exists (
        select 1 from public.conversations c
        where c.id = conversation_id and c.type = 'channel'
      )
      or public.is_conversation_admin(conversation_id, auth.uid())
    )
  );

drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- Typing
drop policy if exists typing_select on public.typing_status;
create policy typing_select on public.typing_status
  for select to authenticated
  using (public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists typing_upsert on public.typing_status;
create policy typing_upsert on public.typing_status
  for all to authenticated
  using (user_id = auth.uid() and public.is_conversation_member(conversation_id, auth.uid()))
  with check (user_id = auth.uid() and public.is_conversation_member(conversation_id, auth.uid()));

-- Blocks
drop policy if exists blocks_own on public.blocks;
create policy blocks_own on public.blocks
  for all to authenticated
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

-- Realtime publication (run if needed)
-- alter publication supabase_realtime add table public.messages;
-- alter publication supabase_realtime add table public.typing_status;
-- alter publication supabase_realtime add table public.conversation_members;
