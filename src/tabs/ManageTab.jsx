// netlify/edge-functions/auth-proxy.js
// Handles Supabase Auth API calls (signup, login, logout, session, password reset)

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
    if (action === "signup") {
      if (!SUPABASE_SERVICE_KEY) {
        return json({ error: "Configuration serveur manquante (SUPABASE_SERVICE_KEY)" }, 500);
      }

      // 1. Créer le compte via Admin API (sans email de confirmation)
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
          email_confirm: true,
        }),
      });
      const createData = await createRes.json();

      if (!createRes.ok) {
        const msg = createData.message || createData.msg || createData.error_description || "Erreur lors de la création du compte";
        const status = createRes.status === 422 ? 409 : 400;
        return json({ error: msg }, status);
      }

      // 2. Connecter immédiatement
      const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
        body: JSON.stringify({ email: body.email, password: body.password }),
      });
      const loginData = await loginRes.json();

      if (!loginRes.ok) {
        return json({ error: "Compte créé mais connexion automatique échouée. Connectez-vous manuellement.", user: createData }, 200);
      }

      return json({
        access_token: loginData.access_token,
        refresh_token: loginData.refresh_token,
        user: loginData.user,
      });
    }

    // ── FORGOT PASSWORD ────────────────────────────────────────────
    // Envoie un email de réinitialisation via l'API Supabase.
    // L'email doit exister dans auth.users, sinon Supabase renvoie 200 quand même
    // (pour ne pas divulguer l'existence du compte).
    if (action === "forgot_password") {
      if (!body.email) return json({ error: "Email requis" }, 400);

      const redirectTo = body.redirect_url || `${url.origin}/reset-password`;

      const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON,
        },
        body: JSON.stringify({
          email: body.email.toLowerCase().trim(),
          gotrue_meta_security: {},
        }),
      });

      // Supabase retourne toujours 200 (sécurité anti-enumeration)
      // On retourne toujours un succès côté client
      return json({ success: true, message: "Si ce compte existe, un email de réinitialisation a été envoyé." });
    }

    // ── RESET PASSWORD ─────────────────────────────────────────────
    // Appelé depuis la page /reset-password avec le token de l'email.
    // Le token est dans le hash de l'URL (#access_token=...) — le client
    // l'extrait et l'envoie ici pour changer le mot de passe.
    if (action === "reset_password") {
      if (!body.access_token || !body.new_password) {
        return json({ error: "Token et nouveau mot de passe requis" }, 400);
      }
      if (body.new_password.length < 8) {
        return json({ error: "Le mot de passe doit faire au moins 8 caractères" }, 400);
      }

      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON,
          "Authorization": `Bearer ${body.access_token}`,
        },
        body: JSON.stringify({ password: body.new_password }),
      });
      const data = await res.json();
      if (!res.ok) return json({ error: data.message || data.error_description || "Erreur lors de la réinitialisation" }, 400);
      return json({ success: true, user: data });
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

    // ── INVITE MEMBER ───────────────────────────────────────────────
    // Crée ou retrouve le compte + ajoute à project_members + envoie un email
    if (action === "invite_member") {
      const { projectId, email, invitedBy, role: memberRole, projectName } = body;
      if (!email || !projectId) return json({ error: "email et projectId requis" }, 400);
      if (!SUPABASE_SERVICE_KEY) return json({ error: "SUPABASE_SERVICE_KEY manquante" }, 500);

      const emailClean  = email.toLowerCase().trim();
      const roleClean   = memberRole || "member";
      const projectLabel = projectName || "le projet";
      const inviterEmail = invitedBy || "";

      // ── Étape 1 : nouveau compte via Supabase Admin "invite" ────────────
      // L'endpoint /invite crée le compte (si absent) ET envoie automatiquement
      // un email Supabase "Vous avez été invité" avec un lien pour définir le mdp.
      // Si le compte existe déjà → Supabase renvoie l'user existant + envoie quand même un lien magic.
      let accountCreated = false;
      let supabaseUserId = null;

      const inviteRes = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          email: emailClean,
          data: {
            invited_by:   inviterEmail,
            project_name: projectLabel,
          },
        }),
      });
      const inviteData = await inviteRes.json();

      if (inviteRes.ok) {
        supabaseUserId = inviteData.id;
        // Supabase renvoie confirmed_at = null → compte tout juste créé
        accountCreated = !inviteData.confirmed_at || inviteData.confirmation_sent_at === inviteData.created_at;
      } else {
        // Fallback : si l'invite échoue (ex: compte déjà confirmé), on passe à la création manuelle
        // pour au moins ajouter au projet même sans email
        console.warn("[invite_member] /invite warn:", inviteData.msg || inviteData.error_description || JSON.stringify(inviteData));
        accountCreated = false;
      }

      // ── Étape 2 : insérer dans project_members (bypass RLS via SERVICE_KEY) ──
      const memberRes = await fetch(`${SUPABASE_URL}/rest/v1/project_members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Prefer": "return=representation,resolution=ignore-duplicates",
        },
        body: JSON.stringify({
          project_id:  projectId,
          user_email:  emailClean,
          role:        roleClean,
          invited_by:  inviterEmail,
        }),
      });

      if (!memberRes.ok) {
        const err = await memberRes.text().catch(() => "");
        console.error("[invite_member] project_members insert failed:", memberRes.status, err.slice(0, 200));
        return json({
          error: accountCreated
            ? "Compte créé mais erreur d'ajout au projet — vérifiez la table project_members"
            : "Erreur d'ajout au projet",
          detail: err.slice(0, 200),
          status: memberRes.status,
        }, 500);
      }

      // ── Étape 3 : pour les comptes existants, composer l'email de notification ──
      // (Supabase envoie déjà un mail pour les nouveaux comptes via /invite)
      // Pour les existants, on retourne le corps d'email pré-composé pour mailto:
      let emailPayload = null;
      if (!accountCreated) {
        const appUrl = "https://correledash.netlify.app"; // URL de l'app
        const roleLabel = roleClean === "reader" ? "Lecture seule" : "Membre";
        emailPayload = {
          to:      emailClean,
          subject: `[CorrelDash] Accès ajouté — ${projectLabel}`,
          body: `Bonjour,

${inviterEmail || "Un administrateur"} vous a ajouté à "${projectLabel}" sur CorrelDash GEO par Sonate.

Votre rôle : ${roleLabel}

Vous pouvez accéder au projet en vous connectant à :
${appUrl}

Bonne analyse,
${inviterEmail || "L'équipe CorrelDash"}`,
        };
      }

      return json({
        ok:            true,
        accountCreated,           // true = nouveau compte, email "définir mdp" envoyé par Supabase
        existed:       !accountCreated, // true = compte existant
        email:         emailClean,
        emailSent:     accountCreated,  // Supabase a envoyé l'email automatiquement
        emailPayload,              // non-null si compte existant → frontend ouvre mailto:
        role:          roleClean,
      });
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