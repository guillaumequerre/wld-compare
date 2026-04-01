// netlify/edge-functions/supabase-proxy.js
// Proxy Supabase — cache la clé API côté serveur
// Accepte : Bearer <JWT Supabase> OU Basic auth legacy (DASHBOARD_PASSWORD)

export default async function(request) {
  const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")       || "";
  const SUPABASE_ANON      = Deno.env.get("SUPABASE_ANON")      || "";
  const DASHBOARD_PASSWORD = Deno.env.get("DASHBOARD_PASSWORD") || "";

  const authHeader = request.headers.get("authorization") || "";
  let userToken = null; // JWT de l'utilisateur connecté

  if (authHeader.startsWith("Bearer ")) {
    // Auth Supabase JWT — on laisse passer, le token sera envoyé à Supabase
    userToken = authHeader.slice(7);
    // Vérification minimale : le token doit être non vide
    if (!userToken) {
      return new Response("Token invalide", { status: 401 });
    }
  } else if (authHeader.startsWith("Basic ")) {
    // Legacy Basic auth (DASHBOARD_PASSWORD)
    const decoded  = atob(authHeader.slice(6));
    const password = decoded.slice(decoded.indexOf(":") + 1);
    if (password !== DASHBOARD_PASSWORD) {
      return new Response("Accès refusé", { status: 401 });
    }
  } else {
    return new Response("Accès refusé — fournissez un Bearer token ou Basic auth", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Dashboard"' },
    });
  }

  const url = new URL(request.url);
  const supaPath  = url.pathname.replace("/api/supabase", "");
  const targetUrl = SUPABASE_URL + supaPath + url.search;

  const headers = new Headers(request.headers);
  headers.set("apikey", SUPABASE_ANON);
  // Si JWT user disponible, l'utiliser pour les requêtes Supabase (RLS)
  // Sinon, utiliser l'anon key
  headers.set("Authorization", userToken ? `Bearer ${userToken}` : `Bearer ${SUPABASE_ANON}`);
  headers.delete("authorization"); // évite la transmission du header original

  const response = await fetch(targetUrl, {
    method:  request.method,
    headers,
    body:    ["GET", "HEAD"].includes(request.method) ? null : request.body,
  });

  return new Response(response.body, {
    status:  response.status,
    headers: response.headers,
  });
}

export const config = { path: "/api/supabase/*" };