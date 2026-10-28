// Supabase Edge Function: username signup / login
// Deploy: supabase functions deploy auth-username --no-verify-jwt
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto in hosted)
//
// NEVER put service_role in frontend. This function validates username+password
// against Auth and returns a session. Uniform errors prevent account enumeration.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DOMAIN = "users.darkknight.local";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function normalizeUsername(u: string) {
  return String(u || "").trim().toLowerCase();
}

function isValidUsername(u: string) {
  return /^[a-z0-9_]{3,24}$/.test(u);
}

function syntheticEmail(username: string) {
  return `${username}@${DOMAIN}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!url || !serviceKey) return json({ error: "server_misconfigured" }, 500);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const action = String(payload.action || "");
  const username = normalizeUsername(String(payload.username || ""));
  const password = String(payload.password || "");
  const displayName = String(payload.display_name || username).trim() || username;
  const gender = payload.gender ? String(payload.gender) : null;
  const country = payload.country ? String(payload.country).trim() : "";

  if (!isValidUsername(username) || password.length < 6) {
    return json({ error: "invalid_credentials" }, 400);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(url, anonKey || serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = syntheticEmail(username);

  try {
    if (action === "signup") {
      // pre-check username uniqueness in profiles
      const { data: existing } = await admin
        .from("profiles")
        .select("id")
        .eq("username", username)
        .maybeSingle();
      if (existing) return json({ error: "username_taken" }, 409);

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName, username },
      });
      if (createErr) {
        const msg = String(createErr.message || "").toLowerCase();
        if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
          return json({ error: "username_taken" }, 409);
        }
        console.error("createUser", createErr);
        return json({ error: "signup_failed" }, 400);
      }
      const uid = created.user?.id;
      if (!uid) return json({ error: "signup_failed" }, 400);

      const g = gender && ["male", "female", "other", "unspecified"].includes(gender)
        ? gender
        : null;
      const { error: pErr } = await admin.from("profiles").upsert({
        id: uid,
        username,
        display_name: displayName,
        gender: g,
        country: country || "",
      });
      if (pErr) {
        // cleanup auth user if profile fails (e.g. username race)
        try { await admin.auth.admin.deleteUser(uid); } catch (_) { /* ignore */ }
        if (String(pErr.message || "").includes("duplicate") || pErr.code === "23505") {
          return json({ error: "username_taken" }, 409);
        }
        return json({ error: "signup_failed" }, 400);
      }

      const { data: sess, error: signErr } = await anon.auth.signInWithPassword({ email, password });
      if (signErr || !sess.session) return json({ error: "signup_failed" }, 400);
      return json({
        access_token: sess.session.access_token,
        refresh_token: sess.session.refresh_token,
        expires_in: sess.session.expires_in,
        token_type: sess.session.token_type,
        user: sess.session.user,
      });
    }

    if (action === "login") {
      // Always attempt same cost path: resolve username then sign in
      const { data: prof } = await admin
        .from("profiles")
        .select("id, username")
        .eq("username", username)
        .maybeSingle();

      // Use synthetic email convention even if profile missing (uniform timing best-effort)
      const { data: sess, error: signErr } = await anon.auth.signInWithPassword({ email, password });
      if (signErr || !sess.session) {
        return json({ error: "invalid_credentials" }, 401);
      }
      // Optional: ensure profile username matches
      if (prof && prof.id !== sess.session.user.id) {
        return json({ error: "invalid_credentials" }, 401);
      }
      return json({
        access_token: sess.session.access_token,
        refresh_token: sess.session.refresh_token,
        expires_in: sess.session.expires_in,
        token_type: sess.session.token_type,
        user: sess.session.user,
      });
    }

    if (action === "recover") {
      // Password recovery via synthetic email — does not reveal whether account exists
      await admin.auth.resetPasswordForEmail(email, {
        redirectTo: String(payload.redirect_to || ""),
      });
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("auth-username error", e);
    return json({ error: "server_error" }, 500);
  }
});
