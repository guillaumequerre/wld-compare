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
    // Erreur 409 = email déjà utilisé
    if (res.status === 409) throw new Error("Un compte existe déjà avec cet email.");
    throw new Error(data.error || "Erreur lors de la création du compte");
  }

  // Le serveur retourne toujours un token après signup désormais
  if (data.access_token) {
    storeSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user }, true);
    return data.user;
  }

  // Cas de repli : compte créé sans token (ne devrait pas arriver)
  return null;
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

export async function sbAddProjectMember(projectId, email, invitedBy) {
  const res = await fetch(`/api/supabase/rest/v1/project_members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "return=representation,resolution=ignore-duplicates" },
    body: JSON.stringify({ project_id: projectId, user_email: email.toLowerCase().trim(), role: "member", invited_by: invitedBy }),
  });
  return res.ok;
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
      fetch(`/api/supabase/rest/v1/project_members?user_email=eq.${encodeURIComponent(email)}&select=project_id`, { headers: authH }),
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
    return [...owned, ...memberProjects]
      .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
      .map(parseProject);
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