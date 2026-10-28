import { getSupabase } from "./supabase-client.js";
import { validateUsername } from "./utils.js";
import { CONFIG } from "../config.js";

export async function getMyProfile() {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function ensureProfile() {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  let profile = await getMyProfile();
  if (!profile) {
    const meta = user.user_metadata || {};
    const { data, error } = await sb.from("profiles").insert({
      id: user.id,
      display_name: meta.display_name || "کاربر جدید",
      username: meta.username || null,
    }).select().single();
    if (error && !String(error.message || "").includes("duplicate")) throw error;
    profile = data || (await getMyProfile());
  }
  return profile;
}

export async function updateProfile(patch) {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("وارد نشده‌اید.");
  const allowed = {};
  if (patch.username != null) {
    const u = String(patch.username).toLowerCase().trim();
    if (!validateUsername(u)) throw new Error("نام کاربری باید ۳ تا ۲۴ حرف، فقط a-z و عدد و _ باشد.");
    allowed.username = u;
  }
  if (patch.display_name != null) allowed.display_name = String(patch.display_name).trim().slice(0, 64);
  if (patch.bio != null) allowed.bio = String(patch.bio).slice(0, 300);
  if (patch.country != null) allowed.country = String(patch.country).slice(0, 64);
  if (patch.gender != null) {
    const g = patch.gender;
    allowed.gender = ["male", "female", "other", "unspecified"].includes(g) ? g : "unspecified";
  }
  if (patch.avatar_url != null) allowed.avatar_url = String(patch.avatar_url);
  if (typeof patch.show_last_seen === "boolean") allowed.show_last_seen = patch.show_last_seen;
  if (typeof patch.show_online === "boolean") allowed.show_online = patch.show_online;
  allowed.updated_at = new Date().toISOString();

  const { data, error } = await sb.from("profiles").update(allowed).eq("id", user.id).select().single();
  if (error) {
    if (String(error.message).includes("duplicate") || error.code === "23505") {
      throw new Error("این نام کاربری قبلاً گرفته شده است.");
    }
    throw error;
  }
  return data;
}

export async function searchUsers(q) {
  const sb = getSupabase();
  let query = (q || "").trim();
  if (query.startsWith("@")) query = query.slice(1);
  query = query.toLowerCase();
  if (query.length < 1) return [];
  // فقط کاراکترهای امن برای فیلتر
  const safe = query.replace(/[^a-z0-9_\s\u0600-\u06FF]/gi, "").slice(0, 40);
  if (!safe) return [];

  const { data: rpcData, error: rpcErr } = await sb.rpc("search_profiles", {
    p_query: safe,
    p_limit: 20,
  });
  if (!rpcErr && Array.isArray(rpcData)) return rpcData;

  // exact username first
  const { data: exact } = await sb
    .from("profiles")
    .select("id, username, display_name, avatar_url, bio")
    .eq("username", safe)
    .limit(5);
  if (exact?.length) return exact;

  const { data, error } = await sb
    .from("profiles")
    .select("id, username, display_name, avatar_url, bio")
    .or(`username.ilike.%${safe}%,display_name.ilike.%${safe}%`)
    .limit(20);
  if (error) throw error;
  return data || [];
}

export async function findUserByUsername(username) {
  const sb = getSupabase();
  let u = String(username || "").trim().toLowerCase();
  if (u.startsWith("@")) u = u.slice(1);
  if (!u) return null;
  const { data, error } = await sb
    .from("profiles")
    .select("id, username, display_name, avatar_url, bio")
    .eq("username", u)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getPublicProfile(id) {
  const sb = getSupabase();
  const { data: rpc, error: rpcErr } = await sb.rpc("get_public_profile", { p_id: id });
  if (!rpcErr && Array.isArray(rpc) && rpc[0]) return rpc[0];
  if (!rpcErr && rpc && !Array.isArray(rpc)) return rpc;

  const { data, error } = await sb
    .from("profiles")
    .select("id, username, display_name, avatar_url, bio, country, gender, created_at, last_seen_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProfileById(id) {
  return getPublicProfile(id);
}

export async function uploadAvatar(file) {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("وارد نشده‌اید.");
  if (!file || !file.type) throw new Error("فایل نامعتبر است.");
  if (!CONFIG.ALLOWED_IMAGE_TYPES.includes(file.type)) throw new Error("فقط تصویر JPEG/PNG/WebP/GIF مجاز است.");
  if (file.size > CONFIG.MAX_IMAGE_BYTES) throw new Error("حجم تصویر بیش از حد مجاز است.");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${user.id}/avatar_${Date.now()}.${ext}`;
  const { error: upErr } = await sb.storage.from("avatars").upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (upErr) throw upErr;
  const { data } = sb.storage.from("avatars").getPublicUrl(path);
  const url = `${data.publicUrl}?t=${Date.now()}`;
  return updateProfile({ avatar_url: url });
}

export async function touchLastSeen() {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.rpc("touch_last_seen");
  if (error) {
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      await sb.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id);
    }
  }
}

export function startPresenceHeartbeat() {
  touchLastSeen();
  const id = setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine) touchLastSeen();
  }, 60_000);
  return () => clearInterval(id);
}
