import InfoCard from "../components/InfoCard";
import TemplateAnalysis from "./TemplateAnalysis";
import { useState, useEffect } from "react";
import { C, PAGE_TYPE_MAP } from "../lib/constants";
import { sbSaveAnalysis, sbGetLatestAnalysis, sbSaveRecommendations, sbGetRecommendations, sbUpdateRecommendation } from "../lib/supabase";
import { computeSiteScore } from "../lib/scoring";

// ── Helpers ───────────────────────────────────────────────────────

function safeN(v) { const n = parseFloat(String(v || "").replace("%", "")); return isNaN(n) ? 0 : n; }

function normP(raw) {
  if (!raw) return "";
  const s = raw.trim();
  try { return new URL(s.startsWith("http") ? s : "https://x.com" + s).pathname.replace(/\/+$/, "") || "/"; }
  catch { return s.replace(/\/+$/, "") || "/"; }
}

// ── Build per-template data for the prompt ────────────────────────

function buildTemplateDataForPrompt(metrics, sfData, gscData, gaData, pageTypes) {
  return metrics.map(m => {
    const sid    = m.site.id;
    const ptMap  = pageTypes[sid] || {};
    const sfRows = sfData[sid]   || [];
    const gscRows = gscData[sid] || [];
    const gaRows  = gaData[sid]  || [];

    // Build click/session lookup by normalised path
    const gscByPath = {};
    gscRows.forEach(r => {
      const raw = (r["page"] || r["url"] || r["adresse"] || "").trim();
      if (!raw) return;
      const p = normP(raw);
      if (!gscByPath[p]) gscByPath[p] = { clicks: 0, impressions: 0 };
      gscByPath[p].clicks      += safeN(r["clics"] || r["clicks"] || 0);
      gscByPath[p].impressions += safeN(r["impressions"] || 0);
    });

    const gaByPath = {};
    gaRows.forEach(r => {
      const raw = (r["page"] || r["url"] || r["adresse"] || r["landing page"] || "").trim();
      if (!raw) return;
      const p = normP(raw);
      if (!gaByPath[p]) gaByPath[p] = { sessions: 0 };
      gaByPath[p].sessions += safeN(r["ga4 sessions"] || r["sessions"] || r["séances"] || 0);
    });

    // Group SF pages by template
    const byTpl = {};
    sfRows.forEach(r => {
      const url = (r["adresse"] || r["address"] || r["url"] || "").trim();
      if (!url) return;
      const ct = (r["type de contenu"] || r["content type"] || "").toLowerCase();
      const sc = safeN(r["code http"] || r["status code"] || 200);
      if (!(ct.includes("html") || ct === "") || sc >= 400) return;

      let tpl = ptMap[url];
      if (!tpl) { try { tpl = ptMap[new URL(url).pathname.replace(/\/+$/, "") || "/"]; } catch {} }
      if (!tpl || tpl === "home" || tpl === "autre") return;

      let path = "";
      try { path = new URL(url).pathname.replace(/\/+$/, "") || "/"; } catch { path = url; }
      const tryPaths = [path, path + "/", path.replace(/\/$/, "")];
      const g  = tryPaths.map(tp => gscByPath[tp]).find(Boolean) || {};
      const ga = tryPaths.map(tp => gaByPath[tp]).find(Boolean)  || {};

      if (!byTpl[tpl]) byTpl[tpl] = [];
      byTpl[tpl].push({
        path,
        clicks:     g.clicks      || 0,
        impressions: g.impressions || 0,
        sessions:   ga.sessions   || 0,
        words:      safeN(r["nombre de mots"]         || r["word count"]      || 0),
        flesch:     safeN(r["score lisibilité"]        || r["readability"]     || r["flesch"] || 0),
        inlinks:    safeN(r["liens entrants uniques"]  || r["unique inlinks"]  || r["inlinks"] || 0),
        depth:      path.split("/").filter(Boolean).length,
        schema:     !!(r["schema type"] || r["structured data 1"] || r["schema 1"]),
        titleLen:   safeN(r["longueur du title 1"] || r["title 1 length"] || 0) || (r["title 1"] || "").length,
      });
    });

    const totalClicks = Object.values(byTpl).reduce((s, pages) => s + pages.reduce((ss, p) => ss + p.clicks, 0), 0) || 1;

    const tplSummaries = Object.entries(byTpl).map(([tplKey, pages]) => {
      const clicks   = pages.reduce((s, p) => s + p.clicks,   0);
      const sessions = pages.reduce((s, p) => s + p.sessions, 0);
      const share    = Math.round(clicks / totalClicks * 100);
      const sample   = pages.filter(p => p.clicks > 0).length > 0 ? pages.filter(p => p.clicks > 0) : pages;
      const avg      = key => sample.length ? Math.round(sample.reduce((s, p) => s + p[key], 0) / sample.length * 10) / 10 : 0;
      const schemaRate = Math.round(sample.filter(p => p.schema).length / (sample.length || 1) * 100);
      const top3 = [...pages].sort((a, b) => b.clicks - a.clicks).slice(0, 3).filter(p => p.clicks > 0);

      return {
        tplKey,
        label: PAGE_TYPE_MAP[tplKey]?.label || tplKey,
        count: pages.length,
        clicks, sessions, share,
        avgWords: avg("words"), avgFlesch: avg("flesch"), avgInlinks: avg("inlinks"),
        avgDepth: avg("depth"), avgTitleLen: avg("titleLen"), schemaRate,
        top3,
      };
    }).sort((a, b) => b.clicks - a.clicks);

    return { siteLabel: m.site.label, tplSummaries };
  });
}

// ── Build AI prompt ────────────────────────────────────────────────

function buildPrompt(metrics, corrMatrix, resultVals, siteScores, templateData) {

  const sitesData = metrics.map((m, i) => {
    const sf  = m.sf || {};
    const rv  = resultVals[i] || {};
    const td  = templateData[i];

    const tplSection = td?.tplSummaries?.length
      ? "\n— Répartition par template:\n" + td.tplSummaries.map(t => {
          const top3str = t.top3.length
            ? "\n    Top pages: " + t.top3.map(p =>
                `${p.path}(${p.clicks}clics,${p.words}mots,${p.inlinks}inl,schema:${p.schema ? "oui" : "non"})`
              ).join(", ")
            : "";
          return `  [${t.label}] ${t.count}p — ${t.share}% des clics (${t.clicks} clics, ${t.sessions} sess) | SF moy: mots=${t.avgWords}, flesch=${t.avgFlesch}, inlinks=${t.avgInlinks}, schema=${t.schemaRate}%, profondeur=${t.avgDepth}${top3str}`;
        }).join("\n")
      : "";

    return `SITE: ${m.site.label} (score GEO-readiness: ${siteScores[i] ?? "N/A"}/100)
— SF global: title=${sf.avgTitleLen ?? "N/A"}car, mots=${sf.avgWords ?? "N/A"}, flesch=${sf.avgFlesch ?? "N/A"}, inlinks=${sf.avgInlinksUniq ?? "N/A"}, schema=${sf.schemaRate ?? "N/A"}%, profondeur=${sf.avgDepth ?? "N/A"}, erreurs=${sf.errorRate ?? "N/A"}%
— KPIs: clics=${rv.clicks ?? 0}, impressions=${rv.impressions ?? 0}, CTR=${rv.ctr ?? 0}%, position=${rv.position ?? 0}, sessions=${rv.sessions ?? 0}, citationsBing=${rv.geoMentions ?? 0}${tplSection}`;
  }).join("\n\n");

  // Comparative (multi-site only)
  const comparativeData = metrics.length >= 2 ? (() => {
    const names  = metrics.map(m => m.site.label);
    const scores = metrics.map((m, i) => `${m.site.label}: ${siteScores[i] ?? "N/A"}/100`).join(", ");
    const dims = ["avgFlesch","avgInlinksUniq","avgWords","schemaRate","tableRate","avgDepth","errorRate"];
    const dimLabels = { avgFlesch:"Flesch", avgInlinksUniq:"Maillage", avgWords:"Mots/page", schemaRate:"Schema%", tableRate:"Tableaux%", avgDepth:"Profondeur", errorRate:"Erreurs%" };
    const deltas = dims.map(k => {
      const vals = metrics.map(m => ({ site: m.site.label, val: m.sf?.[k] ?? null })).filter(v => v.val !== null);
      if (vals.length < 2) return null;
      const lowerBetter = ["avgDepth","errorRate"].includes(k);
      const best  = vals.reduce((a, b) => (lowerBetter ? a.val < b.val : a.val > b.val) ? a : b);
      const worst = vals.reduce((a, b) => (lowerBetter ? a.val > b.val : a.val < b.val) ? a : b);
      const delta = Math.abs(best.val - worst.val);
      if (delta < 0.01) return null;
      return `${dimLabels[k]}: ${best.site} mène (${Math.round(best.val*10)/10}) vs ${worst.site} (${Math.round(worst.val*10)/10}), écart=${Math.round(delta*10)/10}`;
    }).filter(Boolean).join("\n  ");
    return `\n\nANALYSE COMPARATIVE (${names.join(" vs ")}):\nScores: ${scores}\nÉcarts techniques:\n  ${deltas}`;
  })() : "";

  const topCorr = corrMatrix.flatMap(({ dim, corrs }) =>
    corrs.filter(c => c.value !== null && Math.abs(c.value) >= 0.25)
      .map(c => ({ label: `${dim.label} ↔ ${c.kpi.label}`, value: c.value, abs: Math.abs(c.value) }))
  ).sort((a, b) => b.abs - a.abs).slice(0, 10)
   .map(c => `  ${c.label}: ${c.value > 0 ? "+" : ""}${c.value.toFixed(2)}`).join("\n");

  const siteRoadmapSchema = metrics.map(m =>
    `"${m.site.id}": {"quick_wins": [], "moyen_terme": [], "long_terme": []}`
  ).join(", ");

  return `Expert SEO/GEO. Analyse ces données et retourne UNIQUEMENT un objet JSON valide, sans markdown, sans texte autour.

DONNÉES PAR SITE:
${sitesData}
${comparativeData}

TOP CORRÉLATIONS (|r|≥0.25):
${topCorr || "Aucune corrélation significative."}

MISSION — 3 ÉTAPES:
1. POIDS DES TEMPLATES: Analyse quels templates pèsent le plus dans chaque KPI (clics, sessions) globalement et par site. Identifie les templates sur- et sous-performants au regard de leur volume de pages.
2. PAGES QUI RÉUSSISSENT: Pour les templates avec des top pages, identifie les critères SF (mots, flesch, inlinks, schema, profondeur) présents chez les meilleures pages vs la moyenne. Ces critères = leviers de succès à reproduire.
3. INSPIRATIONS + ROADMAP PAR TEMPLATE: Synthétise les apprentissages en inspirations actionnables. Construis une roadmap concrète par site où chaque action cible un template précis.

STRUCTURE JSON EXACTE À RETOURNER:
{"template_weights":[{"template":"...","site":"ALL ou nom-du-site","observation":"...","impact":"fort|moyen|faible"}],"winning_learnings":[{"template":"...","title":"...","detail":"...","criteria":["..."]}],"inspirations":[{"title":"...","detail":"...","template":"..."}],"roadmaps":{${siteRoadmapSchema}}}

RÈGLES STRICTES:
- template_weights: max 6 entrées — 1 à 2 par site, focus sur les templates avec le plus gros poids KPI
- winning_learnings: max 4 entrées — basées sur les métriques SF des top pages vs la moyenne du template
- inspirations: max 3 entrées — synthèse actionnable, chaque inspiration peut couvrir plusieurs templates
- roadmap chaque action: {"template":"nom-du-template","action":"...","metric":"...","why":"...","effort":"...","ice_impact":7,"ice_confidence":6,"ice_effort":5}
- max 2 actions par horizon (quick_wins, moyen_terme, long_terme) par site
- chaque action DOIT cibler un template spécifique (champ "template" obligatoire)
- comparative: si 1 seul site, roadmaps seulement, pas de comparative
- JSON COMPLET ET VALIDE — ferme tous les tableaux et objets`;
}

// ── JSON repair (stack-based LIFO closing) ───────────────────────

function repairJson(raw) {
  let s = raw;
  for (let attempt = 0; attempt < 25; attempt++) {
    // 1. Strip trailing incomplete string value: ,"key":"unclosed...
    //    Detect by counting unescaped quotes — if odd, we're inside a string
    const quoteCount = (s.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 === 1) {
      // Find the opening quote of the unclosed string and cut back to preceding comma
      const lastQ = s.lastIndexOf('"');
      const before = s.substring(0, lastQ);
      const cutAt = Math.max(before.lastIndexOf(','), before.lastIndexOf('['));
      if (cutAt > 0) {
        s = s.substring(0, cutAt).trimEnd();
      } else {
        s = before.trimEnd();
      }
    }

    // 2. Strip other trailing incomplete tokens
    const prev = s.length;
    s = s
      .replace(/,\s*"[^"]*"\s*:\s*$/, "")   // key with no value
      .replace(/,\s*"[^"]*"\s*$/, "")         // dangling key
      .replace(/,\s*\{[^{}]*$/, "")           // incomplete object entry
      .replace(/,\s*$/, "")                    // trailing comma
      .trimEnd();

    // 3. Build correct closing suffix via a LIFO stack (ignore chars inside strings)
    const stack = [];
    let inStr = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\' && inStr) { i++; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') stack.push('}');
      else if (c === '[') stack.push(']');
      else if (c === '}' || c === ']') stack.pop();
    }
    const closing = stack.reverse().join('');
    try { return JSON.parse(s + closing); } catch {}

    // No progress — stop looping
    if (s.length === prev && !closing) break;
  }
  return null;
}

// ── Parse recommendations ─────────────────────────────────────────

function parseRecommendations(analysis, metrics, projectId, analysisId) {
  const recs = [];
  const horizonMap = { quick_wins: "quick", moyen_terme: "medium", long_terme: "long" };

  metrics.forEach(m => {
    const rm = analysis.roadmaps?.[m.site.id];
    if (!rm) return;
    Object.entries(horizonMap).forEach(([key, horizon]) => {
      (rm[key] || []).forEach(item => {
        recs.push({
          id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          project_id: projectId,
          site_id: m.site.id,
          analysis_id: analysisId,
          text: item.action,
          template: item.template || null,
          horizon,
          ice_impact: item.ice_impact ?? 5,
          ice_confidence: item.ice_confidence ?? 5,
          ice_effort: item.ice_effort ?? 5,
          done: false,
        });
      });
    });
  });
  return recs;
}

// ── Sub-components ────────────────────────────────────────────────

const HORIZON_CONFIG = {
  quick:  { label: "⚡ Quick Win",   color: "#059669", bg: "#ECFDF5", border: "#BBF7D0" },
  medium: { label: "📈 Moyen terme", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
  long:   { label: "🏗️ Long terme",  color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE" },
};

function IceScore({ impact, confidence, effort }) {
  const score = effort > 0 ? Math.round(impact * confidence / effort * 10) / 10 : 0;
  const color = score >= 8 ? C.green : score >= 4 ? C.amber : C.red;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <span style={{ fontSize: 10, color: C.textLight }}>ICE</span>
      <span style={{ fontWeight: 800, fontSize: 13, color }}>{score}</span>
      <span style={{ fontSize: 10, color: C.textLight }}>({impact}·{confidence}·{effort})</span>
    </div>
  );
}

function TplBadge({ tplKey }) {
  if (!tplKey) return null;
  const meta = PAGE_TYPE_MAP[tplKey] || { label: tplKey, color: "#64748B", bg: "#F1F5F9" };
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}33`, padding: "2px 7px", borderRadius: 10 }}>
      {meta.label}
    </span>
  );
}

function RecCard({ rec, site, onToggle }) {
  const h = HORIZON_CONFIG[rec.horizon] || HORIZON_CONFIG.quick;
  return (
    <div style={{ background: rec.done ? C.bg : C.white, border: `1px solid ${rec.done ? C.border : h.border}`, borderRadius: 12, padding: "14px 16px", opacity: rec.done ? 0.65 : 1, transition: "all 0.2s" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          onClick={onToggle}
          style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${rec.done ? C.green : C.border}`, background: rec.done ? C.green : C.white, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, marginTop: 1, transition: "all 0.15s" }}
        >
          {rec.done && <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>✓</span>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: rec.done ? C.textLight : C.text, textDecoration: rec.done ? "line-through" : "none", marginBottom: 8, lineHeight: 1.4 }}>{rec.text}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {site && (
              <span style={{ fontSize: 10, fontWeight: 600, color: site.color, background: site.bg, border: `1px solid ${site.color}33`, padding: "2px 8px", borderRadius: 10 }}>{site.label}</span>
            )}
            {rec.template && <TplBadge tplKey={rec.template} />}
            <span style={{ fontSize: 10, fontWeight: 600, color: h.color, background: h.bg, border: `1px solid ${h.border}`, padding: "2px 8px", borderRadius: 10 }}>{h.label}</span>
            <IceScore impact={rec.ice_impact} confidence={rec.ice_confidence} effort={rec.ice_effort} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Impact helpers ────────────────────────────────────────────────

const impactColor = (impact) => impact === "fort" ? C.green : impact === "moyen" ? C.amber : C.textLight;
const impactBg    = (impact) => impact === "fort" ? C.greenLight : impact === "moyen" ? C.amberLight : C.bg;

// ── Main component ────────────────────────────────────────────────

export default function AnalyseTab({ metrics, corrMatrix, resultVals, analysis, setAnalysis, analysisLoading, setAnalysisLoading, analysisError, setAnalysisError, currentProjectId, sites, sfData = {}, gscData = {}, gaData = {}, bingData = {}, smData = {}, pageTypes = {} }) {
  const [activeRoadmap, setActiveRoadmap] = useState(() => metrics[0]?.site.id || "");
  const [recs, setRecs] = useState([]);
  const [filterHorizon, setFilterHorizon] = useState("all");
  const [filterSite, setFilterSite] = useState("all");
  const [showDone, setShowDone] = useState(false);
  const hasData = metrics.some(m => m.sf !== null);

  const horizonConfig = [
    { key: "quick_wins",  label: "⚡ Quick Wins",   sub: "1 jour – 2 semaines", color: C.green,  bg: C.greenLight  },
    { key: "moyen_terme", label: "📈 Moyen terme",  sub: "1 – 3 mois",          color: C.amber,  bg: C.amberLight  },
    { key: "long_terme",  label: "🏗️ Long terme",   sub: "3 – 12 mois",         color: C.purple, bg: C.purpleLight },
  ];

  // Auto-load last analysis and recommendations on mount/project change
  useEffect(() => {
    if (!currentProjectId) return;
    (async () => {
      try {
        const [lastAnalysis, savedRecs] = await Promise.all([
          sbGetLatestAnalysis(currentProjectId),
          sbGetRecommendations(currentProjectId),
        ]);
        if (lastAnalysis?.content) {
          try { setAnalysis(JSON.parse(lastAnalysis.content)); } catch {}
        }
        if (savedRecs?.length) setRecs(savedRecs);
      } catch {}
    })();
  }, [currentProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAnalysis = async () => {
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const siteScores   = metrics.map(m => computeSiteScore(m.sf).score);
      const templateData = buildTemplateDataForPrompt(metrics, sfData, gscData, gaData, pageTypes);
      const prompt       = buildPrompt(metrics, corrMatrix, resultVals, siteScores, templateData);

      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          system: "Tu es un assistant d'analyse SEO/GEO. Tu réponds TOUJOURS et UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après, sans markdown, sans backticks. Jamais de commentaires. Juste le JSON brut commençant par { et finissant par }.",
          messages: [
            { role: "user",      content: prompt },
            { role: "assistant", content: "{" },
          ],
        }),
      });

      const text = await res.text();
      if (res.status === 500) {
        let msg = text.slice(0, 200);
        try { const j = JSON.parse(text); msg = j.error || msg; } catch {}
        throw new Error(`Erreur serveur (500) — vérifiez que ANTHROPIC_API_KEY est configurée. Détail : ${msg}`);
      }
      if (!res.ok) {
        let msg = text.slice(0, 200);
        try { const j = JSON.parse(text); msg = j.error?.message || j.error || msg; } catch {}
        throw new Error(`Erreur ${res.status} : ${msg}`);
      }
      let data;
      try { data = JSON.parse(text); }
      catch (e) { throw new Error("Réponse non-JSON du proxy : " + text.slice(0, 300)); }
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

      const raw      = "{" + (data.content?.map(b => b.text || "").join("") || "");
      const stopReason = data.stop_reason;
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.log("[Analyse] stop_reason:", stopReason, "| length:", raw.length, "| tail:", raw.slice(-200));
      }

      let jsonStr = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      const start = jsonStr.indexOf("{");
      const end   = jsonStr.lastIndexOf("}");
      if (start === -1) throw new Error("Aucun JSON dans la réponse. Contenu reçu : " + raw.slice(0, 200));
      jsonStr = jsonStr.substring(start, end === -1 ? undefined : end + 1);

      let parsed = null;
      try { parsed = JSON.parse(jsonStr); }
      catch { parsed = repairJson(jsonStr); }
      if (!parsed) throw new Error("Impossible de parser le JSON. Extrait : " + jsonStr.slice(0, 300));
      setAnalysis(parsed);

      const analysisId = `analysis-${Date.now()}`;
      const newRecs    = parseRecommendations(parsed, metrics, currentProjectId, analysisId);
      try {
        await sbSaveAnalysis({ id: analysisId, project_id: currentProjectId, content: JSON.stringify(parsed) });
        if (newRecs.length) await sbSaveRecommendations(newRecs);
        setRecs(prev => [...newRecs, ...prev]);
      } catch (e) { console.warn("Save analysis failed:", e); }

    } catch (e) {
      setAnalysisError("Erreur lors de l'analyse : " + e.message);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const toggleRec = async (rec) => {
    const updated = { ...rec, done: !rec.done };
    setRecs(prev => prev.map(r => r.id === rec.id ? updated : r));
    try { await sbUpdateRecommendation(rec.id, { done: updated.done }); } catch {}
  };

  const filteredRecs = recs.filter(r => {
    if (!showDone && r.done) return false;
    if (filterHorizon !== "all" && r.horizon !== filterHorizon) return false;
    if (filterSite !== "all" && r.site_id !== filterSite) return false;
    return true;
  }).sort((a, b) => {
    const iceA = a.ice_effort > 0 ? a.ice_impact * a.ice_confidence / a.ice_effort : 0;
    const iceB = b.ice_effort > 0 ? b.ice_impact * b.ice_confidence / b.ice_effort : 0;
    return iceB - iceA;
  });

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text, fontFamily: "'Georgia', serif", letterSpacing: -0.5 }}>
            Analyse IA & Roadmaps
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textLight }}>
            Analyse Claude Sonnet · poids templates · pages gagnantes · roadmaps par template
          </p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={analysisLoading || !hasData}
          style={{ padding: "10px 24px", background: analysisLoading ? C.border : C.blue, color: analysisLoading ? C.textLight : "#fff", border: "none", borderRadius: 9, cursor: hasData && !analysisLoading ? "pointer" : "not-allowed", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s", boxShadow: analysisLoading ? "none" : "0 2px 8px #2563EB33" }}
        >
          {analysisLoading
            ? <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span> Analyse en cours…</>
            : analysis ? "↻ Relancer l'analyse" : "✦ Générer l'analyse"}
        </button>
      </div>
      <InfoCard tabKey="analyse" />
      <div style={{ marginBottom: 16 }} />

      {!hasData && (
        <div style={{ background: C.amberLight, border: "1px solid #FDE68A", borderRadius: 12, padding: "16px 20px", marginBottom: 24, fontSize: 13, color: C.amber }}>
          ⚠️ Chargez au moins un fichier CSV Screaming Frog dans l'onglet Import pour générer l'analyse.
        </div>
      )}
      {analysisError && (
        <div style={{ background: C.redLight, border: "1px solid #FCA5A5", borderRadius: 12, padding: "16px 20px", marginBottom: 24, fontSize: 13, color: C.red }}>
          {analysisError}
        </div>
      )}

      {/* ── Skeleton loader ── */}
      {analysisLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, marginBottom: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {[1, 2].map(i => (
              <div key={i} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
                <div style={{ height: 16, background: C.borderLight, borderRadius: 6, width: "50%", marginBottom: 16 }} />
                {[1, 2, 3].map(j => <div key={j} style={{ height: 60, background: C.bg, borderRadius: 8, marginBottom: 10 }} />)}
              </div>
            ))}
          </div>
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
            <div style={{ height: 16, background: C.borderLight, borderRadius: 6, width: "40%", marginBottom: 16 }} />
            {[1, 2, 3].map(j => <div key={j} style={{ height: 48, background: C.bg, borderRadius: 8, marginBottom: 10 }} />)}
          </div>
        </div>
      )}

      {analysis && !analysisLoading && (
        <>
          {/* ── Section 1 : Poids des templates + Pages gagnantes ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>

            {/* Poids des templates */}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, borderLeft: `4px solid ${C.blue}` }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>📊 Poids des templates</div>
                <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>Contribution de chaque template aux KPIs globaux et par site</div>
              </div>
              <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                {(analysis.template_weights || []).length === 0 && (
                  <div style={{ fontSize: 12, color: C.textLight, fontStyle: "italic" }}>Aucune donnée de template disponible.</div>
                )}
                {(analysis.template_weights || []).map((tw, i) => {
                  return (
                    <div key={i} style={{ background: impactBg(tw.impact), border: `1px solid ${impactColor(tw.impact)}22`, borderRadius: 10, padding: "12px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <TplBadge tplKey={tw.template} />
                          {tw.site && tw.site !== "ALL" && (
                            <span style={{ fontSize: 10, color: C.textLight, background: C.bg, border: `1px solid ${C.border}`, padding: "1px 7px", borderRadius: 10 }}>{tw.site}</span>
                          )}
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: impactColor(tw.impact), background: `${impactColor(tw.impact)}18`, padding: "2px 8px", borderRadius: 20, textTransform: "uppercase", letterSpacing: 0.8 }}>impact {tw.impact}</span>
                      </div>
                      <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>{tw.observation}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Pages gagnantes — leviers */}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, borderLeft: `4px solid ${C.green}` }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>🏆 Leviers des pages gagnantes</div>
                <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>Critères SF présents chez les meilleures pages par template</div>
              </div>
              <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
                {(analysis.winning_learnings || []).length === 0 && (
                  <div style={{ fontSize: 12, color: C.textLight, fontStyle: "italic" }}>Aucune donnée disponible.</div>
                )}
                {(analysis.winning_learnings || []).map((wl, i) => (
                  <div key={i} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <TplBadge tplKey={wl.template} />
                      <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{wl.title}</div>
                    </div>
                    <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6, marginBottom: 8 }}>{wl.detail}</div>
                    {(wl.criteria || []).length > 0 && (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {wl.criteria.map((c, ci) => (
                          <span key={ci} style={{ fontSize: 10, fontWeight: 600, color: C.green, background: C.greenLight, border: "1px solid #BBF7D0", padding: "2px 8px", borderRadius: 10 }}>
                            ✓ {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Section 2 : Inspirations clés ── */}
          {(analysis.inspirations || []).length > 0 && (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 28 }}>
              <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, borderLeft: `4px solid ${C.purple}` }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>💡 Inspirations clés</div>
                <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>Synthèse des apprentissages tirés de l'analyse template × corrélations</div>
              </div>
              <div style={{ padding: "20px 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
                {(analysis.inspirations || []).map((ins, i) => {
                  const meta = PAGE_TYPE_MAP[ins.template] || null;
                  return (
                    <div key={i} style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#4C1D95", flex: 1 }}>{ins.title}</div>
                        {meta && <TplBadge tplKey={ins.template} />}
                      </div>
                      <div style={{ fontSize: 12, color: "#5B21B6", lineHeight: 1.7 }}>{ins.detail}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Section 3 : Analyse comparative (multi-site) ── */}
          {metrics.length >= 2 && analysis.comparative?.strategic_summary && (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 28 }}>
              <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, borderLeft: `4px solid #7C3AED` }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>⚖️ Analyse comparative</div>
                <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>{metrics.map(m => m.site.label).join(" · ")}</div>
              </div>
              <div style={{ padding: "20px 24px" }}>
                <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "14px 16px", marginBottom: 20, fontSize: 13, color: "#4C1D95", lineHeight: 1.7 }}>
                  {analysis.comparative.strategic_summary}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                  {[
                    { key: "winner_seo", icon: "🔍", label: "Leader SEO",  color: C.blue,   bg: C.blueLight },
                    { key: "winner_geo", icon: "🤖", label: "Leader GEO",  color: C.purple, bg: C.purpleLight },
                  ].map(({ key, icon, label, color, bg }) => analysis.comparative[key] ? (
                    <div key={key} style={{ background: bg, border: `1px solid ${color}33`, borderRadius: 10, padding: "12px 16px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>{icon} {label}</div>
                      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{analysis.comparative[key]}</div>
                    </div>
                  ) : null)}
                </div>
                {(analysis.comparative.gap_analysis || []).length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 10 }}>Écarts clés</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {(analysis.comparative.gap_analysis || []).map((gap, i) => (
                        <div key={i} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: C.amber, background: C.amberLight, padding: "2px 8px", borderRadius: 10 }}>{gap.dimension}</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>→ {gap.leader} en tête</span>
                          </div>
                          <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6, marginBottom: 4 }}>{gap.gap}</div>
                          {gap.opportunity && (
                            <div style={{ fontSize: 11, color: C.green, background: C.greenLight, padding: "4px 10px", borderRadius: 7, display: "inline-block" }}>
                              💡 {gap.opportunity}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Section 4 : Roadmap par site ── */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 28 }}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 12 }}>🗺️ Roadmaps par site · par template</div>
              <div style={{ display: "flex", gap: 8 }}>
                {metrics.map(({ site: s }) => (
                  <button key={s.id} onClick={() => setActiveRoadmap(s.id)} style={{ padding: "7px 18px", border: `1px solid ${activeRoadmap === s.id ? s.color : C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: activeRoadmap === s.id ? 700 : 400, background: activeRoadmap === s.id ? s.bg : C.white, color: activeRoadmap === s.id ? s.color : C.textMid, transition: "all 0.15s" }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ padding: 24 }}>
              {(() => {
                const rm = analysis.roadmaps?.[activeRoadmap];
                if (!rm) return <div style={{ color: C.textLight, fontSize: 13 }}>Aucune roadmap générée pour ce site.</div>;
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
                    {horizonConfig.map(({ key, label, sub, color, bg }) => (
                      <div key={key} style={{ background: bg, border: `1px solid ${color}33`, borderRadius: 12, overflow: "hidden" }}>
                        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${color}22` }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color }}>{label}</div>
                          <div style={{ fontSize: 11, color: `${color}99`, marginTop: 2 }}>{sub}</div>
                        </div>
                        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                          {(rm[key] || []).map((item, i) => (
                            <div key={i} style={{ background: C.white, borderRadius: 9, padding: "12px 14px", border: `1px solid ${color}22` }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                                {item.template && <TplBadge tplKey={item.template} />}
                              </div>
                              <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 6 }}>{item.action}</div>
                              <div style={{ fontSize: 11, color: C.textLight, marginBottom: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                                <span style={{ background: `${color}15`, color, padding: "1px 7px", borderRadius: 10, fontWeight: 500 }}>{item.metric}</span>
                                <span style={{ background: C.bg, color: C.textMid, padding: "1px 7px", borderRadius: 10 }}>⏱ {item.effort}</span>
                                {item.ice_impact && <span style={{ background: C.bg, color: C.textMid, padding: "1px 7px", borderRadius: 10 }}>ICE: {Math.round(item.ice_impact * item.ice_confidence / (item.ice_effort || 1) * 10) / 10}</span>}
                              </div>
                              <div style={{ fontSize: 11, color: C.textMid, lineHeight: 1.5 }}>{item.why}</div>
                            </div>
                          ))}
                          {(rm[key] || []).length === 0 && (
                            <div style={{ fontSize: 11, color: `${color}88`, fontStyle: "italic", textAlign: "center", padding: "8px 0" }}>Aucune action</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </>
      )}

      {!analysis && !analysisLoading && hasData && (
        <div style={{ background: C.white, border: `2px dashed ${C.border}`, borderRadius: 14, padding: "60px 40px", textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>✦</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 8 }}>Prêt à analyser</div>
          <div style={{ fontSize: 13, color: C.textLight, maxWidth: 400, margin: "0 auto" }}>
            Cliquez sur "Générer l'analyse" pour obtenir les insights par template, les leviers des pages gagnantes et les roadmaps actionnables.
          </div>
        </div>
      )}

      {/* ── Recommandations sauvegardées ── */}
      {(recs.length > 0 || analysis) && (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 28 }}>
          <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>✅ Recommandations</div>
                <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>{recs.filter(r => r.done).length}/{recs.length} réalisées · triées par score ICE</div>
              </div>
              <button onClick={() => setShowDone(s => !s)} style={{ padding: "5px 12px", border: `1px solid ${C.border}`, borderRadius: 7, background: showDone ? C.blueLight : C.white, color: showDone ? C.blue : C.textMid, fontSize: 11, cursor: "pointer", fontWeight: showDone ? 600 : 400 }}>
                {showDone ? "Masquer réalisées" : "Afficher réalisées"}
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select value={filterHorizon} onChange={e => setFilterHorizon(e.target.value)} style={{ padding: "5px 10px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, background: C.white, color: C.textMid, cursor: "pointer" }}>
                <option value="all">Tous horizons</option>
                <option value="quick">⚡ Quick Win</option>
                <option value="medium">📈 Moyen terme</option>
                <option value="long">🏗️ Long terme</option>
              </select>
              <select value={filterSite} onChange={e => setFilterSite(e.target.value)} style={{ padding: "5px 10px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, background: C.white, color: C.textMid, cursor: "pointer" }}>
                <option value="all">Tous les sites</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredRecs.length === 0 && (
              <div style={{ fontSize: 13, color: C.textLight, textAlign: "center", padding: "20px 0" }}>
                {recs.length === 0 ? "Génère une analyse pour créer des recommandations." : "Aucune recommandation avec ces filtres."}
              </div>
            )}
            {filteredRecs.map(rec => (
              <RecCard
                key={rec.id}
                rec={rec}
                site={sites.find(s => s.id === rec.site_id)}
                onToggle={() => toggleRec(rec)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Template × Succès ── */}
      <div style={{ marginTop: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 3, height: 20, background: C.blue, borderRadius: 2 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Analyse templates × pages à succès</div>
        </div>
        <TemplateAnalysis
          sites={sites}
          sfData={sfData}
          gscData={gscData}
          gaData={gaData}
          bingData={bingData}
          smData={smData}
          pageTypes={pageTypes}
        />
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
