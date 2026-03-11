import { useState, useCallback } from "react";

// Dimensions dans l'ordre décroissant de poids — doit rester synchro avec scoring.js
const SCORE_DIMS = [
  { key: "avgFlesch",      label: "Score Flesch",      maxPts: 18.6, dir:  1, hint: "Lisibilité du contenu (0–100)" },
  { key: "avgInlinksUniq", label: "Maillage interne",  maxPts: 16.6, dir:  1, hint: "Liens entrants uniques par page" },
  { key: "avgWords",       label: "Volume contenu",    maxPts: 12.4, dir:  1, hint: "Nombre de mots par page" },
  { key: "schemaRate",     label: "Schema JSON-LD",    maxPts:  8.9, dir:  1, hint: "% de pages avec balisage Schema" },
  { key: "avgTitleLen",    label: "Title",             maxPts:  7.5, dir:  1, hint: "Longueur du title (0–65 car.)" },
  { key: "avgDepth",       label: "Profondeur crawl",  maxPts:  7.5, dir: -1, hint: "Profondeur dans l'arborescence (plus bas = mieux)" },
  { key: "tableRate",      label: "Tableaux",          maxPts:  6.3, dir:  1, hint: "% de pages avec un tableau" },
  { key: "avgH1Len",       label: "H1",                maxPts:  5.5, dir:  1, hint: "Longueur du H1 (0–80 car.)" },
  { key: "errorRate",      label: "Erreurs 4xx",       maxPts:  5.5, dir: -1, hint: "% de pages en erreur (moins = mieux)" },
  { key: "avgMetaLen",     label: "Meta description",  maxPts:  3.8, dir:  1, hint: "Longueur de la meta (0–160 car.)" },
  { key: "avgPageSizeKB",  label: "Poids pages",       maxPts:  3.0, dir: -1, hint: "Poids HTML en KB (moins = mieux)" },
  { key: "redirectRate",   label: "Redirections",      maxPts:  3.0, dir: -1, hint: "% de redirections (moins = mieux)" },
  { key: "avgImgSizeKB",   label: "Poids images",      maxPts:  1.4, dir: -1, hint: "Poids moyen images en KB (moins = mieux)" },
];

function useHover() {
  const [rect, setRect] = useState(null);
  const onEnter = useCallback(e => setRect(e.currentTarget.getBoundingClientRect()), []);
  const onLeave = useCallback(() => setRect(null), []);
  return { rect, onEnter, onLeave };
}

function tooltipPos(rect, w, h, gap = 10) {
  if (!rect) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const above = rect.top - h - gap;
  const below = rect.bottom + gap;
  const top = above >= 0 ? above : (below + h <= vh ? below : Math.max(8, vh - h - 8));
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, vw - w - 8));
  return { position: "fixed", top, left, zIndex: 9999, pointerEvents: "none" };
}

/**
 * ScoreTooltip — petit bouton ⓘ qui affiche le détail du scoring au survol
 * Props:
 *   detail  — objet { key: { pts, maxPts? } } retourné par computeSiteScore/computePageScore
 *   score   — score total (number)
 */
export default function ScoreTooltip({ detail, score }) {
  const { rect, onEnter, onLeave } = useHover();
  const W = 320;
  // Estimate height: header ~70px + 13 rows ~22px + footer ~30px
  const H = 70 + SCORE_DIMS.length * 22 + 36;
  const pos = rect ? tooltipPos(rect, W, H) : null;

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <span
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 15, height: 15, borderRadius: "50%",
          background: "#E2E8F0", color: "#64748B",
          fontSize: 9, fontWeight: 700, cursor: "help",
          userSelect: "none", flexShrink: 0,
        }}
      >ⓘ</span>
      {pos && rect && (
        <div style={{
          ...pos, width: W,
          background: "#1E1E2E", color: "#fff", borderRadius: 12,
          padding: "14px 16px", fontSize: 11, boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          lineHeight: 1.5,
        }}>
          {/* Header */}
          <div style={{ fontWeight: 700, fontSize: 13, color: "#E2E8F0", marginBottom: 4 }}>
            Détail du score GEO-readiness
          </div>
          <div style={{ fontSize: 10, color: "#64748B", marginBottom: 10 }}>
            Pondéré par r² des corrélations SF × KPIs · 13 critères · max 100 pts
          </div>

          {/* Rows */}
          <div style={{ borderTop: "1px solid #ffffff15", paddingTop: 8 }}>
            {SCORE_DIMS.map(({ key, label, maxPts, dir, hint }) => {
              const d = detail?.[key];
              const pts = d ? Math.round(d.pts * 10) / 10 : null;
              const pct = pts !== null ? Math.round((pts / maxPts) * 100) : 0;
              const barColor = pts === null ? "#3F3F5A"
                : pct >= 70 ? "#34D399"
                : pct >= 35 ? "#FBBF24"
                : "#F87171";

              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }} title={hint}>
                  {/* Label */}
                  <div style={{ width: 110, fontSize: 10, color: pts === null ? "#4B5563" : "#CBD5E1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0 }}>
                    {dir === 1 ? "↑" : "↓"} {label}
                  </div>
                  {/* Bar */}
                  <div style={{ flex: 1, height: 5, background: "#2D2D44", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 3, transition: "width 0.3s" }} />
                  </div>
                  {/* pts / max */}
                  <div style={{ fontSize: 10, fontVariantNumeric: "tabular-nums", color: pts === null ? "#4B5563" : "#E2E8F0", whiteSpace: "nowrap", width: 60, textAlign: "right", flexShrink: 0 }}>
                    {pts !== null ? `${pts} / ${maxPts}` : `— / ${maxPts}`}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer total */}
          <div style={{ borderTop: "1px solid #ffffff22", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#64748B" }}>Score total</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#E2E8F0", fontVariantNumeric: "tabular-nums" }}>
              {score ?? "—"} <span style={{ fontSize: 10, color: "#64748B" }}>/ 100</span>
            </span>
          </div>
        </div>
      )}
    </span>
  );
}