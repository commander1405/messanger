import { CONFIG } from "../config.js";
import { getSupabase } from "./supabase-client.js";
import { validateUsername } from "./utils.js";

/** ایمیل مصنوعی فقط داخل Auth؛ کاربر آن را نمی‌بیند و در UI استفاده نمی‌شود. */
const USER_EMAIL_DOMAIN = "users.darkknight.local";

export function usernameToEmail(username) {
  return `${String(username || "").trim().toLowerCase()}@${USER_EMAIL_DOMAIN}`;
}

export async function getSession() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

export function onAuthChange(cb) {
  const sb = getSupabase();
  if (!sb) return { data: { subscription: { unsubscribe() {} } } };
  return sb.auth.onAuthStateChange((_event, session) => cb(session));
}

export async function signOut() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

function edgeUrl() {
  const u = (CONFIG.AUTH_EDGE_URL || "").trim();
  return u || null;
}

function edgeHeaders() {
  const key = CONFIG.SUPABASE_ANON_KEY || "";
  return {
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

async function callAuthEdge(payload) {
  const url = edgeUrl();
  if (!url) throw new Error("AUTH_EDGE_URL تنظیم نشده است.");
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: edgeHeaders(),
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("ارتباط با سرویس احراز هویت برقرار نشد. اتصال اینترنت را بررسی کنید.");
  }
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
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
  if (error || !data.session) throw new Error("نشست برقرار نشد. دوباره تلاش کنید.");
  return data.session;
}

/**
 * ثبت‌نام با نام کاربری + رمز.
 * رمز فقط در Supabase Auth ذخیره می‌شود.
 * مسیر اصلی: Edge Function (بدون ارسال ایمیل تأیید و بدون rate-limit ایمیل).
 */
export async function signUpWithUsername({ username, password, displayName, gender, country }) {
  const u = String(username || "").trim().toLowerCase();
  if (!validateUsername(u)) {
    throw new Error("نام کاربری باید ۳ تا ۲۴ حرف انگلیسی کوچک، عدد یا _ باشد.");
  }
  if (!password || String(password).length < 6) {
    throw new Error("رمز عبور حداقل ۶ کاراکتر باشد.");
  }
  const dn = String(displayName || u).trim() || u;

  if (edgeUrl()) {
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
    if (res.status === 429 || body.error === "rate_limited") {
      throw new Error("تعداد درخواست‌ها زیاد است. کمی صبر کنید و دوباره تلاش کنید.");
    }
    if (!res.ok) {
      throw new Error(mapEdgeError(body.error) || "ثبت‌نام ناموفق بود. بعداً تلاش کنید.");
    }
    return applySessionTokens(body);
  }

  // Fallback بدون Edge: signup مستقیم (ممکن است با Confirm email یا rate-limit ایمیل شکست بخورد)
  return signUpClientFallback(u, password, dn, gender, country);
}

export async function signInWithUsername(username, password) {
  const u = String(username || "").trim().toLowerCase();
  if (!validateUsername(u) || !password) {
    throw new Error("نام کاربری یا رمز عبور نادرست است.");
  }

  if (edgeUrl()) {
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

  return signInClientFallback(u, password);
}

function mapEdgeError(code) {
  switch (code) {
    case "username_taken":
      return "این نام کاربری قبلاً گرفته شده است.";
    case "invalid_credentials":
      return "نام کاربری یا رمز عبور نادرست است.";
    case "invalid_json":
    case "unknown_action":
      return "درخواست نامعتبر است.";
    case "server_misconfigured":
      return "سرویس احراز هویت پیکربندی نشده است.";
    case "signup_failed":
      return "ثبت‌نام ناموفق بود. بعداً تلاش کنید.";
    case "rate_limited":
      return "تعداد درخواست‌ها زیاد است. کمی صبر کنید.";
    default:
      return null;
  }
}

async function signUpClientFallback(u, password, dn, gender, country) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase پیکربندی نشده است.");
  const email = usernameToEmail(u);
  const { data, error } = await sb.auth.signUp({
    email,
    password: String(password),
    options: { data: { display_name: dn, username: u } },
  });
  if (error) {
    const m = (error.message || "").toLowerCase();
    if (m.includes("rate") || m.includes("email rate")) {
      throw new Error(
        "سرویس ایمیل محدودیت دارد. AUTH_EDGE_URL را در config تنظیم و Edge Function را deploy کنید."
      );
    }
    if (m.includes("already") || m.includes("registered")) {
      throw new Error("این نام کاربری قبلاً گرفته شده است.");
    }
    throw new Error("ثبت‌نام ناموفق بود. تنظیمات Auth را بررسی کنید.");
  }
  if (!data.session) {
    throw new Error(
      "ثبت‌نام بدون نشست بود (احتمالاً تأیید ایمیل فعال است). Confirm email را خاموش کنید یا از Edge Function استفاده کنید."
    );
  }
  await claimProfileAfterAuth(u, dn, gender, country);
  return data.session;
}

async function signInClientFallback(u, password) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase پیکربندی نشده است.");
  const { data, error } = await sb.auth.signInWithPassword({
    email: usernameToEmail(u),
    password: String(password),
  });
  if (error || !data.session) {
    throw new Error("نام کاربری یا رمز عبور نادرست است.");
  }
  return data.session;
}

async function claimProfileAfterAuth(username, displayName, gender, country) {
  const sb = getSupabase();
  const { error } = await sb.rpc("claim_username", {
    p_username: username,
    p_display_name: displayName,
    p_gender: gender || null,
    p_country: country || "",
  });
  if (!error) return;
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

export async function finalizeProfileClaim(username, displayName, gender, country) {
  return claimProfileAfterAuth(username, displayName, gender, country);
}
