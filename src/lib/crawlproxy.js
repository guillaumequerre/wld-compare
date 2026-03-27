// netlify/edge-functions/crawl-proxy.js
// Fetches a URL, extracts visible text, sends to Claude to identify page sections.
// Returns: { sections: [{type, title, summary, used_in_llm}] }

export default async function handler(request, context) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!ANTHROPIC_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY manquante" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let url;
  try {
    const body = await request.json();
    url = body.url;
    if (!url) throw new Error("url manquante");
  } catch (e) {
    return new Response(JSON.stringify({ error: "Body invalide: " + e.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Step 1: fetch the page ─────────────────────────────────────
  let htmlText = "";
  try {
    const pageRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CorrelDash/1.0; +https://correldash.netlify.app)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });

    if (!pageRes.ok) {
      return new Response(JSON.stringify({ error: `HTTP ${pageRes.status} en fetching ${url}` }), {
        status: 502,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    htmlText = await pageRes.text();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Fetch échoué: " + e.message }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  // ── Step 2: strip HTML to get readable text ───────────────────
  // Basic HTML → text (no DOM in Deno edge, so regex-based)
  const stripped = htmlText
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 8000); // Claude context limit — take first 8000 chars

  // ── Step 3: ask Claude to identify sections ───────────────────
  const prompt = `Tu es un expert en analyse de contenu web pour le GEO (Generative Engine Optimization).

Voici le contenu texte extrait de cette page : ${url}

---
${stripped}
---

Identifie et classe les sections principales de cette page. Pour chaque section, détermine :
1. Le type parmi : intro, tableau, FAQ, liste, comparatif, définition, témoignage, CTA, footer, autre
2. Un titre court (max 8 mots)
3. Un résumé de 1-2 phrases du contenu de la section
4. Si cette section est susceptible d'être reprise par un LLM comme ChatGPT dans une réponse (true/false), et pourquoi en 1 phrase

Réponds UNIQUEMENT en JSON avec ce format exact, sans texte avant ou après :
{
  "sections": [
    {
      "type": "intro|tableau|FAQ|liste|comparatif|définition|témoignage|CTA|footer|autre",
      "title": "...",
      "summary": "...",
      "used_in_llm": true|false,
      "used_in_llm_reason": "..."
    }
  ],
  "page_summary": "Résumé global de la page en 2 phrases",
  "main_topic": "Sujet principal en 5 mots max"
}`;

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const rawText = claudeData?.content?.[0]?.text || "";

    // Extract JSON from Claude response
    const start = rawText.indexOf("{");
    const end   = rawText.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("Pas de JSON dans la réponse Claude");

    const parsed = JSON.parse(rawText.substring(start, end + 1));

    return new Response(JSON.stringify({ ok: true, ...parsed }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: "Analyse Claude échouée: " + e.message }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}

export const config = { path: "/api/crawl" };