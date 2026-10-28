import { getSupabase } from "./supabase-client.js";
import { validateUsername } from "./utils.js";

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
    const { data, error } = await sb.from("profiles").insert({
      id: user.id,
      display_name: user.user_metadata?.display_name || "کاربر جدید",
    }).select().single();
    if (error && !String(error.message).includes("duplicate")) throw error;
    profile = data || (await getMyProfile());
  }
  return profile;
}

export async function updateProfile(patch) {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("وارد نشده‌اید.");
  if (patch.username != null) {
    const u = String(patch.username).toLowerCase().trim();
    if (!validateUsername(u)) throw new Error("نام کاربری باید ۳ تا ۲۴ حرف، فقط a-z و عدد و _ باشد.");
    patch.username = u;
  }
  const { data, error } = await sb.from("profiles").update({
    ...patch,
    updated_at: new Date().toISOString(),
  }).eq("id", user.id).select().single();
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
  const query = (q || "").trim().replace(/^@/, "");
  if (query.length < 2) return [];
  const { data, error } = await sb
    .from("profiles")
    .select("id, username, display_name, avatar_url, bio")
    .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
    .limit(20);
  if (error) throw error;
  return data || [];
}

export async function getProfileById(id) {
  const sb = getSupabase();
  const { data, error } = await sb.from("profiles").select("id, username, display_name, avatar_url, bio, created_at").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function uploadAvatar(file) {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("وارد نشده‌اید.");
  if (!file.type.startsWith("image/")) throw new Error("فقط تصویر مجاز است.");
  if (file.size > 5 * 1024 * 1024) throw new Error("حداکثر ۵ مگابایت.");
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${user.id}/avatar.${ext}`;
  const { error: upErr } = await sb.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) throw upErr;
  const { data } = sb.storage.from("avatars").getPublicUrl(path);
  const url = `${data.publicUrl}?t=${Date.now()}`;
  return updateProfile({ avatar_url: url });
}
