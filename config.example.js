/**
 * نمونه — کپی به config.js و مقادیر را پر کن.
 * cp config.example.js config.js
 */
export const CONFIG = {
  APP_NAME: "DarkKnight Messenger",
  APP_SHORT: "DarkKnight",
  BASE_PATH: "/messanger",
  SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_ANON_OR_PUBLISHABLE_KEY",
  ENABLE_PHONE_AUTH: true,
  ENABLE_EMAIL_DEV_AUTH: true,
  ENABLE_GOOGLE_LOGIN: false,
  ENABLE_VOICE_CALLS: false,
  ENABLE_VIDEO_CALLS: false,
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
  MAX_VIDEO_BYTES: 50 * 1024 * 1024,
  MAX_AUDIO_BYTES: 10 * 1024 * 1024,
  MAX_FILE_BYTES: 20 * 1024 * 1024,
  ALLOWED_IMAGE_TYPES: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  ALLOWED_VIDEO_TYPES: ["video/mp4", "video/webm"],
  ALLOWED_AUDIO_TYPES: ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4"],
  MESSAGE_PAGE_SIZE: 40,
  TYPING_TTL_MS: 3000,
  DEBUG_MODE: false,
};
