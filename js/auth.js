import { CONFIG } from "../config.js";
import { getSupabase } from "./supabase-client.js";
import { faAuthError, normalizePhone } from "./utils.js";

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

/** Phone OTP — requires Supabase SMS provider */
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

/** Dev-only email auth — not production phone flow */
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
