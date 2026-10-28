import { CONFIG } from "../config.js";
import { getSupabase } from "./supabase-client.js";
import { uid } from "./utils.js";

export async function listConversations() {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return [];

  const { data: memberships, error } = await sb
    .from("conversation_members")
    .select("conversation_id, last_read_at, role, conversations:conversation_id(*)")
    .eq("user_id", user.id);
  if (error) throw error;

  const items = (memberships || [])
    .map((m) => ({
      ...m.conversations,
      role: m.role,
      last_read_at: m.last_read_at,
    }))
    .filter(Boolean)
    .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));

  // enrich private chats with peer profile
  for (const c of items) {
    if (c.type === "private") {
      const { data: members } = await sb
        .from("conversation_members")
        .select("user_id, profiles:user_id(id, username, display_name, avatar_url)")
        .eq("conversation_id", c.id);
      const peer = (members || []).map((x) => x.profiles).find((p) => p && p.id !== user.id);
      c.peer = peer || null;
      c.title = peer?.display_name || peer?.username || "گفتگو";
      c.avatar_url = peer?.avatar_url || "";
    }
    // unread approx: messages after last_read_at
    const { count } = await sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", c.id)
      .gt("created_at", c.last_read_at || "1970-01-01")
      .neq("sender_id", user.id);
    c.unread = count || 0;
  }
  return items;
}

export async function openPrivateChat(otherUserId) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_private_conversation", { other_user: otherUserId });
  if (error) throw error;
  return data;
}

export async function createGroup(title, memberIds = []) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_group_conversation", {
    p_title: title,
    p_member_ids: memberIds,
  });
  if (error) throw error;
  return data;
}

export async function createChannel(title, description = "", isPublic = true) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_channel", {
    p_title: title,
    p_description: description,
    p_is_public: isPublic,
  });
  if (error) throw error;
  return data;
}

export async function joinPublicChannel(conversationId) {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from("conversation_members").insert({
    conversation_id: conversationId,
    user_id: user.id,
    role: "subscriber",
  });
  if (error && error.code !== "23505") throw error;
}

export async function searchPublicChannels(q) {
  const sb = getSupabase();
  let query = sb
    .from("conversations")
    .select("id, title, description, avatar_url, is_public, type")
    .eq("type", "channel")
    .eq("is_public", true)
    .limit(30);
  if (q && q.trim()) query = query.ilike("title", `%${q.trim()}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function loadMessages(conversationId, { before, limit } = {}) {
  const sb = getSupabase();
  const page = limit || CONFIG.MESSAGE_PAGE_SIZE;
  let q = sb
    .from("messages")
    .select("*, profiles:sender_id(id, username, display_name, avatar_url)")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(page);
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).reverse();
}

export async function sendMessage(conversationId, body, attachment = null) {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("وارد نشده‌اید.");
  const clientId = uid();
  const row = {
    conversation_id: conversationId,
    sender_id: user.id,
    body: (body || "").trim(),
    client_id: clientId,
  };
  if (attachment) {
    row.attachment_path = attachment.path;
    row.attachment_name = attachment.name;
    row.attachment_mime = attachment.mime;
    row.attachment_size = attachment.size;
  }
  if (!row.body && !row.attachment_path) throw new Error("پیام خالی است.");
  const { data, error } = await sb.from("messages").insert(row).select("*, profiles:sender_id(id, username, display_name, avatar_url)").single();
  if (error) throw error;
  return data;
}

export async function markRead(conversationId) {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await sb
    .from("conversation_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id);
}

export async function setTyping(conversationId) {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await sb.from("typing_status").upsert({
    conversation_id: conversationId,
    user_id: user.id,
    updated_at: new Date().toISOString(),
  });
}

export function subscribeMessages(conversationId, onInsert) {
  const sb = getSupabase();
  const channel = sb
    .channel(`messages:${conversationId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
      (payload) => onInsert(payload.new)
    )
    .subscribe();
  return () => sb.removeChannel(channel);
}

export function subscribeTyping(conversationId, onChange) {
  const sb = getSupabase();
  const channel = sb
    .channel(`typing:${conversationId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "typing_status", filter: `conversation_id=eq.${conversationId}` },
      (payload) => onChange(payload.new || payload.old)
    )
    .subscribe();
  return () => sb.removeChannel(channel);
}

export async function uploadAttachment(conversationId, file) {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("وارد نشده‌اید.");
  const size = file.size;
  const type = file.type || "application/octet-stream";
  let max = CONFIG.MAX_FILE_BYTES;
  if (type.startsWith("image/")) max = CONFIG.MAX_IMAGE_BYTES;
  else if (type.startsWith("video/")) max = CONFIG.MAX_VIDEO_BYTES;
  else if (type.startsWith("audio/")) max = CONFIG.MAX_AUDIO_BYTES;
  if (size > max) throw new Error("حجم فایل بیش از حد مجاز است.");

  const safe = file.name.replace(/[^\w.\-()+ء-ی]/g, "_").slice(0, 80);
  const path = `${conversationId}/${user.id}/${Date.now()}_${safe}`;
  const { error } = await sb.storage.from("attachments").upload(path, file, {
    contentType: type,
    upsert: false,
  });
  if (error) throw error;
  return { path, name: file.name, mime: type, size };
}

export async function getAttachmentUrl(path) {
  const sb = getSupabase();
  const { data, error } = await sb.storage.from("attachments").createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
