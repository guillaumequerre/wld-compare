import { useState, useEffect } from "react";
import { sbGetCalendarEntries, sbAddCalendarEntry } from "../lib/supabase";

// PROVIDERS is passed as prop to avoid circular import
const DAYS = 30;

function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// ── CalendarGrid — pure rendering ────────────────────────────────

function CalendarGrid({ entries, providers }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Group entries by provider → date → presence
  const byProvider = {};
  entries.forEach(e => {
    const pid = e.provider_id;
    const key = String(e.test_date).slice(0, 10);
    if (!byProvider[pid]) byProvider[pid] = {};
    // If multiple on same day: present wins
    const cur = byProvider[pid][key];
    const val = e.brand_present === true || e.brand_present === 1;
    byProvider[pid][key] = cur === undefined ? val : cur || val;
  });

  const activeProviders = providers.filter(p => byProvider[p.id]);
  if (!activeProviders.length) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
      {activeProviders.map(p => {
        const dayMap = byProvider[p.id];
        const slots = [];
        for (let i = DAYS - 1; i >= 0; i--) {
          const d = new Date(today); d.setDate(d.getDate() - i);
          const key = localDateKey(d);
          const val = dayMap[key];
          const color = val === undefined ? "#E5E7EB" : val ? "#059669" : "#DC2626";
          slots.push({ key, color, title: `${key} — ${val === undefined ? "non testé" : val ? "✓ Présent" : "✗ Absent"}` });
        }
        const lastKey = Object.keys(dayMap).sort().pop();
        const lastVal = lastKey !== undefined ? dayMap[lastKey] : undefined;

        return (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: p.color, minWidth: 68, flexShrink: 0 }}>
              {p.icon} {p.label}
            </span>
            <div style={{ display: "flex", gap: 2, flex: 1, overflow: "hidden" }}>
              {slots.map(s => (
                <div key={s.key} title={s.title}
                  style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
              ))}
            </div>
            {lastVal !== undefined && (
              <span style={{ fontSize: 9, fontWeight: 700, color: lastVal ? "#059669" : "#DC2626", flexShrink: 0 }}>
                {lastVal ? "✓" : "✗"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── PresenceCalendar — data + rendering ──────────────────────────

export default function PresenceCalendar({ questionId, providers = [], newEntry = null }) {
  const [entries, setEntries] = useState([]);

  // Load from DB on mount / question change
  useEffect(() => {
    if (!questionId) return;
    sbGetCalendarEntries(questionId).then(rows => setEntries(rows || [])).catch(() => {});
  }, [questionId]);

  // Add entry when a new result arrives (from parent)
  useEffect(() => {
    if (!newEntry) return;
    const { provider_id, brand_present } = newEntry;
    if (!provider_id) return;

    const today = localDateKey(new Date());
    const optimistic = { provider_id, test_date: today, brand_present: !!brand_present };

    // Optimistic — add immediately
    setEntries(prev => [...prev, optimistic]);

    // Persist
    sbAddCalendarEntry(questionId, provider_id, brand_present)
      .then(saved => {
        if (saved?.id) {
          setEntries(prev => prev.map(e =>
            e === optimistic
              ? { provider_id: saved.provider_id, test_date: String(saved.test_date).slice(0, 10), brand_present: saved.brand_present }
              : e
          ));
        }
      })
      .catch(() => {});
  }, [newEntry]); // eslint-disable-line react-hooks/exhaustive-deps

  return <CalendarGrid entries={entries} providers={providers} />;
}