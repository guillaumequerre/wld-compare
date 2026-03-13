import { useMemo } from "react";
import { C, SF_DIMS, PAGE_TYPE_MAP } from "../lib/constants";
import { computeSiteScore, scoreLabel } from "../lib/scoring";

const DIM_LABEL = Object.fromEntries(SF_DIMS.map(d => [d.key, d.label]));

function normPath(url = "") {
  try { url = new URL(url).pathname; } catch (_) {}
  return url.replace(/\/$/, "").toLowerCase();
}

function buildBingByTemplate(sfRows, bingRows, ptMap) {
  const bingMap = {};
  bingRows.forEach(r => {
    const path = normPath(r["adresse"] || r["url"] || "");
    bingMap[path] = (bingMap[path] || 0) + 1;
  });
  const byTemplate = {};
  sfRows.forEach(r => {
    const url = (r["adresse"] || r["address"] || r["url"] || "").trim();
    const path = normPath(url);
    const tpl = (ptMap || {})[url] || (ptMap || {})[path] || "autre";
    if (!byTemplate[tpl]) byTemplate[tpl] = { pages: 0, citations: 0 };
    byTemplate[tpl].pages++;
    byTemplate[tpl].citations += bingMap[path] || 0;
  });
  return byTemplate;
}

export default function AuditGeoTab({ metrics, corrMatrix, resultVals, analysis, sites, sfData, bingData, pageTypes }) {
  const auditSite  = sites[0];
  const benchSites = useMemo(() => sites.slice(1), [sites]);
  const auditM     = metrics[0];
  const benchMs    = useMemo(() => metrics.slice(1), [metrics]);

  const auditScore  = useMemo(() => computeSiteScore(auditM?.sf), [auditM]);
  const benchScores = useMemo(() => benchMs.map(m => computeSiteScore(m?.sf)), [benchMs]);
  const auditLabel  = scoreLabel(auditScore.score);

  const auditBing     = resultVals[0]?.geoMentions ?? 0;
  const auditClics    = resultVals[0]?.clicks       ?? 0;
  const auditSessions = resultVals[0]?.sessions     ?? 0;

  const auditBingByTemplate = useMemo(() => {
    const sfRows   = sfData[auditSite?.id]   || [];
    const bingRows = bingData[auditSite?.id] || [];
    const ptMap    = pageTypes[auditSite?.id] || {};
    return buildBingByTemplate(sfRows, bingRows, ptMap);
  }, [sfData, bingData, pageTypes, auditSite]);

  const benchBingByTemplates = useMemo(() =>
    benchSites.map(s => buildBingByTemplate(sfData[s.id] || [], bingData[s.id] || [], pageTypes[s.id] || {})),
    [sfData, bingData, pageTypes, benchSites]
  );

  const templateKeys = useMemo(() => {
    const all = new Set([
      ...Object.keys(auditBingByTemplate),
      ...benchBingByTemplates.flatMap(bt => Object.keys(bt)),
    ]);
    return [...all].sort((a, b) =>
      (auditBingByTemplate[b]?.citations || 0) - (auditBingByTemplate[a]?.citations || 0)
    );
  }, [auditBingByTemplate, benchBingByTemplates]);

  const maxCitations = useMemo(() => Math.max(
    1,
    ...Object.values(auditBingByTemplate).map(v => v.citations),
    ...benchBingByTemplates.flatMap(bt => Object.values(bt).map(v => v.citations)),
  ), [auditBingByTemplate, benchBingByTemplates]);

  const forces = useMemo(() =>
    Object.entries(auditScore.detail)
      .filter(([, v]) => v.norm >= 0.65)
      .sort((a, b) => b[1].norm - a[1].norm)
      .slice(0, 6),
    [auditScore]
  );

  const faiblesses = useMemo(() =>
    Object.entries(auditScore.detail)
      .filter(([, v]) => v.norm <= 0.35)
      .sort((a, b) => a[1].norm - b[1].norm)
      .slice(0, 6),
    [auditScore]
  );

  const bingCorrs = useMemo(() =>
    corrMatrix
      .map(row => ({ dim: row.dim, value: row.corrs.find(c => c.kpi.key === "geoMentions")?.value ?? null }))
      .filter(r => r.value !== null && Math.abs(r.value) >= 0.15)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 8),
    [corrMatrix]
  );

  const roadmap = useMemo(() => {
    if (!analysis?.roadmaps) return [];
    return (
      analysis.roadmaps[auditSite?.id] ||
      analysis.roadmaps[Object.keys(analysis.roadmaps)[0]] ||
      []
    );
  }, [analysis, auditSite]);

  if (!auditSite) {
    return <div style={{ textAlign: "center", padding: 60, color: C.textMid }}>Aucun site configuré.</div>;
  }

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .audit-section { break-inside: avoid; margin-bottom: 20px !important; }
        }
      `}</style>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <div className="audit-section" style={{
          background: "linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)",
          borderRadius: 16, padding: "32px 36px", marginBottom: 24, color: "#fff", position: "relative",
        }}>
          <button className="no-print" onClick={() => window.print()} style={{
            position: "absolute", top: 20, right: 20,
            padding: "8px 18px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.4)",
            background: "rgba(255,255,255,0.15)", color: "#fff", cursor: "pointer",
            fontSize: 13, fontWeight: 500,
          }}>
            ⬇ Exporter PDF
          </button>

          <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
            Audit GEO · {new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>{auditSite.label}</div>
          {benchSites.length > 0 && (
            <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 24 }}>
              Benchmarks : {benchSites.map(s => s.label).join(", ")}
            </div>
          )}

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {[
              { label: "Citations Bing AI", value: auditBing,                              icon: "🤖" },
              { label: "Score GEO",         value: `${auditScore.score ?? "—"}/100`,       icon: "📊" },
              { label: "Clics GSC",         value: auditClics.toLocaleString("fr-FR"),     icon: "🔍" },
              { label: "Sessions GA4",      value: auditSessions.toLocaleString("fr-FR"),  icon: "📈" },
            ].map(kpi => (
              <div key={kpi.label} style={{ background: "rgba(255,255,255,0.12)", borderRadius: 12, padding: "14px 20px", minWidth: 130 }}>
                <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 4 }}>{kpi.icon} {kpi.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.value}</div>
              </div>
            ))}
            {benchMs.map((m, i) => (
              <div key={i} style={{
                background: "rgba(255,255,255,0.08)", borderRadius: 12, padding: "14px 20px", minWidth: 130,
                borderLeft: `3px solid ${benchSites[i]?.color || "#fff"}`,
              }}>
                <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 4 }}>⚖️ {benchSites[i]?.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>
                  {resultVals[i + 1]?.geoMentions ?? 0}
                  <span style={{ fontSize: 12, opacity: 0.65, marginLeft: 4 }}>cit.</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── ÉTAT DES LIEUX GEO ─────────────────────────────────────── */}
        <div className="audit-section" style={{
          background: C.white, borderRadius: 14, padding: "28px 32px", marginBottom: 20,
          border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>📍 État des lieux GEO</div>

          {/* Score bar */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 14, color: C.textMid }}>Score GEO-readiness</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 24, fontWeight: 800, color: auditLabel.color }}>{auditScore.score ?? "—"}</span>
                <span style={{
                  fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 99,
                  background: auditLabel.bg, color: auditLabel.color,
                }}>{auditLabel.label}</span>
              </div>
            </div>
            <div style={{ position: "relative", height: 14, background: C.bg, borderRadius: 99 }}>
              <div style={{
                position: "absolute", left: 0, top: 0, height: "100%",
                width: `${auditScore.score ?? 0}%`,
                background: `linear-gradient(90deg, ${auditLabel.color}88, ${auditLabel.color})`,
                borderRadius: 99,
              }} />
              {benchScores.map((bs, i) => bs.score !== null && (
                <div key={i} title={`${benchSites[i]?.label} : ${bs.score}/100`} style={{
                  position: "absolute", top: -3, width: 3, height: 20, borderRadius: 2,
                  background: benchSites[i]?.color || "#888",
                  left: `${bs.score}%`, transform: "translateX(-50%)",
                }} />
              ))}
            </div>
            {benchScores.some(bs => bs.score !== null) && (
              <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
                {benchScores.map((bs, i) => bs.score !== null && (
                  <span key={i} style={{ fontSize: 12, color: C.textLight }}>
                    <span style={{
                      display: "inline-block", width: 8, height: 8, borderRadius: 2,
                      background: benchSites[i]?.color, marginRight: 4,
                    }} />
                    {benchSites[i]?.label} : {bs.score}/100
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Citations Bing par template */}
          {templateKeys.length > 0 && (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.textMid, marginBottom: 12 }}>
                Citations Bing AI par template
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {templateKeys.map(tpl => {
                  const tplInfo  = PAGE_TYPE_MAP[tpl] || { label: tpl, color: "#94A3B8", bg: "#F8FAFC" };
                  const auditCit = auditBingByTemplate[tpl]?.citations || 0;
                  const auditPg  = auditBingByTemplate[tpl]?.pages || 0;
                  return (
                    <div key={tpl}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                          background: tplInfo.bg, color: tplInfo.color,
                        }}>{tplInfo.label}</span>
                        <span style={{ fontSize: 12, color: C.textLight }}>
                          {auditPg} page{auditPg > 1 ? "s" : ""} · {auditCit} citation{auditCit > 1 ? "s" : ""}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {[{ site: auditSite, cit: auditCit }, ...benchSites.map((s, i) => ({ site: s, cit: benchBingByTemplates[i]?.[tpl]?.citations || 0 }))].map(({ site, cit }) => (
                          <div key={site.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, color: C.textLight, width: 90, textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {site.label}
                            </span>
                            <div style={{ flex: 1, height: 8, background: C.bg, borderRadius: 99, overflow: "hidden" }}>
                              <div style={{
                                width: `${(cit / maxCitations) * 100}%`, height: "100%",
                                background: site.color || C.blue, borderRadius: 99,
                                opacity: site.id === auditSite.id ? 1 : 0.65,
                              }} />
                            </div>
                            <span style={{ fontSize: 11, color: C.textMid, width: 20, textAlign: "right" }}>{cit}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── FORCES & FAIBLESSES ────────────────────────────────────── */}
        <div className="audit-section" style={{
          background: C.white, borderRadius: 14, padding: "28px 32px", marginBottom: 20,
          border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>⚖️ Forces & Faiblesses</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.green, marginBottom: 12 }}>
                <span style={{ background: C.greenLight, padding: "3px 10px", borderRadius: 99 }}>✓ Forces</span>
              </div>
              {forces.length === 0 ? (
                <div style={{ fontSize: 13, color: C.textLight }}>Aucun point fort identifié</div>
              ) : forces.map(([key, v]) => (
                <div key={key} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 13, color: C.text }}>{DIM_LABEL[key] || key}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.green }}>{Math.round(v.norm * 100)}%</span>
                  </div>
                  <div style={{ height: 6, background: C.bg, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${v.norm * 100}%`, height: "100%", background: C.green, borderRadius: 99 }} />
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 12 }}>
                <span style={{ background: C.redLight, padding: "3px 10px", borderRadius: 99 }}>✗ Faiblesses</span>
              </div>
              {faiblesses.length === 0 ? (
                <div style={{ fontSize: 13, color: C.textLight }}>Aucune faiblesse identifiée</div>
              ) : faiblesses.map(([key, v]) => (
                <div key={key} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 13, color: C.text }}>{DIM_LABEL[key] || key}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.red }}>{Math.round(v.norm * 100)}%</span>
                  </div>
                  <div style={{ height: 6, background: C.bg, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${v.norm * 100}%`, height: "100%", background: C.red, borderRadius: 99 }} />
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>

        {/* ── CRITÈRES À RENFORCER ───────────────────────────────────── */}
        <div className="audit-section" style={{
          background: C.white, borderRadius: 14, padding: "28px 32px", marginBottom: 20,
          border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>🎯 Critères corrélés aux Citations Bing AI</div>
          <div style={{ fontSize: 13, color: C.textMid, marginBottom: 20 }}>
            Dimensions SF avec la plus forte corrélation Pearson avec les citations Bing AI (|r| ≥ 0.15)
          </div>
          {bingCorrs.length === 0 ? (
            <div style={{ fontSize: 13, color: C.textLight }}>Données insuffisantes pour calculer les corrélations.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
              {bingCorrs.map(({ dim, value }) => {
                const isPositive = value >= 0;
                const sfDim      = SF_DIMS.find(d => d.key === dim.key);
                const isAligned  = (isPositive && sfDim?.higher) || (!isPositive && !sfDim?.higher);
                const auditVal   = auditM?.sf?.[dim.key];
                const dispVal    = auditVal !== undefined && auditVal !== null
                  ? (typeof auditVal === "number" && auditVal > 0 && auditVal <= 1 && dim.key.endsWith("Rate"))
                    ? `${Math.round(auditVal * 100)}%`
                    : String(Math.round(auditVal * 10) / 10)
                  : null;
                return (
                  <div key={dim.key} style={{
                    borderRadius: 10, padding: "14px 16px",
                    border: `1px solid ${isAligned ? C.border : C.amberLight}`,
                    background: isAligned ? C.greenLight : C.amberLight,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: isAligned ? C.green : C.amber, marginBottom: 6 }}>
                      {isAligned ? "✓ Levier confirmé" : "⚡ À renforcer"}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>{dim.label}</div>
                    <div style={{ fontSize: 12, color: C.textMid }}>
                      r = <strong>{value > 0 ? "+" : ""}{value.toFixed(2)}</strong>
                      {dispVal && <> · <strong>{dispVal}</strong></>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── RECOMMANDATIONS & ROADMAP ──────────────────────────────── */}
        <div className="audit-section" style={{
          background: C.white, borderRadius: 14, padding: "28px 32px", marginBottom: 20,
          border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>🗺️ Recommandations & Roadmap</div>

          {!analysis ? (
            <div style={{ textAlign: "center", padding: "36px 20px", background: C.bg, borderRadius: 12 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✦</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 8 }}>Analyse IA non encore lancée</div>
              <div style={{ fontSize: 13, color: C.textMid }}>
                Rendez-vous dans l'onglet "Analyse IA" pour générer les recommandations, puis revenez ici.
              </div>
            </div>
          ) : (
            <div>
              {/* Inspirations */}
              {analysis.inspirations?.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.textMid, marginBottom: 12 }}>💡 Inspirations clés</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                    {analysis.inspirations.map((ins, i) => (
                      <div key={i} style={{
                        borderRadius: 10, padding: "14px 16px",
                        border: `1px solid ${C.border}`, background: C.blueLight,
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.blue, marginBottom: 6 }}>
                          {ins.titre || ins.title}
                        </div>
                        <div style={{ fontSize: 12, color: C.textMid }}>{ins.detail || ins.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Roadmap by priority */}
              {roadmap.length > 0 && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.textMid, marginBottom: 12 }}>🗓️ Actions par priorité</div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                    {[
                      { key: "haute",   label: "🔴 Haute priorité",   color: C.red,   bg: C.redLight   },
                      { key: "moyenne", label: "🟡 Priorité moyenne",  color: C.amber, bg: C.amberLight },
                      { key: "basse",   label: "🟢 Basse priorité",   color: C.green, bg: C.greenLight  },
                    ].map(({ key, label, color, bg }) => {
                      const items = roadmap.filter(a =>
                        (a.priorite || a.priority || "").toLowerCase().includes(key)
                      );
                      if (!items.length) return null;
                      return (
                        <div key={key} style={{ flex: "1 1 280px", minWidth: 260 }}>
                          <div style={{
                            fontSize: 12, fontWeight: 700, color, background: bg,
                            padding: "4px 12px", borderRadius: 99, display: "inline-block", marginBottom: 10,
                          }}>{label}</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {items.map((action, j) => (
                              <div key={j} style={{
                                borderRadius: 10, padding: "12px 14px",
                                border: `1px solid ${C.border}`, background: C.white,
                              }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                                  {action.action || action.titre || action.title}
                                </div>
                                {(action.detail || action.description) && (
                                  <div style={{ fontSize: 12, color: C.textMid }}>
                                    {action.detail || action.description}
                                  </div>
                                )}
                                {action.template && PAGE_TYPE_MAP[action.template] && (
                                  <div style={{
                                    display: "inline-block", marginTop: 6,
                                    fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
                                    background: PAGE_TYPE_MAP[action.template].bg,
                                    color: PAGE_TYPE_MAP[action.template].color,
                                  }}>
                                    {PAGE_TYPE_MAP[action.template].label}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!analysis.inspirations?.length && !roadmap.length && (
                <div style={{ fontSize: 13, color: C.textLight }}>
                  Aucune recommandation disponible dans l'analyse actuelle.
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </>
  );
}
