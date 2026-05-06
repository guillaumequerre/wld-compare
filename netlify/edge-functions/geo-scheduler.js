// netlify/edge-functions/geo-scheduler.js
// Scheduled function — runs every hour via Netlify Cron
// Interrogates favorite questions for all active schedules
// No user session required — uses SERVICE_ROLE key to bypass RLS

export const config = {
  schedule: "0 * * * *",   // every hour on the hour
  path: "/api/geo-scheduler",
};

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")              || "";
const SUPABASE_ANON     = Deno.env.get("SUPABASE_ANON")             || "";
// FIX BUG 1 : utiliser la SERVICE_ROLE key pour bypasser les RLS policies
const SUPABASE_SERVICE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
                          Deno.env.get("SUPABASE_SERVICE_KEY")      || "";

// ── Supabase helpers ──────────────────────────────────────────────
// Lecture : clé anon (respecte les RLS publiques)
function sbReadHeaders() {
  return {
    "apikey":        SUPABASE_ANON,
    "Authorization": `Bearer ${SUPABASE_ANON}`,
    "Content-Type":  "application/json",
  };
}

// Écriture : clé service role (bypasse les RLS — requis pour écrire sans session)
function sbWriteHeaders() {
  const key = SUPABASE_SERVICE || SUPABASE_ANON;
  return {
    "apikey":        key,
    "Authorization": `Bearer ${key}`,
    "Content-Type":  "application/json",
    "Prefer":        "return=representation",
  };
}

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbReadHeaders() });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`sbGet ${path}: ${res.status} — ${err.slice(0, 120)}`);
  }
  return res.json();
}

async function sbPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method:  "POST",
    headers: sbWriteHeaders(),
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`sbPost ${path}: ${res.status} — ${err.slice(0, 200)}`);
  }
  return res.json();
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method:  "PATCH",
    headers: sbWriteHeaders(),
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.warn(`sbPatch ${path}: ${res.status} — ${err.slice(0, 120)}`);
  }
  return res.ok;
}

// ── Key codec (base64, mirrors frontend encodeKey/decodeKey) ──────
function decodeKey(enc) {
  if (!enc) return "";
  try { return atob(enc); } catch { return ""; }
}

// ── Provider definitions ──────────────────────────────────────────
const PROVIDERS = {
  openai:     { model: "gpt-4o-mini",              keyField: "openai_key_enc" },
  gemini:     { model: "gemini-2.0-flash",          keyField: "gemini_key_enc" },
  perplexity: { model: "sonar",                    keyField: "perplexity_key_enc" },
  claude:     { model: "claude-haiku-4-5-20251001", keyField: "claude_geo_key_enc" },
};

// ── Call each provider API ────────────────────────────────────────
async function callProvider(providerId, apiKey, prompt) {
  if (!apiKey) throw new Error(`No API key for ${providerId}`);

  if (providerId === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body:    JSON.stringify({
        model:      PROVIDERS.openai.model,
        messages:   [{ role: "user", content: prompt }],
        max_tokens: 1200,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `OpenAI ${res.status}`);
    return { text: data.choices?.[0]?.message?.content || "", sources: [] };
  }

  if (providerId === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Gemini ${res.status}`);
    return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || "", sources: [] };
  }

  if (providerId === "perplexity") {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body:    JSON.stringify({
        model:      PROVIDERS.perplexity.model,
        messages:   [{ role: "user", content: prompt }],
        max_tokens: 1200,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Perplexity ${res.status}`);
    const citations = data.citations || data._citations || [];
    return { text: data.choices?.[0]?.message?.content || "", sources: citations };
  }

  if (providerId === "claude") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      PROVIDERS.claude.model,
        max_tokens: 1200,
        messages:   [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Claude ${res.status}`);
    return { text: data.content?.[0]?.text || "", sources: [] };
  }

  throw new Error(`Unknown provider: ${providerId}`);
}

// ── Brand detection ───────────────────────────────────────────────
function detectBrand(answer, sources, brandName, brandAliases) {
  if (!answer || !brandName) return { brandMentioned: false, brandInSources: false, brandPosition: null };
  const lower = answer.toLowerCase();
  const terms = [brandName, ...(brandAliases || [])].map(t => t.toLowerCase()).filter(Boolean);
  const brandMentioned = terms.some(t => lower.includes(t));

  let brandPosition = null;
  if (brandMentioned) {
    const lines = answer.split("\n").map(l => l.trim()).filter(Boolean);
    let pos = 0;
    for (const line of lines) {
      if (/^(\d+[.)]|[-•*])/.test(line)) {
        pos++;
        if (terms.some(t => line.toLowerCase().includes(t))) { brandPosition = pos; break; }
      }
    }
    if (!brandPosition) brandPosition = 1;
  }

  const brandInSources = (sources || []).some(url =>
    terms.some(t => url.toLowerCase().includes(t.replace(/\s+/g, "").toLowerCase()))
  );

  return { brandMentioned, brandInSources, brandPosition };
}

function extractSources(text) {
  const urlRegex = /https?:\/\/[^\s\)\],"']+/g;
  const matches = [];
  let m;
  while ((m = urlRegex.exec(text)) !== null) {
    matches.push(m[0].replace(/[.,;:]+$/, ""));
  }
  return [...new Set(matches)].slice(0, 10);
}

// ── Build prompt ──────────────────────────────────────────────────
function buildPrompt(question, brandName, brandAliases, context) {
  const ctx      = context ? `Contexte : ${context}\n\n` : "";
  const aliasStr = (brandAliases || []).filter(Boolean).join(", ");
  const brandCtx = brandName
    ? `Marque à détecter : "${brandName}"${aliasStr ? ` (aussi connue comme : ${aliasStr})` : ""}.\n\n`
    : "";
  return `${ctx}${brandCtx}RÈGLE ABSOLUE : Ne demande jamais de clarification. Réponds directement.\n\nPour chaque acteur recommandé : donne le nom, le site web, et une description courte.\n\n${question}`;
}

// ── Process one schedule ──────────────────────────────────────────
async function processSchedule(schedule, project, brand) {
  const providerIds = schedule.providers || ["openai"];
  const maxQ        = schedule.max_questions || 10;

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
        const { text: answer, sources: providerSources } = await callProvider(providerId, apiKey, prompt);
        const textSources = extractSources(answer);
        const sources = [...new Set([...providerSources, ...textSources])];
        const { brandMentioned, brandInSources, brandPosition } = detectBrand(answer, sources, brandName, brandAliases);

        const now = new Date().toISOString();

        // ── Sauvegarder dans geo_results ──────────────────────────
        const record = {
          question_id:           q.id,
          project_id:            schedule.project_id,
          site_id:               schedule.site_id,
          model:                 `${providerId} (${pDef.model}) [auto]`,
          answer,
          sources,
          source_types:          [],
          brand_mentioned:       brandMentioned,
          brand_in_sources:      brandInSources,
          brand_position:        brandPosition,
          competitors_mentioned: [],
          answer_type:           "list",
          intent_type:           "informational",
          created_at:            now,
        };

        await sbPost("geo_results", record);

        // FIX BUG 4 : insérer dans geo_presence_calendar pour le calendrier 30j
        try {
          await sbPost("geo_presence_calendar", {
            question_id:   q.id,
            provider_id:   providerId,
            brand_present: brandMentioned,
            test_date:     now.slice(0, 10),
            created_at:    now,
          });
        } catch(calErr) {
          // Non bloquant — la table peut ne pas exister encore
          console.warn(`[scheduler] calendar insert failed: ${calErr.message}`);
        }

        savedCount++;
        console.log(`[scheduler] ✓ q=${q.id} provider=${providerId} brand=${brandMentioned}`);

        // Délai anti-rate-limit
        await new Promise(r => setTimeout(r, 400));

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

  // Auth : GET = cron Netlify, POST = trigger manuel avec secret optionnel
  const secret    = request.headers.get("X-Scheduler-Secret");
  const envSecret = Deno.env.get("SCHEDULER_SECRET");
  if (request.method === "POST" && envSecret && secret !== envSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // FIX BUG 2 : pour les triggers POST manuels, force=true par défaut
  let forceRun = request.method === "POST"; // trigger manuel = toujours forcé
  if (request.method === "POST") {
    try {
      const body = await request.clone().json().catch(() => ({}));
      // Respecter un force:false explicite si envoyé
      if (body?.force === false) forceRun = false;
    } catch {}
  }

  try {
    const now = new Date().toISOString();

    // FIX BUG 2 : si force=true (trigger manuel), ignorer le filtre next_run
    const filter = forceRun
      ? `geo_schedules?active=eq.true&order=next_run.asc&limit=50`
      : `geo_schedules?active=eq.true&next_run=lte.${encodeURIComponent(now)}&order=next_run.asc&limit=50`;

    const schedules = await sbGet(filter);
    console.log(`[geo-scheduler] ${forceRun ? "FORCED" : "SCHEDULED"} — found ${schedules.length} schedules`);

    if (!schedules.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0, duration: Date.now() - start }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // FIX BUG 3 : syntaxe in.() correcte pour PostgREST — sans guillemets
    const projectIds = [...new Set(schedules.map(s => s.project_id))];
    const projectsRaw = await sbGet(
      `projects?id=in.(${projectIds.join(",")})&select=*`
    );
    const projectsMap = Object.fromEntries(projectsRaw.map(p => [p.id, p]));

    const brandsRaw = await sbGet(
      `site_brand?project_id=in.(${projectIds.join(",")})&select=*`
    );
    const brandsMap = Object.fromEntries(brandsRaw.map(b => [`${b.project_id}__${b.site_id}`, b]));

    const results = [];
    for (const schedule of schedules) {
      const project = projectsMap[schedule.project_id];
      if (!project) {
        console.warn(`[scheduler] Project not found: ${schedule.project_id}`);
        continue;
      }
      const brand = brandsMap[`${schedule.project_id}__${schedule.site_id}`] || null;
      console.log(`[scheduler] Processing schedule ${schedule.id}`);

      let count = 0;
      try {
        count = await processSchedule(schedule, project, brand);
      } catch(e) {
        console.error(`[scheduler] Schedule ${schedule.id} failed:`, e.message);
      }

      const nextRun = computeNextRun(schedule.frequency);
      await sbPatch(
        `geo_schedules?id=eq.${schedule.id}`,
        { next_run: nextRun, last_run: now, last_run_count: count }
      );

      results.push({ schedule_id: schedule.id, questions_processed: count, next_run: nextRun });
    }

    const duration = Date.now() - start;
    console.log(`[geo-scheduler] Done in ${duration}ms — ${results.length} schedules`);

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

// ── Compute next run ──────────────────────────────────────────────
function computeNextRun(frequency) {
  const d = new Date();
  switch (frequency) {
    case "daily":    d.setDate(d.getDate() + 1);  break;
    case "weekly":   d.setDate(d.getDate() + 7);  break;
    case "biweekly": d.setDate(d.getDate() + 14); break;
    case "monthly":  d.setDate(d.getDate() + 30); break;
    default:         d.setDate(d.getDate() + 7);
  }
  return d.toISOString();
}