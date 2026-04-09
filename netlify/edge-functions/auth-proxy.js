// netlify/edge-functions/auth-proxy.js
// Handles Supabase Auth API calls (signup, login, logout, session)

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON       = Deno.env.get("SUPABASE_ANON");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY"); // clé service_role (admin)
const SUPERADMINS         = ["guillaume@deux.io"];

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }

  const url    = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    const body = req.method !== "GET" ? await req.json() : {};

    // ── LOGIN ──────────────────────────────────────────────────────
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

    // ── SIGNUP ─────────────────────────────────────────────────────
    // Utilise la clé service_role pour créer le compte sans email de confirmation,
    // puis connecte immédiatement l'utilisateur avec ses identifiants.
    if (action === "signup") {
      if (!SUPABASE_SERVICE_KEY) {
        return json({ error: "Configuration serveur manquante (SUPABASE_SERVICE_KEY)" }, 500);
      }

      // 1. Créer le compte via Admin API (pas d'email de confirmation)
      const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          email: body.email,
          password: body.password,
          email_confirm: true, // compte confirmé d'emblée, pas d'email requis
        }),
      });
      const createData = await createRes.json();

      if (!createRes.ok) {
        // Supabase renvoie 422 si l'email existe déjà
        const msg = createData.message || createData.msg || createData.error_description || "Erreur lors de la création du compte";
        const status = createRes.status === 422 ? 409 : 400;
        return json({ error: msg }, status);
      }

      // 2. Connecter immédiatement avec les identifiants
      const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
        body: JSON.stringify({ email: body.email, password: body.password }),
      });
      const loginData = await loginRes.json();

      if (!loginRes.ok) {
        // Compte créé mais connexion échouée — cas rare
        return json({ error: "Compte créé mais connexion automatique échouée. Connectez-vous manuellement.", user: createData }, 200);
      }

      return json({
        access_token: loginData.access_token,
        refresh_token: loginData.refresh_token,
        user: loginData.user,
      });
    }

    // ── REFRESH ────────────────────────────────────────────────────
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

    // ── ME ─────────────────────────────────────────────────────────
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

    // ── UPDATE NAME ────────────────────────────────────────────────
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