import { C, RADAR_DIMS } from "../lib/constants.js";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Legend } from "recharts";
import { StatPill, SectionHeader, Badge } from "../components/ui.jsx";

export default function OverviewTab({ sites, pageMode, setPageMode, radarSites, setRadarSites, metrics, radarData }) {
  return (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
      <SectionHeader title="Vue d'ensemble" sub="Scores agrégés et comparaison des 3 sites" />
      <PageModeSelector value={pageMode} onChange={setPageMode} />
    </div>

    {/* Row-based grid: each section spans all 3 sites */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0 20px", marginBottom: 28 }}>

      {/* ── ROW: Headers ── */}
      {metrics.map(({ site, sf }) => (
        <div key={site.id} style={{ background: site.bg, padding: "16px 20px", borderRadius: "14px 14px 0 0", border: `1px solid ${C.border}`, borderBottom: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: site.color }}>{site.label}</div>
          {sf && <Badge color={site.color} bg={site.bg}>{sf.totalPages} pages</Badge>}
        </div>
      ))}

      {/* ── ROW: SF metrics ── */}
      {metrics.map(({ site, sf, sfBase }) => (
        <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderTop: "none", borderBottom: "none", padding: "16px 20px" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 10 }}>🕷️ Screaming Frog</div>
          {sf ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
              {[
                ["Title moy.", sf.avgTitleLen,    sfBase?.avgTitleLen,    "car.", false],
                ["Meta moy.",  sf.avgMetaLen,     sfBase?.avgMetaLen,     "car.", false],
                ["H1 moy.",    sf.avgH1Len,       sfBase?.avgH1Len,       "car.", false],
                ["Mots moy.",  sf.avgWords,       sfBase?.avgWords,       "",     false],
                ["Poids pages",sf.avgPageSizeKB,  sfBase?.avgPageSizeKB,  "KB",   true],
                ["Poids img.", sf.avgImgSizeKB,   sfBase?.avgImgSizeKB,   "KB",   true],
                ["Inlinks uniq.", sf.avgInlinksUniq, sfBase?.avgInlinksUniq, "", false],
                ["Outlinks uniq.", sf.avgOutlinksUniq, sfBase?.avgOutlinksUniq, "", false],
                ["Liens ext. uniq.", sf.avgExtLinksUniq, sfBase?.avgExtLinksUniq, "", false],
                ["Profondeur", sf.avgDepth,       sfBase?.avgDepth,       "",     true],
                ["Flesch",     sf.avgFlesch,      sfBase?.avgFlesch,      "",     false],
                ["Tableaux",   sf.tableRate,      sfBase?.tableRate,      "%",    false],
                ["Schemas",    sf.schemaRate,     sfBase?.schemaRate,     "%",    false],
                ["Indexables", sf.indexableRate,  sfBase?.indexableRate,  "%",    false],
                ["Erreurs",    sf.errorRate,      sfBase?.errorRate,      "%",    true],
                ["Redirects",  sf.redirectRate,   sfBase?.redirectRate,   "%",    true],
              ].map(([k, v, bv, unit, lowerIsBetter]) => {
                const showD = pageMode !== "all" && bv !== null && bv !== undefined;
                const diff = showD ? Math.round((v - bv) * 10) / 10 : null;
                const up = diff > 0;
                const isGood = lowerIsBetter ? !up : up;
                return (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: `1px solid ${C.borderLight}`, gap: 4 }}>
                    <span style={{ fontSize: 11, color: C.textLight, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{v}{unit}</span>
                      {showD && diff !== 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: isGood ? "#16A34A" : "#DC2626" }}>
                          {up ? "▲" : "▼"}{up ? "+" : ""}{diff}{unit}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <div style={{ color: C.textLight, fontSize: 12 }}>Aucun CSV SF chargé</div>}
        </div>
      ))}

      {/* ── ROW: Schema types ── */}
      {metrics.map(({ site, sf }) => (
        <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderTop: "none", borderBottom: "none", padding: "0 20px 16px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          {sf && Object.keys(sf.schemaTypes || {}).length > 0 && (
            <>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>🏷️ Types de Schema</div>
              <SchemaBreakdown schemaTypes={sf.schemaTypes} color={site.color} />
            </>
          )}
          {sf && <LlmsStatus sf={sf} />}
        </div>
      ))}

      {/* ── ROW: GSC ── */}
      {metrics.map(({ site, gsc }) => (
        <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderTop: "none", borderBottom: "none", padding: "16px 20px" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>🔍 GSC</div>
          {gsc ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <StatPill label="Clics" value={gsc.clicks.toLocaleString()} color={C.blue} />
              <StatPill label="Impressions" value={gsc.impressions.toLocaleString()} />
              <StatPill label="CTR" value={`${gsc.ctr}%`} color={C.green} />
              <StatPill label="Position" value={gsc.position} color={C.amber} />
            </div>
          ) : <div style={{ fontSize: 12, color: C.textLight }}>—</div>}
        </div>
      ))}

      {/* ── ROW: GA4 ── */}
      {metrics.map(({ site, ga }) => (
        <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderTop: "none", borderBottom: "none", padding: "16px 20px" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>📊 GA4</div>
          {ga ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <StatPill label="Sessions" value={ga.sessions.toLocaleString()} color={C.blue} />
              <StatPill label="Vues" value={ga.views.toLocaleString()} />
            </div>
          ) : <div style={{ fontSize: 12, color: C.textLight }}>—</div>}
        </div>
      ))}

      {/* ── ROW: Bing AI (last — rounded bottom) ── */}
      {metrics.map(({ site, bing }) => (
        <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 14px 14px", padding: "16px 20px" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>🤖 Bing AI</div>
          {bing ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <StatPill label="Citations" value={bing.geoMentions.toLocaleString()} color={C.purple} />
              <StatPill label="Pages citées" value={bing.pageCount} color={C.teal} />
            </div>
          ) : <div style={{ fontSize: 12, color: C.textLight }}>—</div>}
        </div>
      ))}

    </div>

    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.textMid }}>Profil technique SF — radar</div>
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
              }}>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.textLight, marginBottom: 16 }}>Scores normalisés 0–100</div>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={radarData}>
          <PolarGrid stroke={C.border} />
          <PolarAngleAxis dataKey="dim" tick={{ fill: C.textLight, fontSize: 11 }} />
          {sites.filter(s => radarSites.includes(s.id)).map(s => <Radar key={s.id} name={s.label} dataKey={s.id} stroke={s.color} fill={s.color} fillOpacity={0.08} strokeWidth={2} dot={{ r: 3 }} />)}
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  </div>
)}