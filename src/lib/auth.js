// lib/auth.js
// Auth helpers — talk to /api/auth edge function
// Session stored in sessionStorage (clears on tab close) + localStorage for remember-me

const SUPERADMINS = ["guillaume@deux.io"];

export function getStoredSession() {
  try {
    const s = sessionStorage.getItem("correl_session") || localStorage.getItem("correl_session");
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function storeSession(session, remember = true) {
  const s = JSON.stringify(session);
  sessionStorage.setItem("correl_session", s);
  if (remember) localStorage.setItem("correl_session", s);
}

export function clearSession() {
  sessionStorage.removeItem("correl_session");
  localStorage.removeItem("correl_session");
}

export function getToken() {
  return getStoredSession()?.access_token || null;
}

export function getCurrentUser() {
  return getStoredSession()?.user || null;
}

export function isSuperAdmin(user) {
  return user && SUPERADMINS.includes(user.email);
}

export async function authLogin(email, password, remember = true) {
  const res = await fetch("/api/auth?action=login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Identifiants incorrects");
  storeSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user }, remember);
  return data.user;
}

export async function authSignup(email, password) {
  const res = await fetch("/api/auth?action=signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();

  if (!res.ok) {
    if (res.status === 409) throw new Error("Un compte existe déjà avec cet email.");
    throw new Error(data.error || "Erreur lors de la création du compte");
  }

  if (data.access_token) {
    storeSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user }, true);
    return data.user;
  }

  return null;
}

// ── Mot de passe oublié ───────────────────────────────────────────
// Envoie un email de réinitialisation. Retourne toujours true
// (Supabase ne divulgue pas si le compte existe).
export async function authForgotPassword(email) {
  const res = await fetch("/api/auth?action=forgot_password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: email.toLowerCase().trim(),
      redirect_url: `${window.location.origin}/reset-password`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erreur lors de l'envoi de l'email");
  return data;
}

// ── Réinitialisation du mot de passe ──────────────────────────────
// Appelée depuis la page /reset-password.
// Le token vient du hash de l'URL (#access_token=xxx&type=recovery).
export async function authResetPassword(accessToken, newPassword) {
  const res = await fetch("/api/auth?action=reset_password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: accessToken, new_password: newPassword }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erreur lors de la réinitialisation");
  return data;
}

export async function authLogout() {
  clearSession();
}

export async function authRefresh() {
  const session = getStoredSession();
  if (!session?.refresh_token) return null;
  try {
    const res = await fetch("/api/auth?action=refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) { clearSession(); return null; }
    const data = await res.json();
    storeSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
    return data.user;
  } catch { clearSession(); return null; }
}

// ── Project access control ────────────────────────────────────────

export async function sbGetProjectMembers(projectId) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api/supabase/rest/v1/project_members?project_id=eq.${encodeURIComponent(projectId)}&select=*`, { headers });
  if (!res.ok) return [];
  return res.json();
}

export async function sbAddProjectMember(projectId, email, invitedBy, role = "member") {
  const token = getToken();
  const headers = { "Content-Type": "application/json", "Prefer": "return=representation,resolution=ignore-duplicates" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api/supabase/rest/v1/project_members`, {
    method: "POST",
    headers,
    body: JSON.stringify({ project_id: projectId, user_email: email.toLowerCase().trim(), role, invited_by: invitedBy }),
  });
  return res.ok;
}

// Invite un utilisateur sur un projet.
// - Si le compte existe : l'ajoute directement à project_members
// - Si le compte n'existe pas : envoie un email d'invitation Supabase + ajoute à project_members
// Retourne { ok, existed, invited, error }
export async function sbInviteMember(projectId, email, invitedBy, role = "member") {
  try {
    // 1. Vérifier existence + envoyer invite si besoin
    const res = await fetch("/api/auth?action=invite_member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.toLowerCase().trim(), redirectTo: window.location.origin + "/" }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || "Erreur lors de l'invitation" };

    // 2. Ajouter à project_members dans tous les cas
    const added = await sbAddProjectMember(projectId, email, invitedBy, role);
    if (!added) return { ok: false, error: "Compte invité mais erreur d'ajout au projet" };

    return { ok: true, existed: data.existed, invited: data.invited };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Retourne le rôle de l'utilisateur courant sur un projet ('owner' | 'member' | 'reader' | null)
export async function sbGetMyRole(projectId, userEmail, ownerEmail) {
  if (!userEmail || !projectId) return null;
  const email = userEmail.toLowerCase();
  if (isSuperAdmin({ email })) return "owner";
  if (ownerEmail && ownerEmail.toLowerCase() === email) return "owner";
  const members = await sbGetProjectMembers(projectId);
  const me = members.find(m => m.user_email?.toLowerCase() === email);
  return me?.role || null;
}

export async function sbRemoveProjectMember(projectId, email) {
  const res = await fetch(`/api/supabase/rest/v1/project_members?project_id=eq.${encodeURIComponent(projectId)}&user_email=eq.${encodeURIComponent(email)}`, {
    method: "DELETE",
  });
  return res.ok;
}

export async function sbSetProjectOwner(projectId, ownerEmail) {
  await fetch(`/api/supabase/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner_email: ownerEmail }),
  });
}

export async function sbLoadAccessibleProjects(userEmail) {
  const token = getToken();
  if (!token || !userEmail) return [];

  try {
    const email = userEmail.toLowerCase();
    const admin = isSuperAdmin({ email });
    const authH = { "Authorization": `Bearer ${token}` };

    if (admin) {
      const res = await fetch(`/api/supabase/rest/v1/projects?select=*&order=updated_at.desc`, { headers: authH });
      if (!res.ok) return [];
      return (await res.json()).map(parseProject);
    }

    const [ownedRes, memberRes] = await Promise.all([
      fetch(`/api/supabase/rest/v1/projects?owner_email=eq.${encodeURIComponent(email)}&select=*&order=updated_at.desc`, { headers: authH }),
      fetch(`/api/supabase/rest/v1/project_members?user_email=eq.${encodeURIComponent(email)}&select=project_id,role`, { headers: authH }),
    ]);
    const owned = ownedRes.ok ? await ownedRes.json() : [];
    const memberships = memberRes.ok ? await memberRes.json() : [];
    const memberIds = memberships.map(m => m.project_id).filter(Boolean);

    let memberProjects = [];
    if (memberIds.length > 0) {
      const ids = memberIds.map(id => `"${id}"`).join(",");
      const res = await fetch(`/api/supabase/rest/v1/projects?id=in.(${ids})&select=*&order=updated_at.desc`, { headers: authH });
      if (res.ok) memberProjects = await res.json();
    }

    const seen = new Set();
    // Projets owned = rôle 'owner', projets member = rôle depuis la table
    const ownedParsed = owned.map(p => ({ ...parseProject(p), myRole: "owner" }));
    const memberParsed = memberProjects.map(p => {
      const membership = memberships.find(m => m.project_id === p.id);
      return { ...parseProject(p), myRole: membership?.role || "member" };
    });
    return [...ownedParsed, ...memberParsed]
      .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  } catch(e) {
    console.error("sbLoadAccessibleProjects error:", e);
    return [];
  }
}

function parseProject(r) {
  return {
    id: r.id, name: r.name,
    sites: JSON.parse(r.sites_json || "[]"),
    openai_key_enc: r.openai_key_enc || null,
    geo_axes: JSON.parse(r.geo_axes_json || "null") || ["Meilleur / top / recommandé","Pistes et approches pour utiliser / bénéficier du mot-clé","Avis / fiable / fiabilité","Pour atteindre un objectif lié au mot-clé","Pour résoudre une problématique liée au mot-clé"],
    gemini_key_enc: r.gemini_key_enc || null,
    perplexity_key_enc: r.perplexity_key_enc || null,
    claude_geo_key_enc: r.claude_geo_key_enc || null,
    semrush_key_enc: r.semrush_key_enc || null,
    owner_email: r.owner_email || null,
    updated_at: r.updated_at || null,
    settings_json: r.settings_json || null,
  };
}