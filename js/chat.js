import { CONFIG } from "../config.js";
import { getSupabase } from "./supabase-client.js";
import { uid } from "./utils.js";

export async function listConversations() {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return [];

  const { data: memberships, error } = await sb
    .from("conversation_members")
    .select("conversation_id, last_read_at, role, muted, archived, pinned_at, conversations:conversation_id(*)")
    .eq("user_id", user.id);
  if (error) throw error;

  const items = (memberships || [])
    .map((m) => ({
      ...(m.conversations || {}),
      role: m.role,
      last_read_at: m.last_read_at,
      muted: !!m.muted,
      archived: !!m.archived,
      pinned_at: m.pinned_at || null,
    }))
    .filter((c) => c && c.id);

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
    if (a.pinned_at && !b.pinned_at) return -1;
    if (!a.pinned_at && b.pinned_at) return 1;
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

export async function sendMessage(conversationId, body, attachment = null, { clientId, replyTo } = {}) {
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
  if (replyTo) row.reply_to_id = replyTo;
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


export async function editMessage(messageId, body) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("edit_message", {
    p_message_id: messageId,
    p_body: body,
  });
  if (!error && data) return data;
  // fallback direct update
  const { data: { user } } = await sb.auth.getUser();
  const { data: row, error: e2 } = await sb
    .from("messages")
    .update({ body: String(body || "").trim(), edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("sender_id", user.id)
    .is("deleted_at", null)
    .select("*, profiles:sender_id(id, username, display_name, avatar_url)")
    .single();
  if (e2) throw e2;
  return row;
}

export async function deleteMessage(messageId) {
  const sb = getSupabase();
  const { error } = await sb.rpc("soft_delete_message", { p_message_id: messageId });
  if (!error) return;
  const { data: { user } } = await sb.auth.getUser();
  const { error: e2 } = await sb
    .from("messages")
    .update({ deleted_at: new Date().toISOString(), body: "" })
    .eq("id", messageId)
    .eq("sender_id", user.id);
  if (e2) throw e2;
}

export async function setConversationArchived(conversationId, archived) {
  const sb = getSupabase();
  const { error } = await sb.rpc("set_conversation_archived", {
    p_conversation_id: conversationId,
    p_archived: archived,
  });
  if (!error) return;
  const { data: { user } } = await sb.auth.getUser();
  const { error: e2 } = await sb
    .from("conversation_members")
    .update({ archived: !!archived })
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id);
  if (e2) throw e2;
}

export async function setConversationMuted(conversationId, muted) {
  const sb = getSupabase();
  const { error } = await sb.rpc("set_conversation_muted", {
    p_conversation_id: conversationId,
    p_muted: muted,
  });
  if (!error) return;
  const { data: { user } } = await sb.auth.getUser();
  const { error: e2 } = await sb
    .from("conversation_members")
    .update({ muted: !!muted })
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id);
  if (e2) throw e2;
}

export async function toggleReaction(messageId, emoji) {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("وارد نشده‌اید.");
  const { data: existing } = await sb
    .from("message_reactions")
    .select("emoji")
    .eq("message_id", messageId)
    .eq("user_id", user.id)
    .eq("emoji", emoji)
    .maybeSingle();
  if (existing) {
    await sb.from("message_reactions").delete()
      .eq("message_id", messageId).eq("user_id", user.id).eq("emoji", emoji);
    return { removed: true };
  }
  const { error } = await sb.from("message_reactions").insert({
    message_id: messageId,
    user_id: user.id,
    emoji,
  });
  if (error) throw error;
  return { removed: false };
}

export async function forwardMessage(messageId, targetConversationId) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("forward_message", {
    p_message_id: messageId,
    p_target_conversation_id: targetConversationId,
  });
  if (error) throw error;
  return data;
}

export async function searchInConversation(conversationId, query, { limit = 30, offset = 0 } = {}) {
  const sb = getSupabase();
  const q = String(query || "").trim();
  if (!q) return [];
  const { data, error } = await sb.rpc("search_messages_in_conversation", {
    p_conversation_id: conversationId,
    p_query: q,
    p_limit: limit,
    p_offset: offset,
  });
  if (!error && Array.isArray(data)) return data;
  // fallback
  const { data: rows, error: e2 } = await sb
    .from("messages")
    .select("id, body, sender_id, created_at, profiles:sender_id(username, display_name)")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .ilike("body", `%${q.replace(/%/g, "")}%`)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (e2) throw e2;
  return (rows || []).map((r) => ({
    id: r.id,
    body: r.body,
    sender_id: r.sender_id,
    created_at: r.created_at,
    username: r.profiles?.username,
    display_name: r.profiles?.display_name,
  }));
}

export async function loadReactions(messageIds) {
  const sb = getSupabase();
  if (!messageIds?.length) return {};
  const { data, error } = await sb
    .from("message_reactions")
    .select("message_id, emoji, user_id")
    .in("message_id", messageIds);
  if (error) return {};
  const map = {};
  for (const r of data || []) {
    if (!map[r.message_id]) map[r.message_id] = {};
    if (!map[r.message_id][r.emoji]) map[r.message_id][r.emoji] = { count: 0, mine: false, users: [] };
    map[r.message_id][r.emoji].count += 1;
    map[r.message_id][r.emoji].users.push(r.user_id);
  }
  return map;
}

export async function blockUser(userId) {
  const sb = getSupabase();
  const { error } = await sb.rpc("block_user", { p_blocked_id: userId });
  if (!error) return;
  const { data: { user } } = await sb.auth.getUser();
  const { error: e2 } = await sb.from("blocks").insert({ blocker_id: user.id, blocked_id: userId });
  if (e2 && e2.code !== "23505") throw e2;
}

export async function unblockUser(userId) {
  const sb = getSupabase();
  const { error } = await sb.rpc("unblock_user", { p_blocked_id: userId });
  if (!error) return;
  const { data: { user } } = await sb.auth.getUser();
  const { error: e2 } = await sb.from("blocks").delete().eq("blocker_id", user.id).eq("blocked_id", userId);
  if (e2) throw e2;
}

export async function listBlockedUsers() {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb
    .from("blocks")
    .select("blocked_id, created_at, profiles:blocked_id(id, username, display_name, avatar_url)")
    .eq("blocker_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((b) => ({
    id: b.blocked_id,
    blocked_at: b.created_at,
    ...(b.profiles || {}),
  }));
}

export async function listContacts() {
  // contacts = unique peers from private conversations
  const items = await listConversations();
  const peers = [];
  const seen = new Set();
  for (const c of items) {
    if (c.type !== "private" || !c.peer?.id) continue;
    if (seen.has(c.peer.id)) continue;
    seen.add(c.peer.id);
    peers.push(c.peer);
  }
  return peers;
}

export async function createInviteLink(conversationId, { maxUses = null, expiresHours = null } = {}) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_invite_link", {
    p_conversation_id: conversationId,
    p_max_uses: maxUses,
    p_expires_hours: expiresHours,
  });
  if (error) throw error;
  return data;
}

export async function joinByInvite(code) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("join_by_invite", { p_code: code });
  if (error) {
    const m = String(error.message || "");
    if (m.includes("invalid")) throw new Error("لینک دعوت نامعتبر است.");
    if (m.includes("revoked")) throw new Error("این لینک لغو شده است.");
    if (m.includes("expired")) throw new Error("لینک منقضی شده است.");
    if (m.includes("exhausted")) throw new Error("سقف استفاده از لینک پر شده است.");
    throw error;
  }
  return data;
}

export async function revokeInviteLink(id) {
  const sb = getSupabase();
  const { error } = await sb.rpc("revoke_invite_link", { p_id: id });
  if (error) throw error;
}

export async function submitReport(targetType, targetId, reason) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("submit_report", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function uploadVoiceBlob(conversationId, blob, durationSec) {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("وارد نشده‌اید.");
  if (!blob || blob.size < 1) throw new Error("فایل صوتی خالی است.");
  if (blob.size > CONFIG.MAX_AUDIO_BYTES) throw new Error("حجم فایل صوتی بیش از حد مجاز است.");
  const path = `${user.id}/${conversationId}/voice_${Date.now()}.webm`;
  const { error: upErr } = await sb.storage.from("chat-files").upload(path, blob, {
    contentType: blob.type || "audio/webm",
    upsert: false,
  });
  if (upErr) throw upErr;
  return {
    path,
    name: `voice_${Math.round(durationSec || 0)}s.webm`,
    mime: blob.type || "audio/webm",
    size: blob.size,
  };
}

export async function updateConversationMeta(conversationId, patch = {}) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("update_conversation_meta", {
    p_conversation_id: conversationId,
    p_title: patch.title ?? null,
    p_description: patch.description ?? null,
    p_is_public: typeof patch.is_public === "boolean" ? patch.is_public : null,
    p_avatar_url: patch.avatar_url ?? null,
  });
  if (error) throw error;
  return data;
}

export async function setMemberRole(conversationId, userId, role) {
  const sb = getSupabase();
  const { error } = await sb.rpc("set_member_role", {
    p_conversation_id: conversationId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw error;
}

export async function removeMember(conversationId, userId) {
  const sb = getSupabase();
  const { error } = await sb.rpc("remove_member", {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function pinMessage(conversationId, messageId) {
  const sb = getSupabase();
  const { error } = await sb.rpc("pin_message", {
    p_conversation_id: conversationId,
    p_message_id: messageId,
  });
  if (error) throw error;
}

export async function getMemberCount(conversationId) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("conversation_member_count", {
    p_conversation_id: conversationId,
  });
  if (error) return null;
  return data;
}

export async function uploadConversationAvatar(conversationId, file) {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("وارد نشده‌اید.");
  // avatars bucket RLS: first folder must equal auth.uid()
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!file?.type || !allowed.includes(file.type)) {
    throw new Error("فقط JPEG، PNG، WebP یا GIF مجاز است.");
  }
  if (file.size > (CONFIG.MAX_IMAGE_BYTES || 5_000_000)) {
    throw new Error("حجم تصویر بیش از حد مجاز است.");
  }
  const extMap = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  const ext = extMap[file.type] || "jpg";
  const path = `${user.id}/conversations/${conversationId}/avatar_${Date.now()}.${ext}`;
  const { error: upErr } = await sb.storage.from("avatars").upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (upErr) throw new Error(upErr.message || "آپلود تصویر ناموفق بود.");
  const { data } = sb.storage.from("avatars").getPublicUrl(path);
  const url = `${data.publicUrl}?t=${Date.now()}`;
  try {
    return await updateConversationMeta(conversationId, { avatar_url: url });
  } catch (metaErr) {
    // meta failed after upload — surface error clearly (orphan file remains under user folder)
    throw new Error(
      (metaErr?.message || "ذخیرهٔ اطلاعات گفتگو ناموفق بود") +
      " — تصویر آپلود شد ولی در پروفایل گفتگو ثبت نشد."
    );
  }
}

/** Local draft helpers (device-local, not server) */
export function saveDraft(conversationId, text) {
  try {
    const key = "dk-drafts";
    const all = JSON.parse(localStorage.getItem(key) || "{}");
    if (!text || !String(text).trim()) delete all[conversationId];
    else all[conversationId] = String(text).slice(0, 4000);
    localStorage.setItem(key, JSON.stringify(all));
  } catch (_) {}
}

export function loadDraft(conversationId) {
  try {
    const all = JSON.parse(localStorage.getItem("dk-drafts") || "{}");
    return all[conversationId] || "";
  } catch {
    return "";
  }
}
