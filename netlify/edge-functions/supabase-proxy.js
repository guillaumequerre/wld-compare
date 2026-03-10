// netlify/edge-functions/supabase-proxy.js
// Proxy Supabase — cache la clé API côté serveur

export default async function handler(request, context) {
  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")  || "";
  const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON") || "";
  const DASHBOARD_PASSWORD = Deno.env.get("DASHBOARD_PASSWORD") || "";

  // Auth check (même protection que le dashboard)
  const authHeader = request.headers.get("authorization") || "";
  if (authHeader.startsWith("Basic ")) {
    const decoded  = atob(authHeader.slice(6));
    const password = decoded.slice(decoded.indexOf(":") + 1);
    if (password !== DASHBOARD_PASSWORD) {
      return new Response("Accès refusé", { status: 401 });
    }
  } else {
    return new Response("Accès refusé", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Dashboard"' },
    });
  }

  const url = new URL(request.url);
  // /api/supabase/storage/v1/... → SUPABASE_URL/storage/v1/...
  // /api/supabase/rest/v1/...    → SUPABASE_URL/rest/v1/...
  const supaPath = url.pathname.replace("/api/supabase", "");
  const targetUrl = SUPABASE_URL + supaPath + url.search;

  const headers = new Headers(request.headers);
  headers.set("apikey", SUPABASE_ANON);
  headers.set("Authorization", `Bearer ${SUPABASE_ANON}`);
  // Retire l'auth Basic pour ne pas la transmettre à Supabase
  headers.delete("authorization");

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
