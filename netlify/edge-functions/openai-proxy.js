// netlify/edge-functions/openai-proxy.js
// Proxies OpenAI /v1/responses and /v1/chat/completions requests.
// The client decrypts the key and sends it in the X-Openai-Key header.
// Never stored server-side — the Netlify function just forwards it.

export default async function handler(request, context) {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Openai-Key, X-Openai-Endpoint",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Client sends the decrypted key in a custom header (never in body)
  const apiKey = request.headers.get("X-Openai-Key") || "";
  if (!apiKey || !apiKey.startsWith("sk-")) {
    return new Response(JSON.stringify({ error: "Clé OpenAI manquante ou invalide." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Client can specify endpoint: "responses" (default) or "completions"
  const endpoint = request.headers.get("X-Openai-Endpoint") || "responses";
  const openaiUrl = endpoint === "completions"
    ? "https://api.openai.com/v1/chat/completions"
    : "https://api.openai.com/v1/responses";

  try {
    const body = await request.text();

    const upstream = await fetch(openaiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
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
    return new Response(JSON.stringify({ error: "Proxy error: " + err.message }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}

export const config = { path: "/api/openai" };