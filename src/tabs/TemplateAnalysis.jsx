import { useState, useMemo } from "react";
import { C, PAGE_TYPE_MAP } from "../lib/constants";

// ── Helpers ──────────────────────────────────────────────────────

function safeNum(v) { const n = parseFloat(String(v || "").replace("%", "")); return isNaN(n) ? 0 : n; }

function normPath(raw) {
  if (!raw) return "";
  const s = raw.trim();
  try { return new URL(s.startsWith("http") ? s : "https://x.com" + s).pathname.replace(/\/+$/, "") || "/"; }
  catch { return s.replace(/\/+$/, "") || "/"; }
}

function getPath(url) {
  try { return new URL(url).pathname.replace(/\/+$/, "") || "/"; }
  catch { return url; }
}

// ── KPI definitions — GSC, GA4, Semrush, Bing only ───────────────

const KPI_DEFS = [
  // GSC
  { key: "gscClicks",      label: "Clics",            src: "GSC",     higher: true,  fmt: v => v >= 1000 ? (v/1000).toFixed(1)+"k" : String(Math.round(v)) },
  { key: "gscImpressions", label: "Impressions",       src: "GSC",     higher: true,  fmt: v => v >= 1000 ? (v/1000).toFixed(1)+"k" : String(Math.round(v)) },
  { key: "gscPosition",    label: "Position moy.",     src: "GSC",     higher: false, fmt: v => v.toFixed(1) },
  { key: "gscCtr",         label: "CTR",               src: "GSC",     higher: true,  fmt: v => v.toFixed(1)+"%" },
  // GA4
  { key: "gaSessions",     label: "Sessions",          src: "GA4",     higher: true,  fmt: v => v >= 1000 ? (v/1000).toFixed(1)+"k" : String(Math.round(v)) },
  { key: "gaViews",        label: "Pages vues",        src: "GA4",     higher: true,  fmt: v => v >= 1000 ? (v/1000).toFixed(1)+"k" : String(Math.round(v)) },
  // Semrush
  { key: "smTraffic",      label: "Trafic estimé",     src: "Semrush", higher: true,  fmt: v => v >= 1000 ? (v/1000).toFixed(1)+"k" : String(Math.round(v)) },
  { key: "smKw",           label: "Mots-clés",         src: "Semrush", higher: true,  fmt: v => String(Math.round(v)) },
  { key: "smTop20",        label: "Positions Top 20",  src: "Semrush", higher: true,  fmt: v => String(Math.round(v)) },
  // Bing AI
  { key: "bingCitations",  label: "Citations IA",      src: "Bing AI", higher: true,  fmt: v => String(Math.round(v)) },
];

// ── URL data fusion ───────────────────────────────────────────────

function buildUrlData(sfRows, gscRows, gaRows, bingRows, smRows) {
  const map = {};

  // ── SF — base structure (URL list only, no KPIs shown) ──────
  sfRows.forEach(r => {
    const url = (r["adresse"] || r["address"] || r["url"] || "").trim();
    if (!url) return;
    const ct = (r["type de contenu"] || r["content type"] || r["type"] || "").toLowerCase();
    const sc = safeNum(r["code http"] || r["status code"] || 200);
    const isHtml = (ct.includes("html") || (ct === "" && (r["title 1"] || r["h1-1"] || "").trim() !== "")) && sc < 400;
    if (!isHtml) return;
    map[url] = {
      url,
      title: (r["title 1"] || r["title"] || "").slice(0, 90),
      // All KPIs start at 0
      gscClicks: 0, gscImpressions: 0, gscPosition: 0, gscCtr: 0,
      gaSessions: 0, gaViews: 0,
      smTraffic: 0, smKw: 0, smTop20: 0,
      bingCitations: 0,
    };
  });

  // ── GSC — 1 row per (page × query) or 1 row per page ────────
  // Aggregate by page path
  const gscByPath = {};
  gscRows.forEach(r => {
    const raw = (r["page"] || r["url"] || r["adresse"] || r["pages les plus populaires"] || "").trim();
    if (!raw) return;
    const p = normPath(raw);
    if (!gscByPath[p]) gscByPath[p] = { clicks: 0, impressions: 0, posSum: 0, posCnt: 0, ctrSum: 0, ctrCnt: 0 };
    gscByPath[p].clicks      += safeNum(r["clics"] || r["clicks"] || 0);
    gscByPath[p].impressions += safeNum(r["impressions"] || 0);
    const pos = safeNum(r["position"] || 0);
    if (pos > 0) { gscByPath[p].posSum += pos; gscByPath[p].posCnt++; }
    const ctr = safeNum(r["ctr"] || 0);
    if (ctr > 0) { gscByPath[p].ctrSum += ctr; gscByPath[p].ctrCnt++; }
  });

  // ── GA4 — 1 row per page ────────────────────────────────────
  const gaByPath = {};
  gaRows.forEach(r => {
    const raw = (r["page"] || r["url"] || r["adresse"] || r["pages les plus populaires"] || r["landing page"] || "").trim();
    if (!raw) return;
    const p = normPath(raw);
    if (!gaByPath[p]) gaByPath[p] = { sessions: 0, views: 0 };
    gaByPath[p].sessions += safeNum(r["ga4 sessions"] || r["sessions"] || r["séances"] || 0);
    gaByPath[p].views    += safeNum(r["ga4 views"]    || r["views"]    || r["pages vues"] || 0);
  });

  // ── Bing — 1 row per page ────────────────────────────────────
  const bingByPath = {};
  bingRows.forEach(r => {
    const raw = (r["url"] || r["page"] || r["adresse"] || "").trim();
    if (!raw) return;
    const p = normPath(raw);
    if (!bingByPath[p]) bingByPath[p] = 0;
    bingByPath[p] += safeNum(r["citations"] || r["mentions"] || r["impressions"] || r["appearancecount"] || 0);
  });

  // ── Semrush — already parsed rows with .url ──────────────────
  const smByUrl  = {};
  const smByPath = {};
  smRows.forEach(r => {
    if (!r.url) return;
    smByUrl[r.url]         = r;
    smByPath[normPath(r.url)] = r;
  });

  // ── Merge onto SF URL map ────────────────────────────────────
  Object.values(map).forEach(d => {
    const p = getPath(d.url);

    // Try exact path, then with/without trailing slash
    const tryPaths = [p, p + "/", p.replace(/\/$/, "")];

    const g = tryPaths.map(tp => gscByPath[tp]).find(Boolean);
    if (g) {
      d.gscClicks      = g.clicks;
      d.gscImpressions = g.impressions;
      d.gscPosition    = g.posCnt ? Math.round(g.posSum / g.posCnt * 10) / 10 : 0;
      d.gscCtr         = g.ctrCnt ? Math.round(g.ctrSum / g.ctrCnt * 10) / 10 : 0;
      // Fallback CTR from clicks/impressions
      if (!d.gscCtr && d.gscImpressions > 0) d.gscCtr = Math.round(d.gscClicks / d.gscImpressions * 1000) / 10;
    }

    const ga = tryPaths.map(tp => gaByPath[tp]).find(Boolean);
    if (ga) { d.gaSessions = ga.sessions; d.gaViews = ga.views; }

    const bing = tryPaths.map(tp => bingByPath[tp]).find(Boolean);
    if (bing) d.bingCitations = bing;

    const sm = smByUrl[d.url] || tryPaths.map(tp => smByPath[tp]).find(Boolean);
    if (sm) { d.smTraffic = safeNum(sm.traffic || 0); d.smKw = safeNum(sm.kwCount || 0); d.smTop20 = safeNum(sm.top20 || 0); }
  });

  // ── Also add GSC/GA/Bing/SM pages not in SF ─────────────────
  // So scatter works even without SF (or with partial SF)
  const addIfMissing = (raw, fill) => {
    const p = normPath(raw);
    // Find if any existing entry matches this path
    const existing = Object.keys(map).find(u => getPath(u) === p);
    if (existing) return;
    // Create a minimal entry
    map["__nosf__" + p] = {
      url: raw.startsWith("http") ? raw : raw,
      title: "",
      gscClicks: 0, gscImpressions: 0, gscPosition: 0, gscCtr: 0,
      gaSessions: 0, gaViews: 0, smTraffic: 0, smKw: 0, smTop20: 0, bingCitations: 0,
      ...fill,
    };
  };

  Object.entries(gscByPath).forEach(([p, g]) => {
    if (g.clicks > 0 || g.impressions > 0) addIfMissing(p, {
      gscClicks: g.clicks, gscImpressions: g.impressions,
      gscPosition: g.posCnt ? Math.round(g.posSum / g.posCnt * 10) / 10 : 0,
      gscCtr: g.ctrCnt ? Math.round(g.ctrSum / g.ctrCnt * 10) / 10 : (g.impressions ? Math.round(g.clicks / g.impressions * 1000) / 10 : 0),
    });
  });
  Object.entries(gaByPath).forEach(([p, ga]) => {
    if (ga.sessions > 0 || ga.views > 0) addIfMissing(p, { gaSessions: ga.sessions, gaViews: ga.views });
  });
  smRows.forEach(r => {
    if (r.url && (r.traffic > 0 || r.kwCount > 0)) addIfMissing(r.url, { smTraffic: safeNum(r.traffic), smKw: safeNum(r.kwCount), smTop20: safeNum(r.top20) });
  });
  Object.entries(bingByPath).forEach(([p, cnt]) => {
    if (cnt > 0) addIfMissing(p, { bingCitations: cnt });
  });

  return map;
}

// ── Template stats ────────────────────────────────────────────────

function buildTemplateStats(urlData, ptMap, kpiKey, kpiDef) {
  const byTpl = {};
  Object.entries(urlData).forEach(([url, data]) => {
    const cleanUrl = url.startsWith("__nosf__") ? url.slice(8) : url;
    const tpl = ptMap[cleanUrl] || ptMap[url];
    if (!tpl || tpl === "home" || tpl === "autre") return;
    if (!byTpl[tpl]) byTpl[tpl] = [];
    byTpl[tpl].push({ url: cleanUrl, val: data[kpiKey] ?? 0, data });
  });

  return Object.entries(byTpl).map(([key, pages]) => {
    const sorted  = [...pages].sort((a, b) => kpiDef.higher ? b.val - a.val : (a.val || 999) - (b.val || 999));
    const withVal = pages.filter(p => p.val > 0);
    const total   = withVal.reduce((s, p) => s + p.val, 0);
    const avg     = withVal.length ? total / withVal.length : 0;
    return {
      key,
      meta:  PAGE_TYPE_MAP[key] || { label: key, color: "#64748B", bg: "#F1F5F9", icon: "❓" },
      pages: sorted,
      withVal: withVal.length,
      total, avg,
      best: sorted.find(p => p.val > 0) || null,
    };
  }).filter(t => t.withVal > 0)
    .sort((a, b) => kpiDef.higher ? b.total - a.total : a.avg - b.avg);
}

// ── Scatter plot (multi-site) ─────────────────────────────────────

function ScatterPlot({ allTemplateKeys, allSiteTemplateStats, kpiDef, hoveredUrl, onHover }) {
  const COL_W  = 130;
  const H      = 340;
  const PAD_T  = 16;
  const PAD_B  = 52;
  const PAD_L  = 48;
  const plotH  = H - PAD_T - PAD_B;
  const totalW = Math.max(PAD_L + allTemplateKeys.length * COL_W + 20, 400);

  const allVals = allSiteTemplateStats.flatMap(({ tplStats }) =>
    tplStats.flatMap(t => t.pages.map(p => p.val))
  ).filter(v => v > 0);

  if (!allVals.length) return (
    <div style={{ padding: "40px 0", textAlign: "center", color: C.textLight, fontSize: 12, fontStyle: "italic" }}>
      Aucune donnée disponible pour ce KPI sur les pages classifiées
    </div>
  );

  const maxVal = Math.max(...allVals);
  const yOf = val => PAD_T + plotH * (1 - Math.min(Math.max(kpiDef.higher ? val / maxVal : (maxVal - val) / maxVal, 0), 1));

  const ticks = [0, 0.25, 0.5, 0.75, 1].map(pct => ({
    y:   PAD_T + plotH * (1 - pct),
    val: kpiDef.higher ? maxVal * pct : maxVal * (1 - pct),
  }));

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={totalW} height={H} style={{ display: "block" }}>
        {/* Y-axis grid + ticks */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={totalW - 10} y1={t.y} y2={t.y}
              stroke={C.border} strokeWidth={i === 0 || i === 4 ? 1 : 0.5}
              strokeDasharray={i === 0 || i === 4 ? "none" : "3,3"} />
            <text x={PAD_L - 5} y={t.y + 3.5} fontSize={9} fill={C.textLight} textAnchor="end">
              {kpiDef.fmt(t.val)}
            </text>
          </g>
        ))}

        {/* Template columns — tous les sites partagent la même abscisse */}
        {allTemplateKeys.map((tpl, ci) => {
          const cx = PAD_L + ci * COL_W + COL_W / 2;

          // Fusionner toutes les pages de tous les sites pour ce template (jitter commun)
          const allPages = allSiteTemplateStats.flatMap(({ site, tplStats }) => {
            const tplData = tplStats.find(t => t.key === tpl.key);
            return tplData ? tplData.pages.map(p => ({ p, site, isBest: tplData.pages[0] === p })) : [];
          }).filter(({ p }) => p.val > 0);

          // Jitter commun par bucket Y
          const buckets = {};
          allPages.forEach((entry, i) => {
            const b = Math.round(yOf(entry.p.val) / 7);
            if (!buckets[b]) buckets[b] = [];
            buckets[b].push(i);
          });

          // Lignes de moyenne par site (légèrement décalées)
          const nSites = allSiteTemplateStats.length;

          return (
            <g key={tpl.key}>
              {/* Séparateur de colonne */}
              <line x1={cx - COL_W / 2} x2={cx - COL_W / 2} y1={PAD_T} y2={PAD_T + plotH}
                stroke={C.border} strokeWidth={1} strokeDasharray="4,3" opacity={0.4} />

              {/* Lignes de moyenne par site */}
              {allSiteTemplateStats.map(({ site, tplStats }, si) => {
                const tplData = tplStats.find(t => t.key === tpl.key);
                if (!tplData || tplData.avg <= 0) return null;
                const avgY    = yOf(tplData.avg);
                const offset  = nSites > 1 ? (si - (nSites - 1) / 2) * 14 : 0;
                return (
                  <g key={site.id}>
                    <line x1={cx + offset - 12} x2={cx + offset + 12} y1={avgY} y2={avgY}
                      stroke={site.color} strokeWidth={2.5} strokeLinecap="round" opacity={0.85} />
                  </g>
                );
              })}

              {/* Points (tous sites, jitter commun) */}
              {allPages.map(({ p, site, isBest }, i) => {
                const y      = yOf(p.val);
                const isHov  = hoveredUrl === p.url;
                const b      = Math.round(y / 7);
                const peers  = buckets[b] || [];
                const idx    = peers.indexOf(i);
                const spread = (peers.length - 1) * 6;
                const jx     = peers.length > 1 ? cx - spread / 2 + idx * 6 : cx;
                const r      = isHov ? 7 : isBest ? 5.5 : 3.5;
                return (
                  <g key={p.url + site.id} style={{ cursor: "pointer" }}
                    onMouseEnter={() => onHover(p, tpl.meta, site)}
                    onMouseLeave={() => onHover(null)}>
                    {isBest && <circle cx={jx} cy={y} r={11} fill={site.color} opacity={0.13} />}
                    <circle cx={jx} cy={y} r={r}
                      fill={site.color}
                      opacity={isHov ? 1 : isBest ? 0.9 : 0.5}
                      stroke={isHov || isBest ? site.color : "none"}
                      strokeWidth={isHov ? 2 : 1.5}
                    />
                  </g>
                );
              })}

              {/* Label template */}
              <text x={cx} y={H - PAD_B + 16} fontSize={11}
                fill={tpl.meta.color} textAnchor="middle" fontWeight="700">
                {tpl.meta.icon} {tpl.meta.label}
              </text>
              <text x={cx} y={H - PAD_B + 28} fontSize={9}
                fill={C.textLight} textAnchor="middle">
                {allPages.length} pages
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────

function EmptyState({ icon, title, sub }) {
  return (
    <div style={{ background: C.bg, borderRadius: 12, padding: 32, textAlign: "center" }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: C.textLight }}>{sub}</div>
    </div>
  );
}

// ── Per-page actionable recommendations ──────────────────────────

function generatePageActions(pageSfRow, refSfRow) {
  const actions = [];
  if (!pageSfRow && !refSfRow) return actions;

  // Schema
  const pageSchema = !!(pageSfRow?.["schema type"] || pageSfRow?.["structured data 1"] || pageSfRow?.["schema 1"]);
  const refSchema  = !!(refSfRow?.["schema type"]  || refSfRow?.["structured data 1"]  || refSfRow?.["schema 1"]);
  if (!pageSchema && refSchema) {
    actions.push({ type: "schema", label: "Ajouter du balisage Schema.org", text: "Ajouter du Schema.org (présent sur la référence)" });
  }

  // Words
  const pw = pageSfRow ? safeNum(pageSfRow["nombre de mots"] || pageSfRow["word count"] || 0) : 0;
  const rw = refSfRow  ? safeNum(refSfRow["nombre de mots"]  || refSfRow["word count"]  || 0) : 0;
  if (rw > 0 && pw > 0 && pw < rw * 0.75) {
    actions.push({ type: "words", label: "Enrichir le contenu (volume de mots)", text: `Enrichir le contenu : ${pw} mots → viser ~${Math.round(rw * 0.9)} mots` });
  }

  // Inlinks
  const pi = pageSfRow ? safeNum(pageSfRow["liens entrants uniques"] || 0) : 0;
  const ri = refSfRow  ? safeNum(refSfRow["liens entrants uniques"]  || 0) : 0;
  if (ri > 0 && pi < ri * 0.5) {
    actions.push({ type: "inlinks", label: "Renforcer le maillage interne", text: `Maillage interne : ${Math.round(pi)} lien${pi > 1 ? "s" : ""} → viser ${Math.round(ri * 0.8)} (réf. : ${Math.round(ri)})` });
  }

  // Flesch
  const pf = pageSfRow ? safeNum(pageSfRow["score lisibilité"] || pageSfRow["readability"] || 0) : 0;
  const rf = refSfRow  ? safeNum(refSfRow["score lisibilité"]  || refSfRow["readability"]  || 0) : 0;
  if (rf > 0 && pf > 0 && pf < rf - 15) {
    actions.push({ type: "flesch", label: "Améliorer la lisibilité (score Flesch)", text: `Simplifier la rédaction : Flesch ${Math.round(pf)} → viser ${Math.round(rf)}` });
  }

  // Title length
  const ptl = pageSfRow ? (safeNum(pageSfRow["longueur du title 1"] || pageSfRow["title 1 length"] || 0) || (pageSfRow["title 1"] || "").length) : 0;
  if (ptl > 0 && ptl < 40) {
    actions.push({ type: "title", label: "Optimiser la balise title (trop courte)", text: `Allonger le title : ${ptl} car. → viser 50–65 car.` });
  }

  // Meta description
  const pm = pageSfRow ? (safeNum(pageSfRow["longueur de la meta description 1"] || pageSfRow["meta description 1 length"] || 0) || (pageSfRow["meta description 1"] || "").length) : 0;
  if (pm > 0 && pm < 100) {
    actions.push({ type: "meta", label: "Compléter la meta description", text: `Meta description : ${pm} car. → viser 140–160 car.` });
  }

  return actions;
}

const ACTION_ICONS = { schema: "🔖", words: "📝", inlinks: "🔗", flesch: "📖", title: "🏷️", meta: "📋" };

// ── Main ──────────────────────────────────────────────────────────

export default function TemplateAnalysis({ sites, sfData = {}, gscData = {}, gaData = {}, bingData = {}, smData = {}, pageTypes = {} }) {
  const [selectedSite, setSelectedSite] = useState(() => sites[0]?.id || "");
  const [selectedKpi,  setSelectedKpi]  = useState("bingCitations");
  const [hovered,      setHovered]      = useState(null);
  const [topN,         setTopN]         = useState(8);
  const [openRec,      setOpenRec]      = useState(null);   // url of open accordion
  const [refOverrides, setRefOverrides] = useState({});     // tplKey → url override

  const site   = sites.find(s => s.id === selectedSite) || sites[0];
  const siteId = site?.id || "";
  const kpiDef = KPI_DEFS.find(k => k.key === selectedKpi) || KPI_DEFS[0];
  const ptMap  = pageTypes[siteId] || {};

  const urlData = useMemo(
    () => buildUrlData(
      sfData[siteId]   || [],
      gscData[siteId]  || [],
      gaData[siteId]   || [],
      bingData[siteId] || [],
      smData[siteId]   || [],
    ),
    [siteId, sfData, gscData, gaData, bingData, smData] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const templateStats = useMemo(
    () => buildTemplateStats(urlData, ptMap, selectedKpi, kpiDef),
    [urlData, ptMap, selectedKpi] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const topPages = useMemo(() => {
    return Object.entries(urlData)
      .map(([rawUrl, d]) => {
        const cleanUrl = rawUrl.startsWith("__nosf__") ? rawUrl.slice(8) : rawUrl;
        return { url: cleanUrl, val: d[selectedKpi] ?? 0, tpl: ptMap[cleanUrl] || ptMap[rawUrl], data: d };
      })
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

  // ── SF per-URL lookup ──
  const sfByUrl = useMemo(() => {
    const m = {};
    (sfData[siteId] || []).forEach(r => {
      const url = (r["adresse"] || r["address"] || r["url"] || "").trim();
      if (!url) return;
      m[url] = r;
      // also index by path
      try { m[new URL(url).pathname.replace(/\/+$/, "") || "/"] = r; } catch {}
    });
    return m;
  }, [siteId, sfData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Multi-site data for scatter ──
  const allSiteTemplateStats = useMemo(() => {
    return sites.map(s => {
      const sId   = s.id;
      const ptMap = pageTypes[sId] || {};
      const ud    = buildUrlData(
        sfData[sId] || [], gscData[sId] || [],
        gaData[sId] || [], bingData[sId] || [], smData[sId] || [],
      );
      return { site: s, tplStats: buildTemplateStats(ud, ptMap, selectedKpi, kpiDef) };
    });
  }, [sites, sfData, gscData, gaData, bingData, smData, pageTypes, selectedKpi]); // eslint-disable-line react-hooks/exhaustive-deps

  const allTemplateKeys = useMemo(() => {
    const seen = new Set();
    const out  = [];
    allSiteTemplateStats.forEach(({ tplStats }) => {
      tplStats.forEach(t => {
        if (!seen.has(t.key)) { seen.add(t.key); out.push({ key: t.key, meta: t.meta }); }
      });
    });
    // Sort by total KPI across all sites descending
    return out.sort((a, b) => {
      const totA = allSiteTemplateStats.reduce((s, { tplStats }) => s + (tplStats.find(t => t.key === a.key)?.total || 0), 0);
      const totB = allSiteTemplateStats.reduce((s, { tplStats }) => s + (tplStats.find(t => t.key === b.key)?.total || 0), 0);
      return totB - totA;
    });
  }, [allSiteTemplateStats]);

  // ── Aggregated actions across all recs ──
  const aggregatedActions = useMemo(() => {
    const counts = {};
    recs.forEach(r => {
      const pageSfRow = sfByUrl[r.page.url] || sfByUrl[getPath(r.page.url)];
      const refSfRow  = sfByUrl[r.best.url]  || sfByUrl[getPath(r.best.url)];
      generatePageActions(pageSfRow, refSfRow).forEach(a => {
        if (!counts[a.type]) counts[a.type] = { type: a.type, label: a.label, count: 0 };
        counts[a.type].count++;
      });
    });
    return Object.values(counts).sort((a, b) => b.count - a.count);
  }, [recs, sfByUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Guards after hooks ──
  if (!site) return null;

  const classifiedCount = Object.keys(ptMap).filter(u => ptMap[u] && ptMap[u] !== "home").length;
  const hasAnyData = (gscData[siteId]?.length || gaData[siteId]?.length || smData[siteId]?.length || bingData[siteId]?.length) > 0;
  const totalKpi   = templateStats.reduce((s, t) => s + t.total, 0);
  const winner     = templateStats[0];

  if (!hasAnyData) return (
    <EmptyState icon="📥" title="Aucune donnée source disponible"
      sub="Importez au moins une source : GSC, GA4, Semrush ou Bing AI Performance" />
  );
  if (!classifiedCount) return (
    <EmptyState icon="🏷️" title="Classifiez les templates d'abord"
      sub="Lancez la classification dans ⚙️ Setup → votre site" />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Controls ── */}
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
          {["GSC", "GA4", "Semrush", "Bing AI"].map(src => (
            <optgroup key={src} label={src}>
              {KPI_DEFS.filter(k => k.src === src).map(k => (
                <option key={k.key} value={k.key}>{k.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <span style={{ fontSize: 11, color: C.textLight }}>
          {classifiedCount} pages classifiées · {templateStats.length} templates · accueil & "autre" exclus
        </span>
      </div>

      {/* ── Scatter plot + Priorités d'optimisation ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "start" }}>

        {/* Scatter plot */}
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
          <div style={{ position: "relative", marginBottom: 16, minHeight: 36 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                Positionnement par template — {kpiDef.label} <span style={{ fontWeight: 400, color: C.textLight, fontSize: 11 }}>({kpiDef.src})</span>
              </div>
              <div style={{ fontSize: 11, color: C.textLight, marginTop: 3 }}>
                1 point = 1 page · trait = moyenne · halo = best page · {kpiDef.higher ? "↑ haut = mieux" : "↑ bas = mieux (position)"}
              </div>
            </div>
            <div style={{
              position: "absolute", top: 0, right: 0,
              opacity: hovered ? 1 : 0, pointerEvents: "none", transition: "opacity 0.12s",
              background: hovered ? hovered.site.bg : C.bg,
              border: `1px solid ${hovered ? hovered.site.color + "55" : C.border}`,
              borderRadius: 9, padding: "10px 14px", width: 220,
            }}>
              {hovered && <>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: hovered.site.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: hovered.site.color, textTransform: "uppercase", letterSpacing: 0.6 }}>{hovered.site.label}</span>
                  <span style={{ fontSize: 10, color: C.textLight }}>· {hovered.tplMeta.icon} {hovered.tplMeta.label}</span>
                </div>
                <div style={{ fontSize: 11, color: C.text, wordBreak: "break-all", marginBottom: 5 }}>
                  {getPath(hovered.page.url)}
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: hovered.site.color }}>
                  {kpiDef.fmt(hovered.page.val)}
                  <span style={{ fontSize: 11, fontWeight: 400, color: C.textLight, marginLeft: 5 }}>{kpiDef.label}</span>
                </div>
                {hovered.page.data.title && (
                  <div style={{ fontSize: 10, color: C.textLight, marginTop: 4, fontStyle: "italic" }}>{hovered.page.data.title.slice(0, 65)}</div>
                )}
              </>}
            </div>
          </div>
          <ScatterPlot
            allTemplateKeys={allTemplateKeys}
            allSiteTemplateStats={allSiteTemplateStats}
            kpiDef={kpiDef}
            hoveredUrl={hovered?.page?.url}
            onHover={(page, tplMeta, site) => setHovered(page ? { page, tplMeta, site } : null)}
          />
          {/* Legend */}
          {sites.length > 1 && (
            <div style={{ display: "flex", gap: 18, marginTop: 14, justifyContent: "center", flexWrap: "wrap" }}>
              {sites.map(s => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: s.color }} />
                  <span style={{ fontSize: 11, color: C.textMid, fontWeight: 500 }}>{s.label}</span>
                </div>
              ))}
              <span style={{ fontSize: 10, color: C.textLight }}>· trait = moyenne · halo = best page</span>
            </div>
          )}
          {allTemplateKeys.length === 0 && (
            <div style={{ textAlign: "center", padding: "20px 0", color: C.textLight, fontSize: 12, fontStyle: "italic" }}>
              Aucune page classifiée n'a de données pour <strong>{kpiDef.label}</strong> — essayez un autre KPI
            </div>
          )}
        </div>

        {/* Priorités d'optimisation */}
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>🎯 Priorités d'optimisation</div>
          <div style={{ fontSize: 11, color: C.textLight, marginBottom: 16 }}>
            {recs.length > 0
              ? `Classées par fréquence sur ${recs.length} pages à potentiel`
              : "Aucune page à potentiel détectée pour ce KPI"}
          </div>
          {aggregatedActions.length === 0 && (
            <div style={{ fontSize: 12, color: C.textLight, fontStyle: "italic", textAlign: "center", padding: "20px 0" }}>
              Importez les données SF pour générer les recommandations
            </div>
          )}
          {aggregatedActions.map((a, i) => {
            const pct = aggregatedActions[0]?.count ? Math.round(a.count / aggregatedActions[0].count * 100) : 0;
            const color = i === 0 ? C.red : i === 1 ? C.amber : i <= 3 ? C.blue : C.textLight;
            return (
              <div key={a.type} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: i < aggregatedActions.length - 1 ? `1px solid ${C.borderLight}` : "none" }}>
                <span style={{ fontSize: 18, fontWeight: 900, color: C.textLight, minWidth: 24, lineHeight: 1.3 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text, lineHeight: 1.35, marginBottom: 4 }}>
                    {ACTION_ICONS[a.type] || "•"} {a.label}
                  </div>
                  <div style={{ height: 4, background: C.bg, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width 0.4s" }} />
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}18`, border: `1px solid ${color}33`, padding: "2px 8px", borderRadius: 20, flexShrink: 0 }}>
                  ×{a.count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Template ranking + Top pages ── */}
      {templateStats.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

          {/* Template ranking */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>Templates qui rankent</div>
            <div style={{ fontSize: 11, color: C.textLight, marginBottom: 18 }}>
              Classés par somme de {kpiDef.label} — {kpiDef.src}
            </div>
            {templateStats.map((tpl, i) => {
              const barW = templateStats[0].total ? tpl.total / templateStats[0].total * 100 : 0;
              const share = totalKpi ? Math.round(tpl.total / totalKpi * 100) : 0;
              return (
                <div key={tpl.key} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: C.textLight, minWidth: 20 }}>#{i+1}</span>
                      <span style={{ fontSize: 13 }}>{tpl.meta.icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: tpl.meta.color }}>{tpl.meta.label}</span>
                      <span style={{ fontSize: 10, color: C.textLight }}>{tpl.withVal} p.</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{kpiDef.fmt(tpl.total)}</span>
                      <span style={{ fontSize: 10, color: C.textLight, marginLeft: 5 }}>{share}%</span>
                    </div>
                  </div>
                  <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
                    <div style={{ height: "100%", width: `${barW}%`, background: tpl.meta.color, borderRadius: 3, transition: "width 0.5s" }} />
                  </div>
                  {tpl.best?.val > 0 && (
                    <div style={{ fontSize: 10, color: C.textLight }}>
                      ↗ <a href={tpl.best.url} target="_blank" rel="noreferrer"
                        style={{ color: tpl.meta.color, textDecoration: "none" }}>
                        {getPath(tpl.best.url).slice(0, 45)}
                      </a>
                      {" "}· <strong>{kpiDef.fmt(tpl.best.val)}</strong>
                      <span style={{ color: C.textLight }}> · moy. {kpiDef.fmt(tpl.avg)}</span>
                    </div>
                  )}
                </div>
              );
            })}
            {winner && totalKpi > 0 && (
              <div style={{ marginTop: 16, padding: "11px 14px", background: `${winner.meta.color}0D`, border: `1px solid ${winner.meta.color}28`, borderRadius: 10, fontSize: 12 }}>
                💡 <strong style={{ color: winner.meta.color }}>{winner.meta.icon} {winner.meta.label}</strong> génère{" "}
                {Math.round(winner.total / totalKpi * 100)}% des {kpiDef.label} totaux.{" "}
                <strong>Investissez ce format en priorité.</strong>
              </div>
            )}
          </div>

          {/* Top pages */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>Pages qui rankent</div>
            <div style={{ fontSize: 11, color: C.textLight, marginBottom: 18 }}>
              Modèles à reproduire pour les pages du même template
            </div>
            {topPages.map((p, i) => {
              const tplMeta = PAGE_TYPE_MAP[p.tpl] || { label: p.tpl, color: "#64748B", bg: "#F1F5F9", icon: "❓" };
              return (
                <div key={p.url} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderBottom: i < topPages.length - 1 ? `1px solid ${C.borderLight}` : "none" }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: C.textLight, minWidth: 22, textAlign: "right" }}>{i+1}</span>
                  <span style={{ fontSize: 10, background: tplMeta.bg, color: tplMeta.color, borderRadius: 5, padding: "2px 7px", fontWeight: 600, flexShrink: 0 }}>
                    {tplMeta.icon} {tplMeta.label}
                  </span>
                  <a href={p.url} target="_blank" rel="noreferrer" title={p.data.title || p.url}
                    style={{ flex: 1, fontSize: 11, color: C.blue, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none" }}>
                    {getPath(p.url)}
                  </a>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.text, flexShrink: 0 }}>
                    {kpiDef.fmt(p.val)}
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
      )}

      {/* ── Recommandations ── */}
      {recs.length > 0 && (() => {
        // Group recs by template
        const byTpl = {};
        recs.forEach(r => {
          if (!byTpl[r.tplMeta.key]) byTpl[r.tplMeta.key] = { meta: r.tplMeta, items: [], allBests: [] };
          byTpl[r.tplMeta.key].items.push(r);
        });
        // Collect all candidates for ref override per template
        templateStats.forEach(tpl => {
          if (byTpl[tpl.key]) byTpl[tpl.key].allBests = tpl.pages.filter(p => p.val > 0);
        });

        return (
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>⚡ Pages avec potentiel inexploité</div>
            <div style={{ fontSize: 11, color: C.textLight, marginBottom: 20 }}>
              Pages dont le template performe mieux ailleurs — écart &gt;25% vs la référence du template
            </div>

            {Object.values(byTpl).map(({ meta, items, allBests }) => {
              // Determine active reference (default = best of template, overridable)
              const refUrl     = refOverrides[meta.key] || items[0]?.best?.url || "";
              const refPage    = allBests.find(p => p.url === refUrl) || allBests[0];
              const refSfRow   = refPage ? (sfByUrl[refPage.url] || sfByUrl[getPath(refPage.url)]) : null;

              return (
                <div key={meta.key} style={{ marginBottom: 24 }}>
                  {/* Template group header + ref selector */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: 6, padding: "3px 10px" }}>
                      {meta.icon} {meta.label}
                    </span>
                    <span style={{ fontSize: 11, color: C.textLight }}>{items.length} page{items.length > 1 ? "s" : ""} à optimiser</span>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: C.textLight, flexShrink: 0 }}>📌 Référence :</span>
                      <select
                        value={refUrl}
                        onChange={e => setRefOverrides(prev => ({ ...prev, [meta.key]: e.target.value }))}
                        style={{ fontSize: 11, padding: "4px 8px", border: `1px solid ${meta.color}55`, borderRadius: 6, color: meta.color, background: meta.bg, cursor: "pointer", maxWidth: 260 }}
                      >
                        {allBests.slice(0, 20).map(p => (
                          <option key={p.url} value={p.url}>
                            {getPath(p.url)} — {kpiDef.fmt(p.val)} {kpiDef.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Rec cards */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {items.map((r, ri) => {
                      const pageSfRow  = sfByUrl[r.page.url] || sfByUrl[getPath(r.page.url)];
                      const isOpen     = openRec === (meta.key + "|" + r.page.url);
                      const gapPct     = Math.round(r.gapPct * 100);
                      // Recompute gap vs current refPage (may differ from r.best if overridden)
                      const activeRef  = refPage || r.best;
                      const activeGap  = activeRef ? (kpiDef.higher ? activeRef.val - r.page.val : r.page.val - activeRef.val) : r.gap;
                      const activeGapPct = activeRef?.val ? Math.round(Math.abs(activeGap) / activeRef.val * 100) : gapPct;

                      // SF fields to compare
                      const sfFields = [
                        { label: "Title",        page: pageSfRow ? (safeNum(pageSfRow["longueur du title 1"] || pageSfRow["title 1 length"] || 0) || (pageSfRow["title 1"] || "").length) : null, ref: refSfRow ? (safeNum(refSfRow["longueur du title 1"] || refSfRow["title 1 length"] || 0) || (refSfRow["title 1"] || "").length) : null, unit: "car.", lowerBetter: false },
                        { label: "Meta desc.",   page: pageSfRow ? (safeNum(pageSfRow["longueur de la meta description 1"] || pageSfRow["meta description 1 length"] || 0) || (pageSfRow["meta description 1"] || "").length) : null, ref: refSfRow ? (safeNum(refSfRow["longueur de la meta description 1"] || refSfRow["meta description 1 length"] || 0) || (refSfRow["meta description 1"] || "").length) : null, unit: "car.", lowerBetter: false },
                        { label: "H1",           page: pageSfRow ? (safeNum(pageSfRow["longueur du h1-1"] || pageSfRow["h1-1 length"] || 0) || (pageSfRow["h1-1"] || pageSfRow["h1"] || "").length) : null, ref: refSfRow ? (safeNum(refSfRow["longueur du h1-1"] || refSfRow["h1-1 length"] || 0) || (refSfRow["h1-1"] || refSfRow["h1"] || "").length) : null, unit: "car.", lowerBetter: false },
                        { label: "Mots",         page: pageSfRow ? safeNum(pageSfRow["nombre de mots"] || pageSfRow["word count"] || 0) : null, ref: refSfRow ? safeNum(refSfRow["nombre de mots"] || refSfRow["word count"] || 0) : null, unit: "", lowerBetter: false },
                        { label: "Inlinks",      page: pageSfRow ? safeNum(pageSfRow["liens entrants"] || pageSfRow["inlinks"] || 0) : null, ref: refSfRow ? safeNum(refSfRow["liens entrants"] || refSfRow["inlinks"] || 0) : null, unit: "", lowerBetter: false },
                        { label: "Inlinks uniq.",page: pageSfRow ? safeNum(pageSfRow["liens entrants uniques"] || 0) : null, ref: refSfRow ? safeNum(refSfRow["liens entrants uniques"] || 0) : null, unit: "", lowerBetter: false },
                        { label: "Profondeur",   page: pageSfRow ? getPath(r.page.url).split("/").filter(Boolean).length : null, ref: refPage ? getPath(refPage.url).split("/").filter(Boolean).length : null, unit: "", lowerBetter: true },
                        { label: "Poids page",   page: pageSfRow ? Math.round(safeNum(pageSfRow["taille (octets)"] || pageSfRow["size"] || 0) / 1024) : null, ref: refSfRow ? Math.round(safeNum(refSfRow["taille (octets)"] || refSfRow["size"] || 0) / 1024) : null, unit: "KB", lowerBetter: true },
                        { label: "Schema",       page: pageSfRow ? (pageSfRow["schema type"] || pageSfRow["structured data 1"] ? "✓" : "✗") : null, ref: refSfRow ? (refSfRow["schema type"] || refSfRow["structured data 1"] ? "✓" : "✗") : null, unit: "", lowerBetter: false, isText: true },
                      ].filter(f => f.page !== null || f.ref !== null);

                      return (
                        <div key={r.page.url} style={{ border: `1px solid ${isOpen ? meta.color + "55" : C.border}`, borderRadius: 10, overflow: "hidden", transition: "border-color 0.15s" }}>
                          {/* Card header — clickable */}
                          <div
                            onClick={() => setOpenRec(isOpen ? null : (meta.key + "|" + r.page.url))}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", background: isOpen ? meta.bg : C.white, cursor: "pointer", userSelect: "none" }}
                          >
                            <span style={{ fontSize: 12, color: isOpen ? meta.color : C.textLight, transition: "transform 0.15s", display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none" }}>▶</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {getPath(r.page.url)}
                                </span>
                                <a href={r.page.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                                  title="Ouvrir la page"
                                  style={{ flexShrink: 0, fontSize: 10, color: C.textLight, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px", textDecoration: "none", lineHeight: 1.6, background: C.white }}>
                                  ↗
                                </a>
                              </div>
                              {r.page.data.title && <div style={{ fontSize: 10, color: C.textLight, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.page.data.title}</div>}
                            </div>
                            <div style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
                              <div style={{ textAlign: "right" }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{kpiDef.fmt(r.page.val)}</div>
                                <div style={{ fontSize: 10, color: C.textLight }}>{kpiDef.label}</div>
                              </div>
                              <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, padding: "3px 8px", textAlign: "center" }}>
                                <div style={{ fontSize: 12, fontWeight: 800, color: "#DC2626" }}>−{activeGapPct}%</div>
                                <div style={{ fontSize: 9, color: "#DC2626" }}>vs réf.</div>
                              </div>
                            </div>
                          </div>

                          {/* Accordion body */}
                          {isOpen && (
                            <div style={{ padding: "0 16px 16px", background: C.white, borderTop: `1px solid ${meta.color}22` }}>
                              {/* KPI row */}
                              <div style={{ display: "flex", gap: 8, margin: "12px 0 14px", padding: "10px 12px", background: `${meta.color}06`, borderRadius: 8 }}>
                                <div style={{ flex: 1, textAlign: "center" }}>
                                  <div style={{ fontSize: 10, color: C.textLight, marginBottom: 2 }}>Cette page</div>
                                  <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>{kpiDef.fmt(r.page.val)}</div>
                                  <div style={{ fontSize: 10, color: C.textLight }}>{kpiDef.label}</div>
                                </div>
                                <div style={{ width: 1, background: C.border }} />
                                <div style={{ flex: 1, textAlign: "center" }}>
                                  <div style={{ fontSize: 10, color: C.textLight, marginBottom: 2 }}>Référence</div>
                                  <div style={{ fontSize: 18, fontWeight: 800, color: meta.color }}>{activeRef ? kpiDef.fmt(activeRef.val) : "—"}</div>
                                  <div style={{ fontSize: 10, color: C.textLight }}>{kpiDef.label}</div>
                                </div>
                                <div style={{ width: 1, background: C.border }} />
                                <div style={{ flex: 1, textAlign: "center" }}>
                                  <div style={{ fontSize: 10, color: C.textLight, marginBottom: 2 }}>Écart</div>
                                  <div style={{ fontSize: 18, fontWeight: 800, color: "#DC2626" }}>{activeGap > 0 ? "+" : ""}{kpiDef.fmt(Math.abs(activeGap))}</div>
                                  <div style={{ fontSize: 10, color: "#DC2626" }}>potentiel</div>
                                </div>
                              </div>

                              {/* Actions recommandées */}
                              {(() => {
                                const actions = generatePageActions(pageSfRow, refSfRow);
                                if (!actions.length) return null;
                                return (
                                  <div style={{ marginBottom: 14 }}>
                                    <div style={{ fontSize: 10, fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>⚡ Actions recommandées</div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                      {actions.map((a, ai) => (
                                        <div key={ai} style={{ display: "flex", alignItems: "center", gap: 8, background: "#ECFDF5", border: "1px solid #BBF7D0", borderRadius: 8, padding: "8px 12px" }}>
                                          <span style={{ fontSize: 14, flexShrink: 0 }}>{ACTION_ICONS[a.type] || "•"}</span>
                                          <span style={{ fontSize: 12, color: "#065F46", fontWeight: 500, lineHeight: 1.4 }}>{a.text}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* SF comparison table */}
                              {sfFields.length > 0 ? (
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>🕷️ Comparaison Screaming Frog</div>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "0", border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                                    {/* Header */}
                                    {["Métrique", "Cette page", "Référence", "Delta"].map(h => (
                                      <div key={h} style={{ padding: "6px 10px", background: C.bg, fontSize: 10, fontWeight: 600, color: C.textLight, borderBottom: `1px solid ${C.border}` }}>{h}</div>
                                    ))}
                                    {sfFields.map((f, fi) => {
                                      const hasBoth  = f.page !== null && f.ref !== null && !f.isText;
                                      const numPage  = hasBoth ? parseFloat(f.page) : null;
                                      const numRef   = hasBoth ? parseFloat(f.ref)  : null;
                                      const delta    = hasBoth ? numPage - numRef : null;
                                      const isGood   = delta === null ? null : (f.lowerBetter ? delta < 0 : delta > 0);
                                      const isNeutral= delta === null || delta === 0;
                                      const even     = fi % 2 === 0;
                                      const bg       = even ? C.white : "#FAFAFA";
                                      return [
                                        <div key={f.label+"l"} style={{ padding: "7px 10px", fontSize: 11, color: C.textLight, background: bg, borderBottom: `1px solid ${C.borderLight}` }}>{f.label}</div>,
                                        <div key={f.label+"p"} style={{ padding: "7px 10px", fontSize: 12, fontWeight: 600, color: C.text, background: bg, borderBottom: `1px solid ${C.borderLight}` }}>
                                          {f.page !== null ? `${f.page}${f.unit}` : "—"}
                                        </div>,
                                        <div key={f.label+"r"} style={{ padding: "7px 10px", fontSize: 12, fontWeight: 600, color: meta.color, background: bg, borderBottom: `1px solid ${C.borderLight}` }}>
                                          {f.ref !== null ? `${f.ref}${f.unit}` : "—"}
                                        </div>,
                                        <div key={f.label+"d"} style={{ padding: "7px 10px", fontSize: 11, fontWeight: 700, background: bg, borderBottom: `1px solid ${C.borderLight}`,
                                          color: isNeutral ? C.textLight : isGood ? "#16A34A" : "#DC2626" }}>
                                          {delta === null || f.isText ? (f.page === f.ref ? "=" : f.page !== null && f.ref !== null ? "≠" : "—") : delta === 0 ? "=" : `${delta > 0 ? "+" : ""}${Math.round(delta)}${f.unit}`}
                                        </div>,
                                      ];
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic", textAlign: "center", padding: "12px 0" }}>
                                  Pas de données SF pour ces pages — importez un CSV Screaming Frog
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}