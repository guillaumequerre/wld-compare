import { useState } from "react";
import { C } from "../lib/constants.js";

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
      ? `{"quick_wins": [{"action": "action concrète", "metric": "métrique SF concernée", "why": "pourquoi basé sur les données", "effort": "1-3j|1sem|2sem"}], "moyen_terme": [{"action": "action concrète", "metric": "métrique SF concernée", "why": "pourquoi basé sur les données", "effort": "1mois|2mois|3mois"}], "long_terme": [{"action": "action concrète", "metric": "métrique SF concernée", "why": "pourquoi basé sur les données", "effort": "3-6mois|6-12mois"}]}`
      : `{"quick_wins": [], "moyen_terme": [], "long_terme": []}`
    }`).join(",\n    ")}
  }
}

Règles:
- 3 insights SEO et 3 insights GEO maximum
- 2 actions par horizon temporel par site maximum
- Chaque action doit être concrète et basée sur les données
- Distingue les leviers SEO (GSC/GA4) des leviers GEO (Bing AI)
- Réponds UNIQUEMENT avec le JSON valide et complet, sans texte avant ou après
- IMPORTANT: le JSON doit être complet et bien fermé, ne tronque pas`;
}

export default function AnalyseTab({ metrics, corrMatrix, resultVals, analysis, setAnalysis, analysisLoading, setAnalysisLoading, analysisError, setAnalysisError }) {
  const [activeRoadmap, setActiveRoadmap] = useState(() => metrics[0]?.site.id || "");
  const hasData = metrics.some(m => m.sf !== null);

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
      let attempts = 0;
      while (attempts++ < 20) {
        try { const parsed = JSON.parse(jsonStr); setAnalysis(parsed); break; }
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
    } catch (e) {
      setAnalysisError("Erreur lors de l'analyse : " + e.message);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const impactColor = (impact) => impact === "fort" ? C.green : impact === "moyen" ? C.amber : C.textLight;
  const impactBg    = (impact) => impact === "fort" ? C.greenLight : impact === "moyen" ? C.amberLight : C.bg;

  const horizonConfig = [
    { key: "quick_wins",  label: "⚡ Quick Wins",   sub: "1 jour – 2 semaines", color: C.green,  bg: C.greenLight  },
    { key: "moyen_terme", label: "📈 Moyen terme",  sub: "1 – 3 mois",          color: C.amber,  bg: C.amberLight  },
    { key: "long_terme",  label: "🏗️ Long terme",   sub: "3 – 12 mois",         color: C.purple, bg: C.purpleLight },
  ];

  return (
    <div>
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
                        <span style={{ fontSize: 10, fontWeight: 700, color: impactColor(insight.impact), background: `${impactColor(insight.impact)}18`, padding: "2px 8px", borderRadius: 20, textTransform: "uppercase", letterSpacing: 0.8 }}>
                          impact {insight.impact}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>{insight.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
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
        <div style={{ background: C.white, border: `2px dashed ${C.border}`, borderRadius: 14, padding: "60px 40px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>✦</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 8 }}>Prêt à analyser</div>
          <div style={{ fontSize: 13, color: C.textLight, maxWidth: 400, margin: "0 auto" }}>
            Cliquez sur "Générer l'analyse" pour obtenir les insights SEO/GEO et les roadmaps basés sur vos données et les corrélations calculées.
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}