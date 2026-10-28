/**
 * DarkKnight Messenger — پیکربندی مرکزی
 * مقادیر SUPABASE را از داشبورد پروژه Supabase خودت پر کن:
 * Project Settings → API → Project URL و anon/public key
 * هرگز service_role را اینجا نگذار.
 */
export const CONFIG = {
  APP_NAME: "DarkKnight Messenger",
  APP_SHORT: "DarkKnight",
  // زیر GitHub Pages پروژه: https://USERNAME.github.io/messanger/
  // اگر دامنه ریشه است BASE_PATH را "" بگذار
  BASE_PATH: "/messanger",

  // از Supabase Dashboard → Settings → API
  SUPABASE_URL: "", // مثال: https://xxxxx.supabase.co
  SUPABASE_ANON_KEY: "", // publishable / legacy anon key

  // احراز هویت
  // phone نیاز به SMS Provider در Supabase Auth دارد
  ENABLE_PHONE_AUTH: true,
  // حالت توسعه: ایمیل/رمز — فقط وقتی SMS آماده نیست. تولید واقعی نیست.
  ENABLE_EMAIL_DEV_AUTH: true,
  ENABLE_GOOGLE_LOGIN: false,

  // تماس‌ها تا زیرساخت WebRTC/TURN آماده نشود خاموش بمانند
  ENABLE_VOICE_CALLS: false,
  ENABLE_VIDEO_CALLS: false,

  // محدودیت آپلود (بایت)
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
  MAX_VIDEO_BYTES: 50 * 1024 * 1024,
  MAX_AUDIO_BYTES: 10 * 1024 * 1024,
  MAX_FILE_BYTES: 20 * 1024 * 1024,
  ALLOWED_IMAGE_TYPES: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  ALLOWED_VIDEO_TYPES: ["video/mp4", "video/webm"],
  ALLOWED_AUDIO_TYPES: ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4"],

  // پیام‌ها
  MESSAGE_PAGE_SIZE: 40,
  TYPING_TTL_MS: 3000,

  DEBUG_MODE: false,
};

export function isConfigured() {
  return Boolean(
    CONFIG.SUPABASE_URL &&
      CONFIG.SUPABASE_URL.startsWith("http") &&
      CONFIG.SUPABASE_ANON_KEY &&
      CONFIG.SUPABASE_ANON_KEY.length > 20
  );
}

export function assetUrl(path) {
  const base = (CONFIG.BASE_PATH || "").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
