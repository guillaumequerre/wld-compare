import { useState } from "react";
import { C, SF_DIM_TOOLTIPS, KPI_TOOLTIPS } from "../lib/constants.js";
import { corrColor } from "../lib/helpers.js";

function corrInterpret(r) {
  if (r === null) return null;
  if (r >= 0.25)  return { label: "Corrélation positive forte",  color: "#86EFAC" };
  if (r >= 0.05)  return { label: "Corrélation positive faible", color: "#BBF7D0" };
  if (r > -0.05)  return { label: "Pas de corrélation nette",    color: "#CBD5E1" };
  if (r > -0.25)  return { label: "Corrélation négative faible", color: "#FECACA" };
  return               { label: "Corrélation négative forte",    color: "#FCA5A5" };
}

export function CorrCell({ kpi, value, n, dim, base, delta, showDelta }) {
  const [show, setShow] = useState(false);
  const col    = corrColor(value);
  const interp = corrInterpret(value);
  return (
    <td
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      style={{ padding: "8px 6px", textAlign: "center", borderRight: `1px solid ${C.borderLight}`, borderBottom: `1px solid ${C.borderLight}`, cursor: "help", position: "relative" }}
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
      {show && (
        <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: "#1E1E2E", color: "#fff", borderRadius: 10, padding: "13px 15px", fontSize: 12, zIndex: 50, pointerEvents: "none", boxShadow: "0 6px 20px rgba(0,0,0,0.3)", width: 240, lineHeight: 1.7 }}>
          {value !== null ? (<>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 800 }}>{value > 0 ? "+" : ""}{value}</span>
              <span style={{ fontSize: 10, fontWeight: 600, background: interp.color, color: "#1E1E2E", borderRadius: 4, padding: "2px 7px" }}>{interp.label}</span>
            </div>
            <div style={{ borderTop: "1px solid #ffffff22", paddingTop: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4 }}>Ce que mesure ce coefficient :</div>
              <div style={{ fontSize: 11 }}>
                Quand <b style={{ color: "#E2E8F0" }}>{dim.label}</b> augmente d'une page à l'autre,
                est-ce que <b style={{ color: "#E2E8F0" }}>{kpi.label}</b> a tendance à {value >= 0 ? "augmenter" : "diminuer"} aussi ?
              </div>
            </div>
            <div style={{ borderTop: "1px solid #ffffff22", paddingTop: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4 }}>Comment c'est calculé :</div>
              <div style={{ fontSize: 11 }}>
                Pour chaque page présente à la fois dans SF et dans {kpi.label.includes("Bing") ? "Bing" : ["Clics","Impressions","CTR","Position"].some(k => kpi.label.includes(k)) ? "GSC" : "GA4"},
                on compare sa valeur <b style={{ color: "#E2E8F0" }}>{dim.label}</b> avec <b style={{ color: "#E2E8F0" }}>{kpi.label}</b>.
                Pearson r mesure si ces deux séries varient ensemble (r = +1 parfaite covariation, r = 0 aucun lien, r = −1 relation inverse).
              </div>
            </div>
            {showDelta && delta !== null && (
              <div style={{ borderTop: "1px solid #ffffff22", paddingTop: 8, marginTop: 4 }}>
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
              </div>
            )}
            <div style={{ borderTop: "1px solid #ffffff22", paddingTop: 7, fontSize: 10, color: "#64748B" }}>
              {n} pages avec données des deux sources · Pearson r
            </div>
          </>) : (<>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Données insuffisantes</div>
            <div style={{ fontSize: 11, color: "#94A3B8" }}>
              Seulement {n} page{n > 1 ? "s" : ""} avec URL présente dans les deux sources.
              Minimum 5 requis pour calculer une corrélation fiable.
            </div>
          </>)}
          <div style={{ position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%)", width: 10, height: 10, background: "#1E1E2E", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
        </div>
      )}
    </td>
  );
}

export function KpiHeaderCell({ kpi }) {
  const [show, setShow] = useState(false);
  const tip = KPI_TOOLTIPS[kpi.label];
  return (
    <th
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      style={{ padding: "12px 10px", fontSize: 11, color: C.textLight, fontWeight: 600, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", cursor: tip ? "help" : "default", position: "relative" }}
    >
      {kpi.label}
      {show && tip && (
        <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", background: "#1E1E2E", color: "#fff", borderRadius: 9, padding: "10px 13px", fontSize: 11, zIndex: 60, pointerEvents: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.3)", width: 220, lineHeight: 1.6 }}>
          {tip}
          <div style={{ position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%)", width: 10, height: 10, background: "#1E1E2E", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
        </div>
      )}
    </th>
  );
}

export function SfDimCell({ dim, rowBg }) {
  const [show, setShow] = useState(false);
  const tip = SF_DIM_TOOLTIPS[dim.key];
  return (
    <td
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      style={{ padding: "10px 16px", fontSize: 12, color: C.textMid, fontWeight: 500, whiteSpace: "nowrap", background: rowBg, borderBottom: `1px solid ${C.borderLight}`, borderRight: `1px solid ${C.border}`, cursor: tip ? "help" : "default", position: "relative" }}
    >
      {dim.label}
      {show && tip && (
        <div style={{ position: "absolute", top: "50%", left: "calc(100% + 8px)", transform: "translateY(-50%)", background: "#1E1E2E", color: "#fff", borderRadius: 9, padding: "10px 13px", fontSize: 11, zIndex: 60, pointerEvents: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.3)", width: 240, lineHeight: 1.6 }}>
          {tip}
        </div>
      )}
    </td>
  );
}