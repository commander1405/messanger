import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm";
import { CONFIG, isConfigured } from "../config.js";

let client = null;
const STORAGE_KEY = "dk-messenger-auth-v3";

export function getAuthStorageKey() {
  return STORAGE_KEY;
}

export function resetSupabaseClient() {
  client = null;
}

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
        // قفل سفارشی GoTrue در بعضی مرورگرها باعث بن‌بست می‌شود
        lock: async (_name, _acquireTimeout, fn) => fn(),
      },
    });
  }
  return client;
}
