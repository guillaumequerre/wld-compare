import { useState, useMemo } from "react";
import { C } from "../lib/constants";
import { SectionHeader } from "../components/ui";
import InfoCard from "../components/InfoCard";
import { parseSemrush } from "../lib/parsers";

// ── Helpers ──────────────────────────────────────────────────────

function n(v) { return typeof v === "number" ? v : 0; }

function fmt(v, decimals) {
  if (v === null || v === undefined) return "—";
  return Number(v).toLocaleString("fr", {
    minimumFractionDigits: decimals || 0,
    maximumFractionDigits: decimals || 0,
  });
}

function fmtPct(v) {
  if (!v && v !== 0) return "—";
  return Number(v).toLocaleString("fr", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " %";
}

function Delta({ v }) {
  if (v === null || v === undefined) return <span style={{ color: C.textLight }}>—</span>;
  const nv = Number(v);
  const color = nv > 0 ? "#15803D" : nv < 0 ? "#DC2626" : C.textLight;
  return <span style={{ fontWeight: 700, color }}>{nv > 0 ? "+" : ""}{fmt(nv)}</span>;
}

function IntentBar({ comm, info, nav, trans, total }) {
  if (!total) return <span style={{ color: C.textLight, fontSize: 11 }}>—</span>;
  const segs = [
    { val: n(comm),  color: "#2563EB", label: "Comm." },
    { val: n(info),  color: "#7C3AED", label: "Info." },
    { val: n(nav),   color: "#059669", label: "Nav." },
    { val: n(trans), color: "#D97706", label: "Trans." },
  ].filter(s => s.val > 0);
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
      {segs.map((s, i) => (
        <div key={i} title={s.label + ": " + s.val}
          style={{ height: 8, width: Math.max(4, Math.round(s.val / total * 72)), background: s.color, borderRadius: 2 }} />
      ))}
    </div>
  );
}

// ── Site summary card ─────────────────────────────────────────────

function SiteCard({ site, sm }) {
  if (!sm) return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px", opacity: 0.45 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: site.color }} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>{site.label}</span>
      </div>
      <div style={{ fontSize: 12, color: C.textLight }}>Aucune donnée Semrush importée</div>
    </div>
  );

  const isOrg = sm.format === "organic_pages";
  const totalIntent = n(sm.intentCommercial) + n(sm.intentInformational) + n(sm.intentNavigational) + n(sm.intentTransactional);
  const trafficGrowthRate = sm.totalTraffic > 0 ? Math.round(sm.trafficDelta / (sm.totalTraffic - sm.trafficDelta) * 100) : 0;

  return (
    <div style={{ background: C.white, border: `1.5px solid ${site.color}33`, borderRadius: 14, overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: site.color }} />
        <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{site.label}</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: C.textLight, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, padding: "2px 7px" }}>
          {isOrg ? "Organic Pages" : "Position Tracking"}
        </span>
      </div>

      <div style={{ padding: "14px 18px" }}>

        {/* ── Trafic (hero stat) ── */}
        <div style={{ background: `linear-gradient(135deg, ${site.color}0D, ${site.color}05)`, border: `1px solid ${site.color}22`, borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 10, color: C.textLight, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.7 }}>Trafic organique</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: C.text, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{fmt(sm.totalTraffic)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: C.textLight, marginBottom: 3 }}>Variation</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}><Delta v={sm.trafficDelta} /></div>
              {sm.totalTraffic > 0 && Math.abs(trafficGrowthRate) < 999 && (
                <div style={{ fontSize: 10, color: C.textLight }}>{trafficGrowthRate > 0 ? "+" : ""}{trafficGrowthRate} %</div>
              )}
            </div>
          </div>
          {/* Pages hausse / baisse */}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <div style={{ flex: 1, background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 7, padding: "5px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#15803D" }}>En hausse</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#15803D" }}>+{fmt(sm.pagesGrowing)}</div>
            </div>
            <div style={{ flex: 1, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 7, padding: "5px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#DC2626" }}>En baisse</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#DC2626" }}>{fmt(sm.pagesDeclining)}</div>
            </div>
            <div style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: C.textLight }}>Avec trafic</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{fmt(sm.pagesWithTraffic)}</div>
            </div>
          </div>
        </div>

        {/* ── KPI grid ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 10 }}>
          {[
            { label: "Pages analysées", value: fmt(isOrg ? sm.pageCount : sm.pageCount),        accent: false },
            { label: "Mots-clés",        value: fmt(sm.totalKw),                                  accent: false },
            { label: "Positions top 20", value: fmt(isOrg ? sm.totalTop20 : sm.totalTop20),      accent: true },
            { label: isOrg ? "Pos./page moy." : "Position moy.",
              value: isOrg
                ? fmt(sm.pageCount > 0 ? Math.round(sm.totalTop20 / sm.pageCount * 10) / 10 : 0, 1)
                : fmt(sm.avgPos, 1),
              accent: false },
          ].map(({ label, value, accent }) => (
            <div key={label} style={{ background: C.bg, borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: C.textLight, marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: accent ? site.color : C.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
            </div>
          ))}
        </div>

        {/* ── Intentions ── */}
        {isOrg && totalIntent > 0 && (
          <div>
            <div style={{ fontSize: 10, color: C.textLight, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 7 }}>
              Intentions · positions top 20
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {[
                { label: "Commercial",     pos: sm.intentCommercial,    traf: sm.trafficCommercial,    color: "#2563EB", bg: "#EFF6FF" },
                { label: "Informationnel", pos: sm.intentInformational, traf: sm.trafficInformational, color: "#7C3AED", bg: "#F5F3FF" },
                { label: "Navigationnel",  pos: sm.intentNavigational,  traf: sm.trafficNavigational,  color: "#059669", bg: "#ECFDF5" },
                { label: "Transactionnel", pos: sm.intentTransactional, traf: sm.trafficTransactional, color: "#D97706", bg: "#FFFBEB" },
              ].map(({ label, pos, traf, color, bg }) => n(pos) > 0 ? (
                <div key={label} style={{ background: bg, border: `1px solid ${color}22`, borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 9, color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
                    <span style={{ fontSize: 10, color: C.textLight }}>{totalIntent > 0 ? Math.round(n(pos)/totalIntent*100) : 0}%</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{fmt(pos)}</span>
                    <span style={{ fontSize: 10, color: C.textMid, fontVariantNumeric: "tabular-nums" }}>{fmt(traf)} vis.</span>
                  </div>
                  {/* Mini bar */}
                  <div style={{ marginTop: 5, height: 3, background: `${color}22`, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round(n(pos)/totalIntent*100)}%`, background: color, borderRadius: 2 }} />
                  </div>
                </div>
              ) : null)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────

const SORTS = [
  { key: "traffic",      label: "Trafic" },
  { key: "kwCount",      label: "Mots-clés" },
  { key: "trafficDelta", label: "Δ Trafic" },
  { key: "top20",        label: "Top 20" },
  { key: "intentCommercial", label: "Commercial" },
];

export default function SemrushTab({ sites, smData, metrics }) {
  const [sortKey, setSortKey] = useState("traffic");
  const [sortDir, setSortDir] = useState("desc");
  const [search,  setSearch]  = useState("");
  const [maxRows, setMaxRows] = useState(50);

  // Auto-normalize: if rows are raw CSV objects (from Supabase reload before fix), re-parse them
  const normalizedSmData = useMemo(() => {
    const result = {};
    for (const site of sites) {
      const rows = normalizedSmData[site.id] || [];
      if (!rows.length) { result[site.id] = []; continue; }
      // Detect raw rows: they have uppercase keys like "URL", "Traffic", not the parsed shape
      const isParsed = rows[0] && ("kwCount" in rows[0] || "format" in rows[0]);
      result[site.id] = isParsed ? rows : parseSemrush(rows);
    }
    return result;
  }, [smData, sites]);

  const hasAny = sites.some(s => (normalizedSmData[s.id] || []).length > 0);
  if (!hasAny) return (
    <div style={{ padding: 40, textAlign: "center", color: C.textLight }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>📈</div>
      <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>Aucune donnée Semrush</div>
      <div style={{ fontSize: 13 }}>Importez un export CSV Semrush dans l&apos;onglet Setup</div>
    </div>
  );

  const allRows = sites.flatMap(s => normalizedSmData[s.id] || []);
  const isOrganic = allRows[0]?.format === "organic_pages";

  // Flat list with site context
  const urlRows = sites.flatMap(site =>
    (normalizedSmData[site.id] || []).map(r => ({ ...r, site }))
  );

  const filtered = urlRows
    .filter(r => !search || r.url.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = n(a[sortKey]), bv = n(b[sortKey]);
      return sortDir === "desc" ? bv - av : av - bv;
    });

  const displayed = filtered.slice(0, maxRows);

  const setSort = (sk) => {
    if (sortKey === sk) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(sk); setSortDir("desc"); }
  };

  const THStyle = (sk) => ({
    padding: "10px 12px", textAlign: "right", borderBottom: `1px solid ${C.border}`,
    fontSize: 11, fontWeight: 600, color: sortKey === sk ? C.blue : C.textLight,
    textTransform: "uppercase", letterSpacing: 0.7, cursor: "pointer",
    whiteSpace: "nowrap", background: C.bg, userSelect: "none",
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <SectionHeader title="Semrush · Organic Pages" sub="Visibilité organique, trafic et intentions par URL" />
        <InfoCard tabKey="semrush" />
      </div>

      {/* ── Stats par site ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 12 }}>
          Vue par site
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(sites.filter(s => (normalizedSmData[s.id]||[]).length > 0).length || 1, 3)}, 1fr)`, gap: 16 }}>
          {sites.map((site) => {
            const smRows = normalizedSmData[site.id] || [];
            if (!smRows.length) return <SiteCard key={site.id} site={site} sm={null} />;
            const sum = (fn) => smRows.reduce((a, r) => a + (fn(r) || 0), 0);
            const isOrg = smRows[0]?.format === "organic_pages";
            const sm = {
              format: smRows[0]?.format || "organic_pages",
              pageCount: smRows.length,
              totalTraffic: Math.round(sum(r => r.traffic)),
              trafficDelta: Math.round(sum(r => r.trafficDelta || 0)),
              pagesWithTraffic: smRows.filter(r => (r.traffic || 0) > 0).length,
              pagesGrowing: smRows.filter(r => (r.trafficDelta || 0) > 0).length,
              pagesDeclining: smRows.filter(r => (r.trafficDelta || 0) < 0).length,
              totalKw: sum(r => r.kwCount),
              totalTop20: isOrg ? sum(r => r.top20 || 0) : sum(r => r.top10 || 0),
              avgPos: 0,
              intentCommercial:    sum(r => r.intentCommercial    || 0),
              intentInformational: sum(r => r.intentInformational || 0),
              intentNavigational:  sum(r => r.intentNavigational  || 0),
              intentTransactional: sum(r => r.intentTransactional || 0),
              trafficCommercial:    Math.round(sum(r => r.trafficCommercial    || 0)),
              trafficInformational: Math.round(sum(r => r.trafficInformational || 0)),
              trafficNavigational:  Math.round(sum(r => r.trafficNavigational  || 0)),
              trafficTransactional: Math.round(sum(r => r.trafficTransactional || 0)),
            };
            return <SiteCard key={site.id} site={site} sm={sm} />;
          })}
        </div>
      </div>

      {/* ── Tableau par URL ── */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>

        {/* Toolbar */}
        <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Détail par URL</span>
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setMaxRows(50); }}
            placeholder="Filtrer par URL…"
            style={{ flex: 1, minWidth: 180, padding: "6px 11px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, outline: "none" }}
          />
          <div style={{ display: "flex", gap: 5 }}>
            {SORTS.filter(s => isOrganic || !["top20","intentCommercial"].includes(s.key)).map(s => (
              <button key={s.key} onClick={() => setSort(s.key)}
                style={{ padding: "4px 9px", borderRadius: 6, border: `1px solid ${sortKey === s.key ? C.blue : C.border}`, background: sortKey === s.key ? C.blueLight : C.white, color: sortKey === s.key ? C.blue : C.textMid, fontSize: 11, fontWeight: sortKey === s.key ? 700 : 400, cursor: "pointer" }}>
                {s.label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: C.textLight }}>{filtered.length} URLs</span>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto", maxHeight: 620, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
              <tr>
                {sites.length > 1 && (
                  <th style={{ ...THStyle(null), textAlign: "left", color: C.textLight, cursor: "default" }}>Site</th>
                )}
                <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, background: C.bg }}>URL</th>
                <th style={THStyle("kwCount")} onClick={() => setSort("kwCount")}>
                  Mots-clés{sortKey === "kwCount" && <span style={{ marginLeft: 3, opacity: 0.7 }}>{sortDir === "desc" ? "↓" : "↑"}</span>}
                </th>
                <th style={THStyle("traffic")} onClick={() => setSort("traffic")}>
                  Trafic{sortKey === "traffic" && <span style={{ marginLeft: 3, opacity: 0.7 }}>{sortDir === "desc" ? "↓" : "↑"}</span>}
                </th>
                <th style={THStyle("trafficPct")} onClick={() => setSort("trafficPct")}>
                  Trafic %{sortKey === "trafficPct" && <span style={{ marginLeft: 3, opacity: 0.7 }}>{sortDir === "desc" ? "↓" : "↑"}</span>}
                </th>
                <th style={THStyle("trafficDelta")} onClick={() => setSort("trafficDelta")}>
                  Δ Trafic{sortKey === "trafficDelta" && <span style={{ marginLeft: 3, opacity: 0.7 }}>{sortDir === "desc" ? "↓" : "↑"}</span>}
                </th>
                {isOrganic && (
                  <th style={THStyle("top20")} onClick={() => setSort("top20")}>
                    Top 20{sortKey === "top20" && <span style={{ marginLeft: 3, opacity: 0.7 }}>{sortDir === "desc" ? "↓" : "↑"}</span>}
                  </th>
                )}
                {isOrganic && (
                  <th style={{ ...THStyle("intentCommercial"), textAlign: "center" }} onClick={() => setSort("intentCommercial")}>
                    Intentions{sortKey === "intentCommercial" && <span style={{ marginLeft: 3, opacity: 0.7 }}>{sortDir === "desc" ? "↓" : "↑"}</span>}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: C.textLight, fontSize: 13 }}>Aucune URL correspondante</td></tr>
              )}
              {displayed.map((r, i) => {
                const rowBg = i % 2 === 0 ? C.white : C.bg;
                const totalIntent = n(r.intentCommercial) + n(r.intentInformational) + n(r.intentNavigational) + n(r.intentTransactional);
                let urlPath = "/";
                try { urlPath = new URL(r.url).pathname || "/"; } catch { urlPath = r.url; }
                return (
                  <tr key={r.site.id + r.url} style={{ background: rowBg }}>
                    {sites.length > 1 && (
                      <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <div style={{ width: 7, height: 7, borderRadius: "50%", background: r.site.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 10, color: C.textLight, whiteSpace: "nowrap" }}>{r.site.label}</span>
                        </div>
                      </td>
                    )}
                    {/* URL */}
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, maxWidth: 360 }}>
                      <div style={{ fontSize: 11, color: C.textMid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.url}>
                        {urlPath}
                      </div>
                    </td>
                    {/* Mots-clés */}
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ fontWeight: 600, color: C.text }}>{fmt(r.kwCount)}</span>
                    </td>
                    {/* Trafic */}
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {n(r.traffic) > 0
                        ? <span style={{ fontWeight: 700, color: C.text }}>{fmt(r.traffic)}</span>
                        : <span style={{ color: C.textLight }}>0</span>}
                    </td>
                    {/* Trafic % */}
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "right", color: C.textMid, fontVariantNumeric: "tabular-nums" }}>
                      {n(r.trafficPct) > 0 ? fmtPct(r.trafficPct) : <span style={{ color: C.textLight }}>—</span>}
                    </td>
                    {/* Delta */}
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      <Delta v={r.trafficDelta} />
                    </td>
                    {/* Top 20 */}
                    {isOrganic && (
                      <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "right" }}>
                        {n(r.top20) > 0
                          ? <span style={{ background: "#EFF6FF", color: "#2563EB", borderRadius: 5, padding: "2px 7px", fontWeight: 600 }}>{fmt(r.top20)}</span>
                          : <span style={{ color: C.textLight }}>—</span>}
                      </td>
                    )}
                    {/* Intent bar */}
                    {isOrganic && (
                      <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "center" }}>
                        {totalIntent > 0
                          ? <IntentBar comm={r.intentCommercial} info={r.intentInformational} nav={r.intentNavigational} trans={r.intentTransactional} total={totalIntent} />
                          : <span style={{ color: C.textLight }}>—</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Load more */}
        {filtered.length > maxRows && (
          <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, textAlign: "center" }}>
            <button onClick={() => setMaxRows(m => m + 50)}
              style={{ padding: "6px 18px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.textMid, fontSize: 12, cursor: "pointer" }}>
              Afficher 50 de plus · {filtered.length - maxRows} restantes
            </button>
          </div>
        )}

        {/* Intent legend */}
        {isOrganic && (
          <div style={{ padding: "8px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            {[["#2563EB","Commercial"],["#7C3AED","Informationnel"],["#059669","Navigationnel"],["#D97706","Transactionnel"]].map(([color, label]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textLight }}>
                <div style={{ width: 10, height: 8, background: color, borderRadius: 2 }} />
                {label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}