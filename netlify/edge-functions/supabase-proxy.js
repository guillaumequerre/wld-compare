// netlify/edge-functions/supabase-proxy.js
// Proxy Supabase — cache la clé API côté serveur
// Auth : Bearer <JWT Supabase> uniquement (Basic auth legacy supprimé)

export default async function(request) {
  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")  || "";
  const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON") || "";

  const authHeader = request.headers.get("authorization") || "";
  let userToken = null;

  if (authHeader.startsWith("Bearer ")) {
    userToken = authHeader.slice(7);
    if (!userToken) {
      return new Response("Token invalide", { status: 401 });
    }
  }
  // Pas d'auth = on laisse passer avec anon key (RLS gère les droits)

  const url = new URL(request.url);
  const supaPath  = url.pathname.replace("/api/supabase", "");
  const targetUrl = SUPABASE_URL + supaPath + url.search;

  const headers = new Headers(request.headers);
  headers.set("apikey", SUPABASE_ANON);
  headers.set("Authorization", userToken ? `Bearer ${userToken}` : `Bearer ${SUPABASE_ANON}`);
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