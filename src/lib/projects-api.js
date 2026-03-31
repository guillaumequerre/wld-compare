// netlify/edge-functions/projects-api.js
// Validates JWT, returns only projects accessible to the user

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON");
const SUPERADMINS   = ["guillaume@deux.io"];

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

  // 1. Validate JWT — get user email from token
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!token) return json({ error: "Non authentifié" }, 401);

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": SUPABASE_ANON, "Authorization": `Bearer ${token}` },
  });
  if (!userRes.ok) return json({ error: "Token invalide" }, 401);
  const userData = await userRes.json();
  const userEmail = userData.email?.toLowerCase();
  if (!userEmail) return json({ error: "Utilisateur introuvable" }, 401);

  const isSuperAdmin = SUPERADMINS.includes(userEmail);

  // 2. Fetch projects
  let projects = [];
  if (isSuperAdmin) {
    // Super admin sees ALL projects
    const res = await fetch(`${SUPABASE_URL}/rest/v1/projects?select=*&order=updated_at.desc`, {
      headers: { "apikey": SUPABASE_ANON, "Authorization": `Bearer ${token}` },
    });
    if (res.ok) projects = await res.json();
  } else {
    // Regular user: owned projects + projects they're member of
    const [ownedRes, memberRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/projects?owner_email=eq.${encodeURIComponent(userEmail)}&select=*&order=updated_at.desc`, {
        headers: { "apikey": SUPABASE_ANON, "Authorization": `Bearer ${token}` },
      }),
      fetch(`${SUPABASE_URL}/rest/v1/project_members?user_email=eq.${encodeURIComponent(userEmail)}&select=project_id`, {
        headers: { "apikey": SUPABASE_ANON, "Authorization": `Bearer ${token}` },
      }),
    ]);

    const owned = ownedRes.ok ? await ownedRes.json() : [];
    const memberships = memberRes.ok ? await memberRes.json() : [];
    const memberIds = memberships.map(m => m.project_id).filter(Boolean);

    let memberProjects = [];
    if (memberIds.length > 0) {
      const ids = memberIds.map(id => `"${id}"`).join(",");
      const res = await fetch(`${SUPABASE_URL}/rest/v1/projects?id=in.(${ids})&select=*&order=updated_at.desc`, {
        headers: { "apikey": SUPABASE_ANON, "Authorization": `Bearer ${token}` },
      });
      if (res.ok) memberProjects = await res.json();
    }

    // Merge + deduplicate
    const seen = new Set();
    projects = [...owned, ...memberProjects].filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id); return true;
    });
  }

  return json({ projects, userEmail, isSuperAdmin });
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
    status, headers: { "Content-Type": "application/json", ...cors() },
  });
}

export const config = { path: "/api/projects" };