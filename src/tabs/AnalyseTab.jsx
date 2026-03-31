import InfoCard from "../components/InfoCard";
import TemplateAnalysis from "./TemplateAnalysis";
import { useState, useEffect, useMemo } from "react";
import { C } from "../lib/constants";
import { sbSaveAnalysis, sbGetLatestAnalysis, sbSaveRecommendations, sbGetRecommendations, sbUpdateRecommendation } from "../lib/supabase";
import { computeSiteScore } from "../lib/scoring";

// ── Prompt builder ────────────────────────────────────────────────
function buildPrompt(metrics, corrMatrix, resultVals, siteScores, geoResults = [], geoUrlIndex = []) {

  // Build per-site GEO summary
  const geoSummary = (siteId) => {
    const res = geoResults.filter(r => r.site_id === siteId);
    if (!res.length) return "  Pas de données Fan-outs disponibles";
    const total      = res.length;
    const withBrand  = res.filter(r => r.brand_mentioned).length;
    const withSource = res.filter(r => r.brand_in_sources).length;
    const pct        = Math.round(withBrand / total * 100);
    const byProvider = {};
    res.forEach(r => {
      if (!byProvider[r.provider_id]) byProvider[r.provider_id] = { total: 0, brand: 0 };
      byProvider[r.provider_id].total++;
      if (r.brand_mentioned) byProvider[r.provider_id].brand++;
    });
    const provSummary = Object.entries(byProvider)
      .map(([p, d]) => `${p}:${Math.round(d.brand / d.total * 100)}%`).join(", ");
    const compNames = new Set();
    res.forEach(r => (r.competitors_mentioned || []).forEach(c => { if (c?.name) compNames.add(c.name); }));
    const topDomains = {};
    geoUrlIndex.filter(u => u.site_id === siteId).forEach(u => {
      topDomains[u.domain] = (topDomains[u.domain] || 0) + (u.count_as_source || 0) + (u.count_in_answer || 0);
    });
    const topD = Object.entries(topDomains).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([d, c]) => `${d}(${c}x)`).join(", ");
    const positions = res.filter(r => r.brand_position).map(r => r.brand_position);
    const avgPos = positions.length
      ? (positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(1)
      : "N/A";
    // Questions sans marque (gap)
    const missingQ = res.filter(r => !r.brand_mentioned).length;
    return `  Présence marque: ${pct}% (${withBrand}/${total} réponses LLM)
  Questions sans marque: ${missingQ} (gaps à combler)
  Cité en source URL: ${withSource} fois
  Position moy. dans les listes: ${avgPos}
  Par provider: ${provSummary || "N/A"}
  Top concurrents cités: ${[...compNames].slice(0, 6).join(", ") || "aucun"}
  Top domaines cités par les LLMs: ${topD || "N/A"}`;
  };

  const sitesData = metrics.map((m, i) => {
    const sf = m.sf || {};
    const rv = resultVals[i] || {};
    return `
SITE: ${m.site.label} (score GEO-readiness: ${siteScores[i] ?? "N/A"}/100)
— Technique Screaming Frog:
  Title longueur moy.: ${sf.avgTitleLen ?? "N/A"} car.  |  Meta: ${sf.avgMetaLen ?? "N/A"} car.  |  H1: ${sf.avgH1Len ?? "N/A"} car.
  Mots moyens/page: ${sf.avgWords ?? "N/A"}  |  Score Flesch: ${sf.avgFlesch ?? "N/A"}
  Liens entrants uniques moy.: ${sf.avgInlinksUniq ?? "N/A"}  |  Profondeur: ${sf.avgDepth ?? "N/A"}
  Pages avec Schema: ${sf.schemaRate ?? "N/A"}%  |  Types: ${Object.entries(sf.schemaTypes || {}).map(([k, v]) => `${k}:${v}`).join(", ") || "aucun"}
  Pages avec tableau: ${sf.tableRate ?? "N/A"}%  |  Taux erreurs: ${sf.errorRate ?? "N/A"}%
  Nb pages indexées: ${sf.totalPages ?? "N/A"}
— KPIs SEO/Analytics:
  Clics GSC: ${rv.clicks ?? 0}  |  Impressions: ${rv.impressions ?? 0}  |  CTR: ${rv.ctr ?? 0}%  |  Position moy.: ${rv.position ?? 0}
  Sessions GA4: ${rv.sessions ?? 0}  |  Vues GA4: ${rv.views ?? 0}
  Citations Bing AI: ${rv.geoMentions ?? 0}
— Fan-outs GEO (présence dans les LLMs):
${geoSummary(m.site.id)}`;
  }).join("\n\n");

  // Comparative (≥2 sites)
  const comparativeData = metrics.length >= 2 ? (() => {
    const names  = metrics.map(m => m.site.label);
    const scores = metrics.map((m, i) => `${m.site.label}: ${siteScores[i] ?? "N/A"}/100`).join(", ");
    const dims   = ["avgFlesch", "avgInlinksUniq", "avgWords", "schemaRate", "tableRate", "avgTitleLen", "avgDepth", "errorRate"];
    const dimLabels = { avgFlesch: "Flesch", avgInlinksUniq: "Maillage interne", avgWords: "Mots/page", schemaRate: "Schema %", tableRate: "Tableaux %", avgTitleLen: "Title", avgDepth: "Profondeur", errorRate: "Erreurs %" };
    const deltas = dims.map(k => {
      const vals = metrics.map(m => ({ site: m.site.label, val: m.sf?.[k] ?? null })).filter(v => v.val !== null);
      if (vals.length < 2) return null;
      const lowerBetter = ["avgDepth", "errorRate"].includes(k);
      const best  = vals.reduce((a, b) => lowerBetter ? (a.val < b.val ? a : b) : (a.val > b.val ? a : b));
      const worst = vals.reduce((a, b) => lowerBetter ? (a.val > b.val ? a : b) : (a.val < b.val ? a : b));
      const delta = Math.abs(best.val - worst.val);
      if (delta < 0.01) return null;
      return `${dimLabels[k]}: ${best.site} mène (${Math.round(best.val * 10) / 10}) vs ${worst.site} (${Math.round(worst.val * 10) / 10})`;
    }).filter(Boolean).join("\n  ");
    // GEO comparative
    const geoComp = metrics.map(m => {
      const res = geoResults.filter(r => r.site_id === m.site.id);
      const pct = res.length ? Math.round(res.filter(r => r.brand_mentioned).length / res.length * 100) : null;
      return `${m.site.label}: ${pct !== null ? pct + "%" : "N/A"} présence LLM`;
    }).join(" | ");
    return `\n\nANALYSE COMPARATIVE (${names.join(" vs ")}):\nScores GEO-readiness: ${scores}\nPrésence Fan-outs: ${geoComp}\n\nÉcarts techniques:\n  ${deltas}\n\nKPIs résultats:\n  ${metrics.map((m, i) => { const rv = resultVals[i] || {}; return `${m.site.label} — clics:${rv.clicks ?? 0} pos:${rv.position ?? 0} Bing:${rv.geoMentions ?? 0}`; }).join("\n  ")}`;
  })() : "";

  // Top correlations
  const topCorr = corrMatrix
    .flatMap(({ dim, corrs }) => corrs
      .filter(c => c.value !== null && Math.abs(c.value) >= 0.25)
      .map(c => ({ label: `${dim.label} ↔ ${c.kpi.label}`, value: c.value, abs: Math.abs(c.value) })))
    .sort((a, b) => b.abs - a.abs).slice(0, 8)
    .map(c => `  ${c.label}: ${c.value > 0 ? "+" : ""}${c.value.toFixed(2)}`).join("\n");

  const siteIds = metrics.map(m => `"${m.site.id}": {"quick_wins": [], "moyen_terme": [], "long_terme": []}`).join(", ");
  const hasGeo  = geoResults.length > 0;

  return `Tu es un expert SEO/GEO senior. Analyse ces données et retourne UNIQUEMENT un objet JSON valide.

DONNÉES SITES:
${sitesData}
${comparativeData}

CORRÉLATIONS SIGNIFICATIVES (|r|≥0.25):
${topCorr || "Aucune corrélation significative détectée."}

STRUCTURE JSON EXACTE:
{"insights_seo":[{"title":"...","detail":"...","impact":"fort|moyen|faible","action":"..."}],"insights_geo":[{"title":"...","detail":"...","impact":"fort|moyen|faible","action":"...","provider":"openai|gemini|perplexity|claude|all"}],"fan_out_gaps":[{"question_type":"...","competitor":"...","opportunity":"...","priority":"haute|moyenne|faible"}],"comparative":{"winner_seo":"...","winner_geo":"...","gap_analysis":[{"dimension":"...","leader":"...","gap":"...","opportunity":"..."}],"strategic_summary":"..."},"roadmaps":{${siteIds}}}

RÈGLES STRICTES:
- 2 insights SEO maximum (basés sur les corrélations SF et KPIs GSC/GA4)
- 3 insights GEO maximum${hasGeo ? " — AU MOINS 2 basés sur les données Fan-outs réelles (provider, concurrents, domaines cités)" : ""}
- fan_out_gaps: ${hasGeo ? "2 gaps maximum identifiés depuis les questions sans marque et les concurrents cités" : "tableau vide []"}
- 1 action par horizon (quick_wins, moyen_terme, long_terme) par site
- Chaque action roadmap: {"action":"...","metric":"...","why":"...","effort":"court|moyen|long","ice_impact":7,"ice_confidence":6,"ice_effort":5}
- ice_* sont des entiers de 1 à 10
- ${metrics.length === 1 ? 'comparative: winner_seo="", winner_geo="", gap_analysis=[], strategic_summary=""' : "max 3 gap_analysis"}
- JSON COMPLET ET VALIDE — ferme tous les tableaux et objets`;
}

// ── Recommendation helpers ────────────────────────────────────────
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
          project_id: projectId, site_id: m.site.id, analysis_id: analysisId,
          text: item.action, horizon,
          ice_impact: item.ice_impact ?? 5,
          ice_confidence: item.ice_confidence ?? 5,
          ice_effort: item.ice_effort ?? 5,
          done: false,
          metric: item.metric, why: item.why, effort: item.effort,
        });
      });
    });
  });
  return recs;
}

const HORIZON_CONFIG = {
  quick:  { label: "⚡ Quick Win",   color: "#059669", bg: "#ECFDF5", border: "#BBF7D0" },
  medium: { label: "📈 Moyen terme", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
  long:   { label: "🏗️ Long terme",  color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE" },
};

// ── Sub-components ────────────────────────────────────────────────
function IceScore({ impact, confidence, effort }) {
  const score = effort > 0 ? Math.round(impact * confidence / effort * 10) / 10 : 0;
  const color = score >= 8 ? "#059669" : score >= 4 ? "#D97706" : "#DC2626";
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <span style={{ fontSize: 10, color: C.textLight }}>ICE</span>
      <span style={{ fontWeight: 800, fontSize: 13, color }}>{score}</span>
      <span style={{ fontSize: 10, color: C.textLight }}>({impact}·{confidence}·{effort})</span>
    </div>
  );
}

function InsightCard({ insight, borderColor, isGeo }) {
  const impactColor = { fort: "#059669", moyen: "#D97706", faible: "#64748B" };
  const impactBg    = { fort: "#ECFDF5", moyen: "#FFFBEB", faible: "#F8FAFC" };
  const color = impactColor[insight.impact] || C.textLight;
  return (
    <div style={{ background: impactBg[insight.impact] || C.bg, border: `1px solid ${color}22`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: C.text, flex: 1 }}>{insight.title}</div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {isGeo && insight.provider && insight.provider !== "all" && (
            <span style={{ fontSize: 9, fontWeight: 700, color: "#7C3AED", background: "#F5F3FF", padding: "1px 6px", borderRadius: 8, textTransform: "uppercase" }}>{insight.provider}</span>
          )}
          <span style={{ fontSize: 10, fontWeight: 700, color, background: `${color}18`, padding: "2px 8px", borderRadius: 20, textTransform: "uppercase", letterSpacing: 0.8 }}>
            {insight.impact}
          </span>
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6, marginBottom: insight.action ? 8 : 0 }}>{insight.detail}</div>
      {insight.action && (
        <div style={{ fontSize: 11, fontWeight: 600, color: borderColor, background: `${borderColor}12`, padding: "5px 10px", borderRadius: 7, borderLeft: `3px solid ${borderColor}` }}>
          → {insight.action}
        </div>
      )}
    </div>
  );
}

function RecCard({ rec, site, onToggle }) {
  const h = HORIZON_CONFIG[rec.horizon] || HORIZON_CONFIG.quick;
  return (
    <div style={{ background: rec.done ? C.bg : C.white, border: `1px solid ${rec.done ? C.border : h.border}`, borderRadius: 12, padding: "14px 16px", opacity: rec.done ? 0.65 : 1, transition: "all 0.2s" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div onClick={onToggle} style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${rec.done ? "#059669" : C.border}`, background: rec.done ? "#059669" : C.white, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, marginTop: 1 }}>
          {rec.done && <span style={{ color: "#fff", fontSize: 12 }}>✓</span>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: rec.done ? C.textLight : C.text, textDecoration: rec.done ? "line-through" : "none", marginBottom: 6, lineHeight: 1.4 }}>
            {rec.text}
          </div>
          {rec.metric && <div style={{ fontSize: 11, color: C.textLight, marginBottom: 6 }}>📊 {rec.metric}</div>}
          {rec.why && <div style={{ fontSize: 11, color: C.textMid, lineHeight: 1.5, marginBottom: 8, fontStyle: "italic" }}>{rec.why}</div>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {site && <span style={{ fontSize: 10, fontWeight: 600, color: site.color, background: site.bg, border: `1px solid ${site.color}33`, padding: "2px 8px", borderRadius: 10 }}>{site.label}</span>}
            <span style={{ fontSize: 10, fontWeight: 600, color: h.color, background: h.bg, border: `1px solid ${h.border}`, padding: "2px 8px", borderRadius: 10 }}>{h.label}</span>
            {rec.effort && <span style={{ fontSize: 10, color: C.textLight, background: C.bg, padding: "2px 8px", borderRadius: 10 }}>⏱ {rec.effort}</span>}
            <IceScore impact={rec.ice_impact} confidence={rec.ice_confidence} effort={rec.ice_effort} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DataAvailability({ metrics, geoResults }) {
  const checks = [
    { label: "Screaming Frog",  ok: metrics.some(m => m.sf), icon: "🕷️" },
    { label: "GSC / GA4",       ok: metrics.some(m => m.gsc || m.ga), icon: "📊" },
    { label: "Bing Webmaster",  ok: metrics.some(m => m.bing), icon: "🤖" },
    { label: "Fan-outs GEO",    ok: geoResults.length > 0, icon: "🔍" },
  ];
  const count = checks.filter(c => c.ok).length;
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", marginBottom: 20, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7 }}>Données disponibles</span>
      {checks.map(c => (
        <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 12 }}>{c.icon}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: c.ok ? "#059669" : C.textLight, textDecoration: c.ok ? "none" : "line-through" }}>{c.label}</span>
          <span style={{ fontSize: 11 }}>{c.ok ? "✓" : "—"}</span>
        </div>
      ))}
      <span style={{ fontSize: 11, color: count >= 3 ? "#059669" : count >= 2 ? "#D97706" : "#DC2626", fontWeight: 700, marginLeft: "auto" }}>
        {count}/4 sources · {count >= 3 ? "Analyse complète" : count >= 2 ? "Analyse partielle" : "Données insuffisantes"}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────
export default function AnalyseTab({ metrics, corrMatrix, resultVals, analysis, setAnalysis, analysisLoading, setAnalysisLoading, analysisError, setAnalysisError, currentProjectId, sites, sfData = {}, gscData = {}, gaData = {}, bingData = {}, smData = {}, pageTypes = {}, geoResults = [], geoUrlIndex = [] }) {
  const [activeRoadmap, setActiveRoadmap] = useState(() => metrics[0]?.site.id || "");
  const [recs, setRecs]                   = useState([]);
  const [filterHorizon, setFilterHorizon] = useState("all");
  const [filterSite, setFilterSite]       = useState("all");
  const [showDone, setShowDone]           = useState(false);
  const [activeTab, setActiveTab]         = useState("insights"); // insights | roadmap | gaps | recs

  const hasData = metrics.some(m => m.sf !== null) || geoResults.length > 0;
  const hasSF   = metrics.some(m => m.sf !== null);

  // GEO gap stats
  const geoGapStats = useMemo(() => {
    if (!geoResults.length) return null;
    const missingByProvider = {};
    const competitorsByCount = {};
    geoResults.forEach(r => {
      if (!r.brand_mentioned) {
        if (!missingByProvider[r.provider_id]) missingByProvider[r.provider_id] = 0;
        missingByProvider[r.provider_id]++;
      }
      (r.competitors_mentioned || []).forEach(c => {
        if (c?.name) competitorsByCount[c.name] = (competitorsByCount[c.name] || 0) + 1;
      });
    });
    const totalMissing = geoResults.filter(r => !r.brand_mentioned).length;
    const topCompetitors = Object.entries(competitorsByCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { totalMissing, total: geoResults.length, missingByProvider, topCompetitors };
  }, [geoResults]);

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
      const siteScores = metrics.map(m => computeSiteScore(m.sf).score);
      const prompt = buildPrompt(metrics, corrMatrix, resultVals, siteScores, geoResults, geoUrlIndex);
      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          system: "Tu es un expert SEO/GEO senior. Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans backticks, sans texte avant ou après. Commence directement par { et termine par }.",
          messages: [
            { role: "user", content: prompt },
            { role: "assistant", content: "{" },
          ],
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = text.slice(0, 200);
        try { const j = JSON.parse(text); msg = j.error?.message || j.error || msg; } catch {}
        throw new Error(`Erreur ${res.status} : ${msg}`);
      }
      let data;
      try { data = JSON.parse(text); } catch { throw new Error("Réponse non-JSON : " + text.slice(0, 300)); }
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      const raw = "{" + (data.content?.map(b => b.text || "").join("") || "");
      let jsonStr = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      const start = jsonStr.indexOf("{");
      const end   = jsonStr.lastIndexOf("}");
      if (start === -1) throw new Error("Aucun JSON dans la réponse : " + raw.slice(0, 200));
      jsonStr = jsonStr.substring(start, end === -1 ? undefined : end + 1);
      let parsed = null;
      try { parsed = JSON.parse(jsonStr); } catch {
        let repaired = jsonStr;
        for (let attempt = 0; attempt < 30 && !parsed; attempt++) {
          repaired = repaired
            .replace(/,\s*"[^"]*"\s*:\s*"[^"]*$/, "")
            .replace(/,\s*"[^"]*"\s*:\s*[\d.]*$/, "")
            .replace(/,\s*"[^"]*"\s*:\s*$/, "")
            .replace(/,\s*"[^"]*"\s*$/, "")
            .replace(/,\s*\{[^{}]*$/, "")
            .replace(/,\s*\[[^\]]*$/, "");
          const ob = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;
          const oc = (repaired.match(/\{/g) || []).length - (repaired.match(/\}/g) || []).length;
          repaired += "]".repeat(Math.max(0, ob)) + "}".repeat(Math.max(0, oc));
          try { parsed = JSON.parse(repaired); } catch {}
        }
      }
      if (!parsed) throw new Error("Impossible de parser le JSON : " + jsonStr.slice(0, 300));
      setAnalysis(parsed);
      setActiveTab("insights");
      const analysisId = `analysis-${Date.now()}`;
      const newRecs = parseRecommendations(parsed, metrics, currentProjectId, analysisId);
      try {
        await sbSaveAnalysis({ id: analysisId, project_id: currentProjectId, content: JSON.stringify(parsed) });
        if (newRecs.length) await sbSaveRecommendations(newRecs);
        setRecs(prev => [...newRecs, ...prev]);
      } catch (e) { console.warn("Save failed:", e); }
    } catch (e) {
      setAnalysisError("Erreur : " + e.message);
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
    const ia = a.ice_effort > 0 ? a.ice_impact * a.ice_confidence / a.ice_effort : 0;
    const ib = b.ice_effort > 0 ? b.ice_impact * b.ice_confidence / b.ice_effort : 0;
    return ib - ia;
  });

  const horizonConfig = [
    { key: "quick_wins",  label: "⚡ Quick Wins",   sub: "1 jour – 2 semaines", color: "#059669", bg: "#ECFDF5" },
    { key: "moyen_terme", label: "📈 Moyen terme",  sub: "1 – 3 mois",          color: "#D97706", bg: "#FFFBEB" },
    { key: "long_terme",  label: "🏗️ Long terme",   sub: "3 – 12 mois",         color: "#7C3AED", bg: "#F5F3FF" },
  ];

  const TABS = [
    { key: "insights", label: "💡 Insights" },
    { key: "roadmap",  label: "🗺️ Roadmap" },
    ...(analysis?.fan_out_gaps?.length ? [{ key: "gaps", label: "🎯 Gaps Fan-outs" }] : []),
    { key: "recs",     label: `✅ Recommandations (${recs.length})` },
    { key: "templates", label: "📄 Templates" },
  ];

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text }}>✦ Analyse IA & Roadmaps</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textLight }}>
            Claude Sonnet · Insights SEO & GEO Fan-outs · Roadmaps actionnables
          </p>
        </div>
        <button onClick={runAnalysis} disabled={analysisLoading || !hasData}
          style={{ padding: "10px 24px", background: analysisLoading ? C.border : "#2563EB", color: analysisLoading ? C.textLight : "#fff", border: "none", borderRadius: 9, cursor: hasData && !analysisLoading ? "pointer" : "not-allowed", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, boxShadow: analysisLoading ? "none" : "0 2px 8px #2563EB33" }}>
          {analysisLoading
            ? <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span> Analyse en cours…</>
            : analysis ? "↻ Relancer" : "✦ Générer l'analyse"}
        </button>
      </div>
      <InfoCard tabKey="analyse" />

      {/* ── Data availability ── */}
      <DataAvailability metrics={metrics} geoResults={geoResults} />

      {/* ── Alerts ── */}
      {!hasData && (
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: "14px 18px", marginBottom: 16, fontSize: 13, color: "#92400E" }}>
          ⚠️ Importez au moins un fichier CSV Screaming Frog ou lancez des Fan-outs pour générer l'analyse.
        </div>
      )}
      {!hasSF && geoResults.length > 0 && (
        <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 12, padding: "14px 18px", marginBottom: 16, fontSize: 13, color: "#1D4ED8" }}>
          ℹ️ Données Fan-outs disponibles ({geoResults.length} résultats). L'analyse sera enrichie avec les données Screaming Frog si vous les importez.
        </div>
      )}
      {analysisError && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 12, padding: "14px 18px", marginBottom: 16, fontSize: 13, color: "#DC2626" }}>
          {analysisError}
        </div>
      )}

      {/* ── GEO gap preview (before analysis) ── */}
      {!analysis && geoGapStats && (
        <div style={{ background: C.white, border: "1px solid #DDD6FE", borderRadius: 14, padding: "20px 24px", marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#7C3AED", marginBottom: 14 }}>🔍 Aperçu Fan-outs — données disponibles</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
            {[
              { label: "Total réponses", value: geoGapStats.total, color: C.text },
              { label: "Sans marque", value: geoGapStats.totalMissing, color: "#DC2626", sub: `${Math.round(geoGapStats.totalMissing / geoGapStats.total * 100)}% de gaps` },
              { label: "Avec marque", value: geoGapStats.total - geoGapStats.totalMissing, color: "#059669", sub: `${Math.round((geoGapStats.total - geoGapStats.totalMissing) / geoGapStats.total * 100)}% présence` },
            ].map(k => (
              <div key={k.label} style={{ background: C.bg, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7 }}>{k.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: k.color }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: 10, color: C.textLight }}>{k.sub}</div>}
              </div>
            ))}
          </div>
          {geoGapStats.topCompetitors.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>Top concurrents cités à votre place</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {geoGapStats.topCompetitors.map(([name, count]) => (
                  <div key={name} style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "4px 12px", fontSize: 12, fontWeight: 600, color: "#DC2626" }}>
                    {name} · {count}×
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: 16, fontSize: 12, color: "#7C3AED", fontStyle: "italic" }}>
            → Lancez l'analyse pour obtenir des pistes actionnables basées sur ces données Fan-outs.
          </div>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {analysisLoading && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
          {[1, 2].map(i => (
            <div key={i} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
              <div style={{ height: 16, background: C.borderLight, borderRadius: 6, width: "40%", marginBottom: 16 }} />
              {[1, 2, 3].map(j => <div key={j} style={{ height: 60, background: C.bg, borderRadius: 8, marginBottom: 10 }} />)}
            </div>
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {!analysis && !analysisLoading && hasData && (
        <div style={{ background: C.white, border: `2px dashed ${C.border}`, borderRadius: 14, padding: "60px 40px", textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>✦</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 8 }}>Prêt à analyser</div>
          <div style={{ fontSize: 13, color: C.textLight, maxWidth: 460, margin: "0 auto" }}>
            Générez l'analyse pour obtenir des insights SEO & GEO, les gaps Fan-outs, et des roadmaps actionnables basés sur vos données.
          </div>
        </div>
      )}

      {/* ── Analysis tabs ── */}
      {analysis && !analysisLoading && (
        <>
          {/* Sub-nav */}
          <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: `2px solid ${C.border}`, paddingBottom: 0 }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                padding: "8px 16px", border: "none", borderBottom: `2px solid ${activeTab === t.key ? "#2563EB" : "transparent"}`,
                background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: activeTab === t.key ? 700 : 500,
                color: activeTab === t.key ? "#2563EB" : C.textMid, marginBottom: -2, transition: "all 0.15s",
              }}>{t.label}</button>
            ))}
          </div>

          {/* Insights tab */}
          {activeTab === "insights" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>
              {[
                { key: "insights_seo", label: "🔍 Leviers SEO", sub: "Corrélations SF × GSC/GA4/Bing", border: "#2563EB", isGeo: false },
                { key: "insights_geo", label: "🤖 Leviers GEO", sub: "Fan-outs LLM · providers · concurrents", border: "#7C3AED", isGeo: true },
              ].map(({ key, label, sub, border, isGeo }) => (
                <div key={key} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, borderLeft: `4px solid ${border}` }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>{label}</div>
                    <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>{sub}</div>
                  </div>
                  <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                    {(analysis[key] || []).length === 0
                      ? <div style={{ fontSize: 12, color: C.textLight, fontStyle: "italic" }}>Aucun insight généré.</div>
                      : (analysis[key] || []).map((ins, i) => <InsightCard key={i} insight={ins} borderColor={border} isGeo={isGeo} />)
                    }
                  </div>
                </div>
              ))}

              {/* Comparative */}
              {metrics.length >= 2 && analysis.comparative?.strategic_summary && (
                <div style={{ gridColumn: "1 / -1", background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, borderLeft: "4px solid #7C3AED" }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>⚖️ Analyse comparative</div>
                    <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>{metrics.map(m => m.site.label).join(" · ")}</div>
                  </div>
                  <div style={{ padding: "20px 24px" }}>
                    <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10, padding: "14px 16px", marginBottom: 20, fontSize: 13, color: "#4C1D95", lineHeight: 1.7 }}>
                      {analysis.comparative.strategic_summary}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                      {[
                        { key: "winner_seo", icon: "🔍", label: "Leader SEO", color: "#2563EB", bg: "#EFF6FF" },
                        { key: "winner_geo", icon: "🤖", label: "Leader GEO", color: "#7C3AED", bg: "#F5F3FF" },
                      ].map(({ key, icon, label, color, bg }) => analysis.comparative[key] ? (
                        <div key={key} style={{ background: bg, border: `1px solid ${color}33`, borderRadius: 10, padding: "12px 16px" }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>{icon} {label}</div>
                          <div style={{ fontSize: 13, color: C.text }}>{analysis.comparative[key]}</div>
                        </div>
                      ) : null)}
                    </div>
                    {(analysis.comparative.gap_analysis || []).map((gap, i) => (
                      <div key={i} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#D97706", background: "#FFFBEB", padding: "2px 8px", borderRadius: 10 }}>{gap.dimension}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>→ {gap.leader} en tête</span>
                        </div>
                        <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6, marginBottom: 4 }}>{gap.gap}</div>
                        {gap.opportunity && (
                          <div style={{ fontSize: 11, color: "#059669", background: "#ECFDF5", padding: "4px 10px", borderRadius: 7, display: "inline-block" }}>💡 {gap.opportunity}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Roadmap tab */}
          {activeTab === "roadmap" && (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 28 }}>
              <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: C.text, marginRight: 8 }}>🗺️ Roadmap par site</span>
                {metrics.map(({ site: s }) => (
                  <button key={s.id} onClick={() => setActiveRoadmap(s.id)} style={{ padding: "6px 16px", border: `2px solid ${activeRoadmap === s.id ? s.color : C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: activeRoadmap === s.id ? 700 : 400, background: activeRoadmap === s.id ? s.bg : C.white, color: activeRoadmap === s.id ? s.color : C.textMid }}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div style={{ padding: 24 }}>
                {(() => {
                  const rm = analysis.roadmaps?.[activeRoadmap];
                  if (!rm) return <div style={{ color: C.textLight, fontSize: 13 }}>Aucune roadmap pour ce site.</div>;
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
                      {horizonConfig.map(({ key, label, sub, color, bg }) => (
                        <div key={key} style={{ background: bg, border: `1px solid ${color}33`, borderRadius: 12, overflow: "hidden" }}>
                          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${color}22` }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color }}>{label}</div>
                            <div style={{ fontSize: 11, color: `${color}99`, marginTop: 2 }}>{sub}</div>
                          </div>
                          <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                            {(rm[key] || []).length === 0
                              ? <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucune action générée.</div>
                              : (rm[key] || []).map((item, i) => (
                                <div key={i} style={{ background: C.white, borderRadius: 9, padding: "12px 14px", border: `1px solid ${color}22` }}>
                                  <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 4 }}>{item.action}</div>
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                                    <span style={{ background: `${color}15`, color, padding: "1px 7px", borderRadius: 10, fontSize: 10, fontWeight: 600 }}>{item.metric}</span>
                                    <span style={{ background: C.bg, color: C.textMid, padding: "1px 7px", borderRadius: 10, fontSize: 10 }}>⏱ {item.effort}</span>
                                    {item.ice_impact && <span style={{ background: C.bg, color: C.textMid, padding: "1px 7px", borderRadius: 10, fontSize: 10 }}>ICE {Math.round(item.ice_impact * item.ice_confidence / (item.ice_effort || 1) * 10) / 10}</span>}
                                  </div>
                                  <div style={{ fontSize: 11, color: C.textMid, lineHeight: 1.5 }}>{item.why}</div>
                                </div>
                              ))
                            }
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Gaps Fan-outs tab */}
          {activeTab === "gaps" && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#7C3AED", marginBottom: 16 }}>🎯 Gaps Fan-outs identifiés</div>
              {(analysis.fan_out_gaps || []).length === 0
                ? <div style={{ fontSize: 13, color: C.textLight, fontStyle: "italic" }}>Aucun gap identifié.</div>
                : (analysis.fan_out_gaps || []).map((gap, i) => {
                  const prioColor = { haute: "#DC2626", moyenne: "#D97706", faible: "#64748B" };
                  const prioBg    = { haute: "#FEF2F2", moyenne: "#FFFBEB", faible: "#F8FAFC" };
                  return (
                    <div key={i} style={{ background: prioBg[gap.priority] || C.bg, border: `1px solid ${prioColor[gap.priority] || C.border}33`, borderRadius: 12, padding: "16px 20px", marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: prioColor[gap.priority], background: prioBg[gap.priority], border: `1px solid ${prioColor[gap.priority]}33`, padding: "2px 10px", borderRadius: 20, textTransform: "uppercase" }}>
                          {gap.priority}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{gap.question_type}</span>
                        {gap.competitor && (
                          <span style={{ fontSize: 11, color: "#DC2626", background: "#FEF2F2", padding: "2px 8px", borderRadius: 8 }}>vs {gap.competitor}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>{gap.opportunity}</div>
                    </div>
                  );
                })
              }
            </div>
          )}

          {/* Recommendations tab */}
          {activeTab === "recs" && (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 28 }}>
              <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>✅ Recommandations</div>
                    <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>
                      {recs.filter(r => r.done).length}/{recs.length} réalisées · triées par ICE
                    </div>
                  </div>
                  <button onClick={() => setShowDone(s => !s)} style={{ padding: "5px 12px", border: `1px solid ${C.border}`, borderRadius: 7, background: showDone ? "#EFF6FF" : C.white, color: showDone ? "#2563EB" : C.textMid, fontSize: 11, cursor: "pointer", fontWeight: showDone ? 600 : 400 }}>
                    {showDone ? "Masquer réalisées" : "Afficher réalisées"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select value={filterHorizon} onChange={e => setFilterHorizon(e.target.value)} style={{ padding: "5px 10px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, color: C.textMid, cursor: "pointer" }}>
                    <option value="all">Tous horizons</option>
                    <option value="quick">⚡ Quick Win</option>
                    <option value="medium">📈 Moyen terme</option>
                    <option value="long">🏗️ Long terme</option>
                  </select>
                  <select value={filterSite} onChange={e => setFilterSite(e.target.value)} style={{ padding: "5px 10px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, color: C.textMid, cursor: "pointer" }}>
                    <option value="all">Tous les sites</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
                {filteredRecs.length === 0
                  ? <div style={{ fontSize: 13, color: C.textLight, textAlign: "center", padding: "20px 0" }}>
                      {recs.length === 0 ? "Génère une analyse pour créer des recommandations." : "Aucune recommandation avec ces filtres."}
                    </div>
                  : filteredRecs.map(rec => (
                    <RecCard key={rec.id} rec={rec} site={sites.find(s => s.id === rec.site_id)} onToggle={() => toggleRec(rec)} />
                  ))
                }
              </div>
            </div>
          )}

          {/* Templates tab */}
          {activeTab === "templates" && (
            <TemplateAnalysis sites={sites} sfData={sfData} gscData={gscData} gaData={gaData} bingData={bingData} smData={smData} pageTypes={pageTypes} />
          )}
        </>
      )}

      {/* Templates always shown when no analysis */}
      {!analysis && !analysisLoading && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 3, height: 20, background: "#2563EB", borderRadius: 2 }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Analyse templates × pages à succès</div>
          </div>
          <TemplateAnalysis sites={sites} sfData={sfData} gscData={gscData} gaData={gaData} bingData={bingData} smData={smData} pageTypes={pageTypes} />
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}