import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { C } from "../lib/constants";
import {
  sbSaveBrand, sbGetBrand, sbSaveOpenAIKey,
  sbSaveKeywords, sbGetKeywords, sbUpdateKeywordStatus, sbDeleteKeyword,
  sbSaveQuestions, sbGetQuestions, sbUpdateQuestion, sbDeleteQuestion,
  sbSaveGeoResult, sbGetGeoResults,
  sbGetCategories, sbSaveCategory, sbDeleteCategory,
  sbSetKeywordCategory, sbSetQuestionCategory,
  sbBulkSetKeywordCategory, sbBulkSetQuestionCategory,
  sbGetUrlIndex, sbUpdateUrlMeta, sbIncrementUrlCounts,
} from "../lib/supabase";
// Note: sbSaveGeoAxes is called via onSaveAxes prop from App.jsx



const DEFAULT_AXES = ["Quoi ?", "Pourquoi ?", "Comment ?", "Comparaison", "Coût/budget"];

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

const OPENAI_MODELS = [
  { value: "gpt-4o-mini",       label: "GPT-4o Mini (rapide, peu cher)" },
  { value: "gpt-4o",            label: "GPT-4o (précis)" },
  { value: "gpt-4.1",           label: "GPT-4.1" },
];

async function callOpenAI({ apiKey, model, prompt, endpoint = "responses" }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      answer:       { type: "string" },
      answer_type:  { type: "string" },
      sources:      { type: "array", items: { type: "string" } },
      intent_type:  { type: "string", enum: ["Top", "Informative", "Conseil"] },
      source_types: {
        type: "array",
        items: { type: "string", enum: ["Annuaires", "Sites marchands", "Articles de blog", "Sites institutionnels", "Forums", "Médias", "Autres"] }
      }
    },
    required: ["answer", "answer_type", "sources", "intent_type", "source_types"]
  };

  const body = endpoint === "responses"
    ? {
        model,
        input: prompt,
        tools: [{ type: "web_search_preview", search_context_size: "low" }],
        max_output_tokens: 10000,
        text: { format: { type: "json_schema", name: "geo_answer", strict: true, schema } }
      }
    : {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 1,
      };

  const res = await fetch("/api/openai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Openai-Key": apiKey,
      "X-Openai-Endpoint": endpoint,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (text.trimStart().startsWith("<")) throw new Error("Proxy /api/openai introuvable — ajoutez openai-proxy.js dans netlify/edge-functions/");
  const data = JSON.parse(text);
  if (!res.ok) throw new Error(data.error?.message || data.error || `HTTP ${res.status}`);
  return data;
}

function parseOpenAIResponse(data, endpoint = "responses") {
  const usage = data.usage || {};
  const inTok = usage.input_tokens || usage.prompt_tokens || 0;
  const outTok = usage.output_tokens || usage.completion_tokens || 0;

  let text = "";
  if (endpoint === "responses") {
    for (const item of data.output || []) {
      if (item.type !== "message") continue;
      for (const part of item.content || []) {
        if (part.type === "output_text") text += part.text;
      }
    }
  } else {
    text = data.choices?.[0]?.message?.content || "";
  }

  // Extract JSON
  const s = text.lastIndexOf("{");
  const e = text.lastIndexOf("}");
  if (s !== -1 && e > s) text = text.substring(s, e + 1);

  const HALLUCINATION = [/exemple\d*\./i, /example\d*\./i, /site\d+\./i, /domaine\d*\./i, /placeholder/i];
  const parsed = JSON.parse(text);
  parsed.sources = (parsed.sources || []).filter(u => !HALLUCINATION.some(p => p.test(u)));
  parsed._input_tokens = inTok;
  parsed._output_tokens = outTok;
  return parsed;
}

// ── Brand detection ───────────────────────────────────────────────

function detectBrand(answer, sources, brandName, brandAliases = [], competitors = []) {
  const allBrandTerms = [brandName, ...brandAliases].filter(Boolean).map(t => t.toLowerCase().trim());
  const allCompetitors = competitors.filter(Boolean).map(t => t.toLowerCase().trim());

  const answerLower = answer.toLowerCase();

  // Find brand mention position in fan-out (numbered list detection)
  // Fan-out = numbered items like "1. Brand\n2. Other..."
  const lines = answer.split("\n").map(l => l.trim()).filter(Boolean);
  let brandPosition = null;
  let pos = 0;
  for (const line of lines) {
    const isListItem = /^(\d+[.)]|[-•*])/.test(line);
    if (isListItem) {
      pos++;
      const lineLower = line.toLowerCase();
      if (allBrandTerms.some(t => lineLower.includes(t))) {
        brandPosition = pos;
        break;
      }
    }
  }

  const brandMentioned = allBrandTerms.some(t => answerLower.includes(t));
  const brandInSources = sources.some(s => allBrandTerms.some(t => s.toLowerCase().includes(t)));

  const competitorsMentioned = allCompetitors
    .map(name => {
      let cpos = null;
      let cp = 0;
      for (const line of lines) {
        if (/^(\d+[.)]|[-•*])/.test(line)) {
          cp++;
          if (line.toLowerCase().includes(name)) { cpos = cp; break; }
        }
      }
      return {
        name,
        mentioned: answerLower.includes(name),
        position: cpos,
        in_sources: sources.some(s => s.toLowerCase().includes(name)),
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
  const withBrand   = results.filter(r => r.brand_mentioned).length;
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
      const axesStr = (axes && axes.length ? axes : DEFAULT_AXES).map((t, i) => `${i+1}. ${t}`).join("\n");
      const prompt = `Transforme le mot-clé "${kw.keyword}" en 5 questions courtes et naturelles pour un moteur de recherche IA.\nRespects ces axes :\n${axesStr}\nContraintes : maximum 12 mots par question, langage direct.\nRéponds UNIQUEMENT avec les 5 questions séparées par des points-virgules (;), sans numérotation, sans texte avant ou après.`;

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

// ── Result card ───────────────────────────────────────────────────

function ResultCard({ result, brandName, brandAliases }) {
  const [open, setOpen] = useState(false);
  const sources = result.sources || [];
  const comps = result.competitors_mentioned || [];
  return (
    <div style={{ marginTop: 10, background: C.bg, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: open ? C.blue : C.textLight, display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
        <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: C.textLight }}>{result.model}</span>
          {result.brand_mentioned && <Pill color="#059669">✓ {brandName} #{result.brand_position || "?"}</Pill>}
          {!result.brand_mentioned && <Pill color="#DC2626">✗ Absent</Pill>}
          {result.brand_in_sources && <Pill color="#2563EB">🔗 Source</Pill>}
          {result.answer_type && <Pill color={C.textLight}>{result.answer_type}</Pill>}
          {result.intent_type && <Pill color="#7C3AED">{result.intent_type}</Pill>}
        </div>
        <span style={{ fontSize: 10, color: C.textLight, flexShrink: 0 }}>{(result.input_tokens || 0) + (result.output_tokens || 0)} tok</span>
      </div>
      {open && (
        <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ marginTop: 12, fontSize: 12, color: C.text, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {highlightBrand(result.answer || "", brandName, brandAliases)}
          </div>
          {sources.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Sources</div>
              {sources.map((url, i) => {
                const isBrand = [brandName, ...(brandAliases || [])].some(t => url.toLowerCase().includes((t || "").toLowerCase()));
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: C.textLight, minWidth: 18 }}>[{i+1}]</span>
                    <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: isBrand ? "#059669" : "#2563EB", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</a>
                    {isBrand && <span style={{ fontSize: 10, background: "#ECFDF5", color: "#059669", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>marque</span>}
                  </div>
                );
              })}
            </div>
          )}
          {comps.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Concurrents cités</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {comps.map(c => (
                  <span key={c.name} style={{ fontSize: 10, background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: 5, padding: "2px 8px" }}>
                    {c.name}{c.position ? ` #${c.position}` : ""}
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

function QuestionsTab({ site, projectId, apiKey, model, brand, categories, allResults, onResultSaved }) {
  const [questions, setQuestions]   = useState([]);
  const [results, setResults]       = useState(allResults || []);
  const [manualQ, setManualQ]       = useState("");
  const [filterFav, setFilterFav]   = useState(false);
  const [filterBrand, setFilterBrand] = useState(false);
  const [filterCat, setFilterCat]   = useState("");
  const [running, setRunning]       = useState({});
  const [runAll, setRunAll]         = useState(false);
  const [selected, setSelected]     = useState(new Set());
  const [bulkCat, setBulkCat]       = useState("");
  const [keywords, setKeywords]     = useState([]);

  useEffect(() => { setResults(allResults || []); }, [allResults]);

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

  const runQuestion = useCallback(async (q) => {
    if (!apiKey) return;
    const { brand_name = "", brand_aliases = [], competitors = [], context = "" } = brand || {};
    setRunning(r => ({ ...r, [q.id]: true }));
    const prompt = [
      context ? `Contexte : "${context}"` : "",
      "Tu es ChatGPT. Réponds à la question suivante exactement comme tu le ferais dans l'interface ChatGPT avec accès au web.",
      "RÈGLE ABSOLUE : Ne pose jamais de question de clarification. Choisis l'interprétation la plus probable et réponds directement.",
      "ÉTAPE 1 — Recherche web puis réponse. Insère les marqueurs [1], [2]… dans le texte. La liste 'sources' reprend les URLs dans l'ordre. Ne pas inventer d'URLs.",
      "ÉTAPE 2 — Classification JSON : intent_type (Top|Informative|Conseil), answer_type, source_types.",
      "Produis UNIQUEMENT le JSON final. Aucun texte avant ou après.",
      `Question : ${q.question}`,
    ].filter(Boolean).join("\n");
    try {
      const data = await callOpenAI({ apiKey, model, prompt, endpoint: "responses" });
      const parsed = parseOpenAIResponse(data, "responses");
      const { brandMentioned, brandPosition, brandInSources, competitorsMentioned } = detectBrand(parsed.answer, parsed.sources, brand_name, brand_aliases, competitors);

      // Update URL index
      const domain_counts = {};
      (parsed.sources || []).forEach(url => {
        const domain = extractDomain(url);
        if (!domain_counts[url]) domain_counts[url] = { as_source: 0, in_answer: 0, domain };
        domain_counts[url].as_source++;
      });
      await Promise.all(Object.entries(domain_counts).map(([url, counts]) =>
        sbIncrementUrlCounts(projectId, url, counts)
      ));

      const record = {
        question_id: q.id, project_id: projectId, site_id: site.id, model,
        answer: parsed.answer, answer_type: parsed.answer_type, intent_type: parsed.intent_type,
        sources: parsed.sources, source_types: parsed.source_types,
        brand_mentioned: brandMentioned, brand_position: brandPosition,
        brand_in_sources: brandInSources, competitors_mentioned: competitorsMentioned,
        input_tokens: parsed._input_tokens, output_tokens: parsed._output_tokens,
      };
      const saved = await sbSaveGeoResult(record);
      const newResult = Array.isArray(saved) ? saved[0] : saved;
      setResults(prev => [newResult, ...prev]);
      await sbUpdateQuestion(q.id, { has_result: true });
      setQuestions(prev => prev.map(qq => qq.id === q.id ? { ...qq, has_result: true } : qq));
      onResultSaved?.();
    } catch(e) { console.error("runQuestion error:", e); setRunning(r => ({ ...r, [q.id]: false })); }
    setRunning(r => ({ ...r, [q.id]: false }));
  }, [apiKey, model, brand, projectId, site?.id, onResultSaved]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAllQuestions = async () => {
    setRunAll(true);
    const toRun = filtered.filter(q => !(resultsByQ[q.id]?.length));
    for (const q of toRun) {
      if (!runAll) break;
      await runQuestion(q);
    }
    setRunAll(false);
  };

  const filtered = useMemo(() => questions.filter(q => {
    if (filterFav && !q.is_favorite) return false;
    if (filterCat && q.category_id !== filterCat) return false;
    if (filterBrand) {
      const qRes = resultsByQ[q.id] || [];
      if (!qRes.some(r => r.brand_mentioned)) return false;
    }
    return true;
  }), [questions, filterFav, filterBrand, filterCat, resultsByQ]);

  const { brand_name = "", brand_aliases = [] } = brand || {};
  const totalWithBrand = questions.filter(q => (resultsByQ[q.id] || []).some(r => r.brand_mentioned)).length;

  return (
    <div>
      {/* Manual question input */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 10 }}>
        <input value={manualQ} onChange={e => setManualQ(e.target.value)} onKeyDown={e => e.key === "Enter" && addManual()}
          placeholder="Ajouter une question manuellement…"
          style={{ flex: 1, padding: "7px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text }} />
        <Btn onClick={addManual} disabled={!manualQ.trim()}>➕ Ajouter</Btn>
      </div>

      {/* Filters + bulk actions */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: C.textLight }}>
          {filtered.length} question{filtered.length > 1 ? "s" : ""}
          {" · "}{totalWithBrand} avec {brand_name || "marque"}
          {selected.size > 0 && <strong style={{ color: C.text }}> · {selected.size} sélectionnée{selected.size > 1 ? "s" : ""}</strong>}
        </span>

        <Pill color="#F59E0B" active={filterFav} onClick={() => setFilterFav(f => !f)}>⭐ Favoris</Pill>
        <Pill color="#059669" active={filterBrand} onClick={() => setFilterBrand(f => !f)}>✓ Marque présente</Pill>
        <CatSelect value={filterCat} categories={[{ id: "", name: "Toutes catégories" }, ...categories]} onChange={v => setFilterCat(v || "")} placeholder="Toutes catégories" />

        {/* Bulk selection + categorization */}
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setSelected(new Set(filtered.map(q => q.id)))} style={{ fontSize: 11, padding: "3px 8px", border: `1px solid ${C.border}`, borderRadius: 5, background: C.white, cursor: "pointer", color: C.textMid }}>Tout sélect.</button>
          {selected.size > 0 && <button onClick={() => setSelected(new Set())} style={{ fontSize: 11, padding: "3px 8px", border: `1px solid ${C.border}`, borderRadius: 5, background: C.white, cursor: "pointer", color: C.textMid }}>Désélect.</button>}
        </div>
        {selected.size > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <CatSelect value={bulkCat} categories={categories} onChange={setBulkCat} placeholder="Appliquer catégorie…" />
            <Btn onClick={applyBulkCat} small color="#7C3AED">Appliquer</Btn>
          </div>
        )}

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Btn onClick={runAllQuestions} disabled={runAll || !apiKey} color="#7C3AED">{runAll ? "⏳ En cours…" : "▶ Lancer tout"}</Btn>
          {runAll && <Btn onClick={() => setRunAll(false)} color="#DC2626" variant="outline" small>⏹ Arrêter</Btn>}
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
            const hasBrand = qResults.some(r => r.brand_mentioned);
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
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.5 }}>{q.question}</div>
                    <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                      {kwTag && <span style={{ fontSize: 10, color: C.textLight, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "1px 7px" }}>🔑 {kwTag.keyword}</span>}
                      {cat && <span style={{ fontSize: 10, fontWeight: 700, color: cat.color, background: cat.color + "18", border: `1px solid ${cat.color}44`, borderRadius: 10, padding: "1px 7px" }}>{cat.name}</span>}
                      {q.is_manual && <Pill color={C.textLight}>manuel</Pill>}
                      {hasBrand && <Pill color="#059669">✓ {brand_name}</Pill>}
                      {qResults.length > 0 && <span style={{ fontSize: 10, color: C.textLight }}>{qResults.length} résultat{qResults.length > 1 ? "s" : ""}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 5, flexShrink: 0, alignItems: "center" }}>
                    <CatSelect value={q.category_id} categories={categories} onChange={v => setCatSingle(q.id, v)} />
                    <Btn onClick={() => runQuestion(q)} disabled={isRunning || !apiKey} color={site.color} small>{isRunning ? "⏳" : "▶"}</Btn>
                    <button onClick={() => deleteQ(q.id)} style={{ padding: "3px 7px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.textLight, fontSize: 10, cursor: "pointer" }}>🗑</button>
                  </div>
                </div>
                {qResults.map(r => <ResultCard key={r.id} result={r} brandName={brand_name} brandAliases={brand_aliases} />)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── URL Index sub-tab ─────────────────────────────────────────────

const TEMPLATE_TYPES = ["article","landing","fiche","FAQ","comparatif","forum","media","institutionnel","autre"];

function UrlsTab({ projectId, categories }) {
  const [urls, setUrls]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState({}); // urlId → true
  const [filterCat, setFilterCat] = useState("");
  const [filterTpl, setFilterTpl] = useState("");
  const [search, setSearch]   = useState("");
  const [openCrawl, setOpenCrawl] = useState(null); // urlId with open crawl panel

  useEffect(() => {
    if (!projectId) return;
    sbGetUrlIndex(projectId).then(data => { setUrls(data); setLoading(false); });
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      console.error("Crawl échoué : ", e.message);
    }
    setCrawling(c => ({ ...c, [urlEntry.id]: false }));
  };

  const filtered = useMemo(() => urls.filter(u => {
    if (filterCat && u.theme_category_id !== filterCat) return false;
    if (filterTpl && u.template_type !== filterTpl) return false;
    if (search && !u.url.toLowerCase().includes(search.toLowerCase()) && !u.domain?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [urls, filterCat, filterTpl, search]);

  const topDomains = useMemo(() => {
    const m = {};
    urls.forEach(u => { if (u.domain) m[u.domain] = (m[u.domain] || 0) + u.count_as_source + u.count_in_answer; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [urls]);

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: C.textLight, fontSize: 12 }}>Chargement des URLs…</div>;

  if (!urls.length) return (
    <div style={{ textAlign: "center", padding: 60, color: C.textLight }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>Aucune URL indexée</div>
      <div style={{ fontSize: 12 }}>Interrogez des questions pour voir apparaître les URLs citées</div>
    </div>
  );

  return (
    <div>
      {/* Top domains summary */}
      {topDomains.length > 0 && (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 20px", marginBottom: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7 }}>Top domaines</span>
          {topDomains.map(([d, cnt]) => (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 12, color: "#2563EB", fontWeight: 600 }}>{d}</span>
              <span style={{ fontSize: 11, color: C.textLight, background: C.bg, borderRadius: 10, padding: "1px 7px" }}>{cnt}×</span>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher une URL ou domaine…"
          style={{ padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text, width: 260 }} />
        <CatSelect value={filterCat} categories={[{ id: "", name: "Tous thèmes" }, ...categories]} onChange={v => setFilterCat(v || "")} placeholder="Tous thèmes" />
        <select value={filterTpl} onChange={e => setFilterTpl(e.target.value)}
          style={{ padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, color: C.text }}>
          <option value="">Tous templates</option>
          {TEMPLATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ fontSize: 11, color: C.textLight, marginLeft: "auto" }}>{filtered.length} URL{filtered.length > 1 ? "s" : ""}</span>
      </div>

      {/* URL list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filtered.map(u => {
          const cat = categories.find(c => c.id === u.theme_category_id);
          const isOpen = openCrawl === u.id;
          const hasSections = u.crawl_sections?.length > 0;
          return (
            <div key={u.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", flexWrap: "wrap" }}>
                {/* Counts */}
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, background: "#EFF6FF", color: "#2563EB", borderRadius: 5, padding: "2px 8px" }} title="Fois cité en source">📎 {u.count_as_source}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, background: "#F5F3FF", color: "#7C3AED", borderRadius: 5, padding: "2px 8px" }} title="Fois dans le texte de réponse">💬 {u.count_in_answer}</span>
                </div>

                {/* URL */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <a href={u.url} target="_blank" rel="noreferrer"
                      style={{ fontSize: 12, color: "#2563EB", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none", display: "block" }}>
                      {u.url}
                    </a>
                    <a href={u.url} target="_blank" rel="noreferrer" style={{ flexShrink: 0, fontSize: 10, color: C.textLight, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px", textDecoration: "none" }}>↗</a>
                  </div>
                  <div style={{ fontSize: 11, color: C.textLight }}>{u.domain}</div>
                </div>

                {/* Category + template selectors */}
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
                  {cat && <span style={{ fontSize: 10, fontWeight: 700, color: cat.color, background: cat.color + "18", border: `1px solid ${cat.color}44`, borderRadius: 10, padding: "1px 7px" }}>{cat.name}</span>}
                  <CatSelect value={u.theme_category_id} categories={categories} onChange={v => setThemeCat(u.id, v)} placeholder="Thème…" />
                  <select value={u.template_type || ""} onChange={e => setTemplate(u.id, e.target.value || null)}
                    style={{ padding: "4px 7px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, color: u.template_type ? C.text : C.textLight }}>
                    <option value="">Template…</option>
                    {TEMPLATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                {/* Crawl button */}
                <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                  {hasSections && (
                    <button onClick={() => setOpenCrawl(isOpen ? null : u.id)}
                      style={{ padding: "4px 9px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, cursor: "pointer", background: isOpen ? C.bg : C.white, color: C.textMid }}>
                      {isOpen ? "▲ Sections" : "▼ Sections"}
                    </button>
                  )}
                  <Btn onClick={() => launchCrawl(u)} disabled={crawling[u.id]} color="#059669" small>
                    {crawling[u.id] ? "⏳" : u.crawl_status === "done" ? "🔄 Re-crawl" : "🕷️ Crawler"}
                  </Btn>
                </div>
              </div>

              {/* Crawl sections panel */}
              {isOpen && hasSections && (
                <div style={{ borderTop: `1px solid ${C.border}`, background: C.bg, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>
                    Sections détectées · {u.crawl_sections.length}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                    {u.crawl_sections.map((sec, i) => (
                      <div key={i} style={{ background: C.white, border: `1px solid ${sec.used_in_llm ? "#059669" : C.border}`, borderRadius: 8, padding: "10px 12px", borderLeft: `3px solid ${sec.used_in_llm ? "#059669" : C.border}` }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED", background: "#F5F3FF", borderRadius: 4, padding: "1px 6px" }}>{sec.type}</span>
                          {sec.used_in_llm && <span style={{ fontSize: 10, color: "#059669", fontWeight: 600 }}>✓ utilisé par LLM</span>}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 3 }}>{sec.title}</div>
                        <div style={{ fontSize: 11, color: C.textLight, lineHeight: 1.5 }}>{sec.summary}</div>
                        {sec.used_in_llm_reason && <div style={{ fontSize: 10, color: "#059669", marginTop: 4, fontStyle: "italic" }}>{sec.used_in_llm_reason}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main GeoTab ───────────────────────────────────────────────────

export default function GeoTab({ sites, projectId, project, geoAxes, onSaveAxes }) {
  const [subTab, setSubTab]         = useState("keywords"); // keywords | questions | urls
  const [questionsKey, setQuestionsKey] = useState(0); // incremented to force QuestionsTab reload
  const [selectedSite, setSelectedSite] = useState(sites[0]?.id || "");
  const [model, setModel]           = useState("gpt-4o-mini");
  const [brand, setBrand]           = useState(null);         // { brand_name, brand_aliases, competitors, context }
  const [apiKeyEnc, setApiKeyEnc]   = useState(project?.openai_key_enc || "");

  // Sync enc key when project prop updates (e.g. after Supabase load on mount)
  useEffect(() => {
    if (project?.openai_key_enc && project.openai_key_enc !== apiKeyEnc) {
      console.log("Syncing OpenAI key from project prop");
      setApiKeyEnc(project.openai_key_enc);
    }
  }, [project?.openai_key_enc]); // eslint-disable-line react-hooks/exhaustive-deps
  const [apiKeyDec, setApiKeyDec]   = useState("");           // decrypted, only in memory
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keyStatus, setKeyStatus]   = useState("idle");       // idle | saving | ok | error
  const [allResults, setAllResults] = useState([]);
  const [brandEditing, setBrandEditing] = useState(false);
  const [brandDraft, setBrandDraft] = useState({ brand_name: "", brand_aliases: "", competitors: "", context: "" });
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
      if (b) setBrandDraft({ brand_name: b.brand_name || "", brand_aliases: (b.brand_aliases || []).join(", "), competitors: (b.competitors || []).join(", "), context: b.context || "" });
    });
    sbGetGeoResults(projectId, site.id).then(setAllResults);
  }, [projectId, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Decode key when enc changes
  useEffect(() => {
    if (!apiKeyEnc) return;
    const k = decodeKey(apiKeyEnc);
    console.log("OpenAI key loaded, prefix:", k.slice(0, 10));
    setApiKeyDec(k);
    setKeyStatus(k.startsWith("sk-") ? "ok" : "error");
  }, [apiKeyEnc]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveApiKey = async () => {
    const k = apiKeyInput.trim();
    if (!k.startsWith("sk-") && !k.startsWith("sk_")) { setKeyStatus("error"); return; }
    setKeyStatus("saving");
    try {
      const enc = encodeKey(k);
      await sbSaveOpenAIKey(projectId, enc);
      setApiKeyEnc(enc);
      setApiKeyDec(k);
      setApiKeyInput("");
      setKeyStatus("ok");
      console.log("✓ OpenAI key saved, prefix:", k.slice(0, 10));
    } catch(e) { console.error("saveApiKey error:", e); setKeyStatus("error"); }
  };

  const saveBrand = async () => {
    const b = {
      project_id: projectId, site_id: site.id,
      brand_name: brandDraft.brand_name.trim(),
      brand_aliases: brandDraft.brand_aliases.split(",").map(s => s.trim()).filter(Boolean),
      competitors:   brandDraft.competitors.split(",").map(s => s.trim()).filter(Boolean),
      context:       brandDraft.context.trim(),
    };
    await sbSaveBrand(b);
    setBrand(b);
    setBrandEditing(false);
  };

  const hasKey = !!apiKeyDec;

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 4 }}>🔍 Étude des Fan-outs</div>
        <div style={{ fontSize: 12, color: C.textLight }}>Analysez la présence de vos marques dans les réponses ChatGPT</div>
      </div>

      {/* ── Config strip: site + model + API key ── */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 20px", marginBottom: 20, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>

        {/* Site selector */}
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

        {/* Model selector */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 5 }}>Modèle</div>
          <select value={model} onChange={e => setModel(e.target.value)} style={{ padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text }}>
            {OPENAI_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>

        {/* API Key */}
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 5 }}>
            Clé OpenAI{" "}
            {hasKey && <span style={{ color: "#059669", marginLeft: 4 }}>● Configurée ({apiKeyDec.slice(0, 10)}…)</span>}
            {!hasKey && apiKeyEnc && <span style={{ color: "#DC2626", marginLeft: 4 }}>● Décodage échoué</span>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="password" value={apiKeyInput} onChange={e => { setApiKeyInput(e.target.value); setKeyStatus("idle"); }}
              placeholder={hasKey ? "Remplacer la clé…" : "sk-…"}
              style={{ flex: 1, padding: "6px 10px", border: `1px solid ${keyStatus === "error" ? "#DC2626" : C.border}`, borderRadius: 8, fontSize: 12, color: C.text }}
            />
            <Btn onClick={saveApiKey} disabled={keyStatus === "saving" || !apiKeyInput.trim()} color="#059669" small>
              {keyStatus === "saving" ? "…" : keyStatus === "ok" ? "✓" : "Sauvegarder"}
            </Btn>
          </div>
          {keyStatus === "error" && <div style={{ fontSize: 10, color: "#DC2626", marginTop: 3 }}>Clé invalide (doit commencer par sk-)</div>}
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

      {/* ── Stats header ── */}
      <StatsHeader questions={[]} results={allResults.filter(r => r.site_id === site?.id)} brandName={brand?.brand_name || ""} />

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
          { key: "urls",      label: "🔗 URLs citées" },
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
        />
      )}
      {subTab === "urls" && (
        <UrlsTab
          projectId={projectId}
          categories={categories}
        />
      )}
    </div>
  );
}