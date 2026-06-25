// netlify/edge-functions/claude-geo-proxy.js
// Proxy vers l'API Anthropic pour les analyses GEO (fan-out, "Et maintenant ?", audit).
// Le client fournit sa propre clé (X-Claude-Key).
//
// IMPORTANT — pourquoi on STREAME la réponse :
// Les analyses "Et maintenant ?" utilisent Sonnet + recherche web (plusieurs appels),
// ce qui peut prendre 40-90 s et produire une grosse réponse JSON. Si l'edge function
// bufferise tout (await upstream.text()) avant de répondre, elle dépasse la limite de
// temps/taille de Netlify, qui renvoie alors une page d'erreur TEXTE ("The edge function…")
// — d'où l'erreur côté client « Unexpected token 'h', "the edge fu"… is not valid JSON ».
// En renvoyant directement upstream.body (passthrough en flux), l'edge function rend la
// main dès réception des en-têtes et laisse le corps circuler, ce qui évite ce timeout.
export default async function handler(request) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Claude-Key",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const apiKey = request.headers.get("X-Claude-Key") || "";
  if (!apiKey || !apiKey.startsWith("sk-ant-")) {
    return new Response(JSON.stringify({ error: "Clé Claude manquante dans X-Claude-Key (doit commencer par sk-ant-)" }), {
      status: 401, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  try {
    const body = await request.text();

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body,
    });

    // Passthrough EN FLUX : on ne fait PAS `await upstream.text()`.
    // Le corps (JSON Anthropic) circule tel quel vers le client, sans bufferisation
    // côté edge → pas de dépassement de la limite de temps/taille de Netlify.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        ...CORS,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Claude GEO proxy error: " + err.message }), {
      status: 502, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
}

export const config = { path: "/api/claude-geo" };