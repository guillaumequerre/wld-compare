import InfoCard from "../components/InfoCard";
import { computeSiteScore, scoreLabel } from "../lib/scoring";
import ScoreTooltip from "../components/ScoreTooltip";
import { C, SF_DIMS, PAGE_TYPES } from "../lib/constants";
import SchemaBreakdown from "../components/SchemaBreakdown";
import LlmsStatus from "../components/LlmsStatus";
import PageModeSelector from "../components/PageModeSelector";
import { SectionHeader } from "../components/ui";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Legend } from "recharts";

// ── Sub-components from OverviewTab ──────────────────────────────

function PageTypeBadges({ siteId, pageTypes, templateFilter, setTemplateFilter }) {
  const dist = pageTypes?.[siteId]
    ? PAGE_TYPES.map(t => ({ ...t, count: Object.values(pageTypes[siteId]).filter(v => v === t.key).length })).filter(t => t.count > 0)
    : [];
  if (!dist.length) return <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Pas encore classifié</div>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {dist.sort((a, b) => b.count - a.count).map(t => {
        const active = !templateFilter?.length || templateFilter.includes(t.key);
        return (
          <div key={t.key} onClick={() => setTemplateFilter?.(prev => {
            const cur = prev || [];
            return cur.includes(t.key) ? cur.filter(k => k !== t.key) : [...cur, t.key];
          })} style={{
            display: "flex", alignItems: "center", gap: 4, padding: "3px 9px",
            borderRadius: 20, cursor: setTemplateFilter ? "pointer" : "default",
            background: active ? t.bg : C.bg,
            border: `1px solid ${active ? t.color + "55" : C.border}`,
            opacity: active ? 1 : 0.4, transition: "all 0.15s",
          }}>
            <span style={{ fontSize: 10 }}>{t.icon}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: active ? t.color : C.textLight }}>{t.label}</span>
            <span style={{ fontSize: 10, color: active ? t.color : C.textLight, opacity: 0.7 }}>{t.count}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Radar block ──────────────────────────────────────────────────

function RadarBlock({ sites, radarSites, setRadarSites, radarData }) {
  if (!radarData?.length) return null;
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textMid }}>Profil technique SF — radar</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>Scores normalisés 0–100</div>
        </div>
        {sites.length > 1 && (
          <div style={{ display: "flex", gap: 8 }}>
            {sites.map(s => {
              const active = radarSites.includes(s.id);
              return (
                <button key={s.id} onClick={() => setRadarSites(prev =>
                  prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id]
                )} style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: `2px solid ${s.color}`,
                  background: active ? s.color : "transparent",
                  color: active ? "#fff" : s.color,
                  transition: "all 0.15s",
                }}>{s.label}</button>
              );
            })}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={radarData}>
          <PolarGrid stroke={C.border} />
          <PolarAngleAxis dataKey="dim" tick={{ fill: C.textLight, fontSize: 11 }} />
          {sites.filter(s => radarSites.includes(s.id)).map(s => (
            <Radar key={s.id} name={s.label} dataKey={s.id}
              stroke={s.color} fill={s.color} fillOpacity={0.08} strokeWidth={2} dot={{ r: 3 }} />
          ))}
          {sites.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────

export default function SitesTab({ sites, pageMode, setPageMode, metrics, radarSites, setRadarSites, radarData, pageTypes, templateFilter, setTemplateFilter }) {
  const DIM_LABELS = {
    avgFlesch: "Score Flesch", avgInlinksUniq: "Maillage interne", avgWords: "Volume contenu",
    schemaRate: "Schema JSON-LD", tableRate: "Tableaux", avgTitleLen: "Title",
    avgDepth: "Profondeur", avgH1Len: "H1", errorRate: "Erreurs 4xx",
    avgMetaLen: "Meta description", avgPageSizeKB: "Poids pages",
    redirectRate: "Redirections", avgImgSizeKB: "Poids images",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <SectionHeader title="Vue d'ensemble" sub="Analyse et comparaison de vos sites" />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <InfoCard tabKey="sites" />
          <PageModeSelector value={pageMode} onChange={setPageMode} pageTypes={pageTypes} sites={sites} templateFilter={templateFilter} setTemplateFilter={setTemplateFilter} />
        </div>
      </div>

      {/* ── Radar ── */}
      <RadarBlock sites={sites} radarSites={radarSites} setRadarSites={setRadarSites} radarData={radarData} />

      {/* ── Templates par site ── */}
      {pageTypes && Object.keys(pageTypes).length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 24 }}>
          {sites.map(site => (
            <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: site.color }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: site.color }}>{site.label}</span>
              </div>
              <PageTypeBadges siteId={site.id} pageTypes={pageTypes} templateFilter={templateFilter} setTemplateFilter={setTemplateFilter} />
            </div>
          ))}
        </div>
      )}

      {/* ── Score cards par site ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
        {metrics.map(({ site, sf }) => {
          const { score, detail } = computeSiteScore(sf);
          const lbl = scoreLabel(score);
          const topActions = score !== null ? Object.entries(detail)
            .sort((a, b) => (b[1].maxPts - b[1].pts) - (a[1].maxPts - a[1].pts))
            .slice(0, 3) : [];
          return (
            <div key={site.id} style={{ background: C.white, border: `1.5px solid ${site.color}33`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ background: site.bg, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: site.color }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: site.color }}>{site.label}</span>
                </div>
                {score !== null && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: lbl.color, background: lbl.bg, padding: "2px 8px", borderRadius: 10 }}>{lbl.label}</span>
                    <span style={{ fontSize: 24, fontWeight: 800, color: lbl.color, fontVariantNumeric: "tabular-nums" }}>{score}</span>
                    <span style={{ fontSize: 12, color: C.textLight }}>/100</span>
                    <ScoreTooltip detail={detail} score={score} />
                  </div>
                )}
                {score === null && <span style={{ fontSize: 12, color: C.textLight }}>Pas de données SF</span>}
              </div>
              {score !== null && (
                <div style={{ padding: "12px 18px" }}>
                  <div style={{ height: 6, background: C.bg, borderRadius: 3, marginBottom: 12, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${score}%`, background: lbl.color, borderRadius: 3, transition: "width 0.4s" }} />
                  </div>
                  <div style={{ fontSize: 11, color: C.textLight, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.7 }}>Top leviers</div>
                  {topActions.map(([k, d]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                      <span style={{ fontSize: 12, color: C.textMid }}>{DIM_LABELS[k] || k}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: C.amber }}>+{Math.round(d.maxPts - d.pts)}pts potentiels</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Card SF ── */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 20, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🕷️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Screaming Frog</div>
            <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>Métriques techniques · crawl</div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.bg }}>
                <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, fontSize: 11, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `1px solid ${C.border}`, minWidth: 160 }}>Métrique</th>
                {metrics.map(({ site }) => (
                  <th key={site.id} style={{ padding: "10px 20px", textAlign: "right", fontWeight: 700, fontSize: 12, color: site.color, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{site.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SF_DIMS.map((d, di) => (
                <tr key={d.key} style={{ borderBottom: `1px solid ${C.borderLight}`, background: di % 2 === 0 ? C.white : C.bg }}>
                  <td style={{ padding: "8px 20px", color: C.textMid, fontWeight: 500 }}>{d.label}</td>
                  {metrics.map(({ site, sf }) => {
                    const val = sf?.[d.key] ?? null;
                    const vals = metrics.map(m => m.sf?.[d.key]).filter(v => v !== null && v !== undefined);
                    const best = vals.length > 1 ? Math.max(...vals) : null;
                    const isBest = val !== null && best !== null && val === best;
                    return (
                      <td key={site.id} style={{ padding: "8px 20px", textAlign: "right", fontWeight: 600, color: val === null ? C.textLight : isBest ? site.color : C.text }}>
                        {val !== null ? val : "—"}
                        {isBest && vals.length > 1 && <span style={{ marginLeft: 4, fontSize: 10 }}>★</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {metrics.some(({ sf }) => sf && Object.keys(sf.schemaTypes || {}).length > 0) && (
          <div style={{ padding: "16px 24px", borderTop: `1px solid ${C.borderLight}`, display: "grid", gridTemplateColumns: `160px repeat(${metrics.length}, 1fr)`, gap: 16, alignItems: "start" }}>
            <div style={{ fontSize: 11, color: C.textLight, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, paddingTop: 4 }}>🏷️ Schemas</div>
            {metrics.map(({ site, sf }) => (
              <div key={site.id}>
                {sf && Object.keys(sf.schemaTypes || {}).length > 0
                  ? <SchemaBreakdown schemaTypes={sf.schemaTypes} color={site.color} />
                  : <span style={{ fontSize: 12, color: C.textLight }}>—</span>}
              </div>
            ))}
          </div>
        )}
        {metrics.some(({ sf }) => sf) && (
          <div style={{ padding: "0 24px 16px", display: "grid", gridTemplateColumns: `160px repeat(${metrics.length}, 1fr)`, gap: 16, alignItems: "start" }}>
            <div style={{ fontSize: 11, color: C.textLight, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, paddingTop: 4 }}>🤖 llms.txt</div>
            {metrics.map(({ site, sf }) => (
              <div key={site.id}>{sf ? <LlmsStatus sf={sf} /> : <span style={{ fontSize: 12, color: C.textLight }}>—</span>}</div>
            ))}
          </div>
        )}
      </div>

      {/* ── Card GSC ── */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 20, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔍</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Google Search Console</div>
            <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>Visibilité organique SEO</div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.bg }}>
                <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, fontSize: 11, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `1px solid ${C.border}`, minWidth: 160 }}>Métrique</th>
                {metrics.map(({ site }) => (
                  <th key={site.id} style={{ padding: "10px 20px", textAlign: "right", fontWeight: 700, fontSize: 12, color: site.color, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{site.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { key: "clicks",      label: "Clics",        fmt: v => v.toLocaleString() },
                { key: "impressions", label: "Impressions",   fmt: v => v.toLocaleString() },
                { key: "ctr",         label: "CTR",           fmt: v => `${v}%` },
                { key: "position",    label: "Position moy.", fmt: v => v },
              ].map((row, di) => (
                <tr key={row.key} style={{ borderBottom: `1px solid ${C.borderLight}`, background: di % 2 === 0 ? C.white : C.bg }}>
                  <td style={{ padding: "8px 20px", color: C.textMid, fontWeight: 500 }}>{row.label}</td>
                  {metrics.map(({ site, gsc }) => {
                    const val = gsc?.[row.key] ?? null;
                    const vals = metrics.map(m => m.gsc?.[row.key]).filter(v => v !== null && v !== undefined);
                    const best = vals.length > 1 ? (row.key === "position" ? Math.min(...vals) : Math.max(...vals)) : null;
                    const isBest = val !== null && best !== null && val === best;
                    return (
                      <td key={site.id} style={{ padding: "8px 20px", textAlign: "right", fontWeight: 600, color: val === null ? C.textLight : isBest ? site.color : C.text }}>
                        {val !== null ? row.fmt(val) : "—"}
                        {isBest && vals.length > 1 && <span style={{ marginLeft: 4, fontSize: 10 }}>★</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Card GA4 ── */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 20, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>📊</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Google Analytics 4</div>
            <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>Comportement & trafic</div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.bg }}>
                <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, fontSize: 11, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `1px solid ${C.border}`, minWidth: 160 }}>Métrique</th>
                {metrics.map(({ site }) => (
                  <th key={site.id} style={{ padding: "10px 20px", textAlign: "right", fontWeight: 700, fontSize: 12, color: site.color, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{site.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { key: "sessions", label: "Sessions",   fmt: v => v.toLocaleString() },
                { key: "views",    label: "Pages vues", fmt: v => v.toLocaleString() },
              ].map((row, di) => (
                <tr key={row.key} style={{ borderBottom: `1px solid ${C.borderLight}`, background: di % 2 === 0 ? C.white : C.bg }}>
                  <td style={{ padding: "8px 20px", color: C.textMid, fontWeight: 500 }}>{row.label}</td>
                  {metrics.map(({ site, ga }) => {
                    const val = ga?.[row.key] ?? null;
                    const vals = metrics.map(m => m.ga?.[row.key]).filter(v => v !== null && v !== undefined);
                    const best = vals.length > 1 ? Math.max(...vals) : null;
                    const isBest = val !== null && best !== null && val === best;
                    return (
                      <td key={site.id} style={{ padding: "8px 20px", textAlign: "right", fontWeight: 600, color: val === null ? C.textLight : isBest ? site.color : C.text }}>
                        {val !== null ? row.fmt(val) : "—"}
                        {isBest && vals.length > 1 && <span style={{ marginLeft: 4, fontSize: 10 }}>★</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Card Bing AI ── */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 20, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Bing AI Performance</div>
            <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>Citations & visibilité GEO</div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.bg }}>
                <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, fontSize: 11, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `1px solid ${C.border}`, minWidth: 160 }}>Métrique</th>
                {metrics.map(({ site }) => (
                  <th key={site.id} style={{ padding: "10px 20px", textAlign: "right", fontWeight: 700, fontSize: 12, color: site.color, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{site.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { key: "geoMentions", label: "Citations totales",  fmt: v => v.toLocaleString() },
                { key: "pageCount",   label: "Pages citées (≥1)",  fmt: v => v },
              ].map((row, di) => (
                <tr key={row.key} style={{ borderBottom: `1px solid ${C.borderLight}`, background: di % 2 === 0 ? C.white : C.bg }}>
                  <td style={{ padding: "8px 20px", color: C.textMid, fontWeight: 500 }}>{row.label}</td>
                  {metrics.map(({ site, bing }) => {
                    const val = bing?.[row.key] ?? null;
                    const vals = metrics.map(m => m.bing?.[row.key]).filter(v => v !== null && v !== undefined);
                    const best = vals.length > 1 ? Math.max(...vals) : null;
                    const isBest = val !== null && best !== null && val === best;
                    return (
                      <td key={site.id} style={{ padding: "8px 20px", textAlign: "right", fontWeight: 600, color: val === null ? C.textLight : isBest ? site.color : C.text }}>
                        {val !== null ? row.fmt(val) : "—"}
                        {isBest && vals.length > 1 && <span style={{ marginLeft: 4, fontSize: 10 }}>★</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}