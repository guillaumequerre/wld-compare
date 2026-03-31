import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { C } from "../lib/constants";
import PresenceCalendar from "../components/PresenceCalendar";
import { sbSaveProviderKeys } from "../lib/supabase";
import {
  sbSaveBrand, sbGetBrand,
  sbSaveKeywords, sbGetKeywords, sbUpdateKeywordStatus, sbDeleteKeyword,
  sbSaveQuestions, sbGetQuestions, sbUpdateQuestion, sbDeleteQuestion,
  sbSaveGeoResult, sbGetGeoResults,
  sbGetCategories, sbSaveCategory, sbDeleteCategory,
  sbSetKeywordCategory, sbSetQuestionCategory,
  sbBulkSetKeywordCategory, sbBulkSetQuestionCategory,
  sbGetUrlIndex, sbUpdateUrlMeta, sbIncrementUrlCounts,
  sbAddCalendarEntry,
} from "../lib/supabase";
// Note: sbSaveGeoAxes is called via onSaveAxes prop from App.jsx



const DEFAULT_AXES = [
  "Meilleur / top / recommandé",
  "Pistes et approches pour utiliser / bénéficier du mot-clé",
  "Avis / fiable / fiabilité",
  "Pour atteindre un objectif lié au mot-clé",
  "Pour résoudre une problématique liée au mot-clé",
];

// ── API Key helpers — base64 obfuscation (Supabase already protected by auth) ──
// Fallback: if stored value looks like an AES blob (not a valid sk- key after decode),
// the user must re-enter the key once to migrate to the new format.
function encodeKey(k) {
  try { return btoa(unescape(encodeURIComponent(k))); } catch { return k; }
}
function decodeKey(enc) {
  if (!enc) return "";
  try {
    const k = decodeURIComponent(escape(atob(enc)));
    return k; // may or may not start with sk- — UI will validate
  } catch {
    return ""; // AES blob or corrupted — user must re-enter
  }
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
}

function parseCSV(text) {
  return text.split(/\r?\n/).map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, ""))).filter(r => r[0]);
}

// ── OpenAI call helpers ───────────────────────────────────────────


export const PROVIDERS = [
  {
    id: "openai",
    label: "OpenAI",
    icon: "🟢",
    model: "gpt-4o-mini",
    keyField: "openai_key_enc",
    keyPrefix: "sk-",
    keyPlaceholder: "sk-…",
    proxyPath: "/api/openai",
    color: "#059669",
  },
  {
    id: "gemini",
    label: "Gemini",
    icon: "🔵",
    model: "gemini-2.0-flash",   // supports Google Search grounding (real-time web)
    keyField: "gemini_key_enc",
    keyPrefix: "AIza",
    keyPlaceholder: "AIzaSy…",
    proxyPath: "/api/gemini",
    color: "#2563EB",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    icon: "🟣",
    model: "sonar",              // real-time web search + citations
    keyField: "perplexity_key_enc",
    keyPrefix: "pplx-",
    keyPlaceholder: "pplx-…",
    proxyPath: "/api/perplexity",
    color: "#7C3AED",
  },
  {
    id: "claude",
    label: "Claude",
    icon: "🟠",
    model: "claude-haiku-4-5-20251001", // knowledge-based (no web access)
    keyField: "claude_geo_key_enc",
    keyPrefix: "sk-ant-",
    keyPlaceholder: "sk-ant-…",
    proxyPath: "/api/claude-geo",
    color: "#D97706",
  },
];


function getProviderId(model) {
  const m = (model || "").toLowerCase();
  if (m.includes("openai") || m.includes("gpt")) return "openai";
  if (m.includes("gemini")) return "gemini";
  if (m.includes("perplexity") || m.includes("sonar")) return "perplexity";
  if (m.includes("claude")) return "claude";
  return "other";
}

async function callProvider(provider, apiKey, prompt) {
  if (provider.id === "openai") {
    const res = await fetch("/api/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Openai-Key": apiKey, "X-Openai-Endpoint": "responses" },
      body: JSON.stringify({
        model: provider.model,
        input: prompt,
        tools: [{ type: "web_search_preview", search_context_size: "high" }],
        max_output_tokens: 8000,
        // No JSON schema — free text response so web search annotations contain real URLs
      }),
    });
    const raw = await res.text();
    if (raw.trimStart().startsWith("<")) throw new Error("Proxy /api/openai introuvable");
    const data = JSON.parse(raw);
    if (!res.ok) throw new Error(data.error?.message || `OpenAI ${res.status}`);
    return parseOpenAIResponse(data, "responses");
  }

  if (provider.id === "gemini") {
    const res = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gemini-Key": apiKey },
      body: JSON.stringify({ model: provider.model, prompt }),
    });
    const raw = await res.text();
    if (raw.trimStart().startsWith("<")) throw new Error("Proxy /api/gemini introuvable");
    const data = JSON.parse(raw);
    if (!res.ok) throw new Error(data.error || `Gemini ${res.status}`);
    const text = data.choices?.[0]?.message?.content || "";
    const groundingSources = data._sources || []; // real URLs from Google Search
    return parseTextResponse(text, data.usage?.prompt_tokens || 0, data.usage?.completion_tokens || 0, groundingSources);
  }

  if (provider.id === "perplexity") {
    const res = await fetch("/api/perplexity", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Perplexity-Key": apiKey },
      body: JSON.stringify({ model: provider.model, prompt }),
    });
    const raw = await res.text();
    if (raw.trimStart().startsWith("<")) throw new Error("Proxy /api/perplexity introuvable");
    const data = JSON.parse(raw);
    if (!res.ok) throw new Error(data.error?.message || `Perplexity ${res.status}`);
    const text = data.choices?.[0]?.message?.content || "";
    // Perplexity returns citations separately
    const citations = data._citations || [];
    return parseTextResponse(text, data.usage?.prompt_tokens || 0, data.usage?.completion_tokens || 0, citations);
  }

  if (provider.id === "claude") {
    const res = await fetch("/api/claude-geo", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Claude-Key": apiKey },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const raw = await res.text();
    if (raw.trimStart().startsWith("<")) throw new Error("Proxy /api/claude-geo introuvable — ajoutez claude-geo-proxy.js dans netlify/edge-functions/");
    const data = JSON.parse(raw);
    if (!res.ok) throw new Error(data.error?.message || `Claude ${res.status}`);
    const text = data.content?.[0]?.text || "";
    return parseTextResponse(text, data.usage?.input_tokens || 0, data.usage?.output_tokens || 0);
  }

  throw new Error(`Provider inconnu: ${provider.id}`);
}


// Parse free-text response (Gemini, Perplexity, Claude) into the standard shape
function parseTextResponse(text, inTok, outTok, extraSources = []) {
  // Try to extract JSON if model returned it
  const s = text.lastIndexOf("{"); const e = text.lastIndexOf("}");
  if (s !== -1 && e > s) {
    try {
      const parsed = JSON.parse(text.substring(s, e + 1));
      if (parsed.answer) {
        parsed._input_tokens = inTok; parsed._output_tokens = outTok;
        parsed.sources = [...(parsed.sources || []), ...extraSources].filter(Boolean);
        return parsed;
      }
    } catch {}
  }
  // Fallback: treat entire text as answer, extract URLs
  const HALLUCINATION = [/exemple\d*\./i, /example\d*\./i, /site\d+\./i, /domaine\d*\./i, /placeholder/i];
  const urlRe = /https?:\/\/[^\s\])"'>]+/g;
  const foundUrls = [...text.matchAll(urlRe)].map(m => m[0]).filter(u => !HALLUCINATION.some(p => p.test(u)));
  const allSources = [...new Set([...foundUrls, ...extraSources])];
  return {
    answer: text, answer_type: "Texte libre", intent_type: "Informative",
    sources: allSources, source_types: [],
    _input_tokens: inTok, _output_tokens: outTok,
  };
}

function extractOpenAIUrls(data) {
  // Extract real URLs from annotations (url_citation type) in Responses API
  const urls = [];
  const seen = new Set();
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) {
      // annotations array contains url_citation objects
      for (const ann of part.annotations || []) {
        if (ann.type === "url_citation" && ann.url && !seen.has(ann.url)) {
          seen.add(ann.url);
          urls.push(ann.url);
        }
      }
    }
  }
  return urls;
}

function parseOpenAIResponse(data, endpoint = "responses") {
  const usage = data.usage || {};
  const inTok = usage.input_tokens || usage.prompt_tokens || 0;
  const outTok = usage.output_tokens || usage.completion_tokens || 0;

  let rawText = "";
  if (endpoint === "responses") {
    for (const item of data.output || []) {
      if (item.type !== "message") continue;
      for (const part of item.content || []) {
        if (part.type === "output_text") rawText += part.text;
      }
    }
  } else {
    rawText = data.choices?.[0]?.message?.content || "";
  }

  // Extract real URLs from annotations FIRST (before parsing JSON)
  const realUrls = extractOpenAIUrls(data);

  // Also extract URLs directly from the answer text (markdown links + plain URLs)
  const urlRe = /https?:\/\/[^\s\])"'>]+/g;
  const HALLUCINATION = [/exemple\d*\./i, /example\d*\./i, /site\d+\./i, /domaine\d*\./i, /placeholder/i, /turn\d+search/i];
  const textUrls = [...rawText.matchAll(urlRe)]
    .map(m => m[0].replace(/[.,;:)]+$/, "")) // strip trailing punctuation
    .filter(u => !HALLUCINATION.some(p => p.test(u)));

  // Merge: annotations first (most reliable), then text URLs
  const allUrls = [...new Set([...realUrls, ...textUrls])];

  // Try to parse JSON schema response
  let parsed = { answer: rawText, answer_type: "Texte libre", intent_type: "Informative", sources: [], source_types: [] };
  const s = rawText.lastIndexOf("{");
  const e = rawText.lastIndexOf("}");
  if (s !== -1 && e > s) {
    try {
      const jsonParsed = JSON.parse(rawText.substring(s, e + 1));
      if (jsonParsed.answer) {
        parsed = jsonParsed;
        // Replace turn0searchX sources with real URLs
        const fakeSources = (parsed.sources || []).filter(u => /turn\d+search/i.test(u) || !u.startsWith("http"));
        if (fakeSources.length > 0 || allUrls.length > 0) {
          parsed.sources = allUrls;
        }
      }
    } catch {}
  }

  // If answer is still the raw JSON text, extract readable answer
  if (parsed.answer && parsed.answer.startsWith("{")) {
    parsed.answer = rawText; // use raw text as answer
  }

  // Final URL dedup and hallucination filter
  parsed.sources = [...new Set(allUrls)].filter(u => !HALLUCINATION.some(p => p.test(u)));
  parsed._input_tokens = inTok;
  parsed._output_tokens = outTok;
  return parsed;
}

// ── Brand detection ───────────────────────────────────────────────

function detectBrand(answer, sources, brandName, brandAliases = [], competitors = []) {
  const allBrandTerms = [brandName, ...brandAliases].filter(Boolean).map(t => t.toLowerCase().trim());
  const allCompetitors = competitors.filter(Boolean).map(t => t.toLowerCase().trim());

  const answerLower = (answer || "").toLowerCase();

  // Also extract URLs directly from answer text (covers sources listed at bottom of response)
  const urlRe = /https?:\/\/[^\s\])"'>]+/g;
  const answerUrls = [...(answer || "").matchAll(urlRe)].map(m => m[0].toLowerCase());
  // Merge sources array with URLs found in text
  const allSources = [...new Set([...(sources || []).map(s => s.toLowerCase()), ...answerUrls])];

  // Find brand position in numbered/bulleted list
  const lines = (answer || "").split("\n").map(l => l.trim()).filter(Boolean);
  let brandPosition = null;
  let pos = 0;
  for (const line of lines) {
    const isListItem = /^(\d+[.)]|[-•*]|\*\*)/.test(line);
    if (isListItem) {
      pos++;
      if (allBrandTerms.some(t => line.toLowerCase().includes(t))) {
        brandPosition = pos;
        break;
      }
    }
  }

  const brandMentioned = allBrandTerms.some(t => answerLower.includes(t));
  // Check sources: both the sources array AND URLs found in answer text
  const brandInSources = allBrandTerms.some(t => allSources.some(s => s.includes(t)));

  const competitorsMentioned = allCompetitors
    .map(name => {
      let cpos = null; let cp = 0;
      for (const line of lines) {
        if (/^(\d+[.)]|[-•*]|\*\*)/.test(line)) {
          cp++;
          if (line.toLowerCase().includes(name)) { cpos = cp; break; }
        }
      }
      return {
        name,
        mentioned: answerLower.includes(name),
        position: cpos,
        in_sources: allSources.some(s => s.includes(name)),
      };
    })
    .filter(c => c.mentioned);

  return { brandMentioned, brandPosition, brandInSources, competitorsMentioned };
}

// Highlight brand terms in text
function highlightBrand(text, brandName, brandAliases = []) {
  const terms = [brandName, ...brandAliases].filter(Boolean);
  if (!terms.length) return text;
  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(re);
  return parts.map((part, i) =>
    re.test(part)
      ? <mark key={i} style={{ background: "#FEF08A", color: "#92400E", borderRadius: 2, padding: "0 2px" }}>{part}</mark>
      : part
  );
}

// ── Small UI helpers ──────────────────────────────────────────────

function Pill({ children, color = C.blue, bg, onClick, active }) {
  return (
    <span onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: active ? color : (bg || C.bg),
      color: active ? "#fff" : color,
      border: `1px solid ${color}44`,
      cursor: onClick ? "pointer" : "default",
      transition: "all 0.15s",
    }}>{children}</span>
  );
}

function Btn({ children, onClick, disabled, color = C.blue, variant = "solid", small }) {
  const base = {
    padding: small ? "4px 10px" : "7px 16px",
    borderRadius: 8, fontSize: small ? 11 : 12, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "all 0.15s", border: "none",
  };
  const styles = variant === "outline"
    ? { ...base, background: "transparent", border: `1px solid ${color}`, color }
    : { ...base, background: color, color: "#fff" };
  return <button onClick={onClick} disabled={disabled} style={styles}>{children}</button>;
}

function StatusBadge({ status }) {
  const map = {
    pending:       { label: "En attente",    color: C.textLight, bg: C.bg },
    generating_q:  { label: "⏳ Génération…",  color: "#D97706", bg: "#FFFBEB" },
    done_q:        { label: "✓ Généré",         color: "#059669", bg: "#ECFDF5" },
    generating_r:  { label: "Appel LLM…",   color: "#7C3AED", bg: "#F5F3FF" },
    done:          { label: "Terminé",       color: "#2563EB", bg: "#EFF6FF" },
    error:         { label: "⚠ Erreur",      color: "#DC2626", bg: "#FEF2F2" },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, border: `1px solid ${s.color}33`, borderRadius: 5, padding: "2px 7px" }}>
      {s.label}
    </span>
  );
}

// ── Stats header ──────────────────────────────────────────────────

function StatsHeader({ questions, results, brandName }) {
  const total       = results.length;
  const withBrand   = results.filter(r => r.brand_mentioned === true || r.brand_mentioned === 1).length;
  const withSources = results.filter(r => r.brand_in_sources).length;
  const positions   = results.filter(r => r.brand_position).map(r => r.brand_position);
  const avgPos      = positions.length ? (positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(1) : "—";
  const presence    = total ? Math.round(withBrand / total * 100) : 0;

  // Top competitors
  const compCount = {};
  results.forEach(r => (r.competitors_mentioned || []).forEach(c => {
    compCount[c.name] = (compCount[c.name] || 0) + 1;
  }));
  const topComps = Object.entries(compCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Top domains
  const domainCount = {};
  results.forEach(r => (r.sources || []).forEach(url => {
    try { const d = new URL(url).hostname.replace("www.", ""); domainCount[d] = (domainCount[d] || 0) + 1; } catch {}
  }));
  const topDomains = Object.entries(domainCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (!total) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
      {/* Présence */}
      <div style={{ background: presence >= 50 ? "#ECFDF5" : presence > 0 ? "#FFFBEB" : "#FEF2F2", border: `1px solid ${presence >= 50 ? "#059669" : presence > 0 ? "#D97706" : "#DC2626"}33`, borderRadius: 12, padding: "14px 18px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>Présence {brandName}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: presence >= 50 ? "#059669" : presence > 0 ? "#D97706" : "#DC2626" }}>{presence}%</div>
        <div style={{ fontSize: 11, color: C.textLight }}>{withBrand} / {total} questions</div>
      </div>

      {/* Position moy. */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>Position moy.</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: C.text }}>{avgPos}</div>
        <div style={{ fontSize: 11, color: C.textLight }}>dans les fan-outs</div>
      </div>

      {/* Dans les sources */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>Dans les sources</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#2563EB" }}>{withSources}</div>
        <div style={{ fontSize: 11, color: C.textLight }}>questions citées</div>
      </div>

      {/* Top concurrents */}
      {topComps.length > 0 && (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>Top concurrents cités</div>
          {topComps.map(([name, cnt]) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
              <span style={{ color: C.text, fontWeight: 500 }}>{name}</span>
              <span style={{ color: C.textLight }}>{cnt}×</span>
            </div>
          ))}
        </div>
      )}

      {/* Top domaines */}
      {topDomains.length > 0 && (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>Sites les plus cités</div>
          {topDomains.map(([domain, cnt]) => (
            <div key={domain} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
              <span style={{ color: "#2563EB", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{domain}</span>
              <span style={{ color: C.textLight, flexShrink: 0 }}>{cnt}×</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Category Manager ─────────────────────────────────────────────

const CAT_COLORS = ["#2563EB","#059669","#7C3AED","#D97706","#DC2626","#0891B2","#EA580C","#64748B"];

function CategoryManager({ projectId, categories, setCategories, compact }) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(CAT_COLORS[0]);
  const [adding, setAdding] = useState(false);

  const add = async () => {
    if (!newName.trim()) return;
    try {
      const cat = await sbSaveCategory({ project_id: projectId, name: newName.trim(), color: newColor });
      setCategories(prev => [...prev, cat]);
      setNewName(""); setAdding(false);
    } catch(e) { console.error(e); }
  };

  const del = async (id) => {
    await sbDeleteCategory(id);
    setCategories(prev => prev.filter(c => c.id !== id));
  };

  if (compact) return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {categories.map(c => (
        <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: c.color + "18", color: c.color, border: `1px solid ${c.color}44` }}>
          {c.name}
          <button onClick={() => del(c.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: c.color, padding: 0, lineHeight: 1 }}>×</button>
        </span>
      ))}
      {adding ? (
        <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          {CAT_COLORS.map(col => (
            <button key={col} onClick={() => setNewColor(col)} style={{ width: 14, height: 14, borderRadius: "50%", background: col, border: `2px solid ${newColor === col ? "#000" : "transparent"}`, cursor: "pointer" }} />
          ))}
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="Nom…" style={{ padding: "2px 6px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, width: 100 }} />
          <button onClick={add} style={{ padding: "2px 7px", borderRadius: 6, background: newColor, color: "#fff", border: "none", fontSize: 11, cursor: "pointer" }}>OK</button>
          <button onClick={() => setAdding(false)} style={{ padding: "2px 6px", borderRadius: 6, background: C.bg, border: `1px solid ${C.border}`, fontSize: 11, cursor: "pointer" }}>✕</button>
        </span>
      ) : (
        <button onClick={() => setAdding(true)} style={{ padding: "2px 8px", borderRadius: 12, fontSize: 11, background: C.bg, border: `1px dashed ${C.border}`, color: C.textLight, cursor: "pointer" }}>+ Catégorie</button>
      )}
    </div>
  );

  return null;
}

// ── Category selector dropdown ────────────────────────────────────

function CatSelect({ value, categories, onChange, placeholder = "Catégorie…" }) {
  return (
    <select value={value || ""} onChange={e => onChange(e.target.value || null)}
      style={{ padding: "4px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, color: C.text, background: C.white, cursor: "pointer" }}>
      <option value="">{placeholder}</option>
      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

// ── Keywords sub-tab (v2) ─────────────────────────────────────────

function KeywordsTab({ site, projectId, apiKey, model, axes, context, categories, setCategories, onQuestionsGenerated }) {
  const [keywords, setKeywords] = useState([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [busy, setBusy]         = useState({});
  const [runningAll, setRunningAll] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkCat, setBulkCat]   = useState("");
  const [filterCat, setFilterCat] = useState("");
  const stopRef = useRef(false);

  useEffect(() => {
    if (!projectId || !site?.id) return;
    // Load keywords + count questions per keyword
    Promise.all([
      sbGetKeywords(projectId, site.id),
      sbGetQuestions(projectId, site.id),
    ]).then(([kws, qs]) => {
      const countByKw = {};
      qs.forEach(q => { if (q.keyword_id) countByKw[q.keyword_id] = (countByKw[q.keyword_id] || 0) + 1; });
      setKeywords(kws.map(k => ({ ...k, question_count: countByKw[k.id] || 0 })));
    });
  }, [projectId, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addKeywords = async () => {
    const lines = input.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setLoading(true);
    try {
      const rows = lines.map(keyword => ({ project_id: projectId, site_id: site.id, keyword, status: "pending" }));
      const saved = await sbSaveKeywords(rows);
      setKeywords(prev => [...prev, ...saved]);
      setInput("");
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  // Import CSV: col1=keyword, col2=category name
  const importCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const rows = parseCSV(ev.target.result).filter(r => r[0]);
      const toAdd = [];
      for (const [keyword, catName] of rows) {
        const cat = catName ? categories.find(c => c.name.toLowerCase() === catName.toLowerCase()) : null;
        toAdd.push({ project_id: projectId, site_id: site.id, keyword, status: "pending", ...(cat ? { category_id: cat.id } : {}) });
      }
      if (!toAdd.length) return;
      const saved = await sbSaveKeywords(toAdd);
      setKeywords(prev => [...prev, ...saved]);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const generateQuestions = async (kw, axes) => {
    if (!apiKey) return;
    setBusy(b => ({ ...b, [kw.id]: "q" }));
    await sbUpdateKeywordStatus(kw.id, "generating_q");
    setKeywords(prev => prev.map(k => k.id === kw.id ? { ...k, status: "generating_q" } : k));
    try {
      const numQ = (axes && axes.length ? axes : DEFAULT_AXES).length;
      const axesWithInstructions = (axes && axes.length ? axes : DEFAULT_AXES).map((axe, i) => `${i+1}. [${axe}] → formule une question dont la réponse cite des entreprises, acteurs ou prestataires liés à "${kw.keyword}"`).join("\n");
      const prompt = `Tu es un expert GEO. Ton rôle : générer des questions qui amènent ChatGPT ou Google SGE à répondre avec des NOMS D'ENTREPRISES, D'ACTEURS ou DE PRESTATAIRES — jamais des réponses génériques.

Mot-clé : "${kw.keyword}"

RÈGLE ABSOLUE : chaque question doit être formulée pour que la réponse naturelle soit du type :
"Voici les meilleurs [acteurs] pour [mot-clé]..." / "Je vous recommande [entreprise]..." / "Les [acteurs] à considérer sont..."

IMPORTANT sur le sens des axes :
- "Alternative / pistes" = des façons d'utiliser ou des acteurs qui proposent le mot-clé — PAS des substituts au mot-clé
- Exemple ✅ pour "agence SEO" : "Quelles agences SEO sont recommandées pour une startup ?"
- Exemple ❌ pour "agence SEO" : "Quelles alternatives à une agence SEO existent ?"

Génère exactement ${numQ} questions, une par axe :
${axesWithInstructions}

Contraintes :
- Privilégier "qui", "quels", "quelle", "lesquels", "quel acteur", "quelle entreprise"
- Maximum 15 mots
- Ton décideur / professionnel qui cherche un prestataire ou une recommandation concrète

Réponds UNIQUEMENT avec les ${numQ} questions séparées par des points-virgules (;), sans numérotation, sans texte avant ou après.`;

      // Direct fetch — plain text, no json_object format
      const res = await fetch("/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Openai-Key": apiKey, "X-Openai-Endpoint": "completions" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 400 }),
      });
      const text = await res.text();
      if (text.trimStart().startsWith("<")) throw new Error("Proxy /api/openai introuvable — copiez openai-proxy.js dans netlify/edge-functions/");
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Réponse non-JSON (${res.status}): ${text.slice(0,100)}`); }
      if (!res.ok) {
        const msg = data?.error?.message || data?.error || text.slice(0, 200);
        throw new Error(`OpenAI ${res.status}: ${msg}`);
      }

      const raw = (data?.choices?.[0]?.message?.content || "").trim();
      if (!raw) throw new Error(`Réponse vide. Data reçue: ${JSON.stringify(data).slice(0, 200)}`);

      const questions = raw
        .split(/[;\n]/)
        .map(s => s.replace(/^\s*\d+[.)\s]+/, "").trim())
        .filter(s => s.length > 5 && s.length < 250);

      if (!questions.length) throw new Error(`Parsing échoué. Reçu: "${raw.slice(0, 100)}"`);

      // Save — strip category_id if column not migrated yet
      const baseRow = (q) => ({ project_id: projectId, site_id: site.id, keyword_id: kw.id, question: q, is_manual: false });
      let saved;
      try {
        const qRows = questions.map(q => kw.category_id ? { ...baseRow(q), category_id: kw.category_id } : baseRow(q));
        saved = await sbSaveQuestions(qRows);
      } catch(saveErr) {
        console.warn("Retry without category_id:", saveErr.message);
        saved = await sbSaveQuestions(questions.map(baseRow));
      }
      const savedCount = Array.isArray(saved) ? saved.length : questions.length;
      console.log(`✓ ${savedCount} questions saved for "${kw.keyword}"`);

      await sbUpdateKeywordStatus(kw.id, "done_q");
      setKeywords(prev => prev.map(k => k.id === kw.id
        ? { ...k, status: "done_q", question_count: (k.question_count || 0) + savedCount }
        : k
      ));
      onQuestionsGenerated?.();
    } catch(e) {
      console.error("generateQuestions error:", e);
      await sbUpdateKeywordStatus(kw.id, "error");
      setKeywords(prev => prev.map(k => k.id === kw.id ? { ...k, status: "error", error_msg: e.message } : k));
    }
    setBusy(b => ({ ...b, [kw.id]: false }));
  };

  const deleteKw = async (id) => {
    await sbDeleteKeyword(id);
    setKeywords(prev => prev.filter(k => k.id !== id));
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const generateAll = async () => {
    if (!apiKey) { setKeywords(prev => prev); return; } // apiKey missing shown in UI
    const toProcess = keywords.filter(kw => kw.status === "pending" || kw.status === "error");
    if (!toProcess.length) return;
    setRunningAll(true);
    stopRef.current = false;
    for (const kw of toProcess) {
      if (stopRef.current) break;
      await generateQuestions(kw, null);
    }
    setRunningAll(false);
    onQuestionsGenerated?.();
  };

  const toggleSelect = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelected(new Set(filtered.map(k => k.id)));
  const clearSel = () => setSelected(new Set());

  const applyBulkCat = async () => {
    if (!bulkCat || !selected.size) return;
    const ids = [...selected];
    await sbBulkSetKeywordCategory(ids, bulkCat || null);
    setKeywords(prev => prev.map(k => selected.has(k.id) ? { ...k, category_id: bulkCat || null } : k));
    clearSel(); setBulkCat("");
  };

  const setCatSingle = async (kwId, catId) => {
    await sbSetKeywordCategory(kwId, catId || null);
    setKeywords(prev => prev.map(k => k.id === kwId ? { ...k, category_id: catId || null } : k));
  };

  const filtered = useMemo(() => filterCat ? keywords.filter(k => k.category_id === filterCat) : keywords, [keywords, filterCat]);

  return (
    <div>
      {/* Input + CSV import */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, marginBottom: 6 }}>Ajouter des mots-clés (un par ligne)</div>
            <textarea value={input} onChange={e => setInput(e.target.value)}
              placeholder={"meilleur logiciel CRM\nalternative Salesforce\ncomparer CRM PME"}
              style={{ width: "100%", minHeight: 90, padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <Btn onClick={addKeywords} disabled={loading || !input.trim()}>{loading ? "Ajout…" : "➕ Ajouter"}</Btn>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 22 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, fontWeight: 600, color: C.textMid, cursor: "pointer", background: C.white }}>
              📥 Importer CSV
              <input type="file" accept=".csv,.txt" onChange={importCSV} style={{ display: "none" }} />
            </label>
            <div style={{ fontSize: 10, color: C.textLight }}>Col. 1 = mot-clé<br />Col. 2 = catégorie (optionnel)</div>
          </div>
        </div>
      </div>

      {/* Categories */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, marginBottom: 8 }}>Catégories du projet</div>
        <CategoryManager projectId={projectId} categories={categories} setCategories={setCategories} compact />
      </div>

      {/* Bulk bar + filters */}
      {keywords.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: C.textLight }}>
            {filtered.length} mot{filtered.length > 1 ? "s-clés" : "-clé"}
            {" · "}<span style={{ color: "#059669", fontWeight: 600 }}>{filtered.filter(k => k.status === "done_q" || k.status === "done").length} générés</span>
            {" · "}{filtered.reduce((s, k) => s + (k.question_count || 0), 0)} question{filtered.reduce((s, k) => s + (k.question_count || 0), 0) > 1 ? "s" : ""}
            {selected.size > 0 && <strong style={{ color: C.text }}> · {selected.size} sélectionné{selected.size > 1 ? "s" : ""}</strong>}
          </span>

          {/* Filter by category */}
          <CatSelect value={filterCat} categories={[{ id: "", name: "Toutes catégories" }, ...categories]} onChange={v => setFilterCat(v || "")} placeholder="Toutes catégories" />

          {/* Bulk select */}
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={selectAll} style={{ fontSize: 11, padding: "3px 8px", border: `1px solid ${C.border}`, borderRadius: 5, background: C.white, cursor: "pointer", color: C.textMid }}>Tout sélect.</button>
            {selected.size > 0 && <button onClick={clearSel} style={{ fontSize: 11, padding: "3px 8px", border: `1px solid ${C.border}`, borderRadius: 5, background: C.white, cursor: "pointer", color: C.textMid }}>Désélect.</button>}
          </div>

          {/* Bulk categorize */}
          {selected.size > 0 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <CatSelect value={bulkCat} categories={categories} onChange={setBulkCat} placeholder="Appliquer catégorie…" />
              <Btn onClick={applyBulkCat} disabled={!bulkCat} small color="#7C3AED">Appliquer</Btn>
            </div>
          )}

          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {runningAll && <Btn onClick={() => { stopRef.current = true; setRunningAll(false); }} color="#DC2626" variant="outline" small>⏹ Arrêter</Btn>}
            <Btn onClick={generateAll} disabled={runningAll || !apiKey} color={site.color} small>
              {runningAll ? "⏳ Génération en cours…" : "💬 Générer toutes les questions"}
            </Btn>
          </div>
        </div>
      )}

      {/* Keywords list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: C.textLight, fontSize: 12 }}>
          {keywords.length === 0 ? "Aucun mot-clé — ajoutez-en ci-dessus ou importez un CSV" : "Aucun mot-clé dans cette catégorie"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map(kw => {
            const cat = categories.find(c => c.id === kw.category_id);
            const isSel = selected.has(kw.id);
            return (
              <div key={kw.id} style={{ background: isSel ? "#EFF6FF" : C.white, border: `1px solid ${kw.status === "done_q" ? "#05966933" : isSel ? "#2563EB55" : C.border}`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, borderLeft: `3px solid ${kw.status === "done_q" ? "#059669" : kw.status === "generating_q" ? "#D97706" : "transparent"}` }}>
                <input type="checkbox" checked={isSel} onChange={() => toggleSelect(kw.id)} style={{ cursor: "pointer", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{kw.keyword}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 3, alignItems: "center", flexWrap: "wrap" }}>
                    <StatusBadge status={kw.status} />
                    {kw.error_msg && (
                      <span style={{ fontSize: 10, color: "#DC2626", fontStyle: "italic", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={kw.error_msg}>
                        {kw.error_msg}
                      </span>
                    )}
                    {kw.question_count > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid #059669", borderRadius: 10, padding: "1px 8px" }}>
                        {kw.question_count} question{kw.question_count > 1 ? "s" : ""}
                      </span>
                    )}
                    {cat && <span style={{ fontSize: 10, fontWeight: 700, color: cat.color, background: cat.color + "18", border: `1px solid ${cat.color}44`, borderRadius: 10, padding: "1px 7px" }}>{cat.name}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                  <CatSelect value={kw.category_id} categories={categories} onChange={v => setCatSingle(kw.id, v)} />
                  <Btn onClick={() => generateQuestions(kw, null)} disabled={!!busy[kw.id] || !apiKey} variant="outline" small color={site.color}>
                    {busy[kw.id] === "q" ? "⏳" : kw.status === "done_q" ? "🔄" : "💬"}
                  </Btn>
                  <button onClick={() => deleteKw(kw.id)} style={{ padding: "3px 7px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.textLight, fontSize: 10, cursor: "pointer" }}>🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 30-day presence calendar ─────────────────────────────────────


function isBrandPresent(r) {
  return !!r && (r.brand_mentioned === true || r.brand_mentioned === 1);
}

// history: [{ test_date: "YYYY-MM-DD", brand_mentioned: bool }]
// results: current geo_results for this provider (for today's optimistic update)

// ── HintPanel — GEO optimisation hints ───────────────────────────

function HintPanel({ question, sources, brandName, brandAliases, brandDomain: brandDomainProp = "", claudeKey }) {
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [hint, setHint]     = useState("");

  // Use explicit brand domain first, then try aliases, then brand name
  const brandDomain = brandDomainProp ||
    [...(brandAliases || [])].map(a => (a || "").trim()).find(a => a.includes(".")) ||
    brandName;

  const run = async () => {
    if (!claudeKey) return;
    setStatus("loading");
    setHint("");
    const searchQuery = `${question} site:${brandDomain}`;
    const sourcesText = (sources || []).length > 0
      ? `Pages mentionnées dans la réponse :\n${sources.slice(0, 8).map((u, i) => `[${i+1}] ${u}`).join("\n")}`
      : "Aucune source listée dans la réponse.";

    const prompt = `Tu es un expert en GEO (Generative Engine Optimization).

Un moteur d'IA a répondu à cette question sans mentionner la marque "${brandName}" :
"${question}"

${sourcesText}

Effectue maintenant une recherche Google avec cette requête exacte : "${searchQuery}"

En te basant sur :
1. Les pages de ${brandDomain} qui ressortent sur cette recherche
2. Les pages concurrentes citées dans la réponse du moteur d'IA

RÈGLES STRICTES :
- Ne dis JAMAIS "Je vais effectuer", "Je recherche", "En effectuant cette recherche" ou toute phrase de transition
- Ne décris pas ce que tu fais, donne directement le résultat
- Commence directement par la recommandation (ex: "La page X est candidate…" ou "Créez une page dédiée…")
- 5 à 8 lignes max, ton direct et actionnable

Si une page de ${brandDomain} ressort pertinente → explique comment l'optimiser pour être citée par les IA
Si aucune page pertinente de ${brandDomain} → recommande quel contenu créer et pourquoi`;

    try {
      const res = await fetch("/api/claude-geo", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Claude-Key": claudeKey },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 600,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const raw = await res.text();
      if (raw.trimStart().startsWith("<")) throw new Error("Proxy claude-geo introuvable");
      const data = JSON.parse(raw);
      if (!res.ok) throw new Error(data.error?.message || `Claude ${res.status}`);
      // Extract text from content blocks
      const text = (data.content || [])
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("\n")
        .trim();
      // Strip common AI preambles before showing
      const cleaned = (text || "")
        .replace(/^(Je vais|En effectuant|Je recherche|D'accord[,.]?|Bien sûr[,.]?|Voici|Permettez)[^
]*/gim, "")
        .replace(/^(I will|Let me|Sure[,.]?)[^
]*/gim, "")
        .replace(/^\s*
/gm, "")
        .trim();
      setHint(cleaned || "Aucune recommandation générée.");
      setStatus("done");
    } catch(e) {
      setHint(`Erreur : ${e.message}`);
      setStatus("error");
    }
  };

  return (
    <div style={{ borderTop: `1px solid #FEF3C7`, background: "#FFFBEB", padding: "8px 12px" }}>
      {status === "idle" && (
        <button onClick={run}
          style={{ fontSize: 11, fontWeight: 700, color: "#D97706", background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
          💡 Obtenir des pistes d'optimisation GEO
        </button>
      )}
      {status === "loading" && (
        <div style={{ fontSize: 11, color: "#D97706", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⏳</span>
          Recherche en cours sur {brandDomain}…
        </div>
      )}
      {(status === "done" || status === "error") && (
        <div>
          <div style={{ fontSize: 11, whiteSpace: "pre-wrap", lineHeight: 1.6, color: status === "error" ? "#DC2626" : "#92400E" }}>
            {hint}
          </div>
          <button onClick={() => { setStatus("idle"); setHint(""); }}
            style={{ marginTop: 6, fontSize: 10, color: "#D97706", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
            ↺ Relancer
          </button>
        </div>
      )}
    </div>
  );
}

// ── ProviderRow — calendar + info + accordion + run button ────────

function ProviderRow({ provider, results, allProviderResults, brandName, brandAliases, brandDomain = "", hasKey, isRunning, onRun, questionId, newCalEntry = null, question = "", claudeKey = "" }) {
  const [open, setOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const p = provider;

  // Most recent result for this provider
  const result = [...(results || [])].sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0))[0] || null;
  const hasBrand = isBrandPresent(result);
  const sources = result?.sources || [];
  const comps   = result?.competitors_mentioned || [];



  return (
    <div style={{ border: `1px solid ${result ? (hasBrand ? '#059669' : C.border) : p.color+'33'}`, borderLeft: `3px solid ${hasBrand ? '#059669' : p.color}`, borderRadius: 9, overflow: 'hidden', background: hasBrand ? '#F0FDF4' : C.white }}>

      {/* ── Row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', minHeight: 36 }}>

        {/* Provider name */}
        <span style={{ fontSize: 10, fontWeight: 800, color: p.color, minWidth: 68, flexShrink: 0 }}>{p.icon} {p.label}</span>

        {/* Calendar */}
        <PresenceCalendar questionId={questionId} providers={[provider]} newEntry={newCalEntry} />

        {/* Source badge */}
        {result?.brand_in_sources && (
          <span style={{ fontSize: 9, fontWeight: 700, color: '#2563EB', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '1px 6px', flexShrink: 0 }}>🔗 Source</span>
        )}

        {/* Intent / answer type */}
        {result?.intent_type && (
          <span style={{ fontSize: 9, color: '#7C3AED', background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 8, padding: '1px 6px', flexShrink: 0 }}>{result.intent_type}</span>
        )}

        {/* Accordion toggle */}
        {result && (
          <button onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textLight, fontSize: 11, padding: '2px 6px', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }} title="Voir la réponse">
            <span>Réponse</span><span>{open ? '▲' : '▼'}</span>
          </button>
        )}
        {/* Hint button — only when brand absent and Claude key configured */}
        {result && !hasBrand && claudeKey && (
          <button onClick={() => setShowHint(h => !h)}
            title="Pistes d'optimisation GEO"
            style={{ fontSize: 10, fontWeight: 700, color: showHint ? '#fff' : '#D97706', background: showHint ? '#D97706' : '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 6, padding: '2px 7px', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3 }}>
            <span>💡 Hint</span><span>{showHint ? '▲' : '▼'}</span>
          </button>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Right side: tokens · date+heure · brand · run */}
        {result && (
          <span style={{ fontSize: 9, color: C.textLight, flexShrink: 0 }}>
            {(result.input_tokens||0)+(result.output_tokens||0)} tok
          </span>
        )}
        {result?.created_at && (
          <span style={{ fontSize: 9, color: C.textLight, flexShrink: 0 }}>
            {new Date(result.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
            {' '}
            {new Date(result.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}

        {hasKey && (
          <button onClick={onRun} disabled={isRunning} title={`Interroger ${p.label}`}
            style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', cursor: isRunning ? 'wait' : 'pointer', background: isRunning ? C.bg : '#059669', color: isRunning ? C.textLight : '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: isRunning ? 0.6 : 1 }}>
            {isRunning ? '⏳' : '▶'}
          </button>
        )}
      </div>

      {/* ── Accordion: answer + sources + competitors ── */}
      {showHint && result && !hasBrand && (
        <HintPanel
          question={question}
          sources={sources}
          brandName={brandName}
          brandAliases={brandAliases}
          brandDomain={brandDomain}
          claudeKey={claudeKey}
        />
      )}
      {open && result && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 12px', background: C.bg }}>
          <div style={{ fontSize: 12, color: C.text, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {highlightBrand(result.answer || '', brandName, brandAliases)}
          </div>
          {sources.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 5 }}>Sources</div>
              {sources.map((url, i) => {
                const ib = [brandName, ...(brandAliases||[])].some(t => url.toLowerCase().includes((t||'').toLowerCase()));
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: C.textLight, minWidth: 18 }}>[{i+1}]</span>
                    <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: ib ? '#059669' : '#2563EB', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</a>
                    {ib && <span style={{ fontSize: 9, background: '#ECFDF5', color: '#059669', borderRadius: 4, padding: '1px 4px', flexShrink: 0 }}>marque</span>}
                  </div>
                );
              })}
            </div>
          )}
          {comps.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 5 }}>Concurrents</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {comps.map(c => (
                  <span key={c.name} style={{ fontSize: 10, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: 5, padding: '2px 7px' }}>
                    {c.name}{c.position ? ` #${c.position}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── Questions sub-tab (v2) ────────────────────────────────────────

function QuestionsTab({ site, projectId, apiKey, model, brand, categories, allResults, onResultSaved, activeProviders = ["openai"], providerKeys = {}, runMode = "parallel" }) {
  const [questions, setQuestions]   = useState([]);
  const [results, setResults]       = useState(allResults || []);
  const [manualQ, setManualQ]       = useState("");
  const [editingQ, setEditingQ]     = useState(null); // { id, text } — question being edited
  const [filterFav, setFilterFav]       = useState(false);
  const [filterBrand, setFilterBrand]   = useState(false);
  const [filterCat, setFilterCat]       = useState("");
  const [filterKeyword, setFilterKeyword] = useState("");     // keyword_id filter
  const [filterSearch, setFilterSearch]  = useState("");     // regex/text on question
  const [filterProviders, setFilterProviders] = useState([]); // [] = all
  const [running, setRunning]       = useState({});
  const [runAll, setRunAll]         = useState(false);
  const stopAllRef = useRef(false);
  // Refs so callbacks always read current values without stale closure issues
  const activeProvidersRef = useRef(activeProviders);
  const providerKeysRef    = useRef(providerKeys);
  // Keep refs in sync with props on every render (not just via useEffect)
  activeProvidersRef.current = activeProviders;
  providerKeysRef.current    = providerKeys;
  const [selected, setSelected]     = useState(new Set());
  const [bulkCat, setBulkCat]       = useState("");
  const [keywords, setKeywords]     = useState([]);
  const [newCalEntries, setNewCalEntries] = useState({}); // { `${q.id}|${p.id}` → last newEntry for PresenceCalendar }

  // Sync results from parent prop — but don't overwrite optimistic updates.
  // Track last loaded siteId to detect site changes vs normal re-renders.
  const lastSiteRef = useRef(null);
  useEffect(() => {
    const siteChanged = lastSiteRef.current !== site?.id;
    if (siteChanged) {
      lastSiteRef.current = site?.id || null;
      setResults(allResults || []);
    }
  }, [site?.id, allResults]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!projectId || !site?.id) return;
    sbGetQuestions(projectId, site.id).then(setQuestions);
    sbGetKeywords(projectId, site.id).then(setKeywords);

  }, [projectId, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const resultsByQ = useMemo(() => {
    const m = {};
    results.forEach(r => { if (!m[r.question_id]) m[r.question_id] = []; m[r.question_id].push(r); });
    return m;
  }, [results]);

  const saveEdit = async () => {
    if (!editingQ?.text?.trim()) return;
    const newText = editingQ.text.trim();
    const qId = editingQ.id;
    // Optimistic update immediately
    setQuestions(prev => prev.map(q => q.id === qId ? { ...q, question: newText } : q));
    setEditingQ(null);
    // Persist to Supabase
    const ok = await sbUpdateQuestion(qId, { question: newText });
    if (!ok) {
      // Revert on failure
      console.error("saveEdit failed — reverting");
      setQuestions(prev => prev.map(q => q.id === qId ? { ...q, question: editingQ.text } : q));
    }
  };

  const addManual = async () => {
    const q = manualQ.trim();
    if (!q) return;
    const saved = await sbSaveQuestions([{ project_id: projectId, site_id: site.id, question: q, is_manual: true }]);
    setQuestions(prev => [...prev, ...saved]);
    setManualQ("");
  };

  const toggleFav = async (qId, cur) => {
    await sbUpdateQuestion(qId, { is_favorite: !cur });
    setQuestions(prev => prev.map(q => q.id === qId ? { ...q, is_favorite: !cur } : q));
  };

  const deleteQ = async (qId) => {
    await sbDeleteQuestion(qId);
    setQuestions(prev => prev.filter(q => q.id !== qId));
    setSelected(prev => { const n = new Set(prev); n.delete(qId); return n; });
  };

  const setCatSingle = async (qId, catId) => {
    await sbSetQuestionCategory(qId, catId || null);
    setQuestions(prev => prev.map(q => q.id === qId ? { ...q, category_id: catId || null } : q));
  };

  const applyBulkCat = async () => {
    if (!selected.size) return;
    const ids = [...selected];
    await sbBulkSetQuestionCategory(ids, bulkCat || null);
    setQuestions(prev => prev.map(q => selected.has(q.id) ? { ...q, category_id: bulkCat || null } : q));
    setSelected(new Set()); setBulkCat("");
  };



  // Run a single provider on a single question
  const runProvider = useCallback(async (q, provider) => {
    const pk = providerKeysRef.current[provider.id];
    if (!pk?.dec) { console.warn("No key for provider", provider.id); return; }
    setRunning(r => ({ ...r, [`${q.id}-${provider.id}`]: true }));
    const { brand_name = "", brand_aliases = [], competitors = [], context = "" } = brand || {};
    const baseContext = context ? `Contexte : "${context}"\n` : "";
    const question = `Question : ${q.question}`;
    const promptForClaude = `${baseContext}Tu es un expert en recommandation d'entreprises et prestataires. Réponds à la question suivante en te basant sur tes connaissances pour donner une liste de vrais acteurs, entreprises ou prestataires du marché.
RÈGLE : Ne dis jamais que tu n'as pas accès au web ou aux avis récents. Donne directement des recommandations concrètes avec les vrais noms d'entreprises que tu connais.
Réponds en texte libre structuré. Liste les acteurs avec une courte description de chacun.
${question}`;
    const promptForGemini = `${baseContext}Tu as accès à Google Search en temps réel. Utilise-le pour trouver les meilleurs acteurs, entreprises et prestataires actuels.
Réponds avec une liste de vrais acteurs du marché, leurs sites web et leurs caractéristiques principales.
Sois direct et factuel. Cite les sources que tu as consultées.
${question}`;
    const promptForWeb = [baseContext, "Tu es un assistant IA avec accès au web. Réponds directement et complètement à la question.", "RÈGLE ABSOLUE : Ne pose jamais de question de clarification. Donne directement une liste de recommandations concrètes.", "Pour chaque acteur recommandé : donne le nom, le site web, et une description courte.", "Sois factuel, précis, et cite tes sources.", question].filter(Boolean).join("\n");
    const prompt = provider.id === "claude" ? promptForClaude : provider.id === "gemini" ? promptForGemini : promptForWeb;
    try {
      const parsed = await callProvider(provider, pk.dec, prompt);
      const { brandMentioned, brandPosition, brandInSources, competitorsMentioned } = detectBrand(parsed.answer, parsed.sources, brand_name, brand_aliases, competitors);
      const domain_counts = {};
      (parsed.sources || []).forEach(url => {
        if (!domain_counts[url]) domain_counts[url] = { as_source: 0, in_answer: 0, domain: extractDomain(url) };
        domain_counts[url].as_source++;
      });
      await Promise.all(Object.entries(domain_counts).map(([url, counts]) => sbIncrementUrlCounts(projectId, url, counts)));
      const now = new Date().toISOString();
      const record = {
        question_id: q.id, project_id: projectId, site_id: site.id,
        model: `${provider.label} (${provider.model})`,
        answer: parsed.answer, answer_type: parsed.answer_type, intent_type: parsed.intent_type,
        sources: parsed.sources, source_types: parsed.source_types,
        brand_mentioned: brandMentioned, brand_position: brandPosition,
        brand_in_sources: brandInSources, competitors_mentioned: competitorsMentioned,
        input_tokens: parsed._input_tokens, output_tokens: parsed._output_tokens,
        created_at: now,
      };
      // Optimistic local update — immediately update the card
      const pid = getProviderId(record.model);
      const optimisticResult = { ...record, id: `tmp-${pid}-${q.id}`, provider_id: pid };
      setResults(prev => {
        const existing = prev.findIndex(r => r.question_id === q.id && getProviderId(r.model) === pid);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = { ...updated[existing], ...optimisticResult };
          return updated;
        }
        return [optimisticResult, ...prev];
      });

      // Persist to Supabase in background — update with real id when done
      sbSaveGeoResult(record).then(saved => {
        const real = Array.isArray(saved) ? saved[0] : saved;
        if (real?.id) {
          setResults(prev => prev.map(r =>
            r.id === optimisticResult.id ? { ...r, ...real } : r
          ));
        }
      }).catch(e => console.error("sbSaveGeoResult error:", e));

      // Add to calendar (optimistic + persist)
      setNewCalEntries(prev => ({ ...prev, [`${q.id}|${provider.id}`]: { provider_id: provider.id, brand_present: brandMentioned } }));
      // Persist to DB (best effort)
      sbAddCalendarEntry(q.id, provider.id, brandMentioned).catch(() => {});

      // Update cached answers on question
      const cachePatch = { has_result: true, last_answer: parsed.answer, last_model: record.model, last_date: now };
      if (brandMentioned) Object.assign(cachePatch, { best_answer: parsed.answer, best_model: record.model, best_date: now });
      sbUpdateQuestion(q.id, cachePatch).catch(() => {});
      setQuestions(prev => prev.map(qq => qq.id === q.id ? { ...qq, ...cachePatch } : qq));
      // Notify parent for global stats (non-blocking)
      onResultSaved?.();
    } catch(e) { console.error(`runProvider ${provider.id} error:`, e); }
    setRunning(r => ({ ...r, [`${q.id}-${provider.id}`]: false }));
  }, [brand, projectId, site?.id, providerKeys, onResultSaved]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => questions.filter(q => {
    if (filterFav && !q.is_favorite) return false;
    if (filterCat && q.category_id !== filterCat) return false;
    if (filterKeyword && q.keyword_id !== filterKeyword) return false;
    if (filterSearch) {
      try {
        const rx = new RegExp(filterSearch, 'i');
        if (!rx.test(q.question)) return false;
      } catch { if (!q.question.toLowerCase().includes(filterSearch.toLowerCase())) return false; }
    }
    if (filterBrand) {
      const qRes = resultsByQ[q.id] || [];
      if (!qRes.some(r => r.brand_mentioned === true || r.brand_mentioned === 1)) return false;
    }
    if (filterProviders.length > 0) {
      const qRes = resultsByQ[q.id] || [];
      if (!qRes.some(r => filterProviders.includes(getProviderId(r.model)))) return false;
    }
    return true;
  }), [questions, filterFav, filterBrand, filterCat, filterKeyword, filterSearch, filterProviders, resultsByQ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Returns providers that still need to be called for a question today
  const getProvidersToRun = (q, force = false) => {
    const currentKeys = providerKeysRef.current;
    const currentActive = activeProvidersRef.current;
    const configuredProviders = PROVIDERS.filter(p => currentActive.includes(p.id) && currentKeys[p.id]?.dec);
    if (force) return configuredProviders; // always run all when forced (individual ▶ button)
    const today = new Date().toISOString().slice(0, 10);
    const qResults = resultsByQ[q.id] || [];
    return configuredProviders.filter(p => {
      // Skip if already generated today for this provider
      const alreadyToday = qResults.some(r =>
        getProviderId(r.model) === p.id &&
        r.created_at && r.created_at.slice(0, 10) === today
      );
      return !alreadyToday;
    });
  };

  const runAllQuestions = async () => {
    const toRun = filtered
      .map(q => ({ q, providers: getProvidersToRun(q, false) }))
      .filter(({ providers }) => providers.length > 0);
    if (!toRun.length) return;
    stopAllRef.current = false;
    setRunAll(true);
    for (const { q, providers } of toRun) {
      if (stopAllRef.current) break;
      setRunning(r => ({ ...r, [q.id]: true }));
      await Promise.all(providers.map(p => runProvider(q, p)));
      setRunning(r => ({ ...r, [q.id]: false }));
    }
    setRunAll(false);
  };

  const { brand_name = "", brand_aliases = [] } = brand || {};

  // Results for filtered questions, filtered by provider selection
  const filteredResults = useMemo(() => {
    const qIds = new Set(filtered.map(q => q.id));
    return results.filter(r => {
      if (!qIds.has(r.question_id)) return false;
      if (filterProviders.length > 0 && !filterProviders.includes(getProviderId(r.model))) return false;
      return true;
    });
  }, [filtered, results, filterProviders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Count questions to generate for "Lancer tout" indicator
  const toRunCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const configuredProviders = PROVIDERS.filter(p =>
      activeProviders.includes(p.id) && providerKeys[p.id]?.dec
    );
    if (!configuredProviders.length) return 0;
    return filtered.filter(q => {
      const qResults = resultsByQ[q.id] || [];
      // Count questions that have at least one provider not yet done today
      return configuredProviders.some(p =>
        !qResults.some(r =>
          getProviderId(r.model) === p.id &&
          r.created_at && r.created_at.slice(0, 10) === today
        )
      );
    }).length;
  }, [filtered, resultsByQ, activeProviders, providerKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {/* Manual question input */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 10 }}>
        <input value={manualQ} onChange={e => setManualQ(e.target.value)} onKeyDown={e => e.key === "Enter" && addManual()}
          placeholder="Ajouter une question manuellement…"
          style={{ flex: 1, padding: "7px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text }} />
        <Btn onClick={addManual} disabled={!manualQ.trim()}>➕ Ajouter</Btn>
      </div>

      {/* ── Stats header (filtered) ── */}
      <StatsHeader questions={filtered} results={filteredResults} brandName={brand_name} />

      {/* ── Filters ── */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", marginBottom: 14 }}>
        {/* Row 1: search + category + keyword + fav + brand */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <input
            value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
            placeholder="🔍 Regex / texte sur les questions…"
            style={{ padding: "5px 10px", border: `1px solid ${filterSearch ? "#2563EB" : C.border}`, borderRadius: 7, fontSize: 11, color: C.text, width: 230 }}
          />
          <CatSelect value={filterCat} categories={[{ id: "", name: "Toutes catégories" }, ...categories]} onChange={v => setFilterCat(v || "")} placeholder="Toutes catégories" />
          <select value={filterKeyword} onChange={e => setFilterKeyword(e.target.value)}
            style={{ padding: "5px 8px", border: `1px solid ${filterKeyword ? "#2563EB" : C.border}`, borderRadius: 7, fontSize: 11, color: C.text }}>
            <option value="">Tous les mots-clés</option>
            {keywords.map(k => <option key={k.id} value={k.id}>{k.keyword}</option>)}
          </select>
          <Pill color="#F59E0B" active={filterFav} onClick={() => setFilterFav(f => !f)}>⭐ Favoris</Pill>
          <Pill color="#059669" active={filterBrand} onClick={() => setFilterBrand(f => !f)}>✓ Marque</Pill>
          {(filterSearch || filterCat || filterKeyword || filterFav || filterBrand || filterProviders.length > 0) && (
            <button onClick={() => { setFilterSearch(""); setFilterCat(""); setFilterKeyword(""); setFilterFav(false); setFilterBrand(false); setFilterProviders([]); }}
              style={{ fontSize: 11, padding: "3px 8px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.bg, cursor: "pointer", color: C.textMid }}>
              ✕ Réinitialiser
            </button>
          )}
        </div>

        {/* Row 2: providers multi-select + counters + actions */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: C.textLight, flexShrink: 0 }}>Providers :</span>
          {PROVIDERS.map(p => {
            const active = filterProviders.includes(p.id);
            const hasKey = !!providerKeys[p.id]?.dec;
            return (
              <button key={p.id} onClick={() => setFilterProviders(prev => active ? prev.filter(id => id !== p.id) : [...prev, p.id])}
                style={{ padding: "2px 10px", border: `2px solid ${p.color}`, borderRadius: 10, fontSize: 10, fontWeight: 600, cursor: "pointer",
                  background: active ? p.color : "transparent", color: active ? "#fff" : hasKey ? p.color : C.textLight, opacity: hasKey ? 1 : 0.4 }}>
                {p.icon} {p.label}
              </button>
            );
          })}

          <span style={{ fontSize: 11, color: C.textLight, marginLeft: 8 }}>
            {filtered.length} question{filtered.length > 1 ? "s" : ""}
            {selected.size > 0 && <strong style={{ color: C.text }}> · {selected.size} sél.</strong>}
          </span>

          <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
            <button onClick={() => setSelected(new Set(filtered.map(q => q.id)))} style={{ fontSize: 10, padding: "2px 7px", border: `1px solid ${C.border}`, borderRadius: 5, background: C.white, cursor: "pointer", color: C.textMid }}>Tout sélect.</button>
            {selected.size > 0 && <button onClick={() => setSelected(new Set())} style={{ fontSize: 10, padding: "2px 7px", border: `1px solid ${C.border}`, borderRadius: 5, background: C.white, cursor: "pointer", color: C.textMid }}>Désélect.</button>}
            {selected.size > 0 && (
              <>
                <CatSelect value={bulkCat} categories={categories} onChange={setBulkCat} placeholder="Catégoriser…" />
                <Btn onClick={applyBulkCat} small color="#7C3AED">Appliquer</Btn>
              </>
            )}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={() => sbGetQuestions(projectId, site.id).then(setQuestions)}
              title="Recharger les questions" style={{ padding: "4px 8px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.textLight, fontSize: 11, cursor: "pointer" }}>🔄</button>
            <Btn onClick={runAllQuestions} disabled={runAll || toRunCount === 0} color="#7C3AED">{runAll ? "⏳ En cours…" : toRunCount > 0 ? `▶ Lancer tout (${toRunCount})` : "✓ Tout généré"}</Btn>
            {runAll && <Btn onClick={() => { stopAllRef.current = true; setRunAll(false); }} color="#DC2626" variant="outline" small>⏹ Arrêter</Btn>}
          </div>
        </div>
      </div>

      {/* Questions list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: C.textLight, fontSize: 12 }}>
          {questions.length === 0 ? "Aucune question — générez-en depuis les mots-clés ou ajoutez-en manuellement" : "Aucune question ne correspond aux filtres"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(q => {
            const qResults = resultsByQ[q.id] || [];
            const hasBrand = qResults.some(r => r.brand_mentioned === true || r.brand_mentioned === 1);
            const isRunning = running[q.id];
            const isSel = selected.has(q.id);
            const cat = categories.find(c => c.id === q.category_id);
            const kwTag = keywords.find(k => k.id === q.keyword_id);
            return (
              <div key={q.id} style={{ background: isSel ? "#EFF6FF" : C.white, border: `1px solid ${hasBrand ? "#059669" : isSel ? "#2563EB55" : C.border}`, borderRadius: 12, padding: "12px 16px", borderLeft: `3px solid ${hasBrand ? "#059669" : q.is_favorite ? "#F59E0B" : isSel ? "#2563EB" : C.border}` }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <input type="checkbox" checked={isSel} onChange={() => { setSelected(prev => { const n = new Set(prev); n.has(q.id) ? n.delete(q.id) : n.add(q.id); return n; }); }} style={{ cursor: "pointer", flexShrink: 0, marginTop: 2 }} />
                  <button onClick={() => toggleFav(q.id, q.is_favorite)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, flexShrink: 0, opacity: q.is_favorite ? 1 : 0.3, transition: "opacity 0.15s" }}>⭐</button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Question text — edit mode or display */}
                    {editingQ?.id === q.id ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                        <input
                          autoFocus
                          value={editingQ.text}
                          onChange={e => setEditingQ(prev => ({ ...prev, text: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingQ(null); }}
                          style={{ flex: 1, padding: "5px 10px", border: `1px solid #2563EB`, borderRadius: 7, fontSize: 13, fontWeight: 600, color: C.text }}
                        />
                        <button onClick={saveEdit} style={{ padding: "4px 10px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✓</button>
                        <button onClick={() => setEditingQ(null)} style={{ padding: "4px 8px", background: C.bg, color: C.textLight, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.5 }}>{q.question}</div>
                    )}
                    <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                      {kwTag && <span style={{ fontSize: 10, color: C.textLight, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "1px 7px" }}>🔑 {kwTag.keyword}</span>}
                      {cat && <span style={{ fontSize: 10, fontWeight: 700, color: cat.color, background: cat.color + "18", border: `1px solid ${cat.color}44`, borderRadius: 10, padding: "1px 7px" }}>{cat.name}</span>}
                      {q.is_manual && <Pill color={C.textLight}>manuel</Pill>}
                      {hasBrand && <Pill color="#059669">✓ {brand_name}</Pill>}
                      {qResults.length > 0 && <span style={{ fontSize: 10, color: C.textLight }}>{qResults.length} résultat{qResults.length > 1 ? "s" : ""}</span>}
                    </div>
                    {/* Per-provider 30-day calendar */}

                  </div>
                  <div style={{ display: "flex", gap: 5, flexShrink: 0, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <CatSelect value={q.category_id} categories={categories} onChange={v => setCatSingle(q.id, v)} />
                    <button onClick={() => setEditingQ(editingQ?.id === q.id ? null : { id: q.id, text: q.question })}
                      style={{ padding: "3px 7px", border: `1px solid ${C.border}`, borderRadius: 6, background: editingQ?.id === q.id ? "#EFF6FF" : C.white, color: "#2563EB", fontSize: 11, cursor: "pointer" }}
                      title="Modifier la question">✏️</button>
                    <button
                      onClick={() => {
                        const toRun = getProvidersToRun(q, false); // skip already done today
                        if (!toRun.length) return;
                        toRun.forEach(p => runProvider(q, p));
                      }}
                      disabled={isRunning}
                      title="Lancer les providers non encore interrogés aujourd'hui"
                      style={{ padding: "3px 10px", border: `1px solid ${site.color}`, borderRadius: 6, background: site.color, color: "#fff", fontSize: 11, fontWeight: 700, cursor: isRunning ? "wait" : "pointer", opacity: isRunning ? 0.6 : 1 }}>
                      {isRunning ? "⏳" : "▶ Tous"}
                    </button>
                    <button onClick={() => deleteQ(q.id)} style={{ padding: "3px 7px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.textLight, fontSize: 10, cursor: "pointer" }}>🗑</button>
                  </div>
                </div>
                {/* One row per provider — calendar + info + accordion + run */}
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                  {PROVIDERS.map(p => {
                    const pResults = qResults.filter(r => getProviderId(r.model) === p.id);
                    const hasKey = !!providerKeys[p.id]?.dec;
                    if (!hasKey && !pResults.length) return null;
                    return (
                      <ProviderRow
                        key={p.id}
                        provider={p}
                        results={pResults}
                        allProviderResults={qResults}
                        brandName={brand_name}
                        brandAliases={brand_aliases}
                        hasKey={hasKey}
                        isRunning={!!running[`${q.id}-${p.id}`]}
                        onRun={() => runProvider(q, p)}
                        questionId={q.id}
                        newCalEntry={newCalEntries[`${q.id}|${p.id}`] || null}
                        question={q.question}
                        brandDomain={brand?.brand_domain || ""}
                        claudeKey={providerKeysRef.current["claude"]?.dec || ""}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── URL Index sub-tab ─────────────────────────────────────────────


function UrlsTab({ projectId, categories, brand, allResults }) {
  const [urls, setUrls]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const [crawling, setCrawling] = useState({});
  const [filterType, setFilterType] = useState("all"); // all | brand | competitor | other
  const [filterTpl, setFilterTpl]   = useState("");
  const [search, setSearch]         = useState("");
  const [view, setView]             = useState("urls"); // urls | domains
  const [openCrawl, setOpenCrawl]   = useState(null);

  const brandName    = brand?.brand_name || "";
  const brandAliases = brand?.brand_aliases || [];
  const competitors  = brand?.competitors  || [];

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError(false);
    sbGetUrlIndex(projectId)
      .then(data => { setUrls(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setUrls([]); setLoading(false); setError(true); });
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Classify a URL
  const classifyUrl = (u) => {
    const d = (u.domain || "").toLowerCase();
    const allBrand = [brandName, ...brandAliases].filter(Boolean).map(t => t.toLowerCase());
    const knownComps = competitors.filter(Boolean).map(t => t.toLowerCase());

    if (allBrand.some(t => d.includes(t))) return "brand";

    // Identified competitors from results
    const compNames = new Set();
    allResults.forEach(r => (r.competitors_mentioned || []).forEach(c => { if (c.name) compNames.add(c.name.toLowerCase()); }));
    const identifiedComps = [...compNames];

    if (knownComps.some(t => d.includes(t))) return "competitor_known";
    if (identifiedComps.some(t => d.includes(t) || t.includes(d.split(".")[0]))) return "competitor_identified";
    return "other";
  };

  const classColors = {
    brand:                 { color: "#059669", bg: "#ECFDF5", border: "#059669", label: `✓ ${brandName || "Marque"}` },
    competitor_known:      { color: "#DC2626", bg: "#FEF2F2", border: "#DC2626", label: "⚔️ Concurrent déclaré" },
    competitor_identified: { color: "#EA580C", bg: "#FFF7ED", border: "#EA580C", label: "🔍 Concurrent identifié" },
    other:                 { color: "#64748B", bg: "#F8FAFC", border: "#E2E8F0", label: "🔗 Autre source" },
  };

  const TEMPLATE_TYPES = ["article","landing","fiche","FAQ","comparatif","forum","media","institutionnel","autre"];

  const filtered = useMemo(() => urls.filter(u => {
    if (search && !u.url?.toLowerCase().includes(search.toLowerCase()) && !u.domain?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterTpl && u.template_type !== filterTpl) return false;
    if (filterType !== "all") {
      const cls = classifyUrl(u);
      if (filterType === "brand" && cls !== "brand") return false;
      if (filterType === "competitor" && !cls.startsWith("competitor")) return false;
      if (filterType === "other" && cls !== "other") return false;
    }
    return true;
  }), [urls, search, filterTpl, filterType, brandName, brandAliases, competitors, allResults]); // eslint-disable-line react-hooks/exhaustive-deps

  // Domain aggregation
  const domains = useMemo(() => {
    const m = {};
    urls.forEach(u => {
      if (!u.domain) return;
      if (!m[u.domain]) m[u.domain] = { domain: u.domain, count_as_source: 0, count_in_answer: 0, urls: [] };
      m[u.domain].count_as_source += u.count_as_source || 0;
      m[u.domain].count_in_answer += u.count_in_answer || 0;
      m[u.domain].urls.push(u);
    });
    return Object.values(m).sort((a, b) => (b.count_as_source + b.count_in_answer) - (a.count_as_source + a.count_in_answer));
  }, [urls]);

  // Counts per class
  const classCounts = useMemo(() => {
    const c = { brand: 0, competitor_known: 0, competitor_identified: 0, other: 0 };
    urls.forEach(u => { c[classifyUrl(u)]++; });
    return c;
  }, [urls, brandName, brandAliases, competitors, allResults]); // eslint-disable-line react-hooks/exhaustive-deps

  const setThemeCat = async (id, catId) => {
    await sbUpdateUrlMeta(id, { theme_category_id: catId || null });
    setUrls(prev => prev.map(u => u.id === id ? { ...u, theme_category_id: catId || null } : u));
  };

  const setTemplate = async (id, tpl) => {
    await sbUpdateUrlMeta(id, { template_type: tpl || null });
    setUrls(prev => prev.map(u => u.id === id ? { ...u, template_type: tpl || null } : u));
  };

  const launchCrawl = async (urlEntry) => {
    setCrawling(c => ({ ...c, [urlEntry.id]: true }));
    await sbUpdateUrlMeta(urlEntry.id, { crawl_status: "pending" });
    setUrls(prev => prev.map(u => u.id === urlEntry.id ? { ...u, crawl_status: "pending" } : u));
    try {
      const res = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlEntry.url }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Crawl failed");
      const sections = data.sections || [];
      await sbUpdateUrlMeta(urlEntry.id, { crawl_status: "done", crawl_sections: sections, crawl_at: new Date().toISOString() });
      setUrls(prev => prev.map(u => u.id === urlEntry.id ? { ...u, crawl_status: "done", crawl_sections: sections } : u));
      setOpenCrawl(urlEntry.id);
    } catch(e) {
      await sbUpdateUrlMeta(urlEntry.id, { crawl_status: "error" });
      setUrls(prev => prev.map(u => u.id === urlEntry.id ? { ...u, crawl_status: "error" } : u));
      console.error("Crawl échoué:", e.message);
    }
    setCrawling(c => ({ ...c, [urlEntry.id]: false }));
  };

  if (loading) return (
    <div style={{ textAlign: "center", padding: 40, color: C.textLight, fontSize: 12 }}>
      Chargement des sources citées…
    </div>
  );

  if (error || (!loading && urls.length === 0)) return (
    <div style={{ textAlign: "center", padding: 60, color: C.textLight }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>
        {error ? "Table non disponible" : "Aucune source indexée"}
      </div>
      <div style={{ fontSize: 12 }}>
        {error
          ? "Exécutez migration-geo-v2.sql dans Supabase, puis interrogez des questions."
          : "Interrogez des questions pour voir apparaître les URLs citées."}
      </div>
    </div>
  );

  return (
    <div>
      {/* ── Legend strip ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {Object.entries(classColors).map(([cls, meta]) => (
          <button key={cls} onClick={() => setFilterType(filterType === cls ? "all" : cls)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "5px 12px",
              borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer",
              border: `2px solid ${filterType === cls ? meta.color : meta.border}`,
              background: filterType === cls ? meta.color : meta.bg,
              color: filterType === cls ? "#fff" : meta.color,
              transition: "all 0.15s",
            }}>
            {meta.label}
            <span style={{ opacity: 0.75, fontWeight: 400 }}>({classCounts[cls]})</span>
          </button>
        ))}
      </div>

      {/* ── Filters + view toggle ── */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher…"
          style={{ padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text, width: 220 }} />
        <select value={filterTpl} onChange={e => setFilterTpl(e.target.value)}
          style={{ padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, color: C.text }}>
          <option value="">Tous templates</option>
          {TEMPLATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ fontSize: 11, color: C.textLight }}>{filtered.length} URL{filtered.length > 1 ? "s" : ""} · {domains.length} domaine{domains.length > 1 ? "s" : ""}</span>

        {/* View toggle */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 3, background: C.bg, borderRadius: 8, padding: 3 }}>
          {[{ key: "urls", label: "🔗 URLs" }, { key: "domains", label: "🌐 Domaines" }].map(v => (
            <button key={v.key} onClick={() => setView(v.key)} style={{
              padding: "4px 14px", borderRadius: 6, fontSize: 12, fontWeight: view === v.key ? 700 : 400,
              border: "none", cursor: "pointer",
              background: view === v.key ? C.white : "transparent",
              color: view === v.key ? C.text : C.textLight,
              boxShadow: view === v.key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}>{v.label}</button>
          ))}
        </div>
      </div>

      {/* ── URLs view ── */}
      {view === "urls" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {filtered.map(u => {
            const cls  = classifyUrl(u);
            const meta = classColors[cls];
            const isOpen = openCrawl === u.id;
            const hasSections = u.crawl_sections?.length > 0;
            const cat = categories.find(c => c.id === u.theme_category_id);
            return (
              <div key={u.id} style={{ background: meta.bg, border: `1.5px solid ${meta.border}33`, borderLeft: `4px solid ${meta.color}`, borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", flexWrap: "wrap" }}>
                  {/* Counts */}
                  <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, background: `${meta.color}22`, color: meta.color, borderRadius: 5, padding: "2px 7px" }} title="Source">📎 {u.count_as_source}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, background: "#F5F3FF", color: "#7C3AED", borderRadius: 5, padding: "2px 7px" }} title="Dans réponse">💬 {u.count_in_answer}</span>
                  </div>
                  {/* Class badge */}
                  <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}44`, borderRadius: 10, padding: "1px 8px", flexShrink: 0 }}>
                    {meta.label}
                  </span>
                  {/* URL */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontSize: 12, color: meta.color, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.url}</span>
                      <a href={u.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                        style={{ flexShrink: 0, fontSize: 10, color: C.textLight, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px", textDecoration: "none" }}>↗</a>
                    </div>
                    <div style={{ fontSize: 10, color: C.textLight }}>{u.domain}</div>
                  </div>
                  {/* Selectors */}
                  <div style={{ display: "flex", gap: 5, flexShrink: 0, flexWrap: "wrap" }}>
                    {cat && <span style={{ fontSize: 10, fontWeight: 700, color: cat.color, background: cat.color+"18", borderRadius: 10, padding: "1px 7px" }}>{cat.name}</span>}
                    <CatSelect value={u.theme_category_id} categories={categories} onChange={v => setThemeCat(u.id, v)} placeholder="Thème…" />
                    <select value={u.template_type || ""} onChange={e => setTemplate(u.id, e.target.value || null)}
                      style={{ padding: "3px 6px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 10, color: u.template_type ? C.text : C.textLight }}>
                      <option value="">Template…</option>
                      {TEMPLATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {/* Crawl button */}
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {hasSections && (
                      <button onClick={() => setOpenCrawl(isOpen ? null : u.id)}
                        style={{ padding: "3px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 10, cursor: "pointer", background: isOpen ? C.bg : C.white, color: C.textMid }}>
                        {isOpen ? "▲" : "▼"} Sections
                      </button>
                    )}
                    <button onClick={() => launchCrawl(u)} disabled={crawling[u.id]}
                      style={{ padding: "3px 8px", border: `1px solid ${meta.color}`, borderRadius: 6, fontSize: 10, cursor: crawling[u.id] ? "wait" : "pointer", background: meta.bg, color: meta.color, fontWeight: 600 }}>
                      {crawling[u.id] ? "⏳" : u.crawl_status === "done" ? "🔄" : "🕷️"}
                    </button>
                  </div>
                </div>
                {/* Crawl sections */}
                {isOpen && hasSections && (
                  <div style={{ borderTop: `1px solid ${meta.border}33`, background: C.bg, padding: "10px 14px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>Sections · {u.crawl_sections.length}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 7 }}>
                      {u.crawl_sections.map((sec, i) => (
                        <div key={i} style={{ background: C.white, border: `1px solid ${sec.used_in_llm ? "#059669" : C.border}`, borderRadius: 7, padding: "8px 10px", borderLeft: `3px solid ${sec.used_in_llm ? "#059669" : C.border}` }}>
                          <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 3 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: "#7C3AED", background: "#F5F3FF", borderRadius: 4, padding: "1px 5px" }}>{sec.type}</span>
                            {sec.used_in_llm && <span style={{ fontSize: 9, color: "#059669", fontWeight: 600 }}>✓ LLM</span>}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 2 }}>{sec.title}</div>
                          <div style={{ fontSize: 10, color: C.textLight, lineHeight: 1.4 }}>{sec.summary}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Domains view ── */}
      {view === "domains" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {domains.map((d, i) => {
            const cls  = classifyUrl({ domain: d.domain });
            const meta = classColors[cls];
            const total = d.count_as_source + d.count_in_answer;
            const maxTotal = domains[0] ? domains[0].count_as_source + domains[0].count_in_answer : 1;
            return (
              <div key={d.domain} style={{ background: meta.bg, border: `1.5px solid ${meta.border}33`, borderLeft: `4px solid ${meta.color}`, borderRadius: 10, padding: "10px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: C.textLight, minWidth: 28 }}>#{i+1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>{d.domain}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}44`, borderRadius: 10, padding: "1px 7px" }}>{meta.label}</span>
                      <span style={{ fontSize: 10, color: C.textLight }}>{d.urls.length} URL{d.urls.length > 1 ? "s" : ""}</span>
                    </div>
                    {/* Bar */}
                    <div style={{ height: 5, background: `${meta.color}22`, borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
                      <div style={{ height: "100%", width: `${(total / maxTotal) * 100}%`, background: meta.color, borderRadius: 3, transition: "width 0.4s" }} />
                    </div>
                    <div style={{ display: "flex", gap: 10, fontSize: 11, color: C.textLight }}>
                      <span>📎 {d.count_as_source} source{d.count_as_source > 1 ? "s" : ""}</span>
                      <span>💬 {d.count_in_answer} dans réponse</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main GeoTab ───────────────────────────────────────────────────

export default function GeoTab({ sites, projectId, project, geoAxes, onSaveAxes }) {
  const [subTab, setSubTab]         = useState("keywords"); // keywords | questions | urls
  const [questionsKey, setQuestionsKey] = useState(0); // incremented to force QuestionsTab reload
  const [selectedSite, setSelectedSite] = useState(sites[0]?.id || "");
  const [model] = useState("gpt-4o-mini"); // kept for variation generation (OpenAI completions endpoint)
  const [brand, setBrand]           = useState(null);
  const [runMode, setRunMode]       = useState("parallel"); // parallel | sequential
  const [activeProviders, setActiveProviders] = useState(() => {
    // Start with all providers that have keys configured
    if (project) {
      const withKeys = PROVIDERS.filter(p => project[p.keyField]).map(p => p.id);
      if (withKeys.length) return withKeys;
    }
    return ["openai"];
  });
  // Provider key state: { id → { enc, dec, input, status } }
  const [providerKeys, setProviderKeys] = useState(() => {
    // Initialize synchronously from project prop so keys are available immediately
    const init = {};
    if (project) {
      PROVIDERS.forEach(p => {
        const enc = project[p.keyField] || "";
        if (enc) {
          const dec = decodeKey(enc);
          if (dec) init[p.id] = { enc, dec, input: "", status: "ok" };
        }
      });
    }
    return init;
  });
  const [apiKeyEnc, setApiKeyEnc]   = useState(project?.openai_key_enc || ""); // legacy for variation gen

  // Sync all provider keys when project prop updates
  useEffect(() => {
    if (!project) return;
    const updates = {};
    PROVIDERS.forEach(p => {
      const enc = project[p.keyField] || "";
      if (enc) {
        const dec = decodeKey(enc);
        updates[p.id] = { enc, dec, input: "", status: dec ? "ok" : "error" };
      }
    });
    if (Object.keys(updates).length) setProviderKeys(prev => ({ ...prev, ...updates }));
    // Sync legacy openai key for variation generation
    if (project?.openai_key_enc && project.openai_key_enc !== apiKeyEnc) {
      setApiKeyEnc(project.openai_key_enc);
    }
  }, [project?.openai_key_enc, project?.gemini_key_enc, project?.perplexity_key_enc, project?.claude_geo_key_enc]); // eslint-disable-line react-hooks/exhaustive-deps
  const [apiKeyDec, setApiKeyDec]   = useState("");           // decrypted, only in memory
  const [allResults, setAllResults] = useState([]);
  const [brandEditing, setBrandEditing] = useState(false);
  const [brandDraft, setBrandDraft] = useState({ brand_name: "", brand_domain: "", brand_aliases: "", competitors: "", context: "" });
  const [categories, setCategories] = useState([]);
  const [axes, setAxes]             = useState(geoAxes || DEFAULT_AXES);
  const [axesEditing, setAxesEditing] = useState(false);
  const [axesDraft, setAxesDraft]   = useState(null);

  const site = sites.find(s => s.id === selectedSite) || sites[0];

  // Sync axes when project changes
  useEffect(() => {
    setAxes(geoAxes || DEFAULT_AXES);
  }, [geoAxes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load categories (project-wide, once)
  useEffect(() => {
    if (!projectId) return;
    sbGetCategories(projectId).then(setCategories);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load brand + decrypt key + results when site changes
  useEffect(() => {
    if (!projectId || !site?.id) return;
    sbGetBrand(projectId, site.id).then(b => {
      setBrand(b);
      if (b) setBrandDraft({ brand_name: b.brand_name || "", brand_domain: b.brand_domain || "", brand_aliases: (b.brand_aliases || []).join(", "), competitors: (b.competitors || []).join(", "), context: b.context || "" });
    });
    sbGetGeoResults(projectId, site.id).then(setAllResults);
  }, [projectId, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Decode key when enc changes
  useEffect(() => {
    if (!apiKeyEnc) return;
    const k = decodeKey(apiKeyEnc);
    setApiKeyDec(k);
  }, [apiKeyEnc]); // eslint-disable-line react-hooks/exhaustive-deps


  const saveBrand = async () => {
    const b = {
      project_id: projectId, site_id: site.id,
      brand_name:   brandDraft.brand_name.trim(),
      brand_domain: (brandDraft.brand_domain || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, ""),
      brand_aliases: brandDraft.brand_aliases.split(",").map(s => s.trim()).filter(Boolean),
      competitors:   brandDraft.competitors.split(",").map(s => s.trim()).filter(Boolean),
      context:       brandDraft.context.trim(),
    };
    await sbSaveBrand(b);
    setBrand(b);
    setBrandEditing(false);
  };


  return (
    <div>
      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 4 }}>🔍 Étude des Fan-outs</div>
        <div style={{ fontSize: 12, color: C.textLight }}>Analysez la présence de vos marques dans les réponses ChatGPT</div>
      </div>

      {/* ── Config strip: site + providers + run mode ── */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 20px", marginBottom: 20 }}>

        {/* Row 1: site + run mode */}
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
          {sites.length > 1 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 5 }}>Site</div>
              <div style={{ display: "flex", gap: 6 }}>
                {sites.map(s => (
                  <button key={s.id} onClick={() => setSelectedSite(s.id)} style={{
                    padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    border: `2px solid ${s.color}`,
                    background: selectedSite === s.id ? s.color : "transparent",
                    color: selectedSite === s.id ? "#fff" : s.color,
                  }}>{s.label}</button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 5 }}>Mode d'exécution</div>
            <div style={{ display: "flex", gap: 4, background: C.bg, borderRadius: 8, padding: 3 }}>
              {[{ key: "parallel", label: "⚡ Parallèle" }, { key: "sequential", label: "▶ Séquentiel" }].map(m => (
                <button key={m.key} onClick={() => setRunMode(m.key)} style={{
                  padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: runMode === m.key ? 700 : 400,
                  border: "none", cursor: "pointer",
                  background: runMode === m.key ? C.white : "transparent",
                  color: runMode === m.key ? C.text : C.textLight,
                  boxShadow: runMode === m.key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                }}>{m.label}</button>
              ))}
            </div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 5 }}>Providers actifs</div>
            <div style={{ display: "flex", gap: 6 }}>
              {PROVIDERS.map(p => {
                const isActive = activeProviders.includes(p.id);
                const hasKey = !!providerKeys[p.id]?.dec;
                return (
                  <button key={p.id} onClick={() => {
                    if (!hasKey && !isActive) return; // can't activate without key
                    setActiveProviders(prev => isActive ? prev.filter(id => id !== p.id) : [...prev, p.id]);
                  }} title={!hasKey ? `Configurez la clé ${p.label} ci-dessous` : ""} style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: hasKey ? "pointer" : "not-allowed",
                    border: `2px solid ${p.color}`,
                    background: isActive && hasKey ? p.color : "transparent",
                    color: isActive && hasKey ? "#fff" : hasKey ? p.color : C.textLight,
                    opacity: hasKey ? 1 : 0.4,
                    transition: "all 0.15s",
                  }}>
                    {p.icon} {p.label}
                    {hasKey && <span style={{ fontSize: 9, opacity: 0.8 }}>●</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Row 2: API keys for each provider */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {PROVIDERS.map(p => {
            const pk = providerKeys[p.id] || { enc: "", dec: "", input: "", status: "idle" };
            const hasK = !!pk.dec;
            return (
              <div key={p.id}>
                <div style={{ fontSize: 10, fontWeight: 600, color: p.color, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>
                  {p.icon} {p.label}{hasK && <span style={{ color: "#059669", marginLeft: 4 }}>● OK</span>}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="password"
                    value={pk.input || ""}
                    onChange={e => setProviderKeys(prev => ({ ...prev, [p.id]: { ...prev[p.id], input: e.target.value, status: "idle" } }))}
                    placeholder={hasK ? "Remplacer…" : p.keyPlaceholder}
                    style={{ flex: 1, padding: "5px 8px", border: `1px solid ${pk.status === "error" ? "#DC2626" : C.border}`, borderRadius: 7, fontSize: 11, color: C.text, minWidth: 0 }}
                  />
                  <button
                    disabled={!pk.input?.trim()}
                    onClick={async () => {
                      const k = (pk.input || "").trim();
                      if (!k) return;
                      const enc = encodeKey(k);
                      const dec = decodeKey(enc);
                      setProviderKeys(prev => ({ ...prev, [p.id]: { enc, dec, input: "", status: "ok" } }));
                      // Also sync legacy openai key
                      if (p.id === "openai") { setApiKeyEnc(enc); setApiKeyDec(dec); }
                      // Save all provider keys to Supabase
                      await sbSaveProviderKeys(projectId, { [p.keyField]: enc });
                    }}
                    style={{ padding: "5px 10px", borderRadius: 7, background: p.color, color: "#fff", border: "none", fontSize: 11, fontWeight: 700, cursor: pk.input?.trim() ? "pointer" : "not-allowed", opacity: pk.input?.trim() ? 1 : 0.5 }}>
                    ✓
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Brand config (per site) ── */}
      <div style={{ background: site ? site.bg : C.bg, border: `1px solid ${site ? site.color + "33" : C.border}`, borderRadius: 14, padding: "16px 20px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: brandEditing ? 14 : 0 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: site?.color }}>🏷️ {site?.label}</span>
            {brand?.brand_name && !brandEditing && (
              <>
                <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>Marque : <strong>{brand.brand_name}</strong></span>
                {brand.competitors?.length > 0 && <span style={{ fontSize: 11, color: C.textLight }}>{brand.competitors.length} concurrent{brand.competitors.length > 1 ? "s" : ""} trackés</span>}
              </>
            )}
            {!brand?.brand_name && !brandEditing && <span style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucune marque configurée pour ce site</span>}
          </div>
          <Btn onClick={() => setBrandEditing(e => !e)} variant="outline" small color={site?.color || C.blue}>
            {brandEditing ? "Annuler" : brand ? "✏️ Modifier" : "➕ Configurer"}
          </Btn>
        </div>

        {brandEditing && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { key: "brand_name",   label: "Nom de la marque",                   placeholder: "Altaroc" },
              { key: "brand_domain", label: "Domaine du site",                     placeholder: "altaroc.com" },
              { key: "brand_aliases", label: "Alias (séparés par virgules)",       placeholder: "Altaroc Capital, altaroc.com" },
              { key: "competitors",  label: "Concurrents à tracker (virgules)",    placeholder: "Moonfare, Titanbay, iCapital" },
              { key: "context",      label: "Contexte (instruction système)",      placeholder: "Tu es un investisseur particulier français…" },
            ].map(f => (
              <div key={f.key} style={{ gridColumn: f.key === "context" ? "1 / -1" : "auto" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, marginBottom: 5 }}>{f.label}</div>
                {f.key === "context"
                  ? <textarea value={brandDraft[f.key]} onChange={e => setBrandDraft(d => ({ ...d, [f.key]: e.target.value }))} placeholder={f.placeholder} rows={2} style={{ width: "100%", padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
                  : <input value={brandDraft[f.key]} onChange={e => setBrandDraft(d => ({ ...d, [f.key]: e.target.value }))} placeholder={f.placeholder} style={{ width: "100%", padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text, boxSizing: "border-box" }} />
                }
              </div>
            ))}
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <Btn onClick={saveBrand} color={site?.color || C.blue}>💾 Sauvegarder</Btn>
            </div>
          </div>
        )}
      </div>

      {/* ── Axes editor ── */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 20px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 2 }}>Axes de génération des questions</div>
            {!axesEditing && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {axes.map((a, i) => (
                  <span key={i} style={{ fontSize: 11, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "2px 9px", color: C.textMid }}>
                    {i + 1}. {a}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Btn onClick={() => { setAxesDraft([...axes]); setAxesEditing(e => !e); }} variant="outline" small color={C.blue}>
            {axesEditing ? "Annuler" : "✏️ Modifier"}
          </Btn>
        </div>

        {axesEditing && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: C.textLight, marginBottom: 10 }}>
              Un axe par ligne · utilisé comme instruction de génération pour chaque mot-clé
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              {(axesDraft || axes).map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: C.textLight, minWidth: 20, textAlign: "right" }}>{i + 1}.</span>
                  <input
                    value={a}
                    onChange={e => setAxesDraft(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                    style={{ flex: 1, padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, color: C.text }}
                  />
                  <button
                    onClick={() => setAxesDraft(prev => prev.filter((_, j) => j !== i))}
                    style={{ padding: "4px 8px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.textLight, fontSize: 11, cursor: "pointer" }}
                  >✕</button>
                </div>
              ))}
              {(axesDraft || axes).length < 10 && (
                <button
                  onClick={() => setAxesDraft(prev => [...prev, ""])}
                  style={{ marginLeft: 28, padding: "5px 12px", border: `1px dashed ${C.border}`, borderRadius: 7, background: C.white, color: C.textLight, fontSize: 11, cursor: "pointer", textAlign: "left" }}
                >+ Ajouter un axe</button>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Btn onClick={async () => {
                const cleaned = (axesDraft || []).map(a => a.trim()).filter(Boolean);
                if (!cleaned.length) return;
                setAxes(cleaned);
                setAxesEditing(false);
                await onSaveAxes?.(cleaned);
              }} color="#059669">💾 Sauvegarder</Btn>
              <button onClick={() => { setAxesDraft([...DEFAULT_AXES]); }} style={{ padding: "6px 12px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.textLight, fontSize: 12, cursor: "pointer" }}>
                ↺ Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Sub-nav ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: C.bg, borderRadius: 10, padding: 4, width: "fit-content" }}>
        {[
          { key: "keywords",  label: "🔑 Mots-clés" },
          { key: "questions", label: "💬 Questions" },
          { key: "urls",      label: "🔗 Sources citées" },
        ].map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)} style={{
            padding: "7px 18px", borderRadius: 7, fontSize: 13, fontWeight: subTab === t.key ? 700 : 500,
            border: "none", cursor: "pointer",
            background: subTab === t.key ? C.white : "transparent",
            color: subTab === t.key ? C.text : C.textLight,
            boxShadow: subTab === t.key ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
            transition: "all 0.15s",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Sub-tabs ── */}
      {subTab === "keywords" && (
        <KeywordsTab
          site={site}
          projectId={projectId}
          apiKey={apiKeyDec}
          model={model}
          axes={axes}
          context={brand?.context || ""}
          categories={categories}
          setCategories={setCategories}
          onQuestionsGenerated={() => { setQuestionsKey(k => k + 1); setSubTab("questions"); }}
        />
      )}
      {subTab === "questions" && (
        <QuestionsTab
          key={questionsKey}
          site={site}
          projectId={projectId}
          apiKey={apiKeyDec}
          model={model}
          brand={brand}
          categories={categories}
          allResults={allResults.filter(r => r.site_id === site?.id)}
          onResultSaved={() => sbGetGeoResults(projectId, site.id).then(setAllResults)}
          activeProviders={activeProviders}
          providerKeys={providerKeys}
          runMode={runMode}
        />
      )}
      {subTab === "urls" && (
        <UrlsTab
          projectId={projectId}
          categories={categories}
          brand={brand}
          allResults={allResults.filter(r => r.site_id === site?.id)}
        />
      )}
    </div>
  );
}