import { C, RES_KPIS } from "../lib/constants";
import { SectionHeader } from "../components/ui";
import { CorrCell, KpiHeaderCell } from "../components/CorrCell";

function SmStatCard({ site, sm }) {
  if (!sm) return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px", opacity: 0.5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: site.color }} />
        <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{site.label}</span>
      </div>
      <div style={{ fontSize: 12, color: C.textLight }}>Aucune donnée Semrush</div>
    </div>
  );

  const stats = [
    { label: "Mots-clés trackés",  value: sm.totalKw.toLocaleString("fr"),    icon: "🔑" },
    { label: "Top 3",              value: sm.totalTop3.toLocaleString("fr"),   icon: "🥇" },
    { label: "Top 10",             value: sm.totalTop10.toLocaleString("fr"),  icon: "🏅" },
    { label: "Opportunités",       value: sm.totalOpps.toLocaleString("fr"),   icon: "⚡" },
    { label: "Trafic estimé",      value: Math.round(sm.totalTraffic).toLocaleString("fr"), icon: "📈" },
    { label: "Position moy.",      value: sm.avgPos,                           icon: "📍" },
  ];

  return (
    <div style={{ background: C.white, border: `1.5px solid ${site.color}33`, borderRadius: 14, padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: site.color }} />
        <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{site.label}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: C.textLight, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "2px 8px" }}>{sm.pageCount} pages</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {stats.map(({ label, value, icon }) => (
          <div key={label} style={{ background: C.bg, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: C.textLight, marginBottom: 4 }}>{icon} {label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
          </div>
        ))}
      </div>
      {/* Top 3 / Top 10 rates */}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <div style={{ flex: 1, background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "8px 12px", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "#15803D", marginBottom: 2 }}>Pages avec Top 3</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#15803D" }}>{sm.top3Rate}%</div>
        </div>
        <div style={{ flex: 1, background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "8px 12px", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "#2563EB", marginBottom: 2 }}>Pages avec Top 10</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#2563EB" }}>{sm.top10Rate}%</div>
        </div>
        <div style={{ flex: 1, background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "#D97706", marginBottom: 2 }}>Opps / page</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#D97706" }}>{sm.pageCount > 0 ? (sm.totalOpps / sm.pageCount).toFixed(1) : "—"}</div>
        </div>
      </div>
    </div>
  );
}

export default function SemrushTab({ sites, smData, metrics, semrushCorrMatrix }) {
  const hasAny = sites.some(s => (smData[s.id] || []).length > 0);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <SectionHeader title="Semrush · Position Tracking" sub="Mots-clés, trafic estimé, opportunités par page" />
      </div>

      {!hasAny && (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 8 }}>Aucune donnée Semrush</div>
          <div style={{ fontSize: 13, color: C.textLight }}>Importe un export Position Tracking → Landing Pages depuis Semrush dans l'onglet Import.</div>
        </div>
      )}

      {/* ── Stats par site ── */}
      {hasAny && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 32 }}>
            {sites.map((s, i) => (
              <SmStatCard key={s.id} site={s} sm={metrics[i]?.sm ?? null} />
            ))}
          </div>

          {/* ── Top pages tableau ── */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px", marginBottom: 32 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 16 }}>Top pages par trafic estimé</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: C.bg }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: `1px solid ${C.border}`, color: C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 }}>Site</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: `1px solid ${C.border}`, color: C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 }}>URL</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 }}>Trafic estimé</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 }}>Top 3</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 }}>Top 10</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 }}>Opps</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 }}>Pos. moy.</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 }}>KW</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.flatMap(s =>
                    (smData[s.id] || [])
                      .slice()
                      .sort((a, b) => b.traffic - a.traffic)
                      .slice(0, 10)
                      .map((r, i) => (
                        <tr key={s.id + r.url} style={{ background: i % 2 === 0 ? C.white : C.bg }}>
                          <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.borderLight}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                              <span style={{ fontSize: 11, color: C.textLight }}>{s.label}</span>
                            </div>
                          </td>
                          <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.borderLight}`, maxWidth: 280 }}>
                            <div style={{ fontSize: 11, color: C.textMid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.url}>
                              {r.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                            </div>
                          </td>
                          <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "center" }}>
                            <span style={{ fontWeight: 700, color: C.text }}>{Math.round(r.traffic).toLocaleString("fr")}</span>
                          </td>
                          <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "center" }}>
                            <span style={{ background: r.top3 > 0 ? "#DCFCE7" : C.bg, color: r.top3 > 0 ? "#15803D" : C.textLight, borderRadius: 5, padding: "2px 7px", fontWeight: 600 }}>{r.top3}</span>
                          </td>
                          <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "center" }}>
                            <span style={{ background: r.top10 > 0 ? "#EFF6FF" : C.bg, color: r.top10 > 0 ? "#2563EB" : C.textLight, borderRadius: 5, padding: "2px 7px", fontWeight: 600 }}>{r.top10}</span>
                          </td>
                          <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "center" }}>
                            <span style={{ background: r.opps > 0 ? "#FFFBEB" : C.bg, color: r.opps > 0 ? "#D97706" : C.textLight, borderRadius: 5, padding: "2px 7px", fontWeight: 600 }}>{r.opps}</span>
                          </td>
                          <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "center", color: C.textMid }}>{r.avgPos}</td>
                          <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "center", color: C.textMid }}>{r.kwCount}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Matrice de corrélation Semrush ── */}
          {semrushCorrMatrix && semrushCorrMatrix.some(row => row.corrs.some(c => c.value !== null)) && (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 4 }}>Corrélations Semrush × KPIs</div>
              <div style={{ fontSize: 12, color: C.textLight, marginBottom: 16 }}>Pearson r entre les dimensions Semrush par page et les KPIs GSC / GA4 / Bing</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "10px 16px", textAlign: "left", borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.textLight, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" }}>Dimension Semrush</th>
                      {RES_KPIS.map(kpi => <KpiHeaderCell key={kpi.key} kpi={kpi} />)}
                    </tr>
                  </thead>
                  <tbody>
                    {semrushCorrMatrix.map((row, ri) => (
                      <tr key={row.dim.key} style={{ background: ri % 2 === 0 ? C.white : C.bg }}>
                        <td style={{ padding: "10px 16px", fontSize: 12, color: C.textMid, fontWeight: 500, whiteSpace: "nowrap", borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.border}` }}>
                          {row.dim.label}
                        </td>
                        {row.corrs.map(c => (
                          <CorrCell key={c.kpi.key} kpi={c.kpi} value={c.value} n={c.n} dim={row.dim} base={null} delta={null} showDelta={false} />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}