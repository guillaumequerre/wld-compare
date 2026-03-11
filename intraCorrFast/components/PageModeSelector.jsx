import { C, PAGE_MODES } from "../lib/constants.js";

export default function PageModeSelector({ value, onChange }) {
  return (
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
  );
}