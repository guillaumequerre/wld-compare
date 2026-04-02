// netlify/edge-functions/supabase-info.js
// Expose l'URL et la clé anon Supabase publiquement au client React
// Ces valeurs sont publiques (anon key = lecture seule sans RLS bypass)

export default async function(request) {
  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")  || "";
  const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON") || "";

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }

  return new Response(
    JSON.stringify({ url: SUPABASE_URL, anon: SUPABASE_ANON }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        // Cache 1h — ces valeurs ne changent pas
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}

export const config = { path: "/api/supabase-info" };