// netlify/edge-functions/gemini-proxy.js
export default async function handler(request, context) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Gemini-Key",
      },
    });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const apiKey = request.headers.get("X-Gemini-Key") || "";
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Clé Gemini manquante dans X-Gemini-Key" }), {
      status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const { model = "gemini-2.0-flash", prompt } = await request.json();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    };

    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: data?.error?.message || `Gemini HTTP ${upstream.status}` }), {
        status: upstream.status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Normalize to OpenAI-like response
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const inTok = data?.usageMetadata?.promptTokenCount || 0;
    const outTok = data?.usageMetadata?.candidatesTokenCount || 0;

    return new Response(JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: inTok, completion_tokens: outTok },
      _raw: data,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Gemini proxy error: " + err.message }), {
      status: 502, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}

export const config = { path: "/api/gemini" };