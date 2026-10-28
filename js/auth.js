import { CONFIG } from "../config.js";
import { getSupabase } from "./supabase-client.js";
import { validateUsername } from "./utils.js";

export async function getSession() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

export function onAuthChange(cb) {
  const sb = getSupabase();
  if (!sb) return { data: { subscription: { unsubscribe() {} } } };
  return sb.auth.onAuthStateChange((event, session) => cb(event, session));
}

export async function signOut() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

function edgeUrl() {
  const u = (CONFIG.AUTH_EDGE_URL || "").trim();
  if (!u) throw new Error("AUTH_EDGE_URL در config.js تنظیم نشده است.");
  return u;
}

function edgeHeaders() {
  const key = CONFIG.SUPABASE_ANON_KEY || "";
  if (!key) throw new Error("SUPABASE_ANON_KEY تنظیم نشده است.");
  return {
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

async function callAuthEdge(payload) {
  const url = edgeUrl();
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: edgeHeaders(),
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("ارتباط با سرویس احراز هویت برقرار نشد.");
  }

  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }

  if (res.status === 429 || body.error === "rate_limited") {
    throw new Error("تعداد درخواست‌ها زیاد است. یک دقیقه صبر کنید و دوباره تلاش کنید.");
  }

  return { res, body };
}

async function applySessionTokens(body) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase پیکربندی نشده است.");
  if (!body?.access_token || !body?.refresh_token) {
    throw new Error("نشست معتبر از سرور دریافت نشد.");
  }
  const { data, error } = await sb.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  });
  if (error) {
    console.error("setSession failed", error.message);
    throw new Error("نشست برقرار نشد. صفحه را رفرش کنید و دوباره وارد شوید.");
  }
  if (!data.session) throw new Error("نشست برقرار نشد.");
  return data.session;
}

export async function signUpWithUsername({ username, password, displayName, gender, country }) {
  const u = String(username || "").trim().toLowerCase();
  if (!validateUsername(u)) {
    throw new Error("نام کاربری باید ۳ تا ۲۴ حرف انگلیسی کوچک، عدد یا _ باشد.");
  }
  if (!password || String(password).length < 6) {
    throw new Error("رمز عبور حداقل ۶ کاراکتر باشد.");
  }
  const dn = String(displayName || u).trim() || u;

  const { res, body } = await callAuthEdge({
    action: "signup",
    username: u,
    password: String(password),
    display_name: dn,
    gender: gender || null,
    country: country || "",
  });

  if (res.status === 409 || body.error === "username_taken") {
    throw new Error("این نام کاربری قبلاً گرفته شده است.");
  }
  if (!res.ok) {
    throw new Error(mapEdgeError(body.error) || "ثبت‌نام ناموفق بود.");
  }
  return applySessionTokens(body);
}

export async function signInWithUsername(username, password) {
  const u = String(username || "").trim().toLowerCase();
  if (!validateUsername(u) || !password) {
    throw new Error("نام کاربری یا رمز عبور نادرست است.");
  }

  const { res, body } = await callAuthEdge({
    action: "login",
    username: u,
    password: String(password),
  });

  if (!res.ok) {
    throw new Error("نام کاربری یا رمز عبور نادرست است.");
  }
  return applySessionTokens(body);
}

function mapEdgeError(code) {
  switch (code) {
    case "username_taken":
      return "این نام کاربری قبلاً گرفته شده است.";
    case "invalid_credentials":
      return "نام کاربری یا رمز عبور نادرست است.";
    case "signup_failed":
      return "ثبت‌نام ناموفق بود. بعداً تلاش کنید.";
    case "server_misconfigured":
      return "سرویس احراز هویت روی سرور پیکربندی نشده است.";
    case "server_error":
      return "خطای داخلی سرور احراز هویت.";
    default:
      return null;
  }
}

export async function finalizeProfileClaim(username, displayName, gender, country) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.rpc("claim_username", {
    p_username: username,
    p_display_name: displayName,
    p_gender: gender || null,
    p_country: country || "",
  });
  if (error) {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    await sb.from("profiles").upsert({
      id: user.id,
      username,
      display_name: displayName,
      gender: gender || null,
      country: country || "",
    });
  }
}
