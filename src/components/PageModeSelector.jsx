import { useState } from "react";
import { C, PAGE_MODES, PAGE_TYPES } from "../lib/constants";

export default function PageModeSelector({ value, onChange, pageTypes, sites, templateFilter, setTemplateFilter }) {
  const [showTypes, setShowTypes] = useState(false);

  // Aggregate all typed URLs across sites
  const typeCounts = {};
  (sites || []).forEach(s => {
    Object.values(pageTypes?.[s.id] || {}).forEach(type => {
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
  });
  const hasTypes = Object.keys(typeCounts).length > 0;
  const activeTypes = templateFilter || [];
  const hasActiveFilter = activeTypes.length > 0;
  const hasSfData = (sites || []).some(s => Object.keys(pageTypes?.[s.id] || {}).length > 0 || false);

  const toggleType = (key) => {
    if (!setTemplateFilter) return;
    setTemplateFilter(prev => {
      const cur = prev || [];
      return cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
    });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>

      {/* Template filter — always shown when setTemplateFilter is provided */}
      {setTemplateFilter && (
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowTypes(v => !v)}
            style={{
              padding: "7px 12px",
              border: `1.5px solid ${hasActiveFilter ? C.blue : C.border}`,
              borderRadius: 8, cursor: "pointer", fontSize: 12,
              fontWeight: hasActiveFilter ? 700 : 500,
              background: hasActiveFilter ? C.blueLight : C.white,
              color: hasActiveFilter ? C.blue : C.textMid,
              display: "flex", alignItems: "center", gap: 5,
              opacity: hasTypes ? 1 : 0.5,
            }}
          >
            🏷️ Templates
            {hasActiveFilter && (
              <span style={{ background: C.blue, color: "#fff", borderRadius: 10, fontSize: 10, padding: "1px 6px" }}>
                {activeTypes.length}
              </span>
            )}
            <span style={{ fontSize: 9, opacity: 0.6 }}>{showTypes ? "▲" : "▼"}</span>
          </button>

          {showTypes && (
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 200,
              background: C.white, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 200,
            }}>
              {!hasTypes ? (
                <div style={{ padding: "8px 6px", fontSize: 11, color: C.textLight, fontStyle: "italic" }}>
                  Aucun template classifié —<br />importez un CSV SF et lancez la classification dans l'onglet Import.
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${C.borderLight}` }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: C.textLight }}>Filtrer par template</span>
                    {hasActiveFilter && (
                      <button onClick={() => setTemplateFilter([])} style={{ fontSize: 10, color: C.blue, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        Tout décocher
                      </button>
                    )}
                  </div>
                  {PAGE_TYPES.filter(t => typeCounts[t.key] > 0).map(t => {
                    const active = activeTypes.includes(t.key);
                    return (
                      <div
                        key={t.key}
                        onClick={() => toggleType(t.key)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "5px 8px", borderRadius: 7, cursor: "pointer",
                          background: active ? t.bg : "transparent",
                          marginBottom: 2,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{
                            width: 14, height: 14, borderRadius: 3,
                            border: `2px solid ${active ? t.color : C.border}`,
                            background: active ? t.color : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                          }}>
                            {active && <span style={{ color: "#fff", fontSize: 9, lineHeight: 1 }}>✓</span>}
                          </div>
                          <span style={{ fontSize: 11 }}>{t.icon}</span>
                          <span style={{ fontSize: 11, fontWeight: active ? 600 : 400, color: active ? t.color : C.textMid }}>{t.label}</span>
                        </div>
                        <span style={{ fontSize: 10, color: C.textLight }}>{typeCounts[t.key]}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Page mode toggle */}
      <div style={{ display: "flex", gap: 6, background: C.bg, borderRadius: 10, padding: 4, border: `1px solid ${C.border}` }}>
        {PAGE_MODES.map(m => (
          <button key={m.key} onClick={() => onChange(m.key)} style={{
            padding: "7px 16px", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 500,
            background: value === m.key ? C.blue : "transparent",
            color: value === m.key ? "#fff" : C.textMid,
            transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6,
          }}>
            <span>{m.icon}</span><span>{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}