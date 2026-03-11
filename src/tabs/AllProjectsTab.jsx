import { C, SF_DIMS, RES_KPIS, RADAR_DIMS } from "../lib/constants.js";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Legend } from "recharts";
import { SectionHeader } from "../components/ui.jsx";
import { CorrCell, KpiHeaderCell, SfDimCell } from "../components/CorrCell.jsx";

export default function AllProjectsTab({ projects, sites, sfData, allProjectsMatrix, allProjectsRadar }) {
  return (
  <div>
    <div style={{ marginBottom: 24 }}>
      <SectionHeader
        title="Tous les projets"
        sub={`Analyse consolidée · ${projects.length} projet${projects.length > 1 ? "s" : ""} · pages concaténées`}
      />
    </div>

    {/* Legend: one dot per project */}
    <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
      {projects.map((p, pi) => {
        const col = SITE_PALETTE[pi % SITE_PALETTE.length].color;
        const hasSf = Object.values(p.sfData || {}).flat().length > 0;
        return (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", background: C.white, border: `1px solid ${C.border}`, borderRadius: 20 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: col }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{p.name}</span>
            <span style={{ fontSize: 11, color: C.textLight }}>{p.sites.length} site{p.sites.length > 1 ? "s" : ""}</span>
            {!hasSf && <span style={{ fontSize: 11, color: C.amber }}>⚠ pas de SF</span>}
          </div>
        );
      })}
    </div>

    {/* Global Correlation Matrix */}
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 24, overflow: "hidden" }}>
      <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Matrice de corrélation — tous projets</div>
        <div style={{ fontSize: 12, color: C.textLight, marginTop: 4 }}>Pearson · pages de tous les projets concaténées</div>
      </div>
      <div style={{ overflowX: "auto", padding: "0 0 8px" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 700 }}>
          <thead>
            <tr>
              <th style={{ padding: "12px 16px", fontSize: 11, color: C.textLight, textAlign: "left", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `1px solid ${C.border}` }}>
                Dimension SF
              </th>
              {RES_KPIS.map(kpi => (
                <th key={kpi.key} style={{ padding: "12px 10px", fontSize: 11, color: C.textLight, fontWeight: 600, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>
                  {kpi.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allProjectsMatrix.every(r => r.corrs.every(c => c.value === null)) ? (
              <tr><td colSpan={RES_KPIS.length + 1} style={{ padding: 40, textAlign: "center", color: C.textLight, fontSize: 13 }}>
                Chargez des données SF dans au moins un projet pour afficher la matrice
              </td></tr>
            ) : allProjectsMatrix.map(({ dim, corrs }) => (
              <tr key={dim.key} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                <td style={{ padding: "10px 16px", fontSize: 12, color: C.textMid, fontWeight: 500, whiteSpace: "nowrap" }}>{dim.label}</td>
                {corrs.map(({ kpi, value, n }) => {
                  const v = value !== null ? Math.round(value * 100) / 100 : null;
                  const bg   = v === null ? C.bg : v >= 0.25 ? "#DCFCE7" : v >= 0.05 ? "#F0FDF4" : v <= -0.25 ? "#FEE2E2" : v <= -0.05 ? "#FEF2F2" : "#F1F5F9";
                  const col2 = v === null ? C.textLight : v >= 0.25 ? "#15803D" : v >= 0.05 ? "#16A34A" : v <= -0.25 ? "#B91C1C" : v <= -0.05 ? "#DC2626" : "#64748B";
                  return (
                    <td key={kpi.key} style={{ padding: "8px 10px", textAlign: "center" }}>
                      {v !== null ? (
                        <div style={{ display: "inline-block", background: bg, color: col2, borderRadius: 6, padding: "4px 8px", fontWeight: 700, fontSize: 12, minWidth: 48 }}>
                          {v > 0 ? "+" : ""}{v}
                          <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.7 }}>n={n}</div>
                        </div>
                      ) : <span style={{ color: C.textLight, fontSize: 12 }}>—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {/* Radar — one line per project */}
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 4 }}>Profil technique — radar par projet</div>
      <div style={{ fontSize: 12, color: C.textLight, marginBottom: 20 }}>Scores normalisés 0–100 · moyenne de tous les sites du projet</div>
      {projects.every(p => Object.values(p.sfData || {}).flat().length === 0) ? (
        <div style={{ textAlign: "center", padding: 40, color: C.textLight, fontSize: 13 }}>Chargez des données SF pour afficher le radar</div>
      ) : (
        <ResponsiveContainer width="100%" height={340}>
          <RadarChart data={allProjectsRadar}>
            <PolarGrid stroke={C.border} />
            <PolarAngleAxis dataKey="dim" tick={{ fill: C.textLight, fontSize: 11 }} />
            {projects.map((p, pi) => {
              const col = SITE_PALETTE[pi % SITE_PALETTE.length].color;
              return <Radar key={p.id} name={p.name} dataKey={p.id} stroke={col} fill={col} fillOpacity={0.08} strokeWidth={2} dot={{ r: 3 }} />;
            })}
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </RadarChart>
        </ResponsiveContainer>
      )}
    </div>
  </div>
)}