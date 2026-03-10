// netlify/edge-functions/supabase-proxy.js
// Proxy Supabase — cache la clé API côté serveur
// La protection est assurée par le mot de passe Netlify (auth.js) en amont

export default async function handler(request, context) {
  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")  || "";
  const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON") || "";

  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return new Response("Supabase non configuré", { status: 500 });
  }

  const url = new URL(request.url);
  const supaPath  = url.pathname.replace("/api/supabase", "");
  const targetUrl = SUPABASE_URL + supaPath + url.search;

  const headers = new Headers();
  headers.set("apikey", SUPABASE_ANON);
  headers.set("Authorization", `Bearer ${SUPABASE_ANON}`);
  headers.set("Content-Type", request.headers.get("Content-Type") || "application/json");

  // Forward Prefer header for PostgREST (upsert, return=representation...)
  const prefer = request.headers.get("Prefer");
  if (prefer) headers.set("Prefer", prefer);

  const response = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
  });

  return new Response(response.body, {
    status:  response.status,
    headers: response.headers,
  });
}

export const config = { path: "/api/supabase/*" };
