import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm";
import { CONFIG, isConfigured } from "../config.js";

let client = null;

// storageKey نسخه‌دار تا قفل/نشست خراب قبلی باقی نماند
const STORAGE_KEY = "dk-messenger-auth-v2";

export function getSupabase() {
  if (!isConfigured()) return null;
  if (!client) {
    client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: window.localStorage,
        storageKey: STORAGE_KEY,
        lock: async (_name, _acquireTimeout, fn) => await fn(),
      },
      realtime: { params: { eventsPerSecond: 12 } },
    });
  }
  return client;
}

export function resetSupabaseClient() {
  client = null;
}

export function getAuthStorageKey() {
  return STORAGE_KEY;
}
