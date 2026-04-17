import { safeNum, toUrlPath, pearson } from "./helpers";
import { gscVal } from "./parsers";

// ── URL map builder — call ONCE per matrix computation ──────────
export function buildUrlMaps(gscRows, gaRows, bingRows) {
  const toFull = (raw) => (raw || "").trim().toLowerCase().replace(/\/+$/, "") || "/";
  const buildMap = (rows, ...keys) => {
    const pathMap = {}, fullMap = {};
    for (const r of rows) {
      const raw = keys.map(k => r[k]).find(v => v) || "";
      const p = toUrlPath(raw), f = toFull(raw);
      if (!pathMap[p]) pathMap[p] = r;
      if (!fullMap[f])  fullMap[f] = r;
    }
    return { pathMap, fullMap };
  };
  return {
    gsc:  buildMap(gscRows,  "pages les plus populaires", "page", "adresse", "address", "url"),
    ga:   buildMap(gaRows,   "page", "pagepath", "page path", "adresse", "url"),
    bing: buildMap(bingRows, "url", "page", "adresse", "address"),
  };
}

// ── Pre-extract per-page SF values for ALL dims at once ─────────
export function buildSfPageVectors(sfRows) {
  const toFull = (raw) => (raw || "").trim().toLowerCase().replace(/\/+$/, "") || "/";
  const pages = [];
  for (const r of sfRows) {
    const ct = (r["type de contenu"] || r["content type"] || "").toLowerCase();
    const sc = safeNum(r["code http"] || r["status code"] || 200);
    const isHtml = ct.includes("html") || (ct === "" && (r["title 1"] || r["h1-1"] || r["h1"] || "").trim() !== "");
    if (!isHtml || sc >= 400) continue;
    const sfRaw = r["adresse"] || r["address"] || r["url"] || "";
    let hasTable = false;
    for (let i = 1; i <= 18; i++) {
      const v = r[`présence table ${i}`] || r[`presence table ${i}`] || "";
      if (v && v.trim() !== "" && v.trim() !== "0") { hasTable = true; break; }
    }
    const jsons = [r["json 1"], r["json 2"], r["json 3"], r["json 4"], r["json 5"]].filter(Boolean).join(" ");
    pages.push({
      path:            toUrlPath(sfRaw),
      full:            toFull(sfRaw),
      avgTitleLen:     safeNum(r["longueur du title 1"]              || r["title 1 length"]              || 0) || (r["title 1"] || "").length,
      avgMetaLen:      safeNum(r["longueur de la meta description 1"]|| r["meta description 1 length"]   || 0) || (r["meta description 1"] || "").length,
      avgH1Len:        safeNum(r["longueur du h1-1"]                 || r["h1-1 length"]                 || 0) || (r["h1-1"] || r["h1"] || "").trim().length,
      avgWords:        safeNum(r["nombre de mots"]                   || r["word count"]                  || 0),
      avgPageSizeKB:   safeNum(r["taille (octets)"]                  || r["size"]                        || 0) / 1024,
      avgInlinks:      safeNum(r["liens entrants"]                   || r["inlinks"]                     || 0),
      avgOutlinks:     safeNum(r["liens sortants"]                   || r["outlinks"]                    || 0),
      avgInlinksUniq:  safeNum(r["liens entrants uniques"]           || 0),
      avgOutlinksUniq: safeNum(r["liens sortants uniques"]           || 0),
      avgExtLinksUniq: safeNum(r["liens sortants externes uniques"]  || 0),
      avgDepth:        safeNum(r["crawl profondeur"]                 || r["crawl depth"]                 || 0),
      avgFlesch:       safeNum(r["score de lisibilité de flesch"]    || r["flesch reading ease"]         || 0),
      tableRate:       hasTable ? 1 : 0,
      schemaRate:      jsons.length > 0 ? 1 : 0,
      errorRate:       0, redirectRate: 0, totalPages: 0, avgImgSizeKB: 0,
    });
  }
  return pages;
}

// ── Compute one Pearson correlation from pre-built vectors+maps ──
export function intraCorrFast(sfPages, urlMaps, dimKey, kpiKey) {
  if (!sfPages.length) return null;
  const { gsc, ga, bing } = urlMaps;
  const lookup = ({ pathMap, fullMap }, path, full) => pathMap[path] || fullMap[full] || null;
  const sfVals = [], resVals = [];
  for (const p of sfPages) {
    const sfVal = p[dimKey];
    if (sfVal === undefined) continue;
    const gscR  = lookup(gsc,  p.path, p.full);
    const gaR   = lookup(ga,   p.path, p.full);
    const bingR = lookup(bing, p.path, p.full);
    let resVal = null;
    if      (kpiKey === "clicks")      { if (gscR)  resVal = safeNum(gscVal(gscR, "clics", "clicks") || 0); }
    else if (kpiKey === "impressions") { if (gscR)  resVal = safeNum(gscVal(gscR, "impressions") || 0); }
    else if (kpiKey === "ctr")         { if (gscR)  resVal = safeNum(String(gscVal(gscR, "ctr") || "0").replace("%", "")); }
    else if (kpiKey === "position")    { if (gscR)  resVal = safeNum(gscVal(gscR, "position") || 0); }
    else if (kpiKey === "sessions")    { if (gaR)   resVal = safeNum(gaR["sessions"]  || gaR["ga4 sessions"] || 0); }
    else if (kpiKey === "views")       { if (gaR)   resVal = safeNum(gaR["views"]     || gaR["ga4 views"]    || 0); }
    else if (kpiKey === "geoMentions") { if (bingR) resVal = safeNum(bingR["citations"] || bingR["mentions"] || 0); }
    if (resVal !== null) { sfVals.push(sfVal); resVals.push(resVal); }
  }
  if (sfVals.length < 5) return null;
  return { value: pearson(sfVals, resVals), n: sfVals.length };
}

// ── SEMRUSH INTRA-PAGE CORRELATION ──────────────────────────────
// smRows: [{url, kwCount, top3, top10, opps, traffic, avgPos}]
// urlMaps: output of buildUrlMaps
// dimKey: 'smKwCount' | 'smTop3' | etc.
// kpiKey: 'clicks' | 'impressions' | etc.
export function smIntraCorr(smRows, urlMaps, dimKey, kpiKey) {
  const smKeyMap = {
    smKwCount: 'kwCount', smTop3: 'top3', smTop10: 'top10',
    smOpps: 'opps', smTraffic: 'traffic', smAvgPos: 'avgPos',
  };
  const smField = smKeyMap[dimKey];
  if (!smField) return null;
  const kpiMap = urlMaps[kpiKey] || {};

  const xs = [], ys = [];
  for (const r of smRows) {
    if (!r.url) continue;
    const path = r.url.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || '/';
    const y = kpiMap[path];
    if (y !== undefined && y !== null) {
      xs.push(r[smField] ?? 0);
      ys.push(y);
    }
  }
  if (xs.length < 5) return { value: null, n: xs.length };
  const n = xs.length;
  const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
  const num = xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0);
  const den = Math.sqrt(xs.reduce((s,x)=>s+(x-mx)**2,0)*ys.reduce((s,y)=>s+(y-my)**2,0));
  return { value: den === 0 ? null : Math.round(num/den*100)/100, n };
}
// ── SF × Fan-out URL correlation ─────────────────────────────────
// sfPages: output of buildSfPageVectors
// fanoutMap: { normalizedUrl → { source: n, answer: n } }
// dimKey: SF dim key (avgWords, schemaRate, etc.)
// kpiKey: "fanoutSource" | "fanoutAnswer"
export function sfFanoutCorr(sfPages, fanoutMap, dimKey, kpiKey) {
  const xs = [], ys = [];
  for (const p of sfPages) {
    const sfVal = p[dimKey];
    if (sfVal === undefined || sfVal === null) continue;
    const fan = fanoutMap[p.full] || fanoutMap[p.path];
    if (!fan) continue;
    const kpiVal = kpiKey === "fanoutSource" ? (fan.source || 0) : (fan.answer || 0);
    xs.push(sfVal);
    ys.push(kpiVal);
  }
  if (xs.length < 5) return null;
  return { value: pearson(xs, ys), n: xs.length };
}

// ── URL-level cross correlation (GSC/GA × Bing/Fan-out) ──────────
// urlMaps: output of buildUrlMaps
// fanoutMap: { normalizedUrl → { source: n, answer: n } }
// dimSrc: "gsc" | "ga"
// dimKey: "clicks"|"impressions"|"ctr"|"position"|"sessions"|"views"
// kpiKey: "geoMentions"|"fanoutSource"|"fanoutAnswer"
export function urlXCorr(urlMaps, fanoutMap, dimSrc, dimKey, kpiKey) {
  const { gsc, ga, bing } = urlMaps;
  const dimMaps = dimSrc === "gsc" ? gsc : ga;
  if (!dimMaps) return null;

  const xs = [], ys = [];
  // Iterate over both path and full maps, deduplicate by url key
  const seen = new Set();
  const processRow = (r, url) => {
    if (seen.has(url)) return;
    seen.add(url);

    let dimVal = null;
    if      (dimKey === "clicks")      dimVal = safeNum(gscVal(r, "clics", "clicks") || 0);
    else if (dimKey === "impressions") dimVal = safeNum(gscVal(r, "impressions") || 0);
    else if (dimKey === "ctr")         dimVal = safeNum(String(gscVal(r, "ctr") || "0").replace("%", ""));
    else if (dimKey === "position")    dimVal = safeNum(gscVal(r, "position") || 0);
    else if (dimKey === "sessions")    dimVal = safeNum(r["sessions"]  || r["ga4 sessions"] || 0);
    else if (dimKey === "views")       dimVal = safeNum(r["views"]     || r["ga4 views"]    || 0);
    if (dimVal === null || isNaN(dimVal)) return;

    let kpiVal = null;
    if (kpiKey === "geoMentions") {
      const bingR = bing?.pathMap?.[url] || bing?.fullMap?.[url];
      if (bingR) kpiVal = safeNum(bingR["citations"] || bingR["mentions"] || 0);
    } else {
      const fan = fanoutMap[url];
      if (fan) kpiVal = kpiKey === "fanoutSource" ? (fan.source || 0) : (fan.answer || 0);
    }
    if (kpiVal !== null) { xs.push(dimVal); ys.push(kpiVal); }
  };

  Object.entries(dimMaps.pathMap || {}).forEach(([url, r]) => processRow(r, url));
  Object.entries(dimMaps.fullMap || {}).forEach(([url, r]) => processRow(r, url));

  if (xs.length < 5) return null;
  return { value: pearson(xs, ys), n: xs.length };
}