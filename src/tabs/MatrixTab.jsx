import InfoCard from "../components/InfoCard";
import { useState, useMemo, useEffect, useRef } from "react";
import { C, RES_KPIS } from "../lib/constants";
import { SectionHeader, Badge } from "../components/ui";
import PageModeSelector from "../components/PageModeSelector";
import { CorrCell, KpiHeaderCell, SfDimCell } from "../components/CorrCell";

// Génère un texte d'interprétation synthétique pour une ligne entière
function interpretRow(dim, corrs) {
  const valid = corrs.filter(c => c.value !== null);
  if (valid.length === 0) return { text: "Données insuffisantes pour cette dimension.", level: "none" };

  const strong = valid.filter(c => Math.abs(c.value) >= 0.25);
  const positive = strong.filter(c => c.value > 0);
  const negative = strong.filter(c => c.value < 0);

  if (strong.length === 0) {
    return { text: "Aucune corrélation significative détectée — cette dimension n'est pas liée aux KPIs mesurés.", level: "neutral" };
  }

  const parts = [];
  if (positive.length > 0) {
    const names = positive.map(c => c.kpi.label).join(", ");
    const dir = dim.higher === false ? "baisser" : "augmenter";
    parts.push(`Faire ${dir} ${dim.label} tend à améliorer ${names}`);
  }
  if (negative.length > 0) {
    const names = negative.map(c => c.kpi.label).join(", ");
    const dir = dim.higher === false ? "baisser" : "augmenter";
    parts.push(`${dir === "baisser" ? "Augmenter" : "Baisser"} ${dim.label} dégrade ${names}`);
  }

  const level = strong.length >= 3 ? "strong" : strong.length >= 1 ? "moderate" : "neutral";
  return { text: parts.join(". ") + ".", level };
}

const LEVEL_STYLE = {
  strong:   { color: "#059669", bg: "#ECFDF5", border: "#6EE7B7" },
  moderate: { color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
  neutral:  { color: "#64748B", bg: "#F8FAFC", border: "#E2E8F0" },
  none:     { color: "#94A3B8", bg: "#F8FAFC", border: "#E2E8F0" },
};

function Switch({ value, onChange, label }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{ display: "flex", alignItems: "center", gap: 7, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
    >
      <div style={{
        width: 34, height: 18, borderRadius: 9, background: value ? C.blue : C.border,
        position: "relative", transition: "background 0.2s", flexShrink: 0,
      }}>
        <div style={{
          position: "absolute", top: 2, left: value ? 18 : 2,
          width: 14, height: 14, borderRadius: "50%", background: "#fff",
          transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }} />
      </div>
      <span style={{ fontSize: 12, color: C.textMid, userSelect: "none" }}>{label}</span>
    </button>
  );
}

export default function MatrixTab({ sites, sfData, pageMode, setPageMode, matrixSites, setMatrixSites, filteredCorrMatrix, templateFilter, setTemplateFilter, pageTypes }) {
  const [sortCol, setSortCol] = useState({ key: null, dir: null });
  const [tooltipEnabled, setTooltipEnabled] = useState(true);
  const [showIntroPopup, setShowIntroPopup] = useState(false);
  const tableWrapRef = useRef(null);
  const topBarRef    = useRef(null);

  useEffect(() => {
    const seen = localStorage.getItem("matrix_intro_seen");
    if (!seen) setShowIntroPopup(true);
  }, []);

  const dismissPopup = () => {
    localStorage.setItem("matrix_intro_seen", "1");
    setShowIntroPopup(false);
  };

  const syncFromTop  = () => { if (tableWrapRef.current && topBarRef.current) tableWrapRef.current.scrollLeft = topBarRef.current.scrollLeft; };
  const syncFromMain = () => { if (tableWrapRef.current && topBarRef.current) topBarRef.current.scrollLeft = tableWrapRef.current.scrollLeft; };

  const handleSort = (kpiKey) => {
    setSortCol(prev => {
      if (prev.key !== kpiKey) return { key: kpiKey, dir: "desc" };
      if (prev.dir === "desc")  return { key: kpiKey, dir: "asc" };
      return { key: null, dir: null };
    });
  };

  const sortedMatrix = useMemo(() => {
    if (!sortCol.key) return filteredCorrMatrix;
    return [...filteredCorrMatrix].sort((a, b) => {
      const va = a.corrs.find(c => c.kpi.key === sortCol.key)?.value ?? null;
      const vb = b.corrs.find(c => c.kpi.key === sortCol.key)?.value ?? null;
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return sortCol.dir === "desc" ? vb - va : va - vb;
    });
  }, [filteredCorrMatrix, sortCol]);

  const colSpanTotal = RES_KPIS.length + 2;

  return (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
      <SectionHeader title="Matrice de corrélation" sub="Pearson · SF (ordonnées) × KPIs résultats (abscisses)" />
      <PageModeSelector value={pageMode} onChange={setPageMode} pageTypes={pageTypes} sites={sites} templateFilter={templateFilter} setTemplateFilter={setTemplateFilter} />
    </div>
    <InfoCard tabKey="matrix" />

    {/* Controls */}
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
        <span style={{ fontSize: 12, color: C.textLight, fontWeight: 600 }}>Aide au survol</span>
        <Switch value={tooltipEnabled} onChange={setTooltipEnabled} label={tooltipEnabled ? "Activée" : "Désactivée"} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: C.textLight, fontWeight: 500 }}>Sites :</span>
        {sites.map(s => {
          const active = matrixSites.includes(s.id);
          return (
            <button key={s.id} onClick={() => setMatrixSites(prev =>
              active ? prev.filter(id => id !== s.id) : [...prev, s.id]
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
        {matrixSites.length === 0 && <span style={{ fontSize: 12, color: C.red, fontStyle: "italic" }}>Aucun site sélectionné</span>}
        {matrixSites.length > 0 && (
          <span style={{ fontSize: 11, color: C.purple, background: C.purpleLight, padding: "3px 10px", borderRadius: 20 }}>
            Pearson par page · {matrixSites.length === 1 ? sites.find(s => s.id === matrixSites[0])?.label : `${matrixSites.length} sites combinés`}
          </span>
        )}
      </div>
    </div>

    {/* Legend — 60px */}
    <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
      {[["#15803D","#DCFCE7","#86EFAC","≥ 0.25","Positif fort"],["#16A34A","#F0FDF4","#BBF7D0","0.05–0.25","Positif léger"],["#64748B","#F1F5F9","#CBD5E1","-0.05–0.05","Neutre"],["#DC2626","#FEF2F2","#FECACA","-0.25–-0.05","Négatif léger"],["#B91C1C","#FEE2E2","#FCA5A5","≤ -0.25","Négatif fort"],["#C0C0CC","#F5F5F7","#E8E8ED","—","Données insuffisantes"]].map(([tc,bg,bc,label,desc]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 60, height: 22, background: bg, border: `1px solid ${bc}`, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: tc, fontWeight: 700 }}>{label}</div>
          <span style={{ fontSize: 12, color: C.textMid }}>{desc}</span>
        </div>
      ))}
    </div>

    {/* Top scrollbar mirror */}
    <div ref={topBarRef} onScroll={syncFromTop}
      style={{ overflowX: "auto", overflowY: "hidden", marginBottom: 2 }}>
      <div style={{ height: 1, minWidth: 900 }} />
    </div>

    <div ref={tableWrapRef} onScroll={syncFromMain}
      style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
        <thead style={{ position: "sticky", top: 0, zIndex: 3 }}>
          <tr>
            <th style={{ padding: "14px 18px", textAlign: "left", fontSize: 12, fontWeight: 600, color: C.textMid, background: C.bg, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, minWidth: 210, position: "sticky", left: 0, zIndex: 2 }}>
              SF \ Résultats
            </th>
            {RES_KPIS.map(kpi => (
              <KpiHeaderCell
                key={kpi.key}
                kpi={kpi}
                sortState={sortCol.key === kpi.key ? sortCol.dir : null}
                onSort={() => handleSort(kpi.key)}
                tooltipEnabled={tooltipEnabled}
              />
            ))}
            <th style={{ padding: "12px 14px", fontSize: 11, fontWeight: 600, color: C.textLight, textAlign: "left", textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}`, minWidth: 220, background: C.bg }}>
              Interprétation
            </th>
          </tr>
        </thead>
        <tbody>
          {matrixSites.length === 0 ? (
            <tr><td colSpan={colSpanTotal} style={{ padding: 40, textAlign: "center", color: C.textLight, fontSize: 13 }}>Sélectionnez au moins un site pour afficher la matrice</td></tr>
          ) : matrixSites.every(id => !sfData[id]?.length) ? (
            <tr><td colSpan={colSpanTotal} style={{ padding: 40, textAlign: "center", color: C.textLight, fontSize: 13 }}>Chargez un fichier Screaming Frog pour afficher la matrice</td></tr>
          ) : sortedMatrix.map(({ dim, corrs }, ri) => {
            const rowBg = ri % 2 === 0 ? C.white : "#FAFBFC";
            const interp = interpretRow(dim, corrs);
            const s = LEVEL_STYLE[interp.level];
            return (
              <tr key={dim.key} style={{ background: rowBg }}>
                <SfDimCell dim={dim} rowBg={rowBg} tooltipEnabled={tooltipEnabled} />
                {corrs.map(({ kpi, value, n, base, delta }) => (
                  <CorrCell key={kpi.key} kpi={kpi} value={value} n={n} dim={dim} base={base} delta={delta} showDelta={pageMode !== "all"} tooltipEnabled={tooltipEnabled} />
                ))}
                <td style={{ padding: "8px 14px", borderBottom: `1px solid ${C.borderLight}`, borderLeft: `1px solid ${C.border}`, verticalAlign: "middle" }}>
                  <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 7, padding: "6px 10px", fontSize: 11, color: s.color, lineHeight: 1.55 }}>
                    {interp.text}
                  </div>
                </td>
              </tr>
            );
          })}
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
  {/* ── Matrix intro popup ── */}
  {showIntroPopup && (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,15,30,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 18, padding: "32px 36px", maxWidth: 560, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.25)" }}>

        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 16, lineHeight: 1.3 }}>
          Attention, vous entrez sur une page avec beaucoup de chiffres !
        </div>

        <p style={{ fontSize: 14, color: C.textMid, lineHeight: 1.65, marginBottom: 18 }}>
          Ce tableau permet de visualiser les <b style={{ color: C.text }}>liens entre certains critères de page</b> et
          la <b style={{ color: C.text }}>position SEO/GEO de ces pages</b>. Plus le score est élevé (en valeur absolue),
          plus le lien entre le critère et la performance est fort — dans un sens ou dans l'autre.
        </p>

        <div style={{ background: C.blueLight, border: `1px solid ${C.blue}33`, borderRadius: 10, padding: "14px 16px", marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: C.blue, marginBottom: 8 }}>Exemple de lecture</div>
          <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.6, margin: 0 }}>
            Si une case affiche <b style={{ color: C.blue }}>+42%</b>, les pages ayant un score élevé sur ce critère
            tendent à mieux se positionner. Une case à <b style={{ color: "#DC2626" }}>-18%</b> indique l'inverse.
            Une case proche de <b style={{ color: C.textMid }}>0%</b> signifie qu'il n'y a pas de lien observable.
          </p>
        </div>

        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "12px 16px", marginBottom: 28 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
            <p style={{ fontSize: 13, color: "#92400E", lineHeight: 1.6, margin: 0 }}>
              <b>Corrélation ≠ causalité.</b> Le critère testé est peut-être simplement présent sur un certain
              type de page sans en être la raison des résultats. Ce tableau permet uniquement de dire :
              <em>{" « Les pages du site ayant ce critère fonctionnent mieux (ou moins bien) en moyenne. »"}</em>
            </p>
          </div>
        </div>

        <button onClick={dismissPopup} style={{
          width: "100%", padding: "12px 0", border: "none", borderRadius: 10,
          background: C.blue, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
        }}>
          J'ai compris, afficher la matrice
        </button>
        <div style={{ textAlign: "center", marginTop: 10, fontSize: 11, color: C.textLight }}>
          Cette popup n'apparaîtra plus au prochain chargement.
        </div>
      </div>
    </div>
  )}

  </div>
  );
}