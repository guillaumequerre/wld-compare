import { useState, useMemo } from "react";
import { C, PAGE_TYPES, PAGE_TYPE_MAP } from "../lib/constants";

// ── Helpers ──────────────────────────────────────────────────────

function safeNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function getUrl(r)  { return (r["adresse"] || r["address"] || r["url"] || "").trim(); }
function getPath(url) { try { return new URL(url).pathname; } catch { return url; } }

// ── KPI definitions ───────────────────────────────────────────────

const KPI_DEFS = [
  { key: "clicks",      label: "Clics GSC",        src: "GSC",     higher: true,  unit: "",    fmt: v => v >= 1000 ? (v/1000).toFixed(1)+"k" : Math.round(v).toString() },
  { key: "impressions", label: "Impressions GSC",   src: "GSC",     higher: true,  unit: "",    fmt: v => v >= 1000 ? (v/1000).toFixed(1)+"k" : Math.round(v).toString() },
  { key: "position",    label: "Position moy. GSC", src: "GSC",     higher: false, unit: "",    fmt: v => v.toFixed(1) },
  { key: "ctr",         label: "CTR GSC",           src: "GSC",     higher: true,  unit: "%",   fmt: v => v.toFixed(1)+"%" },
  { key: "smTraffic",   label: "Trafic Semrush",    src: "Semrush", higher: true,  unit: "",    fmt: v => v >= 1000 ? (v/1000).toFixed(1)+"k" : Math.round(v).toString() },
  { key: "smKw",        label: "Mots-clés SM",      src: "Semrush", higher: true,  unit: "",    fmt: v => Math.round(v).toString() },
  { key: "smTop20",     label: "Top 20 SM",         src: "Semrush", higher: true,  unit: "",    fmt: v => Math.round(v).toString() },
  { key: "words",       label: "Nb de mots",        src: "SF",      higher: true,  unit: "",    fmt: v => Math.round(v).toString() },
  { key: "inlinksUniq", label: "Inlinks uniq.",     src: "SF",      higher: true,  unit: "",    fmt: v => Math.round(v).toString() },
  { key: "depth",       label: "Profondeur URL",    src: "SF",      higher: false, unit: "",    fmt: v => v.toFixed(0) },
];

// ── Per-URL data fusion ───────────────────────────────────────────

function buildUrlData(sfRows, gscRows, smRows) {
  const map = {};

  // SF — base
  sfRows.forEach(r => {
    const url = getUrl(r);
    if (!url) return;
    const ct = (r["type de contenu"] || r["content type"] || r["type"] || "").toLowerCase();
    const sc = safeNum(r["code http"] || r["status code"] || 200);
    const isHtml = (ct.includes("html") || (ct === "" && (r["title 1"] || r["h1-1"] || "").trim() !== "")) && sc < 400;
    if (!isHtml) return;
    map[url] = {
      url,
      title:       (r["title 1"] || r["title"] || "").slice(0, 90),
      h1:          (r["h1-1"]    || r["h1"]    || "").slice(0, 90),
      words:       safeNum(r["nombre de mots"] || r["word count"] || 0),
      inlinksUniq: safeNum(r["liens entrants uniques"] || r["unique inlinks"] || 0),
      depth:       getPath(url).split("/").filter(Boolean).length || 1,
      clicks: 0, impressions: 0, position: 0, ctr: 0,
      smTraffic: 0, smKw: 0, smTop20: 0,
    };
  });

  // GSC — match by pathname
  const gscByPath = {};
  gscRows.forEach(r => {
    const raw = (r["page"] || r["url"] || r["adresse"] || "").trim();
    if (!raw) return;
    const p = getPath(raw.startsWith("http") ? raw : "https://x" + raw);
    if (!gscByPath[p]) gscByPath[p] = { clicks: 0, impressions: 0, posSum: 0, posCnt: 0 };
    gscByPath[p].clicks      += safeNum(r["clics"] || r["clicks"] || 0);
    gscByPath[p].impressions += safeNum(r["impressions"] || 0);
    const pos = safeNum(r["position"] || 0);
    if (pos > 0) { gscByPath[p].posSum += pos; gscByPath[p].posCnt++; }
  });

  Object.values(map).forEach(d => {
    const p  = getPath(d.url);
    const g  = gscByPath[p] || gscByPath[p + "/"] || gscByPath[p.replace(/\/$/, "")];
    if (!g) return;
    d.clicks      = g.clicks;
    d.impressions = g.impressions;
    d.position    = g.posCnt ? Math.round(g.posSum / g.posCnt * 10) / 10 : 0;
    d.ctr         = g.impressions ? Math.round(g.clicks / g.impressions * 1000) / 10 : 0;
  });

  // Semrush — match by url
  smRows.forEach(r => {
    const url = r.url || "";
    if (!map[url]) return;
    map[url].smTraffic = safeNum(r.traffic || 0);
    map[url].smKw      = safeNum(r.kwCount || 0);
    map[url].smTop20   = safeNum(r.top20   || 0);
  });

  return map;
}

// ── Template stats ────────────────────────────────────────────────

function buildTemplateStats(urlData, ptMap, kpiKey, kpiDef) {
  const byTpl = {};
  Object.entries(urlData).forEach(([url, data]) => {
    const tpl = ptMap[url];
    if (!tpl || tpl === "home" || tpl === "autre") return;
    if (!byTpl[tpl]) byTpl[tpl] = [];
    byTpl[tpl].push({ url, val: data[kpiKey] ?? 0, data });
  });

  return Object.entries(byTpl).map(([key, pages]) => {
    const sorted = [...pages].sort((a, b) => kpiDef.higher ? b.val - a.val : a.val - b.val);
    const withVal = pages.filter(p => p.val > 0);
    const total   = pages.reduce((s, p) => s + p.val, 0);
    const avg     = withVal.length ? total / withVal.length : 0;
    return {
      key,
      meta:  PAGE_TYPE_MAP[key] || { label: key, color: "#64748B", bg: "#F1F5F9", icon: "❓" },
      pages: sorted,
      total, avg,
      best:  sorted[0] || null,
    };
  }).filter(t => t.pages.length > 0)
    .sort((a, b) => kpiDef.higher ? b.total - a.total : a.avg - b.avg);
}

// ── Scatter plot ──────────────────────────────────────────────────

function ScatterPlot({ templateStats, kpiDef, hoveredUrl, onHover }) {
  const COL_W    = 130;
  const H        = 320;
  const PAD_TOP  = 16;
  const PAD_BOT  = 52;
  const PAD_L    = 44;
  const plotH    = H - PAD_TOP - PAD_BOT;
  const totalW   = Math.max(PAD_L + templateStats.length * COL_W + 20, 400);

  const allVals  = templateStats.flatMap(t => t.pages.map(p => p.val)).filter(v => v > 0);
  if (!allVals.length) return (
    <div style={{ padding: "32px 0", textAlign: "center", color: C.textLight, fontSize: 12 }}>
      Aucune donnée pour ce KPI sur les pages classifiées
    </div>
  );

  const maxVal = Math.max(...allVals);
  const minVal = 0;
  const range  = maxVal - minVal || 1;

  const yOf = (val) => {
    const norm = kpiDef.higher ? val / range : (maxVal - val) / range;
    return PAD_TOP + plotH * (1 - Math.min(norm, 1));
  };

  // Y axis ticks
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(pct => ({
    pct,
    val:  kpiDef.higher ? maxVal * pct : maxVal * (1 - pct),
    y:    PAD_TOP + plotH * (1 - pct),
  }));

  return (
    <div style={{ overflowX: "auto", overflowY: "hidden" }}>
      <svg width={totalW} height={H} style={{ display: "block", minWidth: totalW }}>
        {/* Grid lines + Y labels */}
        {ticks.map(t => (
          <g key={t.pct}>
            <line x1={PAD_L} x2={totalW - 10} y1={t.y} y2={t.y} stroke={C.border} strokeWidth={t.pct === 0 || t.pct === 1 ? 1 : 0.5} strokeDasharray={t.pct === 0 || t.pct === 1 ? "none" : "3,3"} />
            <text x={PAD_L - 5} y={t.y + 3.5} fontSize={9} fill={C.textLight} textAnchor="end">{kpiDef.fmt(t.val)}</text>
          </g>
        ))}

        {/* Columns */}
        {templateStats.map((tpl, ci) => {
          const cx = PAD_L + ci * COL_W + COL_W / 2;
          const avgY = tpl.avg > 0 ? yOf(tpl.avg) : null;

          // Jitter x to avoid overlaps within a column
          const jitterMap = {};
          tpl.pages.forEach((p, pi) => {
            const yBucket = Math.round(yOf(p.val) / 6);
            if (!jitterMap[yBucket]) jitterMap[yBucket] = [];
            jitterMap[yBucket].push(pi);
          });

          return (
            <g key={tpl.key}>
              {/* Column axis */}
              <line x1={cx} x2={cx} y1={PAD_TOP} y2={PAD_TOP + plotH} stroke={tpl.meta.color + "25"} strokeWidth={1} />

              {/* Average bar */}
              {avgY !== null && (
                <g>
                  <line x1={cx - 18} x2={cx + 18} y1={avgY} y2={avgY} stroke={tpl.meta.color} strokeWidth={2.5} strokeLinecap="round" opacity={0.7} />
                  <text x={cx + 22} y={avgY + 3.5} fontSize={9} fill={tpl.meta.color} opacity={0.8}>∅ {kpiDef.fmt(tpl.avg)}</text>
                </g>
              )}

              {/* Points */}
              {tpl.pages.map((p, pi) => {
                const y       = yOf(p.val);
                const isBest  = pi === 0 && p.val > 0;
                const isHov   = hoveredUrl === p.url;
                // Horizontal jitter
                const yBucket = Math.round(y / 6);
                const peers   = jitterMap[yBucket] || [];
                const idx     = peers.indexOf(pi);
                const spread  = (peers.length - 1) * 7;
                const jx      = peers.length > 1 ? cx - spread / 2 + idx * 7 : cx;
                const r       = isHov ? 7 : isBest ? 6 : 4;

                return (
                  <g key={p.url} style={{ cursor: "pointer" }}
                    onMouseEnter={() => onHover(p, tpl)}
                    onMouseLeave={() => onHover(null)}>
                    {isBest && <circle cx={jx} cy={y} r={12} fill={tpl.meta.color} opacity={0.12} />}
                    <circle cx={jx} cy={y} r={r}
                      fill={tpl.meta.color}
                      opacity={isHov ? 1 : isBest ? 0.85 : 0.45}
                      stroke={isHov || isBest ? tpl.meta.color : "none"}
                      strokeWidth={isHov ? 2 : 1.5}
                    />
                  </g>
                );
              })}

              {/* Column label */}
              <text x={cx} y={H - PAD_BOT + 16} fontSize={11} fill={tpl.meta.color} textAnchor="middle" fontWeight="700">
                {tpl.meta.icon} {tpl.meta.label}
              </text>
              <text x={cx} y={H - PAD_BOT + 29} fontSize={9} fill={C.textLight} textAnchor="middle">
                {tpl.pages.length} page{tpl.pages.length > 1 ? "s" : ""}
              </text>
              <text x={cx} y={H - PAD_BOT + 41} fontSize={9} fill={tpl.meta.color} textAnchor="middle" fontWeight="600">
                Σ {kpiDef.fmt(tpl.total)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────

export default function TemplateAnalysis({ sites, sfData, gscData, smData, pageTypes }) {
  const [selectedSite, setSelectedSite] = useState(() => sites[0]?.id || "");
  const [selectedKpi,  setSelectedKpi]  = useState("clicks");
  const [hovered,      setHovered]      = useState(null); // { page, tpl }
  const [topN,         setTopN]         = useState(5);

  // ── All hooks BEFORE any early return ────────────────────────
  const site   = sites.find(s => s.id === selectedSite) || sites[0];
  const siteId = site?.id || "";
  const kpiDef = KPI_DEFS.find(k => k.key === selectedKpi) || KPI_DEFS[0];
  const ptMap  = (site && pageTypes[siteId]) || {};

  const urlData = useMemo(
    () => site ? buildUrlData(sfData[siteId] || [], gscData[siteId] || [], smData[siteId] || []) : {},
    [siteId, sfData, gscData, smData] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const templateStats = useMemo(
    () => buildTemplateStats(urlData, ptMap, selectedKpi, kpiDef),
    [urlData, ptMap, selectedKpi] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const topPages = useMemo(() => {
    return Object.entries(urlData)
      .map(([url, d]) => ({ url, val: d[selectedKpi] ?? 0, tpl: ptMap[url], data: d }))
      .filter(p => p.tpl && p.tpl !== "home" && p.val > 0)
      .sort((a, b) => kpiDef.higher ? b.val - a.val : a.val - b.val)
      .slice(0, topN);
  }, [urlData, ptMap, selectedKpi, topN]); // eslint-disable-line react-hooks/exhaustive-deps

  const recs = useMemo(() => {
    const out = [];
    templateStats.forEach(tpl => {
      if (tpl.pages.length < 2 || !tpl.best?.val) return;
      tpl.pages.slice(1).forEach(p => {
        if (!p.val) return;
        const gap    = kpiDef.higher ? tpl.best.val - p.val : p.val - tpl.best.val;
        const gapPct = gap / (tpl.best.val || 1);
        if (gapPct < 0.25) return;
        out.push({ page: p, best: tpl.best, tplMeta: tpl.meta, gap, gapPct });
      });
    });
    return out.sort((a, b) => b.gap - a.gap).slice(0, 12);
  }, [templateStats, kpiDef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Guards AFTER hooks ────────────────────────────────────────
  if (!site) return null;

  const classifiedCount = Object.keys(ptMap).filter(u => ptMap[u] && ptMap[u] !== "home").length;
  const hasData  = Object.keys(urlData).length > 0;
  const hasTpls  = classifiedCount > 0;
  const totalKpi = templateStats.reduce((s, t) => s + t.total, 0);
  const winner   = templateStats[0];

  if (!hasData) return (
    <div style={{ background: C.bg, borderRadius: 12, padding: 32, textAlign: "center" }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>🗂️</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>Importez un CSV Screaming Frog</div>
      <div style={{ fontSize: 12, color: C.textLight }}>Les données SF sont nécessaires pour cette analyse</div>
    </div>
  );

  if (!hasTpls) return (
    <div style={{ background: C.bg, borderRadius: 12, padding: 32, textAlign: "center" }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>🏷️</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>Classifiez les templates d'abord</div>
      <div style={{ fontSize: 12, color: C.textLight }}>Lancez la classification dans l'onglet ⚙️ Setup → votre site</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Controls bar ── */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {sites.length > 1 && sites.map(s => (
          <button key={s.id} onClick={() => setSelectedSite(s.id)} style={{
            padding: "5px 13px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
            border: `2px solid ${s.color}`,
            background: selectedSite === s.id ? s.color : "transparent",
            color:      selectedSite === s.id ? "#fff" : s.color,
            transition: "all 0.15s",
          }}>{s.label}</button>
        ))}

        <select value={selectedKpi} onChange={e => setSelectedKpi(e.target.value)} style={{
          padding: "6px 12px", border: `1px solid ${C.border}`, borderRadius: 8,
          fontSize: 12, color: C.text, background: C.white, cursor: "pointer",
        }}>
          {["GSC", "Semrush", "SF"].map(src => (
            <optgroup key={src} label={src}>
              {KPI_DEFS.filter(k => k.src === src).map(k => (
                <option key={k.key} value={k.key}>{k.label}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <span style={{ fontSize: 11, color: C.textLight, marginLeft: 4 }}>
          {classifiedCount} pages · {templateStats.length} templates · accueil exclu
        </span>
      </div>

      {/* ── Scatter plot card ── */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Positionnement par template — {kpiDef.label}</div>
            <div style={{ fontSize: 11, color: C.textLight, marginTop: 3 }}>
              1 point = 1 page · trait = moyenne du template · halo = best page · {kpiDef.higher ? "↑ haut = mieux" : "↑ bas = mieux"}
            </div>
          </div>
          {/* Tooltip survol */}
          {hovered ? (
            <div style={{ background: hovered.tpl.meta.bg, border: `1px solid ${hovered.tpl.meta.color}44`, borderRadius: 9, padding: "10px 14px", minWidth: 220, maxWidth: 300 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: hovered.tpl.meta.color, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.6 }}>
                {hovered.tpl.meta.icon} {hovered.tpl.meta.label}
              </div>
              <div style={{ fontSize: 11, color: C.text, wordBreak: "break-all", marginBottom: 5 }} title={hovered.page.url}>
                {getPath(hovered.page.url)}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: hovered.tpl.meta.color }}>
                {kpiDef.fmt(hovered.page.val)} <span style={{ fontSize: 11, fontWeight: 400, color: C.textLight }}>{kpiDef.label}</span>
              </div>
              {hovered.page.data.title && (
                <div style={{ fontSize: 10, color: C.textLight, marginTop: 4, fontStyle: "italic" }}>{hovered.page.data.title.slice(0, 60)}</div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Survolez un point pour les détails</div>
          )}
        </div>
        <ScatterPlot
          templateStats={templateStats}
          kpiDef={kpiDef}
          hoveredUrl={hovered?.page?.url}
          onHover={(page, tpl) => setHovered(page ? { page, tpl } : null)}
        />
      </div>

      {/* ── Templates qui rankent + Pages qui rankent ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

        {/* Templates ranking */}
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>Templates qui rankent</div>
          <div style={{ fontSize: 11, color: C.textLight, marginBottom: 18 }}>
            Classés par {kpiDef.higher ? "somme" : "moyenne"} de {kpiDef.label}
          </div>

          {templateStats.map((tpl, i) => {
            const share = totalKpi ? Math.round(tpl.total / totalKpi * 100) : 0;
            const barW  = templateStats[0].total ? tpl.total / templateStats[0].total * 100 : 0;
            return (
              <div key={tpl.key} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: C.textLight, minWidth: 18 }}>#{i + 1}</span>
                    <span style={{ fontSize: 13 }}>{tpl.meta.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: tpl.meta.color }}>{tpl.meta.label}</span>
                    <span style={{ fontSize: 10, color: C.textLight }}>{tpl.pages.length} p.</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{kpiDef.fmt(tpl.total)}</span>
                    <span style={{ fontSize: 10, color: C.textLight, marginLeft: 5 }}>{share}%</span>
                  </div>
                </div>
                <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
                  <div style={{ height: "100%", width: `${barW}%`, background: tpl.meta.color, borderRadius: 3, transition: "width 0.5s ease" }} />
                </div>
                {tpl.best?.val > 0 && (
                  <div style={{ fontSize: 10, color: C.textLight }}>
                    ↗ meilleure : <a href={tpl.best.url} target="_blank" rel="noreferrer" style={{ color: tpl.meta.color, textDecoration: "none" }}>{getPath(tpl.best.url).slice(0, 45)}</a>
                    {" "}· <strong>{kpiDef.fmt(tpl.best.val)}</strong>
                    <span style={{ color: C.textLight }}> · moy. {kpiDef.fmt(tpl.avg)}</span>
                  </div>
                )}
              </div>
            );
          })}

          {winner && totalKpi > 0 && (
            <div style={{ marginTop: 16, padding: "11px 14px", background: `${winner.meta.color}0D`, border: `1px solid ${winner.meta.color}30`, borderRadius: 10, fontSize: 12 }}>
              <span style={{ fontWeight: 700, color: winner.meta.color }}>💡 {winner.meta.icon} {winner.meta.label}</span> représente{" "}
              <strong>{Math.round(winner.total / totalKpi * 100)}%</strong> du {kpiDef.label} total.
              {" "}Piste prioritaire pour ce KPI — <strong>investissez ce format en priorité.</strong>
            </div>
          )}
        </div>

        {/* Top pages */}
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>Pages qui rankent</div>
          <div style={{ fontSize: 11, color: C.textLight, marginBottom: 18 }}>
            Modèles à reproduire pour les pages du même template
          </div>

          {topPages.length === 0 ? (
            <div style={{ color: C.textLight, fontSize: 12, fontStyle: "italic" }}>Aucune donnée pour ce KPI</div>
          ) : topPages.map((p, i) => {
            const tplMeta = PAGE_TYPE_MAP[p.tpl] || { label: p.tpl, color: "#64748B", bg: "#F1F5F9", icon: "❓" };
            const path = getPath(p.url);
            return (
              <div key={p.url} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderBottom: i < topPages.length - 1 ? `1px solid ${C.borderLight}` : "none" }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: C.textLight, minWidth: 22, textAlign: "right" }}>{i + 1}</span>
                <span style={{ fontSize: 11, background: tplMeta.bg, color: tplMeta.color, borderRadius: 5, padding: "2px 7px", fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" }}>
                  {tplMeta.icon} {tplMeta.label}
                </span>
                <a href={p.url} target="_blank" rel="noreferrer" title={p.data.title || p.url}
                  style={{ flex: 1, fontSize: 11, color: C.blue, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none" }}>
                  {path}
                </a>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{kpiDef.fmt(p.val)}</div>
                </div>
              </div>
            );
          })}

          {topPages.length >= topN && (
            <button onClick={() => setTopN(n => n + 5)}
              style={{ marginTop: 12, width: "100%", padding: "7px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.textMid, fontSize: 11, cursor: "pointer" }}>
              Afficher 5 de plus
            </button>
          )}
        </div>
      </div>

      {/* ── Recommandations ── */}
      {recs.length > 0 && (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>
            ⚡ Pages avec potentiel inexploité
          </div>
          <div style={{ fontSize: 11, color: C.textLight, marginBottom: 18 }}>
            Pages dont le template a de meilleures performances ailleurs — écart &gt;25% par rapport à la meilleure page du même template
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 10 }}>
            {recs.map((r, i) => {
              const path     = getPath(r.page.url);
              const bestPath = getPath(r.best.url);
              const gapPct   = Math.round(r.gapPct * 100);
              return (
                <div key={i} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                    <span style={{ fontSize: 10, background: r.tplMeta.bg, color: r.tplMeta.color, borderRadius: 4, padding: "2px 7px", fontWeight: 700 }}>
                      {r.tplMeta.icon} {r.tplMeta.label}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#DC2626" }}>−{gapPct}%</span>
                    <span style={{ fontSize: 10, color: C.textLight }}>vs meilleure du template</span>
                  </div>
                  <a href={r.page.url} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, color: C.text, fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none", marginBottom: 4 }}
                    title={r.page.data.title || r.page.url}>
                    {path}
                  </a>
                  <div style={{ fontSize: 12, color: C.textLight, marginBottom: 8 }}>
                    {kpiDef.label} : <strong style={{ color: C.text }}>{kpiDef.fmt(r.page.val)}</strong>
                    <span style={{ margin: "0 6px" }}>·</span>
                    potentiel : <strong style={{ color: r.tplMeta.color }}>+{kpiDef.fmt(r.gap)}</strong>
                  </div>
                  <div style={{ fontSize: 10, color: C.textLight, padding: "7px 10px", background: `${r.tplMeta.color}08`, border: `1px solid ${r.tplMeta.color}20`, borderRadius: 6 }}>
                    📌 Référence : <a href={r.best.url} target="_blank" rel="noreferrer" style={{ color: r.tplMeta.color, textDecoration: "none" }}>{bestPath}</a>
                    <strong style={{ color: r.tplMeta.color, marginLeft: 4 }}>({kpiDef.fmt(r.best.val)})</strong>
                    {r.page.data.title && <div style={{ marginTop: 4, fontStyle: "italic", color: C.textLight }}>"{r.page.data.title.slice(0, 70)}"</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}