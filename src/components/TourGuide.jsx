// src/components/TourGuide.jsx
import { useState, useEffect, useCallback, useRef } from "react";

const GREEN = "#1A3C2E";
const PAD   = 12;

export default function TourGuide({ steps, onClose, initialStep = 0 }) {
  const [step, setStep]   = useState(initialStep);
  const [rect, setRect]   = useState(null);
  const [pos,  setPos]    = useState({ top: 80, left: 80 });
  const boxRef            = useRef(null);
  const rafRef            = useRef(null);
  const mountedRef        = useRef(true);

  const current = steps[step];
  const total   = steps.length;
  const isLast  = step === total - 1;

  // Calcule le DOMRect de l'élément cible
  const calcRect = useCallback(() => {
    if (!mountedRef.current) return;
    const target = current?.target
      ? document.querySelector(`[data-tour="${current.target}"]`)
      : null;
    if (!target) { setRect(null); return; }
    const r = target.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [current]);

  // Boucle RAF pour suivre en temps réel (scroll, resize, animations)
  useEffect(() => {
    mountedRef.current = true;
    const loop = () => {
      calcRect();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      mountedRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [calcRect]);

  // Au changement d'étape : scroll instantané vers la cible
  useEffect(() => {
    const target = current?.target
      ? document.querySelector(`[data-tour="${current.target}"]`)
      : null;
    if (target) {
      target.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
    }
  }, [step, current]);

  // Positionner le tooltip
  useEffect(() => {
    if (!boxRef.current) return;
    const boxH = boxRef.current.offsetHeight || 220;
    const boxW = boxRef.current.offsetWidth  || 320;
    const vw   = window.innerWidth;
    const vh   = window.innerHeight;
    const pref = current?.position || "auto";

    if (pref === "center" || !rect || !rect.width) {
      setPos({ top: Math.max(vh / 2 - boxH / 2, 12), left: Math.max(vw / 2 - boxW / 2, 12) });
      return;
    }

    const sTop    = rect.top  - PAD;
    const sLeft   = rect.left - PAD;
    const sBottom = rect.top  + rect.height + PAD;
    const sRight  = rect.left + rect.width  + PAD;
    const clamp   = (l) => Math.min(Math.max(l, 12), vw - boxW - 12);

    let top, left;
    if (pref === "bottom" || (pref === "auto" && sBottom + boxH + 12 < vh)) {
      top = sBottom + 12; left = clamp(sLeft);
    } else if (pref === "top" || sTop - boxH - 12 > 0) {
      top = sTop - boxH - 12; left = clamp(sLeft);
    } else if (pref === "right" || sRight + boxW + 12 < vw) {
      top = Math.min(Math.max(rect.top - boxH / 2 + rect.height / 2, 12), vh - boxH - 12);
      left = sRight + 12;
    } else {
      top = Math.min(Math.max(rect.top - boxH / 2 + rect.height / 2, 12), vh - boxH - 12);
      left = sLeft - boxW - 12;
    }
    setPos({ top: Math.max(top, 8), left: Math.max(left, 8) });
  }, [rect, current]);

  if (!current) return null;

  const s = rect ? {
    top:    rect.top    - PAD,
    left:   rect.left   - PAD,
    width:  rect.width  + PAD * 2,
    height: rect.height + PAD * 2,
  } : null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, pointerEvents: "none" }}>

      {s ? <>
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: Math.max(s.top, 0), background: "rgba(0,0,0,0.52)", pointerEvents: "auto" }} onClick={onClose} />
        <div style={{ position: "fixed", top: s.top + s.height, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.52)", pointerEvents: "auto" }} onClick={onClose} />
        <div style={{ position: "fixed", top: s.top, left: 0, width: Math.max(s.left, 0), height: s.height, background: "rgba(0,0,0,0.52)", pointerEvents: "auto" }} onClick={onClose} />
        <div style={{ position: "fixed", top: s.top, left: s.left + s.width, right: 0, height: s.height, background: "rgba(0,0,0,0.52)", pointerEvents: "auto" }} onClick={onClose} />
        <div style={{ position: "fixed", top: s.top - 2, left: s.left - 2, width: s.width + 4, height: s.height + 4, borderRadius: 10, border: `2px solid ${GREEN}99`, boxShadow: `0 0 0 3px ${GREEN}33`, pointerEvents: "none" }} />
      </> : (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", pointerEvents: "auto" }} onClick={onClose} />
      )}

      {/* Tooltip */}
      <div ref={boxRef} style={{ position: "fixed", top: pos.top, left: pos.left, width: 320, background: "#fff", borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.22)", overflow: "hidden", pointerEvents: "auto", zIndex: 9001 }}>
        <div style={{ background: GREEN, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 22, height: 22, background: "#F0EBE0", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: GREEN, fontSize: 11, fontWeight: 900, fontStyle: "italic" }}>S</span>
            </div>
            <div>
              <div style={{ color: "#F0EBE0", fontSize: 9, fontWeight: 600, letterSpacing: 1.2, textTransform: "uppercase", opacity: 0.7 }}>Guide de démarrage</div>
              <div style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>Étape {step + 1} / {total}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#fff", fontSize: 16, opacity: 0.7, padding: 0 }}>✕</button>
        </div>
        <div style={{ height: 3, background: "#E2E8F0" }}>
          <div style={{ height: "100%", width: `${((step + 1) / total) * 100}%`, background: GREEN, transition: "width 0.3s" }} />
        </div>
        <div style={{ padding: "16px 18px" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: current.tip ? 10 : 0 }}>
            {current.icon && (
              <div style={{ width: 38, height: 38, borderRadius: 10, background: GREEN + "15", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                {current.icon}
              </div>
            )}
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", marginBottom: 4, lineHeight: 1.3 }}>{current.title}</div>
              <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.6 }}>{current.desc}</div>
            </div>
          </div>
          {current.tip && (
            <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 7, padding: "7px 11px", fontSize: 11, color: "#92400E", display: "flex", gap: 6 }}>
              <span style={{ flexShrink: 0 }}>💡</span><span>{current.tip}</span>
            </div>
          )}
        </div>
        <div style={{ padding: "10px 18px 14px", borderTop: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {steps.map((_, i) => (
              <button key={i} onClick={() => setStep(i)}
                style={{ width: i === step ? 18 : 6, height: 6, borderRadius: 3, border: "none", background: i === step ? GREEN : i < step ? GREEN + "55" : "#E2E8F0", cursor: "pointer", padding: 0, transition: "all 0.2s" }} />
            ))}
          </div>
          <div style={{ flex: 1 }} />
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)}
              style={{ padding: "7px 13px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "1px solid #E2E8F0", background: "transparent", color: "#64748B", cursor: "pointer" }}>
              ← Préc.
            </button>
          )}
          <button onClick={() => { if (isLast) onClose(); else setStep(s => s + 1); }}
            style={{ padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700, border: "none", background: isLast ? "#059669" : GREEN, color: "#fff", cursor: "pointer" }}>
            {isLast ? "✓ Terminer" : "Suivant →"}
          </button>
        </div>
      </div>
    </div>
  );
}