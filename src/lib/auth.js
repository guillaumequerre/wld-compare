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
  if (!res.ok) throw new Error(data.error || "Erreur lors de la création du compte");
  // Auto-login after signup if token returned
  if (data.access_token) {
    storeSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
    return data.user;
  }
  return data.user;
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

// Project access control
export async function sbGetProjectMembers(projectId) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api/supabase/rest/v1/project_members?project_id=eq.${encodeURIComponent(projectId)}&select=*`);
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

// Load projects accessible to this user
export async function sbLoadAccessibleProjects(userEmail) {
  if (isSuperAdmin({ email: userEmail })) {
    // Superadmin sees all projects
    const res = await fetch(`/api/supabase/rest/v1/projects?select=*&order=updated_at.desc`);
    if (!res.ok) return [];
    return (await res.json()).map(parseProject);
  }
  // Regular user: projects they own OR are member of
  const [owned, membered] = await Promise.all([
    fetch(`/api/supabase/rest/v1/projects?owner_email=eq.${encodeURIComponent(userEmail)}&select=*&order=updated_at.desc`).then(r => r.ok ? r.json() : []),
    fetch(`/api/supabase/rest/v1/project_members?user_email=eq.${encodeURIComponent(userEmail)}&select=project_id`).then(r => r.ok ? r.json() : []),
  ]);
  const memberIds = membered.map(m => m.project_id);
  let memberProjects = [];
  if (memberIds.length) {
    const ids = memberIds.map(id => `"${id}"`).join(",");
    const res = await fetch(`/api/supabase/rest/v1/projects?id=in.(${ids})&select=*&order=updated_at.desc`);
    if (res.ok) memberProjects = await res.json();
  }
  const all = [...owned, ...memberProjects];
  const seen = new Set();
  return all.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; }).map(parseProject);
}

function parseProject(r) {
  return {
    id: r.id, name: r.name,
    sites: JSON.parse(r.sites_json || "[]"),
    openai_key_enc: r.openai_key_enc || null,
    geo_axes: JSON.parse(r.geo_axes_json || "null") || ["Quoi ?","Pourquoi ?","Comment ?","Comparaison","Coût/budget"],
    gemini_key_enc: r.gemini_key_enc || null,
    perplexity_key_enc: r.perplexity_key_enc || null,
    claude_geo_key_enc: r.claude_geo_key_enc || null,
    owner_email: r.owner_email || null,
    updated_at: r.updated_at || null,
  };
}