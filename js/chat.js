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
      ...(m.conversations || {}),
      role: m.role,
      last_read_at: m.last_read_at,
    }))
    .filter((c) => c && c.id)
    .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));

  for (const c of items) {
    if (c.type === "private") {
      const { data: members } = await sb
        .from("conversation_members")
        .select("user_id, profiles:user_id(id, username, display_name, avatar_url)")
        .eq("conversation_id", c.id);
      const peer = (members || []).map((x) => x.profiles).find((p) => p && p.id !== user.id);
      c.peer = peer || null;
      c.title = peer?.display_name || (peer?.username ? `@${peer.username}` : "گفتگو");
      c.avatar_url = peer?.avatar_url || "";
    }
    const { count } = await sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", c.id)
      .gt("created_at", c.last_read_at || "1970-01-01")
      .neq("sender_id", user.id);
    c.unread = count || 0;

    const { data: lastRows } = await sb
      .from("messages")
      .select("body, attachment_name, attachment_mime, created_at, sender_id")
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const last = lastRows?.[0];
    if (last) {
      c.last_message_at = last.created_at || c.last_message_at;
      if (last.body) c.last_preview = last.body.slice(0, 80);
      else if (last.attachment_mime?.startsWith("image/")) c.last_preview = "تصویر";
      else if (last.attachment_name) c.last_preview = last.attachment_name;
      else c.last_preview = "پیام";
    } else {
      c.last_preview = c.type === "channel" ? "کانال" : c.type === "group" ? "گروه" : "بدون پیام";
    }

    c.is_saved = (
      c.type === "group" &&
      c.title === "پیام‌های شخصی" &&
      c.created_by === user.id
    );
    if (c.is_saved) {
      c.title = "پیام‌های شخصی";
      c.last_preview = c.last_preview || "یادداشت‌ها و میانبر @username";
    }
  }

  items.sort((a, b) => {
    if (a.is_saved && !b.is_saved) return -1;
    if (!a.is_saved && b.is_saved) return 1;
    return new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0);
  });
  return items;
}

export async function openPrivateChat(otherUserId) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_private_conversation", { other_user: otherUserId });
  if (error) throw error;
  return data;
}

/** گفتگوی «پیام‌های شخصی» — ذخیره برای خود کاربر */
export async function ensureSavedMessages() {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await sb
    .from("conversation_members")
    .select("conversation_id, conversations:conversation_id(id, type, title, created_by)")
    .eq("user_id", user.id);

  const existing = (memberships || []).find((m) => {
    const c = m.conversations;
    return c && c.type === "group" && c.title === "پیام‌های شخصی" && c.created_by === user.id;
  });
  if (existing?.conversations?.id) return existing.conversations.id;

  // ساخت گروه فقط با خود کاربر
  const { data: id, error } = await sb.rpc("create_group_conversation", {
    p_title: "پیام‌های شخصی",
    p_member_ids: [],
  });
  if (error) {
    // fallback بدون RPC
    const { data: conv, error: e2 } = await sb
      .from("conversations")
      .insert({ type: "group", title: "پیام‌های شخصی", created_by: user.id })
      .select("id")
      .single();
    if (e2) throw e2;
    await sb.from("conversation_members").insert({
      conversation_id: conv.id,
      user_id: user.id,
      role: "owner",
    });
    return conv.id;
  }
  return id;
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

export async function listMembers(conversationId) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("list_conversation_members", {
    p_conversation_id: conversationId,
  });
  if (!error && data) return data;
  const { data: rows, error: e2 } = await sb
    .from("conversation_members")
    .select("user_id, role, joined_at, profiles:user_id(username, display_name, avatar_url)")
    .eq("conversation_id", conversationId);
  if (e2) throw e2;
  return (rows || []).map((r) => ({
    user_id: r.user_id,
    role: r.role,
    username: r.profiles?.username,
    display_name: r.profiles?.display_name,
    avatar_url: r.profiles?.avatar_url,
    joined_at: r.joined_at,
  }));
}

export async function groupAddMember(conversationId, userId) {
  const sb = getSupabase();
  const { error } = await sb.rpc("group_add_member", {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function groupLeave(conversationId) {
  const sb = getSupabase();
  const { error } = await sb.rpc("group_leave", { p_conversation_id: conversationId });
  if (error) {
    if (String(error.message || "").includes("owner_must_transfer")) {
      throw new Error("مالک تنها نمی‌تواند خارج شود. ابتدا مالکیت را منتقل کنید.");
    }
    throw error;
  }
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

export async function sendMessage(conversationId, body, attachment = null, { clientId } = {}) {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("وارد نشده‌اید.");
  const cid = clientId || uid();
  const row = {
    conversation_id: conversationId,
    sender_id: user.id,
    body: (body || "").trim(),
    client_id: cid,
  };
  if (attachment) {
    row.attachment_path = attachment.path;
    row.attachment_name = attachment.name;
    row.attachment_mime = attachment.mime;
    row.attachment_size = attachment.size;
  }
  if (!row.body && !row.attachment_path) throw new Error("پیام خالی است.");
  const { data, error } = await sb
    .from("messages")
    .insert(row)
    .select("*, profiles:sender_id(id, username, display_name, avatar_url)")
    .single();
  if (error) {
    if (error.code === "23505") {
      // duplicate client_id — treat as success path by re-fetch
      const { data: existing } = await sb
        .from("messages")
        .select("*, profiles:sender_id(id, username, display_name, avatar_url)")
        .eq("conversation_id", conversationId)
        .eq("sender_id", user.id)
        .eq("client_id", cid)
        .maybeSingle();
      if (existing) return existing;
    }
    throw error;
  }
  return data;
}

export async function markRead(conversationId) {
  const sb = getSupabase();
  const { error } = await sb.rpc("mark_conversation_read", {
    p_conversation_id: conversationId,
  });
  if (error) {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    await sb
      .from("conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id);
  }
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
    .channel(`messages:${conversationId}:${Date.now()}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onInsert(payload.new)
    )
    .subscribe();
  return () => {
    try { sb.removeChannel(channel); } catch (_) { /* ignore */ }
  };
}

export function subscribeTyping(conversationId, onChange) {
  const sb = getSupabase();
  const channel = sb
    .channel(`typing:${conversationId}:${Date.now()}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "typing_status",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onChange(payload.new || payload.old)
    )
    .subscribe();
  return () => {
    try { sb.removeChannel(channel); } catch (_) { /* ignore */ }
  };
}

function sniffAllowed(file) {
  const type = file.type || "";
  const name = (file.name || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";
  if (CONFIG.ALLOWED_IMAGE_TYPES.includes(type)) return "image";
  if (CONFIG.ALLOWED_VIDEO_TYPES.includes(type)) return "video";
  if (CONFIG.ALLOWED_AUDIO_TYPES.includes(type)) return "audio";
  const okExt = ["pdf", "txt", "zip", "doc", "docx", "xls", "xlsx", "ppt", "pptx"];
  if (type === "application/pdf" || type === "text/plain" || okExt.includes(ext)) return "file";
  if (type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/")) {
    // type claimed but not in allowlist
    return null;
  }
  return null;
}

export async function uploadAttachment(conversationId, file) {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("وارد نشده‌اید.");
  const kind = sniffAllowed(file);
  if (!kind) throw new Error("نوع فایل مجاز نیست.");
  const size = file.size;
  let max = CONFIG.MAX_FILE_BYTES;
  if (kind === "image") max = CONFIG.MAX_IMAGE_BYTES;
  else if (kind === "video") max = CONFIG.MAX_VIDEO_BYTES;
  else if (kind === "audio") max = CONFIG.MAX_AUDIO_BYTES;
  if (size > max) throw new Error("حجم فایل بیش از حد مجاز است.");

  const safe = file.name.replace(/[^\w.\-()+ء-ی]/g, "_").slice(0, 80) || "file";
  const path = `${conversationId}/${user.id}/${Date.now()}_${Math.random().toString(16).slice(2, 10)}_${safe}`;
  const { error } = await sb.storage.from("attachments").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  return {
    path,
    name: file.name,
    mime: file.type || "application/octet-stream",
    size,
  };
}

export async function getAttachmentUrl(path) {
  const sb = getSupabase();
  const { data, error } = await sb.storage.from("attachments").createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
