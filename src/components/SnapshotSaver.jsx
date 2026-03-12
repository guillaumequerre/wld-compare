import { useState } from "react";
import { C } from "../lib/constants";
import { sbSaveSnapshot } from "../lib/supabase";
import { extractSF, extractGSC, extractGA, extractBing, extractSemrush } from "../lib/parsers";

// Try to detect a date from a filename
function detectDateFromFilename(filename) {
  if (!filename) return null;
  const m = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// Try to detect period from GSC/GA rows (they have date columns)
function detectPeriodFromRows(rows, source) {
  if (!rows?.length) return { start: null, end: null };
  const dateKeys = ["date", "jour", "day", "semaine", "week", "mois", "month"];
  const dateKey = Object.keys(rows[0] || {}).find(k =>
    dateKeys.some(d => k.toLowerCase().includes(d))
  );
  if (!dateKey) return { start: null, end: null };
  const dates = rows
    .map(r => r[dateKey])
    .filter(Boolean)
    .map(d => d.trim())
    .filter(d => /\d{4}/.test(d))
    .sort();
  if (!dates.length) return { start: null, end: null };
  return { start: dates[0], end: dates[dates.length - 1] };
}

const SOURCE_LABELS = {
  sf:      { label: "Screaming Frog", icon: "🕷️", color: "#7C3AED" },
  gsc:     { label: "Google Search Console", icon: "🔍", color: "#2563EB" },
  ga:      { label: "Google Analytics 4", icon: "📊", color: "#EA580C" },
  bing:    { label: "Bing AI", icon: "🤖", color: "#0891B2" },
  semrush: { label: "Semrush", icon: "📈", color: "#059669" },
};

function buildMetrics(source, rows) {
  try {
    if (source === "sf")      return extractSF(rows);
    if (source === "gsc")     return extractGSC(rows);
    if (source === "ga")      return extractGA(rows);
    if (source === "bing")    return extractBing(rows);
    if (source === "semrush") return extractSemrush(rows);
  } catch { return null; }
  return null;
}

export default function SnapshotSaver({ source, rows, filename, projectId, siteId, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const detectedEnd   = detectDateFromFilename(filename) || today;
  const detectedPeriod = detectPeriodFromRows(rows, source);

  const [dateEnd,   setDateEnd]   = useState(detectedEnd);
  const [dateStart, setDateStart] = useState(
    source === "sf" ? "" : (detectedPeriod.start || "")
  );
  const [label,  setLabel]  = useState("");
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState(null);

  const isSF      = source === "sf";
  const durationDays = dateStart && dateEnd
    ? Math.max(1, Math.round((new Date(dateEnd) - new Date(dateStart)) / 86400000) + 1)
    : 1;

  const src = SOURCE_LABELS[source] || { label: source, icon: "📁", color: C.blue };

  const save = async () => {
    if (!dateEnd) { setError("Date de fin requise"); return; }
    setSaving(true);
    setError(null);
    try {
      const metrics = buildMetrics(source, rows);
      if (!metrics) throw new Error("Impossible d'extraire les métriques");
      await sbSaveSnapshot({
        project_id:    projectId,
        site_id:       siteId,
        source,
        date_start:    isSF || !dateStart ? null : dateStart,
        date_end:      dateEnd,
        duration_days: isSF ? 1 : durationDays,
        label:         label || `${src.label} — ${dateEnd}`,
        metrics,
      });
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, fontSize: 11, color: "#15803D" }}>
        <span>✓</span>
        <span>Snapshot sauvegardé — {dateEnd}</span>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 13 }}>{src.icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Sauvegarder un snapshot</span>
        <span style={{ fontSize: 11, color: C.textLight }}>· {src.label}</span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        {/* Date start — only for non-SF sources */}
        {!isSF && (
          <div>
            <div style={{ fontSize: 10, color: C.textLight, marginBottom: 3 }}>Début de période</div>
            <input
              type="date" value={dateStart} onChange={e => setDateStart(e.target.value)}
              style={{ padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, color: C.text, background: C.white }}
            />
          </div>
        )}

        {/* Date end */}
        <div>
          <div style={{ fontSize: 10, color: C.textLight, marginBottom: 3 }}>
            {isSF ? "Date du crawl" : "Fin de période"}
          </div>
          <input
            type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)}
            style={{ padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, color: C.text, background: C.white }}
          />
        </div>

        {/* Duration badge */}
        {!isSF && durationDays > 1 && (
          <div style={{ padding: "5px 10px", background: C.white, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, color: C.textMid, alignSelf: "flex-end" }}>
            {durationDays}j
          </div>
        )}

        {/* Label */}
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 10, color: C.textLight, marginBottom: 3 }}>Label (optionnel)</div>
          <input
            type="text" value={label} onChange={e => setLabel(e.target.value)}
            placeholder={`${src.label} — ${dateEnd}`}
            style={{ width: "100%", padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, color: C.text, background: C.white, boxSizing: "border-box" }}
          />
        </div>

        {/* Save button */}
        <button
          onClick={save} disabled={saving || !dateEnd}
          style={{
            padding: "6px 14px", border: "none", borderRadius: 6,
            background: saving ? C.bg : src.color,
            color: saving ? C.textLight : "#fff",
            fontSize: 11, fontWeight: 700, cursor: saving ? "wait" : "pointer",
            alignSelf: "flex-end",
          }}
        >
          {saving ? "…" : "📌 Sauvegarder"}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#DC2626" }}>⚠️ {error}</div>
      )}
    </div>
  );
}