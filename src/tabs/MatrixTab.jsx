import { C, RES_KPIS } from "../lib/constants";
import { SectionHeader, Badge } from "../components/ui";
import PageModeSelector from "../components/PageModeSelector";
import { CorrCell, KpiHeaderCell, SfDimCell } from "../components/CorrCell";

export default function MatrixTab({ sites, sfData, pageMode, setPageMode, matrixSites, setMatrixSites, filteredCorrMatrix }) {
  return (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
      <SectionHeader title="Matrice de corrélation" sub="Pearson · SF (ordonnées) × KPIs résultats (abscisses)" />
      <PageModeSelector value={pageMode} onChange={setPageMode} />
    </div>

    {/* Site toggles */}
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: C.textLight, fontWeight: 500 }}>Sites inclus dans le calcul :</span>
      {sites.map(s => {
        const active = matrixSites.includes(s.id);
        return (
          <button key={s.id} onClick={() => setMatrixSites(prev =>
            active
              ? prev.filter(id => id !== s.id)
              : [...prev, s.id]
          )} style={{
            padding: "5px 14px", border: `1.5px solid ${active ? s.color : C.border}`,
            borderRadius: 20, cursor: "pointer", fontSize: 12, fontWeight: 600,
            background: active ? s.bg : C.white, color: active ? s.color : C.textLight,
            transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: active ? s.color : C.border, display: "inline-block" }} />
            {s.label}
          </button>
        );
      })}
      {matrixSites.length === 0 && (
        <span style={{ fontSize: 12, color: C.red, fontStyle: "italic" }}>Aucun site sélectionné — matrice vide</span>
      )}
      {matrixSites.length > 0 && (
        <span style={{ fontSize: 11, color: C.purple, background: C.purpleLight, padding: "3px 10px", borderRadius: 20 }}>
          Pearson par page · {matrixSites.length === 1
            ? sites.find(s => s.id === matrixSites[0])?.label
            : `${matrixSites.length} sites combinés`}
        </span>
      )}
    </div>

    <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
      {[["#15803D","#DCFCE7","#86EFAC","≥ 0.25","Positif fort"],["#16A34A","#F0FDF4","#BBF7D0","0.05–0.25","Positif léger"],["#64748B","#F1F5F9","#CBD5E1","-0.05–0.05","Neutre"],["#DC2626","#FEF2F2","#FECACA","-0.25–-0.05","Négatif léger"],["#B91C1C","#FEE2E2","#FCA5A5","≤ -0.25","Négatif fort"],["#C0C0CC","#F5F5F7","#E8E8ED","—","Données insuffisantes"]].map(([tc,bg,bc,label,desc]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 22, background: bg, border: `1px solid ${bc}`, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: tc, fontWeight: 700 }}>{label}</div>
          <span style={{ fontSize: 12, color: C.textMid }}>{desc}</span>
        </div>
      ))}
    </div>


    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
        <thead>
          <tr>
            <th style={{ padding: "14px 18px", textAlign: "left", fontSize: 12, fontWeight: 600, color: C.textMid, background: C.bg, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, minWidth: 210, position: "sticky", left: 0, zIndex: 2 }}>
              SF \ Résultats
            </th>
            {RES_KPIS.map(kpi => (
              <KpiHeaderCell key={kpi.key} kpi={kpi} />
            ))}
          </tr>
        </thead>
        <tbody>
          {matrixSites.length === 0 ? (
            <tr><td colSpan={RES_KPIS.length + 1} style={{ padding: 40, textAlign: "center", color: C.textLight, fontSize: 13 }}>Sélectionnez au moins un site pour afficher la matrice</td></tr>
          ) : matrixSites.every(id => !sfData[id]?.length) ? (
            <tr><td colSpan={RES_KPIS.length + 1} style={{ padding: 40, textAlign: "center", color: C.textLight, fontSize: 13 }}>Chargez un fichier Screaming Frog pour afficher la matrice</td></tr>
          ) : filteredCorrMatrix.map(({ dim, corrs }, ri) => (
            <tr key={dim.key} style={{ background: ri % 2 === 0 ? C.white : "#FAFBFC" }}>
              <SfDimCell dim={dim} rowBg={ri % 2 === 0 ? C.white : "#FAFBFC"} />
              {corrs.map(({ kpi, value, n, base, delta }) => (
                <CorrCell key={kpi.key} kpi={kpi} value={value} n={n} dim={dim} base={base} delta={delta} showDelta={pageMode !== "all"} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      {[["🟢 Top corrélations positives", (a,b) => b.value-a.value, v => v >= 0.4, C.green, C.greenLight],
        ["🔴 Top corrélations négatives", (a,b) => a.value-b.value, v => v <= -0.4, C.red, C.redLight]
      ].map(([title, sort, filter, color, bg]) => (
        <div key={title} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: C.text, marginBottom: 12 }}>{title}</div>
          {filteredCorrMatrix.flatMap(({ dim, corrs }) => corrs.filter(c => c.value !== null && filter(c.value)).map(c => ({ dim, kpi: c.kpi, value: c.value })))
            .sort(sort).slice(0,5).map((item, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.borderLight}` }}>
              <div>
                <div style={{ fontSize: 12, color: C.text }}>{item.dim.label}</div>
                <div style={{ fontSize: 11, color: C.textLight }}>→ {item.kpi.label}</div>
              </div>
              <Badge color={color} bg={bg}>{item.value > 0 ? "+" : ""}{item.value}</Badge>
            </div>
          ))}
          {filteredCorrMatrix.flatMap(({ dim, corrs }) => corrs.filter(c => c.value !== null && filter(c.value))).length === 0 &&
            <div style={{ fontSize: 12, color: C.textLight }}>Pas encore de données suffisantes</div>}
        </div>
      ))}
    </div>
  </div>
)}