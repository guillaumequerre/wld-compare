// netlify/edge-functions/geo-scheduler.js
// Scheduled function — runs every hour via Netlify Cron
// Interrogates favorite questions for all active schedules
// No user session required — uses encrypted API keys from projects table

export const config = {
  schedule: "0 * * * *",   // every hour on the hour
  path: "/api/geo-scheduler",
};

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")  || "";
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON") || "";

// ── Supabase helpers ──────────────────────────────────────────────
function sbHeaders() {
  return {
    "apikey": SUPABASE_ANON,
    "Authorization": `Bearer ${SUPABASE_ANON}`,
    "Content-Type": "application/json",
  };
}

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`sbGet ${path}: ${res.status}`);
  return res.json();
}

async function sbPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...sbHeaders(), "Prefer": "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`sbPost ${path}: ${res.status} — ${err.slice(0, 120)}`);
  }
  return res.json();
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: sbHeaders(),
    body: JSON.stringify(body),
  });
  return res.ok;
}

// ── Key codec (base64, same as frontend encodeKey/decodeKey) ───────
function decodeKey(enc) {
  if (!enc) return "";
  try { return atob(enc); } catch { return ""; }
}

// ── Provider definitions ──────────────────────────────────────────
const PROVIDERS = {
  openai:     { model: "gpt-4o-mini",         keyField: "openai_key_enc" },
  gemini:     { model: "gemini-2.0-flash",     keyField: "gemini_key_enc" },
  perplexity: { model: "sonar",                keyField: "perplexity_key_enc" },
  claude:     { model: "claude-haiku-4-5-20251001", keyField: "claude_geo_key_enc" },
};

// ── Call each provider API ────────────────────────────────────────
async function callProvider(providerId, apiKey, prompt) {
  if (!apiKey) throw new Error(`No API key for ${providerId}`);

  if (providerId === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model: PROVIDERS.openai.model, messages: [{ role: "user", content: prompt }], max_tokens: 1200 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `OpenAI ${res.status}`);
    return data.choices?.[0]?.message?.content || "";
  }

  if (providerId === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Gemini ${res.status}`);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  if (providerId === "perplexity") {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model: PROVIDERS.perplexity.model, messages: [{ role: "user", content: prompt }], max_tokens: 1200 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Perplexity ${res.status}`);
    return data.choices?.[0]?.message?.content || "";
  }

  if (providerId === "claude") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: PROVIDERS.claude.model, max_tokens: 1200, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Claude ${res.status}`);
    return data.content?.[0]?.text || "";
  }

  throw new Error(`Unknown provider: ${providerId}`);
}

// ── Brand detection (mirrors frontend detectBrand) ────────────────
function detectBrand(answer, sources, brandName, brandAliases) {
  if (!answer || !brandName) return { brandMentioned: false, brandInSources: false, brandPosition: null };
  const lower = answer.toLowerCase();
  const terms = [brandName, ...(brandAliases || [])].map(t => t.toLowerCase()).filter(Boolean);
  const brandMentioned = terms.some(t => lower.includes(t));

  // Position: which paragraph mentions the brand first
  let brandPosition = null;
  if (brandMentioned) {
    const paragraphs = answer.split(/\n+/).filter(p => p.trim().length > 20);
    const idx = paragraphs.findIndex(p => terms.some(t => p.toLowerCase().includes(t)));
    brandPosition = idx >= 0 ? idx + 1 : 1;
  }

  const brandInSources = (sources || []).some(url =>
    terms.some(t => url.toLowerCase().includes(t.replace(/\s+/g, "").toLowerCase()))
  );

  return { brandMentioned, brandInSources, brandPosition };
}

function extractSources(text) {
  const urls = [];
  const urlRegex = /https?:\/\/[^\s\)\],"']+/g;
  let m;
  while ((m = urlRegex.exec(text)) !== null) {
    urls.push(m[0].replace(/[.,;:]+$/, ""));
  }
  return [...new Set(urls)].slice(0, 10);
}

// ── Build prompt (mirrors frontend baseContext) ───────────────────
function buildPrompt(question, brandName, brandAliases, context) {
  const ctx = context ? `Contexte : ${context}\n\n` : "";
  const aliasStr = (brandAliases || []).filter(Boolean).join(", ");
  const brandCtx = brandName
    ? `Marque à détecter : "${brandName}"${aliasStr ? ` (aussi connue comme : ${aliasStr})` : ""}.\n\n`
    : "";
  return `${ctx}${brandCtx}RÈGLE ABSOLUE : Ne demande jamais de clarification. Réponds directement.\n\nPour chaque acteur recommandé : donne le nom, le site web, et une description courte.\n\n${question}`;
}

// ── Process one schedule ──────────────────────────────────────────
async function processSchedule(schedule, project, brand) {
  const providerIds = schedule.providers || ["openai"];
  const maxQ = schedule.max_questions || 10;

  // Load favorite questions for this site
  const questions = await sbGet(
    `geo_questions?project_id=eq.${encodeURIComponent(schedule.project_id)}&site_id=eq.${encodeURIComponent(schedule.site_id)}&is_favorite=eq.true&order=created_at.asc&limit=${maxQ}`
  );

  if (!questions.length) {
    console.log(`[scheduler] No favorite questions for ${schedule.project_id}/${schedule.site_id}`);
    return 0;
  }

  const brandName    = brand?.brand_name    || "";
  const brandAliases = brand?.brand_aliases || [];
  const context      = brand?.context       || "";
  let savedCount = 0;

  for (const q of questions) {
    for (const providerId of providerIds) {
      const pDef = PROVIDERS[providerId];
      if (!pDef) continue;

      const apiKey = decodeKey(project[pDef.keyField]);
      if (!apiKey) {
        console.warn(`[scheduler] Missing key for ${providerId} on project ${schedule.project_id}`);
        continue;
      }

      try {
        const prompt = buildPrompt(q.question, brandName, brandAliases, context);
        const answer = await callProvider(providerId, apiKey, prompt);
        const sources = extractSources(answer);
        const { brandMentioned, brandInSources, brandPosition } = detectBrand(answer, sources, brandName, brandAliases);

        const record = {
          question_id:          q.id,
          project_id:           schedule.project_id,
          site_id:              schedule.site_id,
          model:                `${providerId} (${pDef.model}) [auto]`,
          answer,
          sources,
          source_types:         [],
          brand_mentioned:      brandMentioned,
          brand_in_sources:     brandInSources,
          brand_position:       brandPosition,
          competitors_mentioned: [],
          answer_type:          "list",
          intent_type:          "informational",
          created_at:           new Date().toISOString(),
        };

        await sbPost("geo_results", record);
        savedCount++;

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));

      } catch(e) {
        console.error(`[scheduler] Error q=${q.id} provider=${providerId}:`, e.message);
      }
    }
  }

  return savedCount;
}

// ── Main handler ──────────────────────────────────────────────────
export default async function(request) {
  const start = Date.now();
  console.log("[geo-scheduler] Run started at", new Date().toISOString());

  // Only accept GET (Netlify cron) or POST with secret header (manual trigger)
  const secret = request.headers.get("X-Scheduler-Secret");
  const envSecret = Deno.env.get("SCHEDULER_SECRET");
  if (request.method === "POST" && envSecret && secret !== envSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const now = new Date().toISOString();

    // 1. Load all active schedules due for execution
    const schedules = await sbGet(
      `geo_schedules?active=eq.true&next_run=lte.${encodeURIComponent(now)}&order=next_run.asc&limit=50`
    );

    console.log(`[geo-scheduler] Found ${schedules.length} schedules to process`);
    if (!schedules.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0, duration: Date.now() - start }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. Load all needed projects in one query
    const projectIds = [...new Set(schedules.map(s => s.project_id))];
    const projectsRaw = await sbGet(
      `projects?id=in.(${projectIds.map(id => `"${id}"`).join(",")})&select=*`
    );
    const projectsMap = Object.fromEntries(projectsRaw.map(p => [p.id, p]));

    // 3. Load all needed brands in one query
    const siteKeys = schedules.map(s => `${s.project_id}__${s.site_id}`);
    const brandsRaw = await sbGet(
      `site_brand?project_id=in.(${projectIds.map(id => `"${id}"`).join(",")})&select=*`
    );
    const brandsMap = Object.fromEntries(brandsRaw.map(b => [`${b.project_id}__${b.site_id}`, b]));

    // 4. Process each schedule
    const results = [];
    for (const schedule of schedules) {
      const project = projectsMap[schedule.project_id];
      if (!project) {
        console.warn(`[scheduler] Project not found: ${schedule.project_id}`);
        continue;
      }

      const brand = brandsMap[`${schedule.project_id}__${schedule.site_id}`] || null;

      console.log(`[scheduler] Processing schedule ${schedule.id} for ${schedule.project_id}/${schedule.site_id}`);

      let count = 0;
      try {
        count = await processSchedule(schedule, project, brand);
      } catch(e) {
        console.error(`[scheduler] Schedule ${schedule.id} failed:`, e.message);
      }

      // 5. Update next_run and last_run
      const nextRun = computeNextRun(schedule.frequency);
      await sbPatch(
        `geo_schedules?id=eq.${schedule.id}`,
        { next_run: nextRun, last_run: now, last_run_count: count }
      );

      results.push({ schedule_id: schedule.id, questions_processed: count, next_run: nextRun });
    }

    const duration = Date.now() - start;
    console.log(`[geo-scheduler] Done in ${duration}ms — processed ${results.length} schedules`);

    return new Response(JSON.stringify({ ok: true, processed: results.length, results, duration }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch(e) {
    console.error("[geo-scheduler] Fatal error:", e.message);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ── Compute next run timestamp ────────────────────────────────────
function computeNextRun(frequency) {
  const now = new Date();
  switch (frequency) {
    case "daily":    now.setDate(now.getDate() + 1); break;
    case "weekly":   now.setDate(now.getDate() + 7); break;
    case "biweekly": now.setDate(now.getDate() + 14); break;
    case "monthly":  now.setDate(now.getDate() + 30); break;
    default:         now.setDate(now.getDate() + 7);
  }
  return now.toISOString();
}