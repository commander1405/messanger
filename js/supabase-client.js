import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
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
      },
      realtime: { params: { eventsPerSecond: 12 } },
    });
  }
  return client;
}
