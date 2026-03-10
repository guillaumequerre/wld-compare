// netlify/edge-functions/anthropic-proxy.js
// Proxy Anthropic API — cache la clé API côté serveur

export default async function handler(request, context) {
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

  if (!ANTHROPIC_KEY) {
    return new Response("ANTHROPIC_API_KEY non configurée", { status: 500 });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await request.text();

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body,
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export const config = { path: "/api/anthropic" };
