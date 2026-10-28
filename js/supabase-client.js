import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm";
import { CONFIG, isConfigured } from "../config.js";

let client = null;

export function getSupabase() {
  if (!isConfigured()) return null;
  if (!client) {
    client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        storageKey: "dk-messenger-auth",
      },
      realtime: { params: { eventsPerSecond: 12 } },
    });
  }
  return client;
}
