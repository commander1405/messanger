import { CONFIG } from "../config.js";
import { getSupabase } from "./supabase-client.js";
import { faAuthError, normalizePhone, validateUsername } from "./utils.js";

/** Synthetic mailbox for username accounts — passwords live only in Supabase Auth. */
const USER_EMAIL_DOMAIN = "users.darkknight.local";

export function usernameToEmail(username) {
  const u = String(username || "").trim().toLowerCase();
  return `${u}@${USER_EMAIL_DOMAIN}`;
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

export async function sendPhoneOtp(countryCode, national) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase پیکربندی نشده است.");
  if (!CONFIG.ENABLE_PHONE_AUTH) throw new Error("احراز هویت تلفنی غیرفعال است.");
  const phone = normalizePhone(countryCode, national);
  if (!phone || phone.length < 10) throw new Error("شماره تلفن نامعتبر است.");
  const { error } = await sb.auth.signInWithOtp({ phone });
  if (error) throw new Error(faAuthError(error));
  return phone;
}

export async function verifyPhoneOtp(phone, token) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase پیکربندی نشده است.");
  const { data, error } = await sb.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) throw new Error(faAuthError(error));
  return data.session;
}

export async function signUpEmail(email, password, displayName) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase پیکربندی نشده است.");
  if (!CONFIG.ENABLE_EMAIL_DEV_AUTH) throw new Error("ورود ایمیلی توسعه غیرفعال است.");
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName || "کاربر" } },
  });
  if (error) throw new Error(faAuthError(error));
  return data;
}

export async function signInEmail(email, password) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase پیکربندی نشده است.");
  if (!CONFIG.ENABLE_EMAIL_DEV_AUTH) throw new Error("ورود ایمیلی توسعه غیرفعال است.");
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(faAuthError(error));
  return data.session;
}

/**
 * ثبت‌نام با نام کاربری + رمز.
 * رمز فقط در Supabase Auth ذخیره می‌شود (هش‌شده)، نه در profiles.
 * ترجیح: Edge Function در صورت تنظیم CONFIG.AUTH_EDGE_URL
 * جایگزین امن سمت کلاینت: ایمیل مصنوعی username@users.darkknight.local
 * (در Auth، تأیید ایمیل را برای این دامنه/پروژه غیرفعال کنید)
 */
export async function signUpWithUsername({ username, password, displayName, gender, country }) {
  const u = String(username || "").trim().toLowerCase();
  if (!validateUsername(u)) throw new Error("نام کاربری باید ۳ تا ۲۴ حرف انگلیسی، عدد یا _ باشد.");
  if (!password || password.length < 6) throw new Error("رمز عبور حداقل ۶ کاراکتر باشد.");
  const dn = (displayName || u).trim();

  if (CONFIG.AUTH_EDGE_URL) {
    const res = await fetch(CONFIG.AUTH_EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "signup",
        username: u,
        password,
        display_name: dn,
        gender: gender || null,
        country: country || "",
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (body.error === "username_taken") throw new Error("این نام کاربری قبلاً گرفته شده است.");
      throw new Error("ثبت‌نام ناموفق بود. بعداً تلاش کنید.");
    }
    return applySessionTokens(body);
  }

  const sb = getSupabase();
  if (!sb) throw new Error("Supabase پیکربندی نشده است.");
  const email = usernameToEmail(u);
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: dn, username: u },
    },
  });
  if (error) {
    const m = (error.message || "").toLowerCase();
    if (m.includes("already") || m.includes("registered")) {
      throw new Error("ثبت‌نام ناموفق بود. نام کاربری یا حساب تکراری است.");
    }
    throw new Error(faAuthError(error));
  }
  if (data.session) {
    await claimProfileAfterAuth(u, dn, gender, country);
  }
  return data;
}

export async function signInWithUsername(username, password) {
  const u = String(username || "").trim().toLowerCase();
  if (!validateUsername(u) || !password) {
    throw new Error("نام کاربری یا رمز عبور نادرست است.");
  }

  if (CONFIG.AUTH_EDGE_URL) {
    const res = await fetch(CONFIG.AUTH_EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", username: u, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("نام کاربری یا رمز عبور نادرست است.");
    return applySessionTokens(body);
  }

  const sb = getSupabase();
  if (!sb) throw new Error("Supabase پیکربندی نشده است.");
  const email = usernameToEmail(u);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  // پیام یکسان — افشای وجود حساب نشود
  if (error || !data.session) throw new Error("نام کاربری یا رمز عبور نادرست است.");
  return data.session;
}

/** بازیابی رمز — همیشه پیام موفقیت‌آمیز یکسان (ضد enumeration) */
export async function recoverUsernamePassword(username, redirectTo) {
  const u = String(username || "").trim().toLowerCase();
  if (!validateUsername(u)) {
    // still generic
    return;
  }
  if (CONFIG.AUTH_EDGE_URL) {
    await fetch(CONFIG.AUTH_EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "recover",
        username: u,
        password: "noop123", // satisfies server min length check path; recover ignores password
        redirect_to: redirectTo || window.location.href,
      }),
    }).catch(() => {});
    return;
  }
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.resetPasswordForEmail(usernameToEmail(u), {
    redirectTo: redirectTo || window.location.href,
  }).catch(() => {});
}

async function applySessionTokens(body) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase پیکربندی نشده است.");
  const { error } = await sb.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  });
  if (error) throw new Error("نشست برقرار نشد.");
  const { data } = await sb.auth.getSession();
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
  if (error) {
    // fallback direct upsert if migration 004 not applied yet
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

export async function finalizeProfileClaim(username, displayName, gender, country) {
  return claimProfileAfterAuth(username, displayName, gender, country);
}
