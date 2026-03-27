import { useState, useEffect, useCallback, useMemo } from "react";
import { C } from "../lib/constants";
import {
  sbSaveBrand, sbGetBrand, sbSaveOpenAIKey,
  sbSaveKeywords, sbGetKeywords, sbUpdateKeywordStatus, sbDeleteKeyword,
  sbSaveQuestions, sbGetQuestions, sbUpdateQuestion, sbDeleteQuestion,
  sbSaveGeoResult, sbGetGeoResults,
} from "../lib/supabase";

// ── Crypto helpers (AES-GCM via WebCrypto) ───────────────────────

const CRYPTO_SALT = "correldash-geo-v1";

async function deriveKey(password) {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(CRYPTO_SALT), iterations: 100000, hash: "SHA-256" },
    keyMat, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

async function encryptKey(apiKey, password) {
  const key  = await deriveKey(password);
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const enc  = new TextEncoder();
  const ct   = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(apiKey));
  const buf  = new Uint8Array([...iv, ...new Uint8Array(ct)]);
  return btoa(String.fromCharCode(...buf));
}

async function decryptKey(enc64, password) {
  const buf  = Uint8Array.from(atob(enc64), c => c.charCodeAt(0));
  const iv   = buf.slice(0, 12);
  const ct   = buf.slice(12);
  const key  = await deriveKey(password);
  const pt   = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// Derive a per-project password from the project ID (deterministic, no extra secret needed)
function projectPassword(projectId) { return `cgeo-${projectId}-v1`; }

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
        response_format: { type: "json_object" }
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

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
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
    generating_q:  { label: "Génération Q…", color: "#D97706", bg: "#FFFBEB" },
    done_q:        { label: "Questions OK",  color: "#059669", bg: "#ECFDF5" },
    generating_r:  { label: "Appel LLM…",   color: "#7C3AED", bg: "#F5F3FF" },
    done:          { label: "Terminé",       color: "#2563EB", bg: "#EFF6FF" },
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

// ── Keywords sub-tab ─────────────────────────────────────────────

function KeywordsTab({ site, projectId, apiKey, model, context, onQuestionsGenerated }) {
  const [keywords, setKeywords] = useState([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [busy, setBusy]         = useState({}); // kwId → true

  // Load from Supabase
  useEffect(() => {
    if (!projectId || !site?.id) return;
    sbGetKeywords(projectId, site.id).then(setKeywords);
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
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const generateQuestions = async (kw, axes) => {
    if (!apiKey) { alert("Clé OpenAI manquante — configure-la dans ⚙️ Setup"); return; }
    setBusy(b => ({ ...b, [kw.id]: "q" }));
    await sbUpdateKeywordStatus(kw.id, "generating_q");
    setKeywords(prev => prev.map(k => k.id === kw.id ? { ...k, status: "generating_q" } : k));
    try {
      const axesStr = (axes || ["Quoi ?", "Pourquoi ?", "Comment ?", "Comparaison", "Coût/budget"]).map((t, i) => `${i+1}. ${t}`).join("\n");
      const prompt = `Tu es un utilisateur de ChatGPT. ${context || ""}. Tu poses des questions directes, courtes et sans fioritures.\nTransforme le mot-clé "${kw.keyword}" en 5 questions ultra-courtes pour un LLM.\nRespects ces axes :\n${axesStr}\nMaximum 12 mots par question. Langage naturel et direct.\nRéponds uniquement par les 5 questions séparées par des points-virgules (;).`;

      const data = await callOpenAI({ apiKey, model, prompt, endpoint: "completions" });
      const text = data.choices?.[0]?.message?.content || "";
      const questions = text.split(";").map(s => s.trim()).filter(Boolean);

      if (questions.length) {
        const qRows = questions.map(q => ({
          project_id: projectId, site_id: site.id,
          keyword_id: kw.id, question: q, is_manual: false,
        }));
        await sbSaveQuestions(qRows);
        onQuestionsGenerated?.();
      }

      await sbUpdateKeywordStatus(kw.id, "done_q");
      setKeywords(prev => prev.map(k => k.id === kw.id ? { ...k, status: "done_q" } : k));
    } catch (e) {
      console.error(e);
      await sbUpdateKeywordStatus(kw.id, "pending");
      setKeywords(prev => prev.map(k => k.id === kw.id ? { ...k, status: "pending" } : k));
    }
    setBusy(b => ({ ...b, [kw.id]: false }));
  };

  const deleteKw = async (id) => {
    await sbDeleteKeyword(id);
    setKeywords(prev => prev.filter(k => k.id !== id));
  };

  return (
    <div>
      {/* Input area */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.textMid, marginBottom: 8 }}>Ajouter des mots-clés</div>
        <div style={{ fontSize: 11, color: C.textLight, marginBottom: 10 }}>Un mot-clé par ligne</div>
        <textarea
          value={input} onChange={e => setInput(e.target.value)}
          placeholder={"meilleur logiciel CRM\nalternative Salesforce\ncomparer CRM PME"}
          style={{ width: "100%", minHeight: 100, padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
        />
        <div style={{ marginTop: 10 }}>
          <Btn onClick={addKeywords} disabled={loading || !input.trim()}>
            {loading ? "Ajout…" : "➕ Ajouter"}
          </Btn>
        </div>
      </div>

      {/* Keywords list */}
      {keywords.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: C.textLight, fontSize: 12 }}>
          Aucun mot-clé pour ce site — ajoutez-en ci-dessus
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {keywords.map(kw => (
            <div key={kw.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{kw.keyword}</div>
                <div style={{ marginTop: 4 }}><StatusBadge status={kw.status} /></div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
                <Btn
                  onClick={() => generateQuestions(kw, null)}
                  disabled={!!busy[kw.id] || !apiKey}
                  variant="outline" small
                  color={site.color}
                >
                  {busy[kw.id] === "q" ? "⏳ Génération…" : "💬 Générer questions"}
                </Btn>
                <button onClick={() => deleteKw(kw.id)} style={{ padding: "4px 8px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.textLight, fontSize: 11, cursor: "pointer" }}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Question result card ──────────────────────────────────────────

function ResultCard({ result, brandName, brandAliases }) {
  const [open, setOpen] = useState(false);
  const sources = result.sources || [];
  const comps = result.competitors_mentioned || [];

  return (
    <div style={{ marginTop: 10, background: C.bg, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: open ? C.blue : C.textLight, transition: "transform 0.15s", display: "inline-block", transform: open ? "rotate(90deg)" : "none" }}>▶</span>
        <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: C.textLight }}>{result.model}</span>
          {result.brand_mentioned && <Pill color="#059669">✓ {brandName} #{result.brand_position || "?"}</Pill>}
          {!result.brand_mentioned && <Pill color="#DC2626">✗ Absent</Pill>}
          {result.brand_in_sources && <Pill color="#2563EB">🔗 Source</Pill>}
          {result.answer_type && <Pill color={C.textLight}>{result.answer_type}</Pill>}
          {result.intent_type && <Pill color="#7C3AED">{result.intent_type}</Pill>}
        </div>
        <span style={{ fontSize: 10, color: C.textLight, flexShrink: 0 }}>
          {result.input_tokens + result.output_tokens} tok
        </span>
      </div>

      {open && (
        <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${C.border}` }}>
          {/* Answer */}
          <div style={{ marginTop: 12, fontSize: 12, color: C.text, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {highlightBrand(result.answer || "", brandName, brandAliases)}
          </div>

          {/* Sources */}
          {sources.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Sources</div>
              {sources.map((url, i) => {
                const isBrand = [brandName, ...brandAliases].some(t => url.toLowerCase().includes(t.toLowerCase()));
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

          {/* Competitors */}
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

// ── Questions sub-tab ─────────────────────────────────────────────

function QuestionsTab({ site, projectId, apiKey, model, brand, allResults, onResultSaved }) {
  const [questions, setQuestions]   = useState([]);
  const [results, setResults]       = useState(allResults || []);
  const [manualQ, setManualQ]       = useState("");
  const [filterFav, setFilterFav]   = useState(false);
  const [filterBrand, setFilterBrand] = useState(false);
  const [running, setRunning]       = useState({}); // qId → true
  const [runAll, setRunAll]         = useState(false);

  useEffect(() => { setResults(allResults || []); }, [allResults]);

  useEffect(() => {
    if (!projectId || !site?.id) return;
    sbGetQuestions(projectId, site.id).then(setQuestions);
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
  };

  const runQuestion = useCallback(async (q) => {
    if (!apiKey) { alert("Clé OpenAI manquante"); return; }
    const { brand_name, brand_aliases = [], competitors = [], context = "" } = brand || {};
    setRunning(r => ({ ...r, [q.id]: true }));

    const prompt = [
      context ? `Contexte : "${context}"` : "",
      "Tu es ChatGPT. Réponds à la question suivante exactement comme tu le ferais dans l'interface ChatGPT avec accès au web.",
      "RÈGLE ABSOLUE : Ne pose jamais de question de clarification. Choisis l'interprétation la plus probable et réponds directement.",
      "",
      "ÉTAPE 1 — Recherche web puis réponse.",
      "  • Rédige une réponse complète, naturelle et bien structurée.",
      "  • Insère les marqueurs [1], [2]… dans le texte.",
      "  • La liste 'sources' reprend les URLs dans l'ordre. Ne pas inventer d'URLs.",
      "",
      "ÉTAPE 2 — Classification (JSON uniquement).",
      "- intent_type : Top | Informative | Conseil",
      "- answer_type : format dominant (Définition, Liste, Comparatif, FAQ, Procédure, Conseils…)",
      "- source_types : déduit des URLs.",
      "",
      "Produis UNIQUEMENT le JSON final conforme au schéma. Aucun texte avant ou après.",
      "",
      `Question : ${q.question}`,
    ].filter(Boolean).join("\n");

    try {
      const data = await callOpenAI({ apiKey, model, prompt, endpoint: "responses" });
      const parsed = parseOpenAIResponse(data, "responses");
      const { brandMentioned, brandPosition, brandInSources, competitorsMentioned } = detectBrand(
        parsed.answer, parsed.sources, brand_name, brand_aliases, competitors
      );

      const record = {
        question_id: q.id, project_id: projectId, site_id: site.id,
        model,
        answer: parsed.answer,
        answer_type: parsed.answer_type,
        intent_type: parsed.intent_type,
        sources: parsed.sources,
        source_types: parsed.source_types,
        brand_mentioned: brandMentioned,
        brand_position: brandPosition,
        brand_in_sources: brandInSources,
        competitors_mentioned: competitorsMentioned,
        input_tokens: parsed._input_tokens,
        output_tokens: parsed._output_tokens,
      };

      const saved = await sbSaveGeoResult(record);
      const newResult = Array.isArray(saved) ? saved[0] : saved;
      setResults(prev => [newResult, ...prev]);
      await sbUpdateQuestion(q.id, { has_result: true });
      setQuestions(prev => prev.map(qq => qq.id === q.id ? { ...qq, has_result: true } : qq));
      onResultSaved?.();
    } catch (e) {
      console.error("runQuestion error:", e);
      alert("Erreur : " + e.message);
    }

    setRunning(r => ({ ...r, [q.id]: false }));
  }, [apiKey, model, brand, projectId, site?.id, onResultSaved]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAllQuestions = async () => {
    setRunAll(true);
    const toRun = filtered.filter(q => !(resultsByQ[q.id]?.length));
    for (const q of toRun) {
      if (!runAll) break; // allow cancel
      await runQuestion(q);
    }
    setRunAll(false);
  };

  const filtered = useMemo(() => questions.filter(q => {
    if (filterFav && !q.is_favorite) return false;
    if (filterBrand) {
      const qResults = resultsByQ[q.id] || [];
      if (!qResults.some(r => r.brand_mentioned)) return false;
    }
    return true;
  }), [questions, filterFav, filterBrand, resultsByQ]);

  const { brand_name = "", brand_aliases = [] } = brand || {};
  const totalWithBrand = questions.filter(q => (resultsByQ[q.id] || []).some(r => r.brand_mentioned)).length;
  const totalWithResult = questions.filter(q => resultsByQ[q.id]?.length > 0).length;

  return (
    <div>
      {/* Manual question input */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 20, display: "flex", gap: 10 }}>
        <input
          value={manualQ} onChange={e => setManualQ(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addManual()}
          placeholder="Ajouter une question manuellement…"
          style={{ flex: 1, padding: "7px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.text }}
        />
        <Btn onClick={addManual} disabled={!manualQ.trim()}>➕ Ajouter</Btn>
      </div>

      {/* Filters + actions bar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: C.textLight }}>
          {questions.length} questions · {totalWithResult} interrogées · {totalWithBrand} avec {brand_name || "marque"}
        </span>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          <Pill color="#F59E0B" active={filterFav} onClick={() => setFilterFav(f => !f)}>⭐ Favoris</Pill>
          <Pill color="#059669" active={filterBrand} onClick={() => setFilterBrand(f => !f)}>✓ Marque présente</Pill>
        </div>
        <Btn onClick={runAllQuestions} disabled={runAll || !apiKey} color="#7C3AED">
          {runAll ? "⏳ En cours…" : "▶ Lancer tout"}
        </Btn>
        {runAll && <Btn onClick={() => setRunAll(false)} color="#DC2626" variant="outline" small>⏹ Arrêter</Btn>}
      </div>

      {/* Questions list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: C.textLight, fontSize: 12 }}>
          {questions.length === 0 ? "Aucune question — générez-en depuis les mots-clés ou ajoutez-en manuellement" : "Aucune question ne correspond aux filtres"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(q => {
            const qResults = resultsByQ[q.id] || [];
            const hasBrand = qResults.some(r => r.brand_mentioned);
            const isRunning = running[q.id];
            return (
              <div key={q.id} style={{ background: C.white, border: `1px solid ${hasBrand ? "#059669" : C.border}`, borderRadius: 12, padding: "14px 18px", borderLeft: `3px solid ${hasBrand ? "#059669" : q.is_favorite ? "#F59E0B" : C.border}` }}>
                {/* Question header */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <button onClick={() => toggleFav(q.id, q.is_favorite)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, flexShrink: 0, opacity: q.is_favorite ? 1 : 0.3, transition: "opacity 0.15s" }}>⭐</button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.5 }}>{q.question}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
                      {q.is_manual && <Pill color={C.textLight}>manuel</Pill>}
                      {hasBrand && <Pill color="#059669">✓ {brand_name}</Pill>}
                      {qResults.length > 0 && <span style={{ fontSize: 10, color: C.textLight }}>{qResults.length} résultat{qResults.length > 1 ? "s" : ""}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <Btn onClick={() => runQuestion(q)} disabled={isRunning || !apiKey} color={site.color} small>
                      {isRunning ? "⏳" : "▶ Interroger"}
                    </Btn>
                    <button onClick={() => deleteQ(q.id)} style={{ padding: "4px 7px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.textLight, fontSize: 10, cursor: "pointer" }}>🗑</button>
                  </div>
                </div>

                {/* Results */}
                {qResults.map(r => (
                  <ResultCard key={r.id} result={r} brandName={brand_name} brandAliases={brand_aliases} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main GeoTab ───────────────────────────────────────────────────

export default function GeoTab({ sites, projectId, project }) {
  const [subTab, setSubTab]         = useState("keywords"); // keywords | questions
  const [selectedSite, setSelectedSite] = useState(sites[0]?.id || "");
  const [model, setModel]           = useState("gpt-4o-mini");
  const [brand, setBrand]           = useState(null);         // { brand_name, brand_aliases, competitors, context }
  const [apiKeyEnc, setApiKeyEnc]   = useState(project?.openai_key_enc || "");
  const [apiKeyDec, setApiKeyDec]   = useState("");           // decrypted, only in memory
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keyStatus, setKeyStatus]   = useState("idle");       // idle | saving | ok | error
  const [allResults, setAllResults] = useState([]);
  const [brandEditing, setBrandEditing] = useState(false);
  const [brandDraft, setBrandDraft] = useState({ brand_name: "", brand_aliases: "", competitors: "", context: "" });

  const site = sites.find(s => s.id === selectedSite) || sites[0];

  // Load brand + decrypt key + results when site changes
  useEffect(() => {
    if (!projectId || !site?.id) return;
    sbGetBrand(projectId, site.id).then(b => {
      setBrand(b);
      if (b) setBrandDraft({ brand_name: b.brand_name || "", brand_aliases: (b.brand_aliases || []).join(", "), competitors: (b.competitors || []).join(", "), context: b.context || "" });
    });
    sbGetGeoResults(projectId, site.id).then(setAllResults);
  }, [projectId, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Decrypt key when enc changes
  useEffect(() => {
    if (!apiKeyEnc || !projectId) return;
    decryptKey(apiKeyEnc, projectPassword(projectId))
      .then(k => setApiKeyDec(k))
      .catch(() => setApiKeyDec(""));
  }, [apiKeyEnc, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveApiKey = async () => {
    const k = apiKeyInput.trim();
    if (!k.startsWith("sk-")) { setKeyStatus("error"); return; }
    setKeyStatus("saving");
    try {
      const enc = await encryptKey(k, projectPassword(projectId));
      await sbSaveOpenAIKey(projectId, enc);
      setApiKeyEnc(enc);
      setApiKeyDec(k);
      setApiKeyInput("");
      setKeyStatus("ok");
    } catch { setKeyStatus("error"); }
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
            Clé OpenAI {hasKey && <span style={{ color: "#059669", marginLeft: 4 }}>● Configurée</span>}
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

      {/* ── Sub-nav ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: C.bg, borderRadius: 10, padding: 4, width: "fit-content" }}>
        {[
          { key: "keywords",  label: "🔑 Mots-clés" },
          { key: "questions", label: "💬 Questions" },
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
          context={brand?.context || ""}
          onQuestionsGenerated={() => setSubTab("questions")}
        />
      )}
      {subTab === "questions" && (
        <QuestionsTab
          site={site}
          projectId={projectId}
          apiKey={apiKeyDec}
          model={model}
          brand={brand}
          allResults={allResults.filter(r => r.site_id === site?.id)}
          onResultSaved={() => sbGetGeoResults(projectId, site.id).then(setAllResults)}
        />
      )}
    </div>
  );
}