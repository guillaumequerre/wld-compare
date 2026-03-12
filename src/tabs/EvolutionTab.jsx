import { useState, useEffect, useCallback } from "react";
import { C } from "../lib/constants";
import { sbGetSnapshots, sbGetMilestones, sbSaveMilestone, sbDeleteMilestone, sbDeleteSnapshot } from "../lib/supabase";
import { SectionHeader } from "../components/ui";
import InfoCard from "../components/InfoCard";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid, Legend,
} from "recharts";

// ── Constants ────────────────────────────────────────────────────

const SOURCES = {
  sf:      { label: "Screaming Frog", icon: "🕷️", color: "#7C3AED" },
  gsc:     { label: "GSC",            icon: "🔍", color: "#2563EB" },
  ga:      { label: "GA4",            icon: "📊", color: "#EA580C" },
  bing:    { label: "Bing AI",        icon: "🤖", color: "#0891B2" },
  semrush: { label: "Semrush",        icon: "📈", color: "#059669" },
};

const MILESTONE_CATEGORIES = [
  { key: "contenu",     label: "Contenu",     color: "#7C3AED" },
  { key: "technique",   label: "Technique",   color: "#2563EB" },
  { key: "netlinking",  label: "Netlinking",  color: "#059669" },
  { key: "refonte",     label: "Refonte",     color: "#EA580C" },
  { key: "algo",        label: "Algo Google", color: "#DC2626" },
  { key: "autre",       label: "Autre",       color: "#64748B" },
];

// Metrics available per source with label and whether higher=better
const METRICS_BY_SOURCE = {
  sf: [
    { key: "avgWords",       label: "Mots moy.",      higher: true  },
    { key: "avgTitleLen",    label: "Title moy.",      higher: null  },
    { key: "avgMetaLen",     label: "Meta moy.",       higher: null  },
    { key: "avgH1Len",       label: "H1 moy.",         higher: null  },
    { key: "schemaRate",     label: "Schemas %",       higher: true  },
    { key: "tableRate",      label: "Tableaux %",      higher: true  },
    { key: "avgFlesch",      label: "Flesch",          higher: true  },
    { key: "avgDepth",       label: "Profondeur",      higher: false },
    { key: "avgPageSizeKB",  label: "Poids page KB",   higher: false },
    { key: "errorRate",      label: "Erreurs %",       higher: false },
    { key: "indexableRate",  label: "Indexables %",    higher: true  },
    { key: "totalPages",     label: "Pages totales",   higher: true  },
  ],
  gsc: [
    { key: "clicks",      label: "Clics",         higher: true  },
    { key: "impressions", label: "Impressions",   higher: true  },
    { key: "ctr",         label: "CTR %",         higher: true  },
    { key: "position",    label: "Position moy.", higher: false },
  ],
  ga: [
    { key: "sessions", label: "Sessions", higher: true },
    { key: "views",    label: "Vues",     higher: true },
  ],
  bing: [
    { key: "geoMentions", label: "Citations AI", higher: true },
    { key: "pageCount",   label: "Pages citées", higher: true },
  ],
  semrush: [
    { key: "totalKw",      label: "Mots-clés",   higher: true  },
    { key: "totalTraffic", label: "Trafic est.", higher: true  },
    { key: "totalTop10",   label: "Top 10",      higher: true  },
    { key: "totalOpps",    label: "Opportunités",higher: true  },
    { key: "avgPos",       label: "Pos. moy.",   higher: false },
  ],
};

// ── Helpers ──────────────────────────────────────────────────────

function normalize(value, durationDays) {
  if (value == null) return null;
  return durationDays > 1 ? Math.round((value / durationDays) * 100) / 100 : value;
}

function fmtDate(d) {
  if (!d) return "";
  return new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" });
}

function fmtVal(v, key) {
  if (v == null) return "—";
  if (["ctr", "schemaRate", "tableRate", "errorRate", "indexableRate"].includes(key)) return v + "%";
  if (key === "position" || key === "avgPos") return v.toFixed(1);
  return v.toLocaleString("fr");
}

// Detect overlapping snapshots (same source, > 50% overlap)
function detectOverlaps(snapshots) {
  const overlaps = [];
  for (let i = 0; i < snapshots.length; i++) {
    for (let j = i + 1; j < snapshots.length; j++) {
      const a = snapshots[i], b = snapshots[j];
      if (a.source !== b.source) continue;
      if (!a.date_start || !b.date_start) continue;
      const aStart = new Date(a.date_start), aEnd = new Date(a.date_end);
      const bStart = new Date(b.date_start), bEnd = new Date(b.date_end);
      const overlapStart = new Date(Math.max(aStart, bStart));
      const overlapEnd   = new Date(Math.min(aEnd, bEnd));
      if (overlapEnd > overlapStart) {
        const overlapDays = (overlapEnd - overlapStart) / 86400000;
        const minDur = Math.min(a.duration_days, b.duration_days);
        if (overlapDays / minDur > 0.5) overlaps.push([a.id, b.id]);
      }
    }
  }
  return overlaps;
}

// Build chart data: one entry per unique date_end, all sources merged
function buildChartData(snapshots, selectedMetrics, normalize_) {
  const byDate = {};
  snapshots.forEach(snap => {
    const date = snap.date_end;
    if (!byDate[date]) byDate[date] = { date };
    selectedMetrics.forEach(({ source, key }) => {
      if (snap.source !== source) return;
      const raw = snap.metrics?.[key];
      const val = normalize_ ? normalize(raw, snap.duration_days) : raw;
      if (val != null) byDate[date][`${source}_${key}`] = val;
    });
  });
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Custom Tooltip ───────────────────────────────────────────────

function ChartTooltip({ active, payload, label, snapshots, selectedMetrics }) {
  if (!active || !payload?.length) return null;
  const snap = snapshots.find(s => s.date_end === label);
  return (
    <div style={{ background: "#1E1E2E", borderRadius: 10, padding: "12px 14px", fontSize: 11, color: "#CBD5E1", boxShadow: "0 6px 20px rgba(0,0,0,0.3)", minWidth: 180 }}>
      <div style={{ fontWeight: 700, color: "#E2E8F0", marginBottom: 6 }}>{fmtDate(label)}</div>
      {snap?.date_start && (
        <div style={{ fontSize: 10, color: "#64748B", marginBottom: 8 }}>
          Période : {fmtDate(snap.date_start)} → {fmtDate(snap.date_end)} · {snap.duration_days}j
        </div>
      )}
      {payload.map(p => {
        const [src, ...keyParts] = p.dataKey.split("_");
        const key = keyParts.join("_");
        const meta = METRICS_BY_SOURCE[src]?.find(m => m.key === key);
        const raw = snap?.metrics?.[key];
        return (
          <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 3 }}>
            <span style={{ color: p.color }}>{meta?.label || key}</span>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontWeight: 700, color: "#E2E8F0" }}>{fmtVal(p.value, key)}</span>
              {snap?.duration_days > 1 && raw != null && (
                <div style={{ fontSize: 9, color: "#64748B" }}>brut: {fmtVal(raw, key)}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Period line (custom SVG rendered via customized dot) ─────────

function PeriodDot({ cx, cy, payload, snapshots, stroke }) {
  const snap = snapshots?.find(s => s.date_end === payload?.date);
  if (!snap || !snap.date_start || snap.duration_days <= 1) {
    return <circle cx={cx} cy={cy} r={4} fill={stroke} stroke="#fff" strokeWidth={1.5} />;
  }
  // We'll render a simple dot — the period line is handled via a separate custom layer
  return <circle cx={cx} cy={cy} r={5} fill={stroke} stroke="#fff" strokeWidth={2} />;
}

// ── Main Component ───────────────────────────────────────────────

export default function EvolutionTab({ projects, sites, currentProjectId }) {
  const [snapshots,  setSnapshots]  = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [loading,    setLoading]    = useState(false);

  // Selected metrics (array of { source, key })
  const [selectedMetrics, setSelectedMetrics] = useState([
    { source: "gsc",  key: "clicks"    },
    { source: "gsc",  key: "position"  },
    { source: "sf",   key: "avgWords"  },
  ]);

  const [normalizeByDay, setNormalizeByDay] = useState(true);
  const [showMilestones, setShowMilestones] = useState(true);
  const [activeSite, setActiveSite]         = useState(sites?.[0]?.id || null);

  // Milestone form
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [mDate,     setMDate]     = useState(new Date().toISOString().slice(0, 10));
  const [mLabel,    setMLabel]    = useState("");
  const [mCategory, setMCategory] = useState("contenu");
  const [mSaving,   setMSaving]   = useState(false);

  const load = useCallback(async () => {
    if (!currentProjectId || !activeSite) return;
    setLoading(true);
    try {
      const [snaps, miles] = await Promise.all([
        sbGetSnapshots(currentProjectId, activeSite),
        sbGetMilestones(currentProjectId),
      ]);
      setSnapshots(snaps);
      setMilestones(miles);
    } catch (e) { console.warn("Load evolution failed", e); }
    finally { setLoading(false); }
  }, [currentProjectId, activeSite]);

  useEffect(() => { load(); }, [load]);

  const toggleMetric = (source, key) => {
    setSelectedMetrics(prev => {
      const exists = prev.find(m => m.source === source && m.key === key);
      return exists ? prev.filter(m => !(m.source === source && m.key === key)) : [...prev, { source, key }];
    });
  };

  const addMilestone = async () => {
    if (!mLabel.trim() || !mDate) return;
    setMSaving(true);
    try {
      const cat = MILESTONE_CATEGORIES.find(c => c.key === mCategory);
      await sbSaveMilestone({
        project_id:     currentProjectId,
        site_id:        activeSite,
        milestone_date: mDate,
        label:          mLabel.trim(),
        category:       mCategory,
        color:          cat?.color || "#6366F1",
      });
      setMLabel("");
      setShowMilestoneForm(false);
      await load();
    } finally { setMSaving(false); }
  };

  const deleteMilestone = async (id) => {
    await sbDeleteMilestone(id);
    setMilestones(prev => prev.filter(m => m.id !== id));
  };

  const deleteSnapshot = async (id) => {
    await sbDeleteSnapshot(id);
    setSnapshots(prev => prev.filter(s => s.id !== id));
  };

  // ── Derived data ──────────────────────────────────────────────
  const siteSnapshots = snapshots; // already filtered by site via sbGetSnapshots
  const overlaps      = detectOverlaps(siteSnapshots);
  const chartData     = buildChartData(siteSnapshots, selectedMetrics, normalizeByDay);

  // Active sources present in snapshots
  const presentSources = [...new Set(siteSnapshots.map(s => s.source))];

  // Delta: last vs previous snapshot per source
  const deltas = {};
  presentSources.forEach(src => {
    const srcSnaps = siteSnapshots.filter(s => s.source === src).sort((a, b) => a.date_end.localeCompare(b.date_end));
    if (srcSnaps.length >= 2) {
      const last = srcSnaps[srcSnaps.length - 1];
      const prev = srcSnaps[srcSnaps.length - 2];
      const metrics = METRICS_BY_SOURCE[src] || [];
      deltas[src] = metrics.map(m => {
        const vLast = normalize(last.metrics?.[m.key], last.duration_days);
        const vPrev = normalize(prev.metrics?.[m.key], prev.duration_days);
        if (vLast == null || vPrev == null || vPrev === 0) return null;
        const diff   = vLast - vPrev;
        const diffPct = Math.round(diff / vPrev * 100);
        const isGood = m.higher === true ? diff > 0 : m.higher === false ? diff < 0 : null;
        return { ...m, vLast, vPrev, diff, diffPct, isGood, src };
      }).filter(Boolean);
    }
  });

  // Alerts: significant changes
  const alerts = Object.values(deltas).flat().filter(d => {
    if (d.isGood === null) return false;
    return (!d.isGood && Math.abs(d.diffPct) >= 15) || (!d.isGood && Math.abs(d.diffPct) >= 10);
  });

  const hasSiteData = sites?.length > 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <SectionHeader title="Évolution" sub="Suivi temporel des métriques et jalons" />
        <InfoCard tabKey="evolution" />
      </div>

      {/* Site selector */}
      {sites?.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {sites.map(s => (
            <button key={s.id} onClick={() => setActiveSite(s.id)} style={{
              padding: "6px 14px", borderRadius: 8, border: `1px solid ${activeSite === s.id ? s.color : C.border}`,
              background: activeSite === s.id ? s.bg : C.white, color: activeSite === s.id ? s.color : C.textMid,
              fontWeight: activeSite === s.id ? 700 : 400, fontSize: 12, cursor: "pointer",
            }}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: "#DC2626", marginBottom: 6 }}>⚠️ Variations significatives détectées</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {alerts.map((a, i) => (
              <div key={i} style={{ fontSize: 11, background: "#fff", border: "1px solid #FECACA", borderRadius: 6, padding: "3px 10px", color: "#B91C1C" }}>
                {SOURCES[a.src]?.icon} {a.label} {a.diffPct > 0 ? "▲" : "▼"}{a.diffPct > 0 ? "+" : ""}{a.diffPct}%
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overlap warning */}
      {overlaps.length > 0 && (
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "8px 14px", marginBottom: 16, fontSize: 11, color: "#92400E" }}>
          ⚠️ {overlaps.length} paire{overlaps.length > 1 ? "s" : ""} de snapshots avec périodes chevauchantes — les points peuvent ne pas être directement comparables.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 20 }}>

        {/* ── Left panel: metric selector ── */}
        <div>
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: C.text, marginBottom: 10 }}>Métriques</div>
            {Object.entries(METRICS_BY_SOURCE).map(([src, metrics]) => {
              if (!presentSources.includes(src) && siteSnapshots.length > 0) return null;
              const srcMeta = SOURCES[src];
              return (
                <div key={src} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: srcMeta?.color || C.blue, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>
                    {srcMeta?.icon} {srcMeta?.label}
                  </div>
                  {metrics.map(m => {
                    const active = selectedMetrics.some(s => s.source === src && s.key === m.key);
                    return (
                      <div key={m.key} onClick={() => toggleMetric(src, m.key)} style={{
                        display: "flex", alignItems: "center", gap: 6, padding: "3px 6px",
                        borderRadius: 6, cursor: "pointer",
                        background: active ? (srcMeta?.color || C.blue) + "15" : "transparent",
                        marginBottom: 1,
                      }}>
                        <div style={{
                          width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                          background: active ? (srcMeta?.color || C.blue) : C.border,
                        }} />
                        <span style={{ fontSize: 11, color: active ? C.text : C.textLight }}>{m.label}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Options */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: C.text, marginBottom: 8 }}>Options</div>
            {[
              [normalizeByDay, setNormalizeByDay, "Normaliser par jour"],
              [showMilestones, setShowMilestones, "Afficher les jalons"],
            ].map(([val, set, lbl]) => (
              <div key={lbl} onClick={() => set(v => !v)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 6 }}>
                <div style={{
                  width: 32, height: 18, borderRadius: 9, position: "relative", flexShrink: 0,
                  background: val ? C.blue : C.border, transition: "background 0.2s",
                }}>
                  <div style={{
                    position: "absolute", top: 2, left: val ? 16 : 2,
                    width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left 0.2s",
                  }} />
                </div>
                <span style={{ fontSize: 11, color: C.textMid }}>{lbl}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right panel: chart + delta + milestones ── */}
        <div>

          {/* Chart */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
            {loading ? (
              <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: C.textLight, fontSize: 12 }}>Chargement…</div>
            ) : chartData.length === 0 ? (
              <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: C.textLight }}>
                <div style={{ fontSize: 32 }}>📈</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Aucun snapshot sauvegardé</div>
                <div style={{ fontSize: 11 }}>Importez des données puis cliquez "📌 Sauvegarder" dans l'onglet Import</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: C.textLight, marginBottom: 12 }}>
                  {normalizeByDay ? "Valeurs normalisées par jour" : "Valeurs brutes"} · {siteSnapshots.length} snapshot{siteSnapshots.length > 1 ? "s" : ""}
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.borderLight} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={fmtDate}
                      tick={{ fontSize: 10, fill: C.textLight }}
                      tickLine={false}
                    />
                    <YAxis tick={{ fontSize: 10, fill: C.textLight }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip content={<ChartTooltip snapshots={siteSnapshots} selectedMetrics={selectedMetrics} />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />

                    {/* Milestone reference lines */}
                    {showMilestones && milestones.map(m => (
                      <ReferenceLine
                        key={m.id}
                        x={m.milestone_date}
                        stroke={m.color || "#6366F1"}
                        strokeDasharray="4 3"
                        strokeOpacity={0.5}
                        strokeWidth={1.5}
                        label={{ value: m.label, position: "top", fontSize: 9, fill: m.color || "#6366F1", opacity: 0.8 }}
                      />
                    ))}

                    {/* Lines */}
                    {selectedMetrics.map(({ source, key }) => {
                      const srcMeta = SOURCES[source];
                      const metaMeta = METRICS_BY_SOURCE[source]?.find(m => m.key === key);
                      return (
                        <Line
                          key={`${source}_${key}`}
                          type="monotone"
                          dataKey={`${source}_${key}`}
                          name={`${srcMeta?.icon || ""} ${metaMeta?.label || key}`}
                          stroke={srcMeta?.color || C.blue}
                          strokeWidth={2}
                          dot={(props) => <PeriodDot {...props} snapshots={siteSnapshots} stroke={srcMeta?.color || C.blue} />}
                          activeDot={{ r: 6 }}
                          connectNulls={false}
                        />
                      );
                    })}

                    {/* Period lines — rendered as separate thin lines */}
                    {selectedMetrics.map(({ source, key }) => {
                      const srcMeta = SOURCES[source];
                      return siteSnapshots
                        .filter(s => s.source === source && s.date_start)
                        .map(snap => {
                          const val = snap.metrics?.[key];
                          if (val == null) return null;
                          return (
                            <ReferenceLine
                              key={`period-${snap.id}-${key}`}
                              x={snap.date_start}
                              stroke={srcMeta?.color || C.blue}
                              strokeOpacity={0.2}
                              strokeWidth={1}
                              strokeDasharray="2 4"
                            />
                          );
                        });
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}
          </div>

          {/* Delta table */}
          {Object.keys(deltas).length > 0 && (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 12 }}>Évolution — dernier vs précédent</div>
              <div style={{ display: "grid", gap: 12 }}>
                {Object.entries(deltas).map(([src, metrics]) => (
                  <div key={src}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: SOURCES[src]?.color, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
                      {SOURCES[src]?.icon} {SOURCES[src]?.label}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6 }}>
                      {metrics.map(d => (
                        <div key={d.key} style={{ background: C.bg, borderRadius: 8, padding: "8px 10px" }}>
                          <div style={{ fontSize: 10, color: C.textLight, marginBottom: 3 }}>{d.label}</div>
                          <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{fmtVal(d.vLast, d.key)}</div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: d.isGood === true ? "#16A34A" : d.isGood === false ? "#DC2626" : C.textLight }}>
                            {d.diffPct > 0 ? "▲ +" : d.diffPct < 0 ? "▼ " : "= "}{d.diffPct}%
                            <span style={{ color: C.textLight, fontWeight: 400, marginLeft: 4 }}>vs {fmtVal(d.vPrev, d.key)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Milestones */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Jalons</div>
              <button onClick={() => setShowMilestoneForm(v => !v)} style={{
                padding: "5px 12px", border: `1px solid ${C.blue}`, borderRadius: 7,
                background: showMilestoneForm ? C.blue : C.white,
                color: showMilestoneForm ? "#fff" : C.blue,
                fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}>
                {showMilestoneForm ? "Annuler" : "+ Ajouter"}
              </button>
            </div>

            {/* Add form */}
            {showMilestoneForm && (
              <div style={{ background: C.bg, borderRadius: 10, padding: "12px 14px", marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontSize: 10, color: C.textLight, marginBottom: 3 }}>Date</div>
                  <input type="date" value={mDate} onChange={e => setMDate(e.target.value)}
                    style={{ padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, background: C.white, color: C.text }} />
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 10, color: C.textLight, marginBottom: 3 }}>Label</div>
                  <input type="text" value={mLabel} onChange={e => setMLabel(e.target.value)}
                    placeholder="Ex: Refonte des fiches produits"
                    style={{ width: "100%", padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, background: C.white, color: C.text, boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textLight, marginBottom: 3 }}>Catégorie</div>
                  <select value={mCategory} onChange={e => setMCategory(e.target.value)}
                    style={{ padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, background: C.white, color: C.text }}>
                    {MILESTONE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <button onClick={addMilestone} disabled={mSaving || !mLabel.trim()}
                  style={{ padding: "6px 14px", border: "none", borderRadius: 6, background: C.blue, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  {mSaving ? "…" : "Ajouter"}
                </button>
              </div>
            )}

            {/* Milestone list */}
            {milestones.length === 0 ? (
              <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucun jalon — ajoutez des événements clés pour contextualiser les courbes.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {milestones.sort((a, b) => b.milestone_date.localeCompare(a.milestone_date)).map(m => {
                  const cat = MILESTONE_CATEGORIES.find(c => c.key === m.category);
                  return (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, background: C.bg }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: m.color || "#6366F1", flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: C.text, flex: 1 }}>{m.label}</span>
                      <span style={{ fontSize: 10, color: C.textLight }}>{fmtDate(m.milestone_date)}</span>
                      <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 10, background: (m.color || "#6366F1") + "22", color: m.color || "#6366F1", fontWeight: 600 }}>{cat?.label || m.category}</span>
                      <button onClick={() => deleteMilestone(m.id)} style={{ border: "none", background: "none", cursor: "pointer", color: C.textLight, fontSize: 12, padding: 2 }}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Snapshot list */}
          {siteSnapshots.length > 0 && (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 12 }}>Snapshots sauvegardés</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[...siteSnapshots].sort((a, b) => b.date_end.localeCompare(a.date_end)).map(s => {
                  const src = SOURCES[s.source];
                  return (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 7, background: C.bg }}>
                      <span style={{ fontSize: 11 }}>{src?.icon}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: src?.color }}>{src?.label}</span>
                      <span style={{ fontSize: 11, color: C.textLight }}>
                        {s.date_start ? `${fmtDate(s.date_start)} → ` : ""}{fmtDate(s.date_end)}
                        {s.duration_days > 1 ? ` · ${s.duration_days}j` : ""}
                      </span>
                      {s.label && <span style={{ fontSize: 10, color: C.textLight, fontStyle: "italic" }}>{s.label}</span>}
                      <button onClick={() => deleteSnapshot(s.id)} style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer", color: C.textLight, fontSize: 11, padding: 2 }}>✕</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}