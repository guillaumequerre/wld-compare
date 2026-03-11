import InfoCard from "../components/InfoCard";
import { useState, useEffect } from "react";
import { C } from "../lib/constants";
import { sbSaveAnalysis, sbGetLatestAnalysis, sbSaveRecommendations, sbGetRecommendations, sbUpdateRecommendation } from "../lib/supabase";

function buildPrompt(metrics, corrMatrix, resultVals) {
  const sitesData = metrics.map((m, i) => {
    const sf = m.sf || {};
    const rv = resultVals[i] || {};
    return `
SITE: ${m.site.label}
— Screaming Frog:
  Title longueur moy.: ${sf.avgTitleLen ?? "N/A"} car.
  Meta longueur moy.: ${sf.avgMetaLen ?? "N/A"} car.
  H1 longueur moy.: ${sf.avgH1Len ?? "N/A"} car.
  Mots moyens/page: ${sf.avgWords ?? "N/A"}
  Poids pages (KB): ${sf.avgPageSizeKB ?? "N/A"}
  Poids images (KB): ${sf.avgImgSizeKB ?? "N/A"}
  Liens entrants uniques moy.: ${sf.avgInlinksUniq ?? "N/A"}
  Liens sortants uniques moy.: ${sf.avgOutlinksUniq ?? "N/A"}
  Liens ext. uniques moy.: ${sf.avgExtLinksUniq ?? "N/A"}
  Profondeur crawl: ${sf.avgDepth ?? "N/A"}
  Score Flesch: ${sf.avgFlesch ?? "N/A"}
  Pages avec tableau: ${sf.tableRate ?? "N/A"}%
  Pages avec Schema: ${sf.schemaRate ?? "N/A"}%
  Types de schema: ${Object.entries(sf.schemaTypes || {}).map(([k, v]) => k + ":" + v).join(", ") || "aucun"}
  Taux erreurs: ${sf.errorRate ?? "N/A"}%
  Taux redirections: ${sf.redirectRate ?? "N/A"}%
  Nb pages: ${sf.totalPages ?? "N/A"}
— Résultats GSC/GA4/Bing:
  Clics GSC: ${rv.clicks ?? 0}
  Impressions GSC: ${rv.impressions ?? 0}
  CTR: ${rv.ctr ?? 0}%
  Position moy.: ${rv.position ?? 0}
  Sessions GA4: ${rv.sessions ?? 0}
  Vues GA4: ${rv.views ?? 0}
  Citations Bing AI: ${rv.geoMentions ?? 0}`;
  }).join("\n\n");

  const topCorr = corrMatrix.flatMap(({ dim, corrs }) =>
    corrs.filter(c => c.value !== null && Math.abs(c.value) >= 0.4)
      .map(c => `${dim.label} ↔ ${c.kpi.label}: ${c.value > 0 ? "+" : ""}${c.value}`)
  ).join("\n");

  return `Tu es un expert SEO et GEO (Generative Engine Optimization). Tu analyses des données de sites web concurrents et tu dois produire une analyse stratégique et des roadmaps actionnables.

DONNÉES DES SITES:
${sitesData}

CORRÉLATIONS SIGNIFICATIVES (Pearson ≥ 0.4 ou ≤ -0.4):
${topCorr || "Données insuffisantes pour calculer des corrélations significatives."}

INSTRUCTIONS:
Produis un JSON STRICT avec exactement cette structure (rien d'autre, pas de markdown, pas de backticks):
{
  "insights_seo": [
    {"title": "titre court", "detail": "1-2 phrases max", "impact": "fort|moyen|faible"}
  ],
  "insights_geo": [
    {"title": "titre court", "detail": "1-2 phrases max", "impact": "fort|moyen|faible"}
  ],
  "roadmaps": {
    ${metrics.map((m, i) => `"${m.site.id}": ${i === 0
      ? `{"quick_wins": [{"action": "action concrète", "metric": "métrique SF concernée", "why": "pourquoi basé sur les données", "effort": "1-3j|1sem|2sem", "ice_impact": 7, "ice_confidence": 6, "ice_effort": 3}], "moyen_terme": [{"action": "action concrète", "metric": "métrique SF concernée", "why": "pourquoi basé sur les données", "effort": "1mois|2mois|3mois", "ice_impact": 7, "ice_confidence": 6, "ice_effort": 5}], "long_terme": [{"action": "action concrète", "metric": "métrique SF concernée", "why": "pourquoi basé sur les données", "effort": "3-6mois|6-12mois", "ice_impact": 7, "ice_confidence": 6, "ice_effort": 8}]}`
      : `{"quick_wins": [], "moyen_terme": [], "long_terme": []}`
    }`).join(",\n    ")}
  }
}

Règles:
- 3 insights SEO et 3 insights GEO maximum
- 2 actions par horizon temporel par site maximum
- Chaque action doit être concrète et basée sur les données
- ice_impact, ice_confidence, ice_effort : scores 1-10
- Distingue les leviers SEO (GSC/GA4) des leviers GEO (Bing AI)
- Réponds UNIQUEMENT avec le JSON valide et complet, sans texte avant ou après
- IMPORTANT: le JSON doit être complet et bien fermé, ne tronque pas`;
}

// Parse analysis JSON into flat recommendation cards
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

function RecCard({ rec, site, onToggle, onIceChange }) {
  const h = HORIZON_CONFIG[rec.horizon] || HORIZON_CONFIG.quick;
  return (
    <div style={{ background: rec.done ? C.bg : C.white, border: `1px solid ${rec.done ? C.border : h.border}`, borderRadius: 12, padding: "14px 16px", opacity: rec.done ? 0.65 : 1, transition: "all 0.2s" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {/* Checkbox */}
        <div
          onClick={onToggle}
          style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${rec.done ? C.green : C.border}`, background: rec.done ? C.green : C.white, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, marginTop: 1, transition: "all 0.15s" }}
        >
          {rec.done && <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>✓</span>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: rec.done ? C.textLight : C.text, textDecoration: rec.done ? "line-through" : "none", marginBottom: 8, lineHeight: 1.4 }}>{rec.text}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {/* Site tag */}
            {site && (
              <span style={{ fontSize: 10, fontWeight: 600, color: site.color, background: site.bg, border: `1px solid ${site.color}33`, padding: "2px 8px", borderRadius: 10 }}>{site.label}</span>
            )}
            {/* Horizon tag */}
            <span style={{ fontSize: 10, fontWeight: 600, color: h.color, background: h.bg, border: `1px solid ${h.border}`, padding: "2px 8px", borderRadius: 10 }}>{h.label}</span>
            {/* ICE score */}
            <IceScore impact={rec.ice_impact} confidence={rec.ice_confidence} effort={rec.ice_effort} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AnalyseTab({ metrics, corrMatrix, resultVals, analysis, setAnalysis, analysisLoading, setAnalysisLoading, analysisError, setAnalysisError, currentProjectId, sites }) {
  const [activeRoadmap, setActiveRoadmap] = useState(() => metrics[0]?.site.id || "");
  const [recs, setRecs] = useState([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [filterHorizon, setFilterHorizon] = useState("all");
  const [filterSite, setFilterSite] = useState("all");
  const [showDone, setShowDone] = useState(false);
  const hasData = metrics.some(m => m.sf !== null);

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
      const prompt = buildPrompt(metrics, corrMatrix, resultVals);
      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 3500,
          messages: [{ role: "user", content: prompt }],
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
      const data = JSON.parse(text);
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      const raw = data.content?.map(b => b.text || "").join("") || "";
      const clean = raw.replace(/```json|```/g, "").trim();
      const start = clean.indexOf("{");
      const end = clean.lastIndexOf("}");
      if (start === -1 || end === -1) throw new Error("La réponse ne contient pas de JSON valide");
      let jsonStr = clean.substring(start, end + 1);
      let parsed = null;
      let attempts = 0;
      while (attempts++ < 20) {
        try { parsed = JSON.parse(jsonStr); break; }
        catch {
          jsonStr = jsonStr
            .replace(/,\s*"[^"]*"\s*:\s*[^,}\]]*$/, "")
            .replace(/,\s*\{[^}]*$/, "")
            .replace(/,\s*"[^"]*"$/, "");
          const opens = (jsonStr.match(/\[/g) || []).length - (jsonStr.match(/\]/g) || []).length;
          const objs  = (jsonStr.match(/\{/g) || []).length - (jsonStr.match(/\}/g) || []).length;
          jsonStr += "]".repeat(Math.max(0, opens)) + "}".repeat(Math.max(0, objs));
        }
      }
      if (!parsed) throw new Error("Impossible de parser le JSON de l'analyse");
      setAnalysis(parsed);

      // Save analysis + parse recommendations
      const analysisId = `analysis-${Date.now()}`;
      const newRecs = parseRecommendations(parsed, metrics, currentProjectId, analysisId);
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

  const impactColor = (impact) => impact === "fort" ? C.green : impact === "moyen" ? C.amber : C.textLight;
  const impactBg    = (impact) => impact === "fort" ? C.greenLight : impact === "moyen" ? C.amberLight : C.bg;
  const horizonConfig = [
    { key: "quick_wins",  label: "⚡ Quick Wins",   sub: "1 jour – 2 semaines", color: C.green,  bg: C.greenLight  },
    { key: "moyen_terme", label: "📈 Moyen terme",  sub: "1 – 3 mois",          color: C.amber,  bg: C.amberLight  },
    { key: "long_terme",  label: "🏗️ Long terme",   sub: "3 – 12 mois",         color: C.purple, bg: C.purpleLight },
  ];

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
      <InfoCard tabKey="analyse" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text, fontFamily: "'Georgia', serif", letterSpacing: -0.5 }}>
            Analyse IA & Roadmaps
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textLight }}>
            Analyse Claude Sonnet · insights SEO & GEO · roadmaps actionnables par site
          </p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={analysisLoading || !hasData}
          style={{ padding: "10px 24px", background: analysisLoading ? C.border : C.blue, color: analysisLoading ? C.textLight : "#fff", border: "none", borderRadius: 9, cursor: hasData && !analysisLoading ? "pointer" : "not-allowed", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s", boxShadow: analysisLoading ? "none" : "0 2px 8px #2563EB33" }}
        >
          {analysisLoading ? <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span> Analyse en cours…</> : analysis ? "↻ Relancer l'analyse" : "✦ Générer l'analyse"}
        </button>
      </div>

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

      {analysis && !analysisLoading && (
        <>
          {/* Insights */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>
            {[
              { key: "insights_seo", label: "🔍 Leviers SEO", sub: "Basés sur corrélations GSC & GA4", border: C.blue },
              { key: "insights_geo", label: "🤖 Leviers GEO", sub: "Basés sur corrélations Bing AI",   border: C.purple },
            ].map(({ key, label, sub, border }) => (
              <div key={key} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, borderLeft: `4px solid ${border}` }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{label}</div>
                  <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>{sub}</div>
                </div>
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {(analysis[key] || []).map((insight, i) => (
                    <div key={i} style={{ background: impactBg(insight.impact), border: `1px solid ${impactColor(insight.impact)}22`, borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{insight.title}</div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: impactColor(insight.impact), background: `${impactColor(insight.impact)}18`, padding: "2px 8px", borderRadius: 20, textTransform: "uppercase", letterSpacing: 0.8 }}>impact {insight.impact}</span>
                      </div>
                      <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>{insight.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Roadmap visuelle */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 28 }}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 12 }}>🗺️ Roadmaps par site</div>
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
                              <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 4 }}>{item.action}</div>
                              <div style={{ fontSize: 11, color: C.textLight, marginBottom: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                                <span style={{ background: `${color}15`, color, padding: "1px 7px", borderRadius: 10, fontWeight: 500 }}>{item.metric}</span>
                                <span style={{ background: C.bg, color: C.textMid, padding: "1px 7px", borderRadius: 10 }}>⏱ {item.effort}</span>
                                {item.ice_impact && <span style={{ background: C.bg, color: C.textMid, padding: "1px 7px", borderRadius: 10 }}>ICE: {Math.round(item.ice_impact * item.ice_confidence / (item.ice_effort || 1) * 10) / 10}</span>}
                              </div>
                              <div style={{ fontSize: 11, color: C.textMid, lineHeight: 1.5 }}>{item.why}</div>
                            </div>
                          ))}
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
            Cliquez sur "Générer l'analyse" pour obtenir les insights SEO/GEO et les roadmaps basés sur vos données et les corrélations calculées.
          </div>
        </div>
      )}

      {/* ── Recommandations sauvegardées ── */}
      {(recs.length > 0 || analysis) && (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
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
            {/* Filters */}
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

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}