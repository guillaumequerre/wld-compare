// netlify/edge-functions/perplexity-proxy.js
export default async function handler(request, context) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Perplexity-Key",
      },
    });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const apiKey = request.headers.get("X-Perplexity-Key") || "";
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Clé Perplexity manquante dans X-Perplexity-Key" }), {
      status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const { model = "sonar", prompt } = await request.json();

    const upstream = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096,
        temperature: 0.7,
        return_citations: true,
        return_images: false,
        search_recency_filter: "month",
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: data?.error?.message || `Perplexity HTTP ${upstream.status}` }), {
        status: upstream.status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Perplexity returns OpenAI-compatible format + citations array
    // Extract citations from the response
    const citations = data?.citations || [];
    const text = data?.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({
      ...data,
      _citations: citations,
      _text: text,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Perplexity proxy error: " + err.message }), {
      status: 502, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}

export const config = { path: "/api/perplexity" };