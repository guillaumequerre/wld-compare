import { C } from "../lib/constants.js";

export default function LlmsStatus({ sf }) {
  if (!sf) return null;
  const files = [
    { key: "llms",     label: "llms.txt",     data: sf.llms },
    { key: "llmsFull", label: "llms-full.txt", data: sf.llmsFull },
  ];
  return (
    <div style={{ marginTop: 12, padding: "12px 14px", background: C.bg, borderRadius: 10, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8, fontWeight: 600 }}>
        🤖 Fichiers LLMs
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {files.map(({ key, label, data }) => {
          const ok  = data?.present && data?.status >= 200 && data?.status < 300;
          const rdr = data?.present && data?.status >= 300 && data?.status < 400;
          const err = data?.present && (data?.status >= 400 || data?.status === 0);
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 12, color: C.textMid, fontFamily: "monospace" }}>{label}</span>
              {ok  && <span style={{ fontSize: 11, fontWeight: 700, color: C.green,     background: C.greenLight,  padding: "2px 10px", borderRadius: 20 }}>✓ {data.status} OK</span>}
              {rdr && <span style={{ fontSize: 11, fontWeight: 700, color: C.amber,     background: C.amberLight,  padding: "2px 10px", borderRadius: 20 }}>↪ {data.status} Redirect</span>}
              {err && <span style={{ fontSize: 11, fontWeight: 700, color: C.red,       background: C.redLight,    padding: "2px 10px", borderRadius: 20 }}>✗ {data.status} Erreur</span>}
              {!data?.present && <span style={{ fontSize: 11, fontWeight: 600, color: C.textLight, background: C.borderLight, padding: "2px 10px", borderRadius: 20 }}>Absent</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}