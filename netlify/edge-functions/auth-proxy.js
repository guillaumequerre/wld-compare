// netlify/edge-functions/auth-proxy.js
// Handles Supabase Auth API calls (signup, login, logout, session)

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON");
const SUPERADMINS   = ["guillaume@deux.io"]; // Always have access to all projects

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action"); // login | signup | logout | session | me

  try {
    const body = req.method !== "GET" ? await req.json() : {};

    if (action === "login") {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
        body: JSON.stringify({ email: body.email, password: body.password }),
      });
      const data = await res.json();
      if (!res.ok) return json({ error: data.error_description || data.msg || "Identifiants incorrects" }, 401);
      return json({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
    }

    if (action === "signup") {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
        body: JSON.stringify({ email: body.email, password: body.password }),
      });
      const data = await res.json();
      if (!res.ok) return json({ error: data.error_description || data.msg || "Erreur d'inscription" }, 400);
      return json({ user: data.user, message: "Compte créé — vérifiez votre email" });
    }

    if (action === "refresh") {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
        body: JSON.stringify({ refresh_token: body.refresh_token }),
      });
      const data = await res.json();
      if (!res.ok) return json({ error: "Session expirée" }, 401);
      return json({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
    }

    if (action === "me") {
      const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
      if (!token) return json({ user: null });
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { "apikey": SUPABASE_ANON, "Authorization": `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) return json({ user: null });
      return json({ user: data, isSuperAdmin: SUPERADMINS.includes(data.email) });
    }

    if (action === "update_name") {
      const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
      if (!token) return json({ error: "Non authentifié" }, 401);
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON,
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ data: { display_name: body.display_name || "" } }),
      });
      const data = await res.json();
      if (!res.ok) return json({ error: data.message || "Erreur mise à jour" }, 400);
      return json({ user: data });
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

export const config = { path: "/api/auth" };