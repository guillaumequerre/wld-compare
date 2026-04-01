// netlify/edge-functions/semrush-volume-proxy.js
// Fetches keyword search volumes from Semrush API

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Semrush-Key",
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export default async function(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "POST only" }, 405);
  }

  const apiKey = req.headers.get("X-Semrush-Key");
  if (!apiKey) return jsonResponse({ error: "Clé Semrush manquante (header X-Semrush-Key requis)" }, 400);

  let body;
  try { body = await req.json(); }
  catch { return jsonResponse({ error: "JSON invalide" }, 400); }

  const { keywords = [], database = "fr" } = body;
  if (!keywords.length) return jsonResponse({ volumes: {} });
  if (keywords.length > 100) return jsonResponse({ error: "Maximum 100 mots-clés par requête" }, 400);

  const results = {};
  try {
    // Semrush batch keyword overview
    const phrase = keywords.map(k => encodeURIComponent(k)).join(";");
    const url = `https://api.semrush.com/?type=phrase_these&key=${apiKey}&phrase=${phrase}&database=${database}&export_columns=Ph,Nq`;
    const res = await fetch(url);

    if (!res.ok) {
      const text = await res.text();
      return jsonResponse({ error: `Semrush API: ${text.slice(0, 200)}` }, 502);
    }

    const text = await res.text();
    if (text.includes("ERROR 50") || text.includes("NOTHING FOUND")) {
      return jsonResponse({ volumes: {} });
    }

    const lines = text.trim().split("\n");
    for (const line of lines.slice(1)) {
      const parts = line.split(";");
      if (parts.length >= 2) {
        const kw  = parts[0].trim();
        const vol = parseInt(parts[1].trim(), 10);
        if (kw && !isNaN(vol)) results[kw.toLowerCase()] = vol;
      }
    }
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }

  return jsonResponse({ volumes: results, database });
}

export const config = { path: "/api/semrush-volume" };