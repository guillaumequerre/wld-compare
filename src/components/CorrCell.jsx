import { useState, useCallback } from "react";
import { C, SF_DIM_TOOLTIPS, KPI_TOOLTIPS } from "../lib/constants";
import { corrColor } from "../lib/helpers";

function useTooltip(enabled) {
  const [rect, setRect] = useState(null);
  const onEnter = useCallback((e) => { if (enabled) setRect(e.currentTarget.getBoundingClientRect()); }, [enabled]);
  const onLeave = useCallback(() => setRect(null), []);
  return { rect, onEnter, onLeave };
}

function tooltipStyle(rect, w, h, gap = 10) {
  if (!rect) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const above = rect.top - h - gap;
  const below = rect.bottom + gap;
  const top = above >= 0 ? above : (below + h <= vh ? below : Math.max(8, vh - h - 8));
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, vw - w - 8));
  return { position: "fixed", top, left, zIndex: 9999, pointerEvents: "none" };
}

function corrInterpret(r) {
  if (r === null) return null;
  if (r >= 0.25)  return { label: "Corrélation positive forte",  color: "#86EFAC" };
  if (r >= 0.05)  return { label: "Corrélation positive faible", color: "#BBF7D0" };
  if (r > -0.05)  return { label: "Pas de corrélation nette",    color: "#CBD5E1" };
  if (r > -0.25)  return { label: "Corrélation négative faible", color: "#FECACA" };
  return               { label: "Corrélation négative forte",    color: "#FCA5A5" };
}

// Shared dark tooltip shell
function DarkTooltip({ style, children }) {
  return (
    <div style={{ ...style, background: "#1E1E2E", color: "#fff", borderRadius: 10, padding: "13px 15px", fontSize: 12, boxShadow: "0 6px 20px rgba(0,0,0,0.3)", lineHeight: 1.7, wordWrap: "break-word", overflowWrap: "break-word", whiteSpace: "normal" }}>
      {children}
    </div>
  );
}

function Sep() {
  return <div style={{ borderTop: "1px solid #ffffff22", margin: "8px 0" }} />;
}

// ── CorrCell ────────────────────────────────────────────────────
export function CorrCell({ kpi, value, n, dim, base, delta, showDelta, tooltipEnabled }) {
  const { rect, onEnter, onLeave } = useTooltip(tooltipEnabled);
  const col    = corrColor(value);
  const interp = corrInterpret(value);
  const W = 260, H = value !== null ? (showDelta && delta !== null ? 310 : 250) : 110;
  const ts = tooltipEnabled ? tooltipStyle(rect, W, H) : null;

  return (
    <td
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ padding: "8px 6px", textAlign: "center", borderRight: `1px solid ${C.borderLight}`, borderBottom: `1px solid ${C.borderLight}`, cursor: tooltipEnabled ? "help" : "default", position: "relative" }}
    >
      <div style={{ background: col.bg, color: col.text, border: `1px solid ${col.border}`, borderRadius: 7, padding: "5px 6px", fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {value !== null ? (value > 0 ? "+" : "") + value : "—"}
      </div>
      {showDelta && delta !== null && (
        <div style={{ fontSize: 10, fontWeight: 600, marginTop: 2, color: delta > 0 ? "#16A34A" : delta < 0 ? "#DC2626" : C.textLight, display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "="}{delta !== 0 ? (delta > 0 ? "+" : "") + delta : "="}
        </div>
      )}
      {n > 0 && <div style={{ fontSize: 9, color: C.textLight, marginTop: 1 }}>{n}p</div>}
      {ts && rect && (
        <DarkTooltip style={{ ...ts, width: W }}>
          {value !== null ? (<>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 800 }}>{value > 0 ? "+" : ""}{value}</span>
              <span style={{ fontSize: 10, fontWeight: 600, background: interp.color, color: "#1E1E2E", borderRadius: 4, padding: "2px 7px" }}>{interp.label}</span>
            </div>
            <Sep />
            <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4 }}>Ce que mesure ce coefficient :</div>
            <div style={{ fontSize: 11 }}>
              Quand <b style={{ color: "#E2E8F0" }}>{dim.label}</b> augmente d'une page à l'autre,
              est-ce que <b style={{ color: "#E2E8F0" }}>{kpi.label}</b> a tendance à {value >= 0 ? "augmenter" : "diminuer"} aussi ?
            </div>
            <Sep />
            <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4 }}>Comment c'est calculé :</div>
            <div style={{ fontSize: 11 }}>
              Pour chaque page dans SF et dans {kpi.label.includes("Bing") ? "Bing" : ["Clics","Impressions","CTR","Position"].some(k => kpi.label.includes(k)) ? "GSC" : "GA4"},
              on compare sa valeur <b style={{ color: "#E2E8F0" }}>{dim.label}</b> avec <b style={{ color: "#E2E8F0" }}>{kpi.label}</b>.
              Pearson r mesure si ces séries varient ensemble (+1 parfaite, 0 aucun, −1 inverse).
            </div>
            {showDelta && delta !== null && (<>
              <Sep />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: "#94A3B8" }}>Toutes les pages :</span>
                <span style={{ fontWeight: 600 }}>{base !== null ? (base > 0 ? "+" : "") + base : "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: "#94A3B8" }}>Ce filtre :</span>
                <span style={{ fontWeight: 600 }}>{value !== null ? (value > 0 ? "+" : "") + value : "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 2 }}>
                <span style={{ color: "#94A3B8" }}>Différence :</span>
                <span style={{ fontWeight: 700, color: delta > 0 ? "#86EFAC" : delta < 0 ? "#FCA5A5" : "#94A3B8" }}>
                  {delta > 0 ? "▲ +" : delta < 0 ? "▼ " : "= "}{delta}
                </span>
              </div>
            </>)}
            <div style={{ borderTop: "1px solid #ffffff22", paddingTop: 7, marginTop: 8, fontSize: 10, color: "#64748B" }}>
              {n} pages avec données des deux sources · Pearson r
            </div>
          </>) : (<>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Données insuffisantes</div>
            <div style={{ fontSize: 11, color: "#94A3B8" }}>
              Seulement {n} page{n > 1 ? "s" : ""} avec URL présente dans les deux sources.
              Minimum 5 requis pour calculer une corrélation fiable.
            </div>
          </>)}
        </DarkTooltip>
      )}
    </td>
  );
}

// ── KpiHeaderCell ───────────────────────────────────────────────
export function KpiHeaderCell({ kpi, sortState, onSort, tooltipEnabled }) {
  const { rect, onEnter, onLeave } = useTooltip(tooltipEnabled);
  const tip = KPI_TOOLTIPS[kpi.label];
  const W = 260, H = 160;
  const ts = tooltipEnabled ? tooltipStyle(rect, W, H) : null;
  const ICONS = { null: "⇅", asc: "↑", desc: "↓" };

  return (
    <th
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onSort}
      style={{
        padding: "12px 10px", fontSize: 11, fontWeight: 600, textAlign: "center",
        textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `1px solid ${C.border}`,
        whiteSpace: "nowrap", cursor: "pointer", position: "relative", userSelect: "none",
        color: sortState ? C.blue : C.textLight,
        background: sortState ? C.blueLight : "transparent",
      }}
    >
      <span>{kpi.label}</span>
      <span style={{ marginLeft: 4, fontSize: 10, opacity: sortState ? 1 : 0.4 }}>{ICONS[sortState] ?? "⇅"}</span>
      {ts && rect && (
        <DarkTooltip style={{ ...ts, width: W }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: "#E2E8F0" }}>{kpi.label}</div>
          {tip && (<>
            <div style={{ fontSize: 11, color: "#CBD5E1", marginBottom: 8 }}>{tip}</div>
            <Sep />
          </>)}
          <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4 }}>Utilisation dans la matrice :</div>
          <div style={{ fontSize: 11, color: "#CBD5E1" }}>
            Chaque cellule de cette colonne mesure la corrélation Pearson r entre une dimension SF et <b style={{ color: "#E2E8F0" }}>{kpi.label}</b> — page par page.
          </div>
          <Sep />
          <div style={{ fontSize: 10, color: "#64748B" }}>
            Cliquez pour trier les lignes par cette colonne · {sortState ? (sortState === "desc" ? "Tri décroissant actif" : "Tri croissant actif") : "Pas de tri actif"}
          </div>
        </DarkTooltip>
      )}
    </th>
  );
}

// ── SfDimCell ───────────────────────────────────────────────────
export function SfDimCell({ dim, rowBg, tooltipEnabled }) {
  const { rect, onEnter, onLeave } = useTooltip(tooltipEnabled);
  const tip = SF_DIM_TOOLTIPS[dim.key];
  const W = 280, H = 180;
  const ts = tooltipEnabled ? tooltipStyle(rect, W, H) : null;

  return (
    <td
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        padding: "10px 16px", fontSize: 12, color: C.textMid, fontWeight: 500,
        whiteSpace: "nowrap", background: rowBg,
        borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.border}`,
        cursor: tooltipEnabled ? "help" : "default", position: "relative",
      }}
    >
      {dim.label}
      {ts && rect && (
        <DarkTooltip style={{ ...ts, width: W }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: "#E2E8F0" }}>{dim.label}</div>
          {tip && (<>
            <div style={{ fontSize: 11, color: "#CBD5E1", marginBottom: 8 }}>{tip}</div>
            <Sep />
          </>)}
          <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4 }}>Direction optimale :</div>
          <div style={{ fontSize: 11, color: "#CBD5E1" }}>
            {dim.higher !== false
              ? <>Une valeur <b style={{ color: "#86EFAC" }}>élevée</b> est associée à de meilleures performances.</>
              : <>Une valeur <b style={{ color: "#FCA5A5" }}>basse</b> est associée à de meilleures performances.</>
            }
          </div>
          <Sep />
          <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4 }}>Utilisation dans la matrice :</div>
          <div style={{ fontSize: 11, color: "#CBD5E1" }}>
            Chaque cellule de cette ligne montre comment <b style={{ color: "#E2E8F0" }}>{dim.label}</b> se corrèle avec un KPI résultat (GSC, GA4, Bing) — calculé page par page via Pearson r.
          </div>
        </DarkTooltip>
      )}
    </td>
  );
}