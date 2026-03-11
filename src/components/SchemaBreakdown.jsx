import { C } from "../lib/constants.js";

export default function SchemaBreakdown({ schemaTypes, color }) {
  const entries = Object.entries(schemaTypes || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <div style={{ fontSize: 12, color: C.textLight }}>Aucun schema détecté</div>;
  const max = entries[0][1];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map(([type, count]) => (
        <div key={type} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 11, color: C.textMid, minWidth: 140 }}>{type}</div>
          <div style={{ flex: 1, height: 6, background: C.borderLight, borderRadius: 3 }}>
            <div style={{ height: "100%", width: `${(count / max) * 100}%`, background: color, borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color, minWidth: 30, textAlign: "right" }}>{count}</div>
        </div>
      ))}
    </div>
  );
}