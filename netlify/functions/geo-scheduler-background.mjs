// netlify/functions/geo-scheduler-background.mjs
// Netlify BACKGROUND FUNCTION (timeout 15 min, pas ~50s comme les Edge Functions)
// Interroge les questions FAVORITES des schedules actifs, sans session utilisateur.
// Déclenchée par : (1) le cron via geo-scheduler.js (edge), (2) le trigger manuel front.
// Le suffixe "-background" active le mode asynchrone Netlify : réponse 202 immédiate.

const SUPABASE_URL      = process.env.SUPABASE_URL              || "";
const SUPABASE_ANON     = process.env.SUPABASE_ANON             || "";
// FIX BUG 1 : utiliser la SERVICE_ROLE key pour bypasser les RLS policies
const SUPABASE_SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY ||
                          process.env.SUPABASE_SERVICE_KEY      || "";

// ── Email de fin de run (Resend) ──────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM      = process.env.SCHEDULER_MAIL_FROM || "Dashboard GEO | Sonate <noreply@geo.sonate.group>";

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

const PROVIDER_LABEL = { openai: "OpenAI", gemini: "Gemini", perplexity: "Perplexity", claude: "Claude" };

// ── Parsers IDENTIQUES à l'onglet Questions (extraction réponse + sources) ──
const HALLUCINATION = [/exemple\d*\./i, /example\d*\./i, /site\d+\./i, /domaine\d*\./i, /placeholder/i, /turn\d+search/i];

function extractOpenAIUrls(data) {
  const urls = [], seen = new Set();
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) {
      for (const ann of part.annotations || []) {
        if (ann.type === "url_citation" && ann.url && !seen.has(ann.url)) { seen.add(ann.url); urls.push(ann.url); }
      }
    }
  }
  return urls;
}

function parseOpenAIResponse(data, endpoint = "responses") {
  let rawText = "";
  if (endpoint === "responses") {
    for (const item of data.output || []) {
      if (item.type !== "message") continue;
      for (const part of item.content || []) if (part.type === "output_text") rawText += part.text;
    }
  } else {
    rawText = data.choices?.[0]?.message?.content || "";
  }
  const realUrls = extractOpenAIUrls(data);
  const urlRe = /https?:\/\/[^\s\])"'>]+/g;
  const textUrls = [...rawText.matchAll(urlRe)].map(m => m[0].replace(/[.,;:)]+$/, "")).filter(u => !HALLUCINATION.some(p => p.test(u)));
  const allUrls = [...new Set([...realUrls, ...textUrls])];
  let answer = rawText;
  const s = rawText.lastIndexOf("{"), e = rawText.lastIndexOf("}");
  if (s !== -1 && e > s) {
    try { const j = JSON.parse(rawText.substring(s, e + 1)); if (j.answer && !String(j.answer).startsWith("{")) answer = j.answer; } catch {}
  }
  return { answer, sources: [...new Set(allUrls)].filter(u => !HALLUCINATION.some(p => p.test(u))) };
}

function parseTextResponse(text, extraSources = []) {
  const s = text.lastIndexOf("{"), e = text.lastIndexOf("}");
  if (s !== -1 && e > s) {
    try {
      const parsed = JSON.parse(text.substring(s, e + 1));
      if (parsed.answer) {
        const inlineUrls = [...String(parsed.answer).matchAll(/https?:\/\/[^\s\])"'>]+/g)].map(m => m[0]).filter(u => !HALLUCINATION.some(p => p.test(u)));
        return { answer: parsed.answer, sources: [...new Set([...(parsed.sources || []), ...extraSources, ...inlineUrls])].filter(Boolean) };
      }
    } catch {}
  }
  const foundUrls = [...text.matchAll(/https?:\/\/[^\s\])"'>]+/g)].map(m => m[0]).filter(u => !HALLUCINATION.some(p => p.test(u)));
  return { answer: text, sources: [...new Set([...foundUrls, ...extraSources])] };
}

// Évite de réessayer la Responses API OpenAI si elle a échoué une fois (tier).
let openaiResponsesDisabled = false;

// ── Appels providers VIA LES PROXIES — identiques à l'onglet Questions ──
// `site` = origine absolue du déploiement (les proxies sont des routes relatives
// côté front ; côté serveur il faut une URL absolue).
async function callProvider(providerId, apiKey, prompt, site) {
  if (!apiKey) throw new Error(`No API key for ${providerId}`);
  const base = site || "";
  const model = PROVIDERS[providerId].model;

  if (providerId === "openai") {
    // Tentative 1 : Responses API + web_search (temps réel), comme dans Questions.
    if (!openaiResponsesDisabled) {
      try {
        const resA = await fetch(`${base}/api/openai`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Openai-Key": apiKey, "X-Openai-Endpoint": "responses" },
          body: JSON.stringify({ model, input: prompt, tools: [{ type: "web_search_preview", search_context_size: "high" }], max_output_tokens: 4000 }),
        });
        const rawA = await resA.text();
        if (resA.ok && !rawA.trimStart().startsWith("<")) {
          try { return parseOpenAIResponse(JSON.parse(rawA), "responses"); } catch {}
        }
        openaiResponsesDisabled = true;
      } catch { openaiResponsesDisabled = true; }
    }
    // Tentative 2 : Chat Completions (fallback).
    const res = await fetch(`${base}/api/openai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Openai-Key": apiKey, "X-Openai-Endpoint": "completions" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: "Tu es un expert en recommandation d'entreprises et prestataires. Réponds directement et factuellement." }, { role: "user", content: prompt }], temperature: 0.7, max_tokens: 2000 }),
    });
    const raw = await res.text();
    if (raw.trimStart().startsWith("<")) throw new Error("Proxy /api/openai introuvable");
    const data = JSON.parse(raw);
    if (!res.ok) throw new Error(data?.error?.message || `OpenAI ${res.status}`);
    return parseOpenAIResponse(data, "completions");
  }

  if (providerId === "gemini") {
    const res = await fetch(`${base}/api/gemini`, { method: "POST", headers: { "Content-Type": "application/json", "X-Gemini-Key": apiKey }, body: JSON.stringify({ model, prompt }) });
    const raw = await res.text();
    if (raw.trimStart().startsWith("<")) throw new Error("Proxy /api/gemini introuvable");
    const data = JSON.parse(raw);
    if (!res.ok) throw new Error(data.error || `Gemini ${res.status}`);
    return parseTextResponse(data.choices?.[0]?.message?.content || "", data._sources || []);
  }

  if (providerId === "perplexity") {
    const res = await fetch(`${base}/api/perplexity`, { method: "POST", headers: { "Content-Type": "application/json", "X-Perplexity-Key": apiKey }, body: JSON.stringify({ model, prompt }) });
    const raw = await res.text();
    if (raw.trimStart().startsWith("<")) throw new Error("Proxy /api/perplexity introuvable");
    const data = JSON.parse(raw);
    if (!res.ok) throw new Error(data.error?.message || `Perplexity ${res.status}`);
    return parseTextResponse(data.choices?.[0]?.message?.content || "", data._citations || []);
  }

  if (providerId === "claude") {
    const res = await fetch(`${base}/api/claude-geo`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Claude-Key": apiKey },
      body: JSON.stringify({ model, max_tokens: 4000, system: "Tu es un expert en recommandation d'entreprises et prestataires. Réponds directement sans mentionner les limites de tes connaissances.", messages: [{ role: "user", content: prompt }] }),
    });
    const raw = await res.text();
    if (raw.trimStart().startsWith("<")) throw new Error("Proxy /api/claude-geo introuvable");
    if (!res.ok) { let m = `Claude ${res.status}`; try { m = JSON.parse(raw)?.error?.message || m; } catch {} throw new Error(m); }
    const data = JSON.parse(raw);
    return parseTextResponse(data.content?.[0]?.text || "", []);
  }

  throw new Error(`Unknown provider: ${providerId}`);
}

// ── Brand detection — 3 types (mirrors GeoTab.jsx detectBrand) ──
function detectBrand(answer, sources, brandName, brandAliases) {
  if (!answer || !brandName) {
    return { brandMentioned: false, brandInSources: false, brandPosition: null,
             mention: { present: false, position: null },
             evocation: { present: false, position: null },
             citation: { present: false, position: null } };
  }

  const terms = [brandName, ...(brandAliases || [])].map(t => t.toLowerCase().trim()).filter(Boolean);
  const domainTerms = terms.map(t => t.replace(/\s+/g, ""));

  function matches(text) {
    const t = (text || "").toLowerCase();
    return terms.some(term => term && t.includes(term));
  }

  const lines = answer.split("\n");
  const topItemRe = /^\s*(?:[•\-\*]\s*)?(\d+)[.)\s]\s*(.+)/;

  // MENTION : item numéroté du top
  let mentionPosition = null;
  for (const line of lines) {
    const m = line.match(topItemRe);
    if (m && matches(m[2]) && mentionPosition === null) {
      mentionPosition = parseInt(m[1], 10);
    }
  }

  // EVOCATION : corps narratif hors top items
  let evocationPosition = null;
  let narrativeCount = 0;
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped || topItemRe.test(line)) continue;
    if (stripped.startsWith("http") || stripped.startsWith("[") || stripped.startsWith("Source")) continue;
    narrativeCount++;
    if (matches(stripped) && evocationPosition === null) evocationPosition = narrativeCount;
  }

  // CITATION : domaine dans les sources
  let citationPosition = null;
  const urlRe = /https?:\/\/[^\s\)\],"']+/g;
  const textUrls = [...answer.matchAll(urlRe)].map(m => m[0].replace(/[.,;:]+$/, ""));
  const allSources = [...new Set([...(sources || []), ...textUrls])];
  for (let i = 0; i < allSources.length; i++) {
    const src = allSources[i].toLowerCase().replace("www.", "");
    if (domainTerms.some(d => d && src.includes(d)) && citationPosition === null) {
      citationPosition = i + 1;
    }
  }

  const brandMentioned = mentionPosition !== null || evocationPosition !== null;
  return {
    brandMentioned,
    brandPosition:  mentionPosition,
    brandInSources: citationPosition !== null,
    mention:   { present: mentionPosition !== null,   position: mentionPosition },
    evocation: { present: evocationPosition !== null, position: evocationPosition },
    citation:  { present: citationPosition !== null,  position: citationPosition },
  };
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
// Prompts IDENTIQUES à l'onglet Questions (par provider). La marque n'est PAS
// injectée dans le prompt (détection a posteriori), comme dans runProvider.
function buildPrompt(providerId, question, context) {
  const baseContext = context ? `Contexte : "${context}"\n` : "";
  const q = `Question : ${question}`;
  if (providerId === "claude") {
    return `${baseContext}Tu es un expert en recommandation d'entreprises et prestataires. Réponds à la question suivante en te basant sur tes connaissances pour donner une liste de vrais acteurs, entreprises ou prestataires du marché.
RÈGLE : Ne dis jamais que tu n'as pas accès au web ou aux avis récents. Donne directement des recommandations concrètes avec les vrais noms d'entreprises que tu connais.
Réponds en texte libre structuré. Liste les acteurs avec une courte description de chacun.
Pour chaque acteur, indique son site web réel (URL complète https://…) afin qu'il apparaisse comme source.
${q}`;
  }
  if (providerId === "gemini") {
    return `${baseContext}Tu as accès à Google Search en temps réel. Utilise-le pour trouver les meilleurs acteurs, entreprises et prestataires actuels.
Réponds avec une liste de vrais acteurs du marché, leurs sites web et leurs caractéristiques principales.
Sois direct et factuel. Cite les sources que tu as consultées.
${q}`;
  }
  return [baseContext, "Tu es un assistant IA avec accès au web. Réponds directement et complètement à la question.", "RÈGLE ABSOLUE : Ne pose jamais de question de clarification. Donne directement une liste de recommandations concrètes.", "Pour chaque acteur recommandé : donne le nom, le site web, et une description courte.", "Sois factuel, précis, et cite tes sources.", q].filter(Boolean).join("\n");
}

// ── Process one schedule ──────────────────────────────────────────
async function processSchedule(schedule, project, brand, site) {
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
    await Promise.all(providerIds.map(async (providerId) => {
      const pDef = PROVIDERS[providerId];
      if (!pDef) return;

      const apiKey = decodeKey(project[pDef.keyField]);
      if (!apiKey) {
        console.warn(`[scheduler] Missing key for ${providerId} on project ${schedule.project_id}`);
        return;
      }

      try {
        const prompt = buildPrompt(providerId, q.question, context);
        const { answer, sources: providerSources } = await callProvider(providerId, apiKey, prompt, site);
        const textSources = extractSources(answer);
        const sources = [...new Set([...(providerSources || []), ...textSources])];
// détection inline dans le record ci-dessous

        const now = new Date().toISOString();

        // ── Détection marque (3 types) ────────────────────────────
        const detected = detectBrand(answer, sources, brandName, brandAliases);
        const brandMentioned = detected.brandMentioned;

        // Type de présence pour le calendrier (mirror runProvider front)
        const presTypeForCal = detected.mention?.position != null ? "mention"
          : detected.brandInSources ? "citation"
          : brandMentioned ? "evocation"
          : null;

        // ── 1. Sauvegarder dans geo_results ───────────────────────
        const record = {
          question_id:              q.id,
          project_id:               schedule.project_id,
          site_id:                  schedule.site_id,
          model:                    `${PROVIDER_LABEL[providerId] || providerId} (${pDef.model}) [auto]`,
          answer,
          sources,
          source_types:             [],
          brand_mentioned:          brandMentioned,
          brand_in_sources:         detected.brandInSources,
          brand_position:           detected.brandPosition,
          brand_mention_position:   detected.mention?.position   || null,
          brand_evocation_position: detected.evocation?.position || null,
          brand_citation_position:  detected.citation?.position  || null,
          competitors_mentioned:    [],
          answer_type:              "list",
          intent_type:              "informational",
          created_at:               now,
        };

        // Dédoublonnage : supprimer un éventuel résultat auto du même jour
        // pour ce couple (question, provider) puis insérer le nouveau.
        const today = now.slice(0, 10);
        try {
          await fetch(
            `${SUPABASE_URL}/rest/v1/geo_results?question_id=eq.${encodeURIComponent(q.id)}&model=eq.${encodeURIComponent(record.model)}&created_at=gte.${today}T00:00:00&created_at=lte.${today}T23:59:59`,
            { method: "DELETE", headers: { ...sbWriteHeaders(), "Prefer": "return=minimal" } }
          );
        } catch {}

        // Insert avec fallback : si une colonne brand_*_position manque, retry sans
        try {
          await sbPost("geo_results", record);
        } catch(insErr) {
          if (/column|PGRST204|schema|400/i.test(insErr.message)) {
            const { brand_mention_position, brand_evocation_position, brand_citation_position, ...base } = record;
            await sbPost("geo_results", base);
          } else {
            throw insErr;
          }
        }

        // ── 2. Insérer dans geo_calendar_dates (même table que le front) ──
        // Schéma identique à sbAddCalendarEntry : brand_present + brand_mention/citation/evocation + test_date
        try {
          await sbPost("geo_calendar_dates", {
            question_id:     q.id,
            provider_id:     providerId,
            brand_present:   brandMentioned === true,
            brand_mention:   presTypeForCal === "mention"   ? 1 : 0,
            brand_citation:  presTypeForCal === "citation"  ? 1 : 0,
            brand_evocation: presTypeForCal === "evocation" ? 1 : 0,
            test_date:       today,
          });
        } catch(calErr) {
          console.warn(`[scheduler] calendar insert failed: ${calErr.message}`);
        }

        // ── 3. Mettre à jour le cache de la question (last_date, has_result) ──
        try {
          const cachePatch = { has_result: true, last_answer: answer, last_model: record.model, last_date: now };
          if (brandMentioned) Object.assign(cachePatch, { best_answer: answer, best_model: record.model, best_date: now });
          await sbPatch(`geo_questions?id=eq.${encodeURIComponent(q.id)}`, cachePatch);
        } catch {}

        savedCount++;
        console.log(`[scheduler] ✓ q=${q.id} provider=${providerId} brand=${brandMentioned} pres=${presTypeForCal}`);

      } catch(e) {
        console.error(`[scheduler] Error q=${q.id} provider=${providerId}:`, e.message);
      }
    }));
  }

  return savedCount;
}

// ── Main handler ──────────────────────────────────────────────────


// ── Email de notification de fin de run (via API Resend) ──────────
async function sendRunEmail(schedule, count, projectName) {
  const to = (schedule.owner_email || "").trim();
  if (!to) { console.warn("[scheduler] Pas d'owner_email — email ignoré"); return; }
  if (!RESEND_API_KEY) { console.warn("[scheduler] RESEND_API_KEY absente — email ignoré"); return; }

  const date = new Date().toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });
  const providers = (schedule.providers || []).join(", ") || "—";
  const subject = `[Dashboard GEO] Interrogation automatique effectuée — ${count} question${count > 1 ? "s" : ""} favorite${count > 1 ? "s" : ""}`;
  const text =
    `Bonjour,\n\n` +
    `L'interrogation automatique de vos questions favorites a eu lieu le ${date}.\n\n` +
    `• Projet : ${projectName || schedule.project_id}\n` +
    `• Questions favorites interrogées : ${count}\n` +
    `• Providers interrogés : ${providers}\n\n` +
    `Les résultats sont disponibles dans l'onglet Questions de votre dashboard GEO.\n\n` +
    `— Dashboard GEO par Sonate`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[scheduler] Email Resend échoué (${res.status}): ${detail.slice(0, 200)}`);
    } else {
      console.log(`[scheduler] Email envoyé à ${to} (${count} question(s))`);
    }
  } catch (e) {
    console.error("[scheduler] Email Resend exception:", e.message);
  }
}

// ── computeNextRun ────────────────────────────────────────────────
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

// ── Runner : traite les schedules dûs (ou forcés) ─────────────────
async function runScheduler({ forceRun = false, site = "", target = {} } = {}) {
  const SITE = site || process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || "";
  const start = Date.now();
  const now = new Date().toISOString();

  // Sélection des schedules.
  // Si une cible est fournie (test manuel sur le projet courant) → uniquement ce schedule.
  let filter;
  if (target && target.project_id) {
    filter = `geo_schedules?active=eq.true&project_id=eq.${encodeURIComponent(target.project_id)}`
      + (target.site_id ? `&site_id=eq.${encodeURIComponent(target.site_id)}` : "")
      + `&limit=5`;
  } else if (forceRun) {
    filter = `geo_schedules?active=eq.true&order=next_run.asc&limit=50`;
  } else {
    filter = `geo_schedules?active=eq.true&next_run=lte.${encodeURIComponent(now)}&order=next_run.asc&limit=50`;
  }

  const schedules = await sbGet(filter);
  console.log(`[geo-scheduler-bg] ${forceRun ? "FORCED" : "SCHEDULED"} — ${schedules.length} schedules`);
  if (!schedules.length) return { ok: true, processed: 0, duration: Date.now() - start };

  const projectIds = [...new Set(schedules.map(s => s.project_id))];
  const projectsRaw = await sbGet(`projects?id=in.(${projectIds.join(",")})&select=*`);
  const projectsMap = Object.fromEntries(projectsRaw.map(p => [p.id, p]));
  const brandsRaw = await sbGet(`site_brand?project_id=in.(${projectIds.join(",")})&select=*`);
  const brandsMap = Object.fromEntries(brandsRaw.map(b => [`${b.project_id}__${b.site_id}`, b]));

  const results = [];
  for (const schedule of schedules) {
    const project = projectsMap[schedule.project_id];
    if (!project) { console.warn(`[scheduler] Project not found: ${schedule.project_id}`); continue; }
    const brand = brandsMap[`${schedule.project_id}__${schedule.site_id}`] || null;

    let count = 0;
    try {
      count = await processSchedule(schedule, project, brand, SITE);
    } catch(e) {
      console.error(`[scheduler] Schedule ${schedule.id} failed:`, e.message);
    }
    const nextRun = computeNextRun(schedule.frequency);
    await sbPatch(`geo_schedules?id=eq.${schedule.id}`, { next_run: nextRun, last_run: now, last_run_count: count });
    await sendRunEmail(schedule, count, project?.name);
    results.push({ schedule_id: schedule.id, questions_processed: count, next_run: nextRun });
  }

  const duration = Date.now() - start;
  console.log(`[geo-scheduler-bg] Done in ${duration}ms — ${results.length} schedules`);
  return { ok: true, processed: results.length, results, duration };
}

// ── Handler Background Function (Netlify) ─────────────────────────
// Suffixe -background → timeout 15 min, retourne 202 immédiatement.
export default async (req) => {
  let forceRun = false;
  let origin = "";
  let target = { project_id: null, site_id: null };
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      forceRun = body?.force !== false; // POST manuel = forcé par défaut
      origin = body?.origin || "";
      if (body?.project_id) target = { project_id: body.project_id, site_id: body.site_id || null };
    }
  } catch {}

  // Le travail s'exécute ; Netlify maintient la fonction vivante jusqu'à 15 min.
  try {
    const out = await runScheduler({ forceRun, site: origin, target });
    console.log("[geo-scheduler-bg] result:", JSON.stringify(out).slice(0, 300));
  } catch(e) {
    console.error("[geo-scheduler-bg] fatal:", e.message);
  }
  // Les background functions renvoient 202 automatiquement ; ce return est ignoré.
  return new Response(null, { status: 202 });
};
