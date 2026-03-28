// netlify/edge-functions/claude-geo-proxy.js
// Used by GeoTab for fan-out analysis — non-streaming, client provides its own API key.
export default async function handler(request, context) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Claude-Key",
      },
    });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const apiKey = request.headers.get("X-Claude-Key") || "";
  if (!apiKey || !apiKey.startsWith("sk-ant-")) {
    return new Response(JSON.stringify({ error: "Clé Claude manquante dans X-Claude-Key (doit commencer par sk-ant-)" }), {
      status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
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

    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Claude GEO proxy error: " + err.message }), {
      status: 502, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}

export const config = { path: "/api/claude-geo" };