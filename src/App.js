import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Legend } from "recharts";

// ── PALETTE ─────────────────────────────────────────────────────
const C = {
  bg: "#FAFAFA", white: "#FFFFFF", border: "#E8E8ED", borderLight: "#F0F0F5",
  text: "#0D0D14", textMid: "#4A4A5A", textLight: "#9090A0",
  blue: "#2563EB", blueLight: "#EFF6FF",
  green: "#059669", greenLight: "#ECFDF5",
  amber: "#D97706", amberLight: "#FFFBEB",
  red: "#DC2626", redLight: "#FEF2F2",
  purple: "#7C3AED", purpleLight: "#F5F3FF",
  teal: "#0891B2", tealLight: "#ECFEFF",
};

const SITES = [
  { id: "wedig", label: "wedig.fr",      color: "#2563EB", bg: "#EFF6FF" },
  { id: "deux",  label: "deux.io",       color: "#059669", bg: "#ECFDF5" },
  { id: "lets",  label: "lets-clic.com", color: "#7C3AED", bg: "#F5F3FF" },
];

// ── SF DIMENSIONS ───────────────────────────────────────────────
const SF_DIMS = [
  { key: "avgTitleLen",     label: "Longueur moy. title (car.)", higher: true  },
  { key: "avgMetaLen",      label: "Longueur moy. meta (car.)",  higher: true  },
  { key: "avgH1Len",        label: "Longueur moy. H1 (car.)",    higher: true  },
  { key: "avgWords",        label: "Mots moyens / page",         higher: true  },
  { key: "avgPageSizeKB",   label: "Poids pages contenu (KB)",   higher: false },
  { key: "avgImgSizeKB",    label: "Poids moyen images (KB)",    higher: false },
  { key: "avgInlinks",      label: "Liens entrants moy.",        higher: true  },
  { key: "avgOutlinks",     label: "Liens sortants moy.",        higher: true  },
  { key: "avgDepth",        label: "Profondeur crawl moy.",      higher: false },
  { key: "avgFlesch",       label: "Score Flesch moy.",          higher: true  },
  { key: "tableRate",       label: "Pages avec tableau (%)",     higher: true  },
  { key: "schemaRate",      label: "Pages avec Schema (%)",      higher: true  },
  { key: "errorRate",       label: "Taux d'erreurs (%)",         higher: false },
  { key: "redirectRate",    label: "Taux redirections (%)",      higher: false },
  { key: "totalPages",      label: "Nb pages crawlées",          higher: true  },
];


// ── SF TOOLTIPS ──────────────────────────────────────────────────
const SF_TOOLTIPS = {
  "Title OK":      "% de pages dont le title est entre 30 et 65 caractères. En dessous : trop court, peu descriptif. Au-dessus : tronqué par Google.",
  "Meta OK":       "% de pages dont la meta description est entre 100 et 160 caractères. Hors de cette plage, Google peut réécrire ou ignorer la meta.",
  "H1 OK":         "% de pages avec un H1 renseigné. Le H1 est le titre principal de la page, il doit être unique et présent sur chaque page.",
  "Mots moy.":     "Nombre moyen de mots par page HTML. Un contenu plus riche (500+ mots) favorise généralement le positionnement SEO et la compréhension par les LLMs.",
  "Poids pages":   "Poids moyen des pages HTML en Ko (HTML + CSS + JS). Des pages légères (<500KB) améliorent le Core Web Vitals et l'expérience mobile.",
  "Poids images":  "Poids moyen des ressources images en Ko. Les images lourdes ralentissent le chargement. Idéalement < 100KB par image en moyenne.",
  "Inlinks":       "Nombre moyen de liens internes entrants par page. Un maillage interne dense améliore la diffusion du PageRank et la découverte des pages.",
  "Outlinks":      "Nombre moyen de liens sortants par page (internes + externes). Un trop grand nombre peut diluer l'autorité de la page.",
  "Profondeur":    "Profondeur de crawl moyenne. Les pages trop profondes (> 4 clics depuis la home) sont moins bien indexées et moins visitées.",
  "Flesch":        "Score de lisibilité Flesch-Kincaid (0-100). Plus le score est élevé, plus le texte est facile à lire. Idéalement > 60 pour du contenu grand public.",
  "Tableaux":      "% de pages contenant au moins un tableau HTML. Les tableaux structurent les données et favorisent l'apparition en rich snippets et réponses GEO.",
  "Schemas":       "% de pages avec au moins un schema JSON-LD. Les schemas aident Google et les LLMs à comprendre le type et le contenu de la page.",
  "Erreurs":       "% de pages retournant un code HTTP 4xx (404, 403…). Ces erreurs nuisent à l'expérience utilisateur et au crawl budget.",
  "Redirects":     "% d'URLs retournant un code 3xx (301, 302…). Les redirections consomment du crawl budget et peuvent diluer le PageRank.",
};

// ── TOOLTIP COMPONENT ────────────────────────────────────────────
function MetricRow({ label, value }) {
  const [show, setShow] = useState(false);
  const tip = SF_TOOLTIPS[label];
  return (
    <div
      key={label}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: show && tip ? "#F0F4FF" : C.bg, borderRadius: 5, cursor: tip ? "help" : "default", transition: "background 0.15s" }}
    >
      <span style={{ fontSize: 11, color: C.textMid, display: "flex", alignItems: "center", gap: 4 }}>
        {label}
        {tip && <span style={{ fontSize: 9, color: C.textLight, border: `1px solid ${C.border}`, borderRadius: "50%", width: 13, height: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", fontStyle: "normal" }}>?</span>}
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{value}</span>
      {show && tip && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 200,
          background: C.text, color: "#fff", fontSize: 11, lineHeight: 1.5,
          padding: "8px 12px", borderRadius: 8, width: 240,
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          pointerEvents: "none",
        }}>
          {tip}
          <div style={{ position: "absolute", bottom: -5, left: 16, width: 10, height: 10, background: C.text, transform: "rotate(45deg)", borderRadius: 2 }} />
        </div>
      )}
    </div>
  );
}

// ── RESULT KPIs ─────────────────────────────────────────────────
const RES_KPIS = [
  { key: "clicks",          label: "Clics GSC",             src: "gsc"  },
  { key: "impressions",     label: "Impressions GSC",       src: "gsc"  },
  { key: "ctr",             label: "CTR (%)",               src: "gsc"  },
  { key: "position",        label: "Position moy.",         src: "gsc"  },
  { key: "sessions",  label: "Sessions GA4",  src: "ga" },
  { key: "views",     label: "Vues GA4",      src: "ga" },
  { key: "geoMentions",     label: "Citations Bing AI",     src: "bing" },
];

// ── PAGE SCORING MODES ──────────────────────────────────────────
const PAGE_MODES = [
  { key: "all",  label: "Toutes les pages",           icon: "📄" },
  { key: "geo",  label: "Top succès GEO (Bing)",      icon: "🤖" },
  { key: "seo",  label: "Top succès SEO (GSC)",       icon: "🔍" },
];

// Schema types to detect
const SCHEMA_TYPES = [
  "Article", "BlogPosting", "Product", "Offer", "FAQPage",
  "BreadcrumbList", "Organization", "LocalBusiness", "WebPage",
  "Service", "Event", "Person", "Review", "HowTo",
];

// ── HELPERS ─────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const raw = lines[0];
  const sep = raw.includes("\t") ? "\t" : ",";
  const headers = raw.split(sep).map(h => h.trim().replace(/^["']|["']$/g, "").toLowerCase());
  return lines.slice(1).map(line => {
    const vals = line.split(sep).map(v => v.trim().replace(/^["']|["']$/g, ""));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
}


// ── INTRA-SITE CORRELATION (page-level) ─────────────────────────
function intraCorr(sfRows, gscRows, gaRows, bingRows, dimKey, kpiKey) {
  if (!sfRows.length) return null;

  // Build URL-keyed map from GSC / GA4 / Bing
  const gscMap = {};
  for (const r of gscRows) {
    const url = (r["page"] || r["adresse"] || r["address"] || r["url"] || "").trim().toLowerCase();
    if (url) gscMap[url] = r;
  }
  const gaMap = {};
  for (const r of gaRows) {
    const url = (r["page"] || r["pagepath"] || r["page path"] || r["adresse"] || r["url"] || "").trim().toLowerCase();
    if (url) gaMap[url] = r;
  }
  const bingMap = {};
  for (const r of bingRows) {
    const url = (r["url"] || r["page"] || r["adresse"] || r["address"] || "").trim().toLowerCase();
    if (url) bingMap[url] = r;
  }

  const sfVals  = [];
  const resVals = [];

  for (const r of sfRows) {
    const url = (r["adresse"] || r["address"] || r["url"] || "").trim().toLowerCase();
    const ct  = (r["type de contenu"] || r["content type"] || "").toLowerCase();
    const sc  = safeNum(r["code http"] || r["status code"] || 200);
    if ((!ct.includes("html") && ct !== "") || sc >= 400) continue;

    // SF dim value for this page
    let sfVal = 0;
    if (dimKey === "avgTitleLen") {
      sfVal = safeNum(r["longueur du title 1"] || r["title 1 length"] || 0) || (r["title 1"] || "").length;
    } else if (dimKey === "avgMetaLen") {
      sfVal = safeNum(r["longueur de la meta description 1"] || r["meta description 1 length"] || 0) || (r["meta description 1"] || "").length;
    } else if (dimKey === "avgH1Len") {
      sfVal = (r["h1-1"] || r["h1"] || "").trim().length;
    } else if (dimKey === "avgWords")      { sfVal = safeNum(r["nombre de mots"]   || r["word count"]  || 0); }
    else if (dimKey === "avgPageSizeKB")   { sfVal = safeNum(r["taille (octets)"]  || r["size"]        || 0) / 1024; }
    else if (dimKey === "avgInlinks")      { sfVal = safeNum(r["liens entrants"]   || r["inlinks"]     || 0); }
    else if (dimKey === "avgOutlinks")     { sfVal = safeNum(r["liens sortants"]   || r["outlinks"]    || 0); }
    else if (dimKey === "avgDepth")        { sfVal = safeNum(r["crawl profondeur"] || r["crawl depth"] || 0); }
    else if (dimKey === "avgFlesch")       { sfVal = safeNum(r["score de lisibilité de flesch"] || r["flesch reading ease"] || 0); }
    else if (dimKey === "tableRate") {
      let has = false;
      for (let i = 1; i <= 18; i++) { const v = r[`présence table ${i}`] || r[`presence table ${i}`] || ""; if (v && v.trim() !== "" && v.trim() !== "0") { has = true; break; } }
      sfVal = has ? 1 : 0;
    } else if (dimKey === "schemaRate") {
      const jsons = [r["json 1"],r["json 2"],r["json 3"],r["json 4"],r["json 5"]].filter(Boolean).join(" ");
      sfVal = jsons.length > 0 ? 1 : 0;
    } else { continue; }

    // KPI value for this page
    let resVal = null;
    const gscR = gscMap[url];
    const gaR  = gaMap[url];
    if (kpiKey === "clicks")      resVal = gscR ? safeNum(gscR["clics"]         || gscR["clicks"]      || 0) : null;
    else if (kpiKey === "impressions") resVal = gscR ? safeNum(gscR["impressions"] || 0) : null;
    else if (kpiKey === "ctr")    resVal = gscR ? safeNum(gscR["ctr"]            || 0) : null;
    else if (kpiKey === "position") resVal = gscR ? safeNum(gscR["position"]     || 0) : null;
    else if (kpiKey === "sessions") resVal = gaR  ? safeNum(gaR["sessions"]      || gaR["ga4 sessions"] || 0) : null;
    else if (kpiKey === "views")  resVal = gaR  ? safeNum(gaR["views"]           || gaR["ga4 views"]    || 0) : null;
    else if (kpiKey === "geoMentions") {
      const bingR = bingMap[url];
      resVal = bingR ? safeNum(bingR["citations"] || bingR["mentions"] || 0) : null;
    }
    else resVal = null;

    if (resVal !== null) {
      sfVals.push(sfVal);
      resVals.push(resVal);
    }
  }

  return sfVals.length >= 5 ? pearson(sfVals, resVals) : null;
}

// ── SUPABASE CONFIG ──────────────────────────────────────────────
const PROXY = "/api/supabase";

async function sbUpload(path, csvText) {
  const res = await fetch(`${PROXY}/storage/v1/object/csv-imports/${path}`, {
    method: "POST",
    headers: { "Content-Type": "text/csv", "x-upsert": "true" },
    body: csvText,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return path;
}

async function sbInsertImport({ site_id, source, filename, storage_path, row_count }) {
  const res = await fetch(`${PROXY}/rest/v1/imports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "return=representation" },
    body: JSON.stringify({ site_id, source, filename, storage_path, row_count }),
  });
  if (!res.ok) throw new Error(`Insert failed: ${res.status}`);
  return res.json();
}

async function sbGetHistory(limit = 50) {
  const res = await fetch(`${PROXY}/rest/v1/imports?select=*&order=uploaded_at.desc&limit=${limit}`);
  if (!res.ok) throw new Error(`Fetch history failed: ${res.status}`);
  return res.json();
}

async function sbGetLatest() {
  // Get latest import per site+source
  const res = await fetch(`${PROXY}/rest/v1/imports?select=*&order=uploaded_at.desc&limit=200`);
  if (!res.ok) return {};
  const rows = await res.json();
  const latest = {};
  for (const row of rows) {
    const key = `${row.site_id}_${row.source}`;
    if (!latest[key]) latest[key] = row;
  }
  return latest;
}

async function sbDownload(storage_path) {
  const res = await fetch(`${PROXY}/storage/v1/object/csv-imports/${storage_path}`);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.text();
}

function safeNum(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}
function avg(arr) {
  const n = arr.filter(x => x > 0);
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0;
}
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = avg(xs), my = avg(ys);
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const dx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
  if (!dx || !dy) return null;
  return Math.round((num / (dx * dy)) * 100) / 100;
}

// ── FILTER ROWS BY PAGE MODE ─────────────────────────────────────
function filterByMode(rows, mode, bingRows, gscRows = []) {
  if (mode === "all") return rows;

  if (mode === "geo") {
    // Pages présentes dans Bing avec au moins 1 citation
    const bingUrls = new Set(
      bingRows
        .filter(r => safeNum(r["citations"] || r["mentions"] || 0) >= 1)
        .map(r => (r["page"] || r["url"] || r["adresse"] || "").toLowerCase().trim())
    );
    if (bingUrls.size === 0) return rows; // fallback si pas de data Bing
    return rows.filter(r => {
      const url = (r["adresse"] || r["address"] || r["url"] || "").toLowerCase().trim();
      return bingUrls.has(url);
    });
  }

  if (mode === "seo") {
    // Priorité : clics dans SF, sinon croiser avec fichier GSC séparé
    const sfWithClics = rows.filter(r => safeNum(r["clics"] || r["clicks"] || 0) > 0);

    if (sfWithClics.length > 0) {
      // SF contient les clics GSC — top 30%
      const sorted = [...sfWithClics].sort((a, b) =>
        safeNum(b["clics"] || b["clicks"]) - safeNum(a["clics"] || a["clicks"])
      );
      const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.3)));
      const topUrls = new Set(top.map(r => (r["adresse"] || r["address"] || r["url"] || "").toLowerCase().trim()));
      return rows.filter(r => {
        const url = (r["adresse"] || r["address"] || r["url"] || "").toLowerCase().trim();
        return topUrls.has(url);
      });
    }

    if (gscRows.length > 0) {
      // GSC séparé — on croise les URLs par top 30% de clics
      const gscWithClics = gscRows.filter(r => safeNum(r["clics"] || r["clicks"] || 0) > 0);
      if (gscWithClics.length === 0) return rows;
      const sorted = [...gscWithClics].sort((a, b) =>
        safeNum(b["clics"] || b["clicks"]) - safeNum(a["clics"] || a["clicks"])
      );
      const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.3)));
      const topUrls = new Set(
        top.map(r => (r["adresse"] || r["address"] || r["url"] || r["page"] || r["keys"] || "").toLowerCase().trim())
      );
      return rows.filter(r => {
        const url = (r["adresse"] || r["address"] || r["url"] || "").toLowerCase().trim();
        return topUrls.has(url);
      });
    }

    // Aucune donnée GSC disponible — retourne rien plutôt que tout
    return [];
  }

  return rows;
}

// ── DETECT SCHEMA TYPES ─────────────────────────────────────────
function detectSchemas(jsonStr) {
  if (!jsonStr) return [];
  const found = [];
  SCHEMA_TYPES.forEach(type => {
    if (jsonStr.toLowerCase().includes(`"@type":"${type.toLowerCase()}`) ||
        jsonStr.toLowerCase().includes(`"@type": "${type.toLowerCase()}`)) {
      found.push(type);
    }
  });
  return found;
}

// ── EXTRACT SF ──────────────────────────────────────────────────
function extractSF(rows, mode = "all", bingRows = [], gscRows = []) {
  if (!rows.length) return null;

  const filtered = filterByMode(rows, mode, bingRows, gscRows);

  const html = filtered.filter(r => {
    const ct = (r["type de contenu"] || r["content type"] || r["type"] || "").toLowerCase();
    const sc = safeNum(r["code http"] || r["status code"] || r["statuscode"] || 200);
    return (ct.includes("html") || ct === "") && sc < 400;
  });
  const total = html.length || 1;
  const allTotal = filtered.length || 1;

  // Title — longueur moyenne (pages HTML avec un title renseigné)
  const titleLens = html.map(r => safeNum(r["longueur du title 1"] || r["title 1 length"] || 0) || (r["title 1"] || "").length).filter(l => l > 0);

  // Meta — longueur moyenne (pages avec meta)
  const metaLens = html.map(r => safeNum(r["longueur de la meta description 1"] || r["meta description 1 length"] || 0) || (r["meta description 1"] || "").length).filter(l => l > 0);

  // H1 — longueur moyenne (pages avec H1)
  const h1Lens = html.map(r => (r["h1-1"] || r["h1"] || "").trim().length).filter(l => l > 0);

  // Content page weight (HTML pages only)
  const pageSizes = html.map(r => safeNum(r["taille (octets)"] || r["size"] || 0));

  // Image weight — rows where content type includes "image"
  const imgRows = filtered.filter(r => {
    const ct = (r["type de contenu"] || r["content type"] || r["type"] || "").toLowerCase();
    return ct.includes("image");
  });
  const imgSizes = imgRows.map(r => safeNum(r["taille (octets)"] || r["size"] || 0));

  // Mots — HTML uniquement, exclure 0
  const words  = html.map(r => safeNum(r["nombre de mots"]   || r["word count"]  || 0)).filter(x => x > 0);

  // Inlinks / Outlinks — HTML uniquement
  const inlk   = html.map(r => safeNum(r["liens entrants"]   || r["inlinks"]     || 0));
  const outlk  = html.map(r => safeNum(r["liens sortants"]   || r["outlinks"]    || 0));

  // Profondeur — HTML uniquement, exclure les pages à profondeur 0 (home)
  const depth  = html.map(r => safeNum(r["crawl profondeur"] || r["crawl depth"] || 0)).filter(x => x >= 0);

  // Flesch — HTML uniquement, exclure 0 (pages sans score)
  const flesch = html.map(r => safeNum(r["score de lisibilité de flesch"] || r["flesch reading ease"] || 0)).filter(x => x > 0);

  // Indexabilité — pages HTML indexables
  const indexable = html.filter(r => {
    const idx = (r["indexabilité"] || r["indexability"] || r["indexable"] || "").toLowerCase();
    return idx === "indexable" || idx === "" || idx === "true";
  }).length;
  const totalImg = imgRows.length;

  // Tables — colonnes "Présence Table 1" à "Présence Table 18"
  const withTable = html.filter(r => {
    for (let i = 1; i <= 18; i++) {
      const val = r[`présence table ${i}`] || r[`presence table ${i}`] || r[`table ${i}`] || "";
      if (val && val.trim() !== "" && val.trim() !== "0") return true;
    }
    return false;
  }).length;

  // Schemas — colonnes JSON 1..5
  const schemaTypes = {};
  const withSchema = html.filter(r => {
    const jsons = [r["json 1"], r["json 2"], r["json 3"], r["json 4"], r["json 5"]].filter(Boolean).join(" ");
    if (!jsons) return false;
    const types = detectSchemas(jsons);
    types.forEach(t => { schemaTypes[t] = (schemaTypes[t] || 0) + 1; });
    return types.length > 0;
  }).length;

  const redirects = filtered.filter(r => { const sc = safeNum(r["code http"] || r["status code"] || 200); return sc >= 300 && sc < 400; }).length;
  const errors    = filtered.filter(r => { const sc = safeNum(r["code http"] || r["status code"] || 200); return sc >= 400; }).length;

  // llms.txt detection — cherche dans toutes les lignes du crawl (pas seulement HTML filtrées)
  const llmsRow     = rows.find(r => /\/llms\.txt$/i.test((r["adresse"] || r["address"] || r["url"] || "").trim()));
  const llmsFullRow = rows.find(r => /\/llms-full\.txt$/i.test((r["adresse"] || r["address"] || r["url"] || "").trim()));
  const llmsStatus     = llmsRow     ? safeNum(llmsRow["code http"]     || llmsRow["status code"]     || 0) : null;
  const llmsFullStatus = llmsFullRow ? safeNum(llmsFullRow["code http"] || llmsFullRow["status code"] || 0) : null;

  return {
    totalPages:    total,
    totalImg,
    indexableRate: Math.round((indexable / total) * 100),
    avgTitleLen:   Math.round(titleLens.reduce((a,b)=>a+b,0) / (titleLens.length || 1)),
    avgMetaLen:    Math.round(metaLens.reduce((a,b)=>a+b,0)  / (metaLens.length  || 1)),
    avgH1Len:      Math.round(h1Lens.reduce((a,b)=>a+b,0)    / (h1Lens.length    || 1)),
    avgWords:      Math.round(words.reduce((a,b)=>a+b,0)     / (words.length     || 1)),
    avgPageSizeKB: Math.round(avg(pageSizes) / 1024),
    avgImgSizeKB:  imgSizes.length ? Math.round(avg(imgSizes) / 1024) : 0,
    avgInlinks:    Math.round(avg(inlk) * 10) / 10,
    avgOutlinks:   Math.round(avg(outlk) * 10) / 10,
    avgDepth:      Math.round((depth.reduce((a,b)=>a+b,0) / (depth.length || 1)) * 10) / 10,
    avgFlesch:     Math.round((flesch.reduce((a,b)=>a+b,0) / (flesch.length || 1)) * 10) / 10,
    tableRate:     Math.round((withTable / total) * 100),
    schemaRate:    Math.round((withSchema / total) * 100),
    schemaTypes,
    errorRate:     Math.round((errors / allTotal) * 100),
    redirectRate:  Math.round((redirects / allTotal) * 100),
    llms:     llmsRow     ? { present: true,  status: llmsStatus,     url: llmsRow["adresse"]     || llmsRow["url"]     || "" } : { present: false },
    llmsFull: llmsFullRow ? { present: true,  status: llmsFullStatus, url: llmsFullRow["adresse"] || llmsFullRow["url"] || "" } : { present: false },
  };
}

// ── EXTRACT GSC ─────────────────────────────────────────────────
function extractGSC(rows) {
  if (!rows.length) return null;
  const validRows = rows.filter(r => safeNum(r["clics"] || r["clicks"] || 0) > 0 || safeNum(r["impressions"] || 0) > 0);
  const src = validRows.length > 0 ? validRows : rows;
  return {
    clicks:      src.map(r => safeNum(r["clics"] || r["clicks"] || 0)).reduce((a,b)=>a+b,0),
    impressions: src.map(r => safeNum(r["impressions"] || 0)).reduce((a,b)=>a+b,0),
    ctr:         Math.round(avg(src.map(r => safeNum(String(r["ctr"] || "0").replace("%",""))).filter(x=>x>0)) * 100) / 100,
    position:    Math.round(avg(src.map(r => safeNum(r["position"] || 0)).filter(x=>x>0)) * 10) / 10,
  };
}

// ── EXTRACT GA ──────────────────────────────────────────────────
function extractGA(rows) {
  if (!rows.length) return null;
  return {
    sessions: rows.map(r => safeNum(r["ga4 sessions"] || r["sessions"] || r["séances"] || 0)).reduce((a,b)=>a+b,0),
    views:    rows.map(r => safeNum(r["ga4 views"]    || r["views"]    || r["pages vues"] || 0)).reduce((a,b)=>a+b,0),
  };
}

// ── EXTRACT BING ─────────────────────────────────────────────────
function extractBing(rows) {
  if (!rows.length) return null;
  return {
    geoMentions: rows.map(r => safeNum(r["citations"] || r["mentions"] || r["impressions"] || r["appearancecount"] || 0)).reduce((a,b)=>a+b,0),
    pageCount:   rows.filter(r => safeNum(r["citations"] || r["mentions"] || 0) >= 1).length,
  };
}

// ── CORRELATION CELL COLOR ───────────────────────────────────────
function corrColor(v) {
  if (v === null) return { bg: "#F5F5F7", text: "#C0C0CC", border: "#E8E8ED" };
  const a = Math.abs(v);
  if (a >= 0.7) return v > 0 ? { bg: "#DCFCE7", text: "#15803D", border: "#86EFAC" } : { bg: "#FEE2E2", text: "#B91C1C", border: "#FCA5A5" };
  if (a >= 0.4) return { bg: "#FEF9C3", text: "#92400E", border: "#FDE68A" };
  return { bg: "#F1F5F9", text: "#64748B", border: "#CBD5E1" };
}

// ── COMPONENTS ──────────────────────────────────────────────────
function Badge({ children, color, bg }) {
  return <span style={{ background: bg, color, borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>{children}</span>;
}

function StatPill({ label, value, color }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", minWidth: 110 }}>
      <div style={{ fontSize: 11, color: C.textLight, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || C.text, fontVariantNumeric: "tabular-nums" }}>{value ?? "—"}</div>
    </div>
  );
}

function SectionHeader({ title, sub }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text, fontFamily: "'Georgia', serif", letterSpacing: -0.5 }}>{title}</h2>
      {sub && <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textLight }}>{sub}</p>}
    </div>
  );
}

function UploadCard({ label, icon, hint, onData, loaded, color, siteId, source }) {
  const [drag, setDrag]       = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState(null);
  const ref = useRef();

  const handle = useCallback(async (file) => {
    if (!file) return;
    setUploadErr(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      const rows = parseCSV(text);
      onData(rows);
      // Upload to Supabase in background
      if (siteId && source) {
        setUploading(true);
        try {
          const ts   = new Date().toISOString().replace(/[:.]/g, "-");
          const path = `${siteId}/${source}/${ts}_${file.name}`;
          await sbUpload(path, text);
          await sbInsertImport({ site_id: siteId, source, filename: file.name, storage_path: path, row_count: rows.length });
        } catch(err) {
          setUploadErr("Sauvegarde échouée");
          console.warn("Supabase upload error:", err);
        } finally {
          setUploading(false);
        }
      }
    };
    reader.readAsText(file);
  }, [onData, siteId, source]);

  return (
    <div
      onClick={() => ref.current.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); }}
      style={{ border: `1.5px dashed ${drag ? color : loaded ? color : "#D1D5DB"}`, borderRadius: 10, padding: "14px 16px", cursor: "pointer", background: loaded ? `${color}0D` : drag ? `${color}08` : "#FAFAFA", transition: "all 0.18s", display: "flex", alignItems: "center", gap: 12 }}
    >
      <input ref={ref} type="file" accept=".csv" style={{ display: "none" }} onChange={e => handle(e.target.files[0])} />
      <div style={{ fontSize: 22 }}>{uploading ? "⏳" : loaded ? "✅" : icon}</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: loaded ? color : C.textMid }}>{label}</div>
        <div style={{ fontSize: 11, color: uploadErr ? C.red : C.textLight, marginTop: 2 }}>
          {uploading ? "Sauvegarde en cours…" : uploadErr ? uploadErr : loaded ? "Fichier chargé · sauvegardé" : hint}
        </div>
      </div>
    </div>
  );
}

// ── PAGE MODE SELECTOR ───────────────────────────────────────────
function PageModeSelector({ value, onChange }) {
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

// ── SCHEMA BREAKDOWN ────────────────────────────────────────────
function SchemaBreakdown({ schemaTypes, color }) {
  const entries = Object.entries(schemaTypes || {}).sort((a,b) => b[1]-a[1]);
  if (!entries.length) return <div style={{ fontSize: 12, color: C.textLight }}>Aucun schema détecté</div>;
  const max = entries[0][1];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map(([type, count]) => (
        <div key={type} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 11, color: C.textMid, minWidth: 140 }}>{type}</div>
          <div style={{ flex: 1, height: 6, background: C.borderLight, borderRadius: 3 }}>
            <div style={{ height: "100%", width: `${(count/max)*100}%`, background: color, borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color, minWidth: 30, textAlign: "right" }}>{count}</div>
        </div>
      ))}
    </div>
  );
}


// ── BUILD PROMPT FOR CLAUDE ──────────────────────────────────────
function buildPrompt(metrics, corrMatrix, resultVals) {
  const sitesData = metrics.map((m, i) => {
    const sf = m.sf || {};
    const rv = resultVals[i] || {};
    return `
SITE: ${m.site.label}
— Screaming Frog:
  Title longueur moy.: ${sf.avgTitleLen ?? "N/A"} car.
  Meta longueur moy.: ${sf.avgMetaLen ?? "N/A"} car.
  H1 longueur moy.: ${sf.avgH1Len ?? "N/A"} car.
  Mots moyens/page: ${sf.avgWords ?? "N/A"}
  Poids pages (KB): ${sf.avgPageSizeKB ?? "N/A"}
  Poids images (KB): ${sf.avgImgSizeKB ?? "N/A"}
  Liens entrants moy.: ${sf.avgInlinks ?? "N/A"}
  Liens sortants moy.: ${sf.avgOutlinks ?? "N/A"}
  Profondeur crawl: ${sf.avgDepth ?? "N/A"}
  Score Flesch: ${sf.avgFlesch ?? "N/A"}
  Pages avec tableau: ${sf.tableRate ?? "N/A"}%
  Pages avec Schema: ${sf.schemaRate ?? "N/A"}%
  Types de schema: ${Object.entries(sf.schemaTypes || {}).map(([k,v]) => k+":"+v).join(", ") || "aucun"}
  Taux erreurs: ${sf.errorRate ?? "N/A"}%
  Taux redirections: ${sf.redirectRate ?? "N/A"}%
  Nb pages: ${sf.totalPages ?? "N/A"}
— Résultats GSC/GA4/Bing:
  Clics GSC: ${rv.clicks ?? 0}
  Impressions GSC: ${rv.impressions ?? 0}
  CTR: ${rv.ctr ?? 0}%
  Position moy.: ${rv.position ?? 0}
  Sessions GA4: ${rv.sessions ?? 0}
  Vues GA4: ${rv.views ?? 0}
  Citations Bing AI: ${rv.geoMentions ?? 0}`;
  }).join("\n\n");

  const topCorr = corrMatrix.flatMap(({ dim, corrs }) =>
    corrs.filter(c => c.value !== null && Math.abs(c.value) >= 0.4)
      .map(c => `${dim.label} ↔ ${c.kpi.label}: ${c.value > 0 ? "+" : ""}${c.value}`)
  ).join("\n");

  return `Tu es un expert SEO et GEO (Generative Engine Optimization). Tu analyses des données de 3 sites web concurrents et tu dois produire une analyse stratégique et des roadmaps actionnables.

DONNÉES DES 3 SITES:
${sitesData}

CORRÉLATIONS SIGNIFICATIVES (Pearson ≥ 0.4 ou ≤ -0.4):
${topCorr || "Données insuffisantes pour calculer des corrélations significatives."}

INSTRUCTIONS:
Produis un JSON STRICT avec exactement cette structure (rien d'autre, pas de markdown, pas de backticks):
{
  "insights_seo": [
    {"title": "titre court", "detail": "explication 2-3 phrases basée sur les données", "impact": "fort|moyen|faible"}
  ],
  "insights_geo": [
    {"title": "titre court", "detail": "explication 2-3 phrases basée sur les données", "impact": "fort|moyen|faible"}
  ],
  "roadmaps": {
    "wedig": {
      "quick_wins": [
        {"action": "action concrète", "metric": "métrique SF concernée", "why": "pourquoi basé sur les données", "effort": "1-3j|1sem|2sem"}
      ],
      "moyen_terme": [
        {"action": "action concrète", "metric": "métrique SF concernée", "why": "pourquoi basé sur les données", "effort": "1mois|2mois|3mois"}
      ],
      "long_terme": [
        {"action": "action concrète", "metric": "métrique SF concernée", "why": "pourquoi basé sur les données", "effort": "3-6mois|6-12mois"}
      ]
    },
    "deux": { "quick_wins": [], "moyen_terme": [], "long_terme": [] },
    "lets": { "quick_wins": [], "moyen_terme": [], "long_terme": [] }
  }
}

Règles:
- 3 à 5 insights SEO et 3 à 5 insights GEO
- 3 à 5 actions par horizon temporel par site
- Chaque action doit être concrète, mesurable et basée sur les données fournies
- Distingue clairement les leviers SEO (GSC/GA4) des leviers GEO (Bing AI)
- Utilise les corrélations pour justifier les priorités
- Réponds UNIQUEMENT avec le JSON, sans texte avant ou après`;
}

// ── ANALYSE TAB COMPONENT ────────────────────────────────────────
function AnalyseTab({ metrics, corrMatrix, resultVals, analysis, setAnalysis, analysisLoading, setAnalysisLoading, analysisError, setAnalysisError }) {
  const [activeRoadmap, setActiveRoadmap] = useState("wedig");
  const hasData = metrics.some(m => m.sf !== null);

  const runAnalysis = async () => {
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const prompt = buildPrompt(metrics, corrMatrix, resultVals);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await res.json();
      const raw = data.content?.map(b => b.text || "").join("") || "";
      const clean = raw.replace(/```json|```/g, "").trim();
      const start = clean.indexOf("{");
      const end = clean.lastIndexOf("}");
      const parsed = JSON.parse(clean.substring(start, end + 1));
      setAnalysis(parsed);
    } catch(e) {
      setAnalysisError("Erreur lors de l'analyse : " + e.message);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const impactColor = (impact) => impact === "fort" ? C.green : impact === "moyen" ? C.amber : C.textLight;
  const impactBg    = (impact) => impact === "fort" ? C.greenLight : impact === "moyen" ? C.amberLight : C.bg;

  const horizonConfig = [
    { key: "quick_wins",   label: "⚡ Quick Wins",    sub: "1 jour – 2 semaines", color: C.green,  bg: C.greenLight  },
    { key: "moyen_terme",  label: "📈 Moyen terme",   sub: "1 – 3 mois",          color: C.amber,  bg: C.amberLight  },
    { key: "long_terme",   label: "🏗️ Long terme",    sub: "3 – 12 mois",         color: C.purple, bg: C.purpleLight },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text, fontFamily: "'Georgia', serif", letterSpacing: -0.5 }}>
            Analyse IA & Roadmaps
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textLight }}>
            Interprétation des corrélations · Leviers SEO & GEO · Actions priorisées par site
          </p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={analysisLoading || !hasData}
          style={{
            padding: "10px 24px", background: analysisLoading ? C.border : C.blue, color: analysisLoading ? C.textLight : "#fff",
            border: "none", borderRadius: 9, cursor: hasData && !analysisLoading ? "pointer" : "not-allowed",
            fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
            transition: "all 0.2s", boxShadow: analysisLoading ? "none" : "0 2px 8px #2563EB33",
          }}
        >
          {analysisLoading ? (
            <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span> Analyse en cours…</>
          ) : analysis ? "↻ Relancer l'analyse" : "✦ Générer l'analyse"}
        </button>
      </div>

      {/* No data warning */}
      {!hasData && (
        <div style={{ background: C.amberLight, border: `1px solid #FDE68A`, borderRadius: 12, padding: "16px 20px", marginBottom: 24, fontSize: 13, color: C.amber }}>
          ⚠️ Chargez au moins un fichier CSV Screaming Frog dans l'onglet Import pour générer l'analyse.
        </div>
      )}

      {/* Error */}
      {analysisError && (
        <div style={{ background: C.redLight, border: `1px solid #FCA5A5`, borderRadius: 12, padding: "16px 20px", marginBottom: 24, fontSize: 13, color: C.red }}>
          {analysisError}
        </div>
      )}

      {/* Loading skeleton */}
      {analysisLoading && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
          {[1,2].map(i => (
            <div key={i} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
              <div style={{ height: 16, background: C.borderLight, borderRadius: 6, width: "40%", marginBottom: 16 }} />
              {[1,2,3].map(j => (
                <div key={j} style={{ height: 60, background: C.bg, borderRadius: 8, marginBottom: 10 }} />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Analysis results */}
      {analysis && !analysisLoading && (
        <>
          {/* Insights SEO + GEO */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>
            {[
              { key: "insights_seo", label: "🔍 Leviers SEO", sub: "Basés sur corrélations GSC & GA4", border: C.blue },
              { key: "insights_geo", label: "🤖 Leviers GEO", sub: "Basés sur corrélations Bing AI",   border: C.purple },
            ].map(({ key, label, sub, border }) => (
              <div key={key} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, borderLeft: `4px solid ${border}` }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{label}</div>
                  <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>{sub}</div>
                </div>
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {(analysis[key] || []).map((insight, i) => (
                    <div key={i} style={{ background: impactBg(insight.impact), border: `1px solid ${impactColor(insight.impact)}22`, borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{insight.title}</div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: impactColor(insight.impact), background: `${impactColor(insight.impact)}18`, padding: "2px 8px", borderRadius: 20, textTransform: "uppercase", letterSpacing: 0.8 }}>
                          impact {insight.impact}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>{insight.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Roadmaps */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 12 }}>🗺️ Roadmaps par site</div>
              <div style={{ display: "flex", gap: 8 }}>
                {SITES.map(s => (
                  <button key={s.id} onClick={() => setActiveRoadmap(s.id)} style={{
                    padding: "7px 18px", border: `1px solid ${activeRoadmap === s.id ? s.color : C.border}`,
                    borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: activeRoadmap === s.id ? 700 : 400,
                    background: activeRoadmap === s.id ? s.bg : C.white, color: activeRoadmap === s.id ? s.color : C.textMid,
                    transition: "all 0.15s",
                  }}>{s.label}</button>
                ))}
              </div>
            </div>

            <div style={{ padding: "24px" }}>
              {(() => {
                const siteId = activeRoadmap;
                const rm = analysis.roadmaps?.[siteId];
                if (!rm) return <div style={{ color: C.textLight, fontSize: 13 }}>Aucune roadmap générée pour ce site.</div>;
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
                    {horizonConfig.map(({ key, label, sub, color, bg }) => (
                      <div key={key} style={{ background: bg, border: `1px solid ${color}33`, borderRadius: 12, overflow: "hidden" }}>
                        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${color}22` }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color }}>{label}</div>
                          <div style={{ fontSize: 11, color: `${color}99`, marginTop: 2 }}>{sub}</div>
                        </div>
                        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                          {(rm[key] || []).map((item, i) => (
                            <div key={i} style={{ background: C.white, borderRadius: 9, padding: "12px 14px", border: `1px solid ${color}22` }}>
                              <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 4 }}>{item.action}</div>
                              <div style={{ fontSize: 11, color: C.textLight, marginBottom: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                                <span style={{ background: `${color}15`, color, padding: "1px 7px", borderRadius: 10, fontWeight: 500 }}>{item.metric}</span>
                                <span style={{ background: C.bg, color: C.textMid, padding: "1px 7px", borderRadius: 10 }}>⏱ {item.effort}</span>
                              </div>
                              <div style={{ fontSize: 11, color: C.textMid, lineHeight: 1.5 }}>{item.why}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!analysis && !analysisLoading && hasData && (
        <div style={{ background: C.white, border: `2px dashed ${C.border}`, borderRadius: 14, padding: "60px 40px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>✦</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 8 }}>Prêt à analyser</div>
          <div style={{ fontSize: 13, color: C.textLight, maxWidth: 400, margin: "0 auto" }}>
            Cliquez sur "Générer l'analyse" pour obtenir les insights SEO/GEO et les roadmaps basés sur vos données et les corrélations calculées.
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}


// ── KPI HEADER CELL WITH TOOLTIP ─────────────────────────────────
function KpiHeaderCell({ kpi }) {
  const [show, setShow] = useState(false);
  const tip = KPI_TOOLTIPS[kpi.label];
  return (
    <th
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      style={{ position: "relative", padding: "14px 10px", textAlign: "center", fontSize: 11, fontWeight: 600, color: C.textMid, background: C.bg, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.borderLight}`, minWidth: 105, lineHeight: 1.3, cursor: tip ? "help" : "default" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
        {kpi.label}
        {tip && <span style={{ fontSize: 9, color: C.textLight, border: `1px solid ${C.border}`, borderRadius: "50%", width: 13, height: 13, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>?</span>}
      </div>
      <div style={{ fontSize: 10, fontWeight: 400, color: C.textLight, marginTop: 2 }}>
        {kpi.src === "gsc" ? "🔍 GSC" : kpi.src === "ga" ? "📊 GA4" : "🤖 Bing"}
      </div>
      {show && tip && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", zIndex: 300,
          background: C.text, color: "#fff", fontSize: 11, lineHeight: 1.5,
          padding: "8px 12px", borderRadius: 8, width: 220, fontWeight: 400, textAlign: "left",
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)", pointerEvents: "none",
        }}>
          <div style={{ position: "absolute", top: -5, left: "50%", transform: "translateX(-50%)", width: 10, height: 10, background: C.text, rotate: "45deg", borderRadius: 2 }} />
          {tip}
        </div>
      )}
    </th>
  );
}


// ── SF DIM ROW LABEL WITH TOOLTIP ────────────────────────────────
function SfDimCell({ dim, rowBg }) {
  const [show, setShow] = useState(false);
  const tip = SF_DIM_TOOLTIPS[dim.key];
  return (
    <td
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      style={{ position: "sticky", padding: "11px 18px", fontSize: 12, fontWeight: 500, color: C.text, borderRight: `1px solid ${C.border}`, borderBottom: `1px solid ${C.borderLight}`, left: 0, background: rowBg, zIndex: 1, cursor: tip ? "help" : "default" }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {dim.label}
        <span style={{ fontSize: 10, color: C.textLight }}>{dim.higher ? "↑" : "↓"}</span>
        {tip && <span style={{ fontSize: 9, color: C.textLight, border: `1px solid ${C.border}`, borderRadius: "50%", width: 13, height: 13, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>?</span>}
      </span>
      {show && tip && (
        <div style={{
          position: "absolute", top: "50%", left: "calc(100% + 8px)", transform: "translateY(-50%)", zIndex: 400,
          background: C.text, color: "#fff", fontSize: 11, lineHeight: 1.5,
          padding: "8px 12px", borderRadius: 8, width: 230, fontWeight: 400,
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)", pointerEvents: "none",
        }}>
          <div style={{ position: "absolute", top: "50%", left: -5, transform: "translateY(-50%)", width: 10, height: 10, background: C.text, rotate: "45deg", borderRadius: 2 }} />
          {tip}
        </div>
      )}
    </td>
  );
}


// ── SF DIM TOOLTIPS BY KEY ────────────────────────────────────────
const SF_DIM_TOOLTIPS = {
  avgTitleLen:   "Longueur moyenne des balises title en caractères. Idéalement entre 30 et 65 car. pour Google.",
  avgMetaLen:    "Longueur moyenne des meta descriptions en caractères. Idéalement entre 100 et 160 car.",
  avgH1Len:      "Longueur moyenne des H1 en caractères. Un H1 présent et descriptif est essentiel pour le SEO et le GEO.",
  avgWords:      "Nombre moyen de mots par page HTML. Plus de contenu (500+ mots) favorise le positionnement et la compréhension GEO.",
  avgPageSizeKB: "Poids moyen des pages HTML en KB. Des pages légères améliorent le Core Web Vitals et l'expérience mobile.",
  avgImgSizeKB:  "Poids moyen des images en KB. Des images lourdes ralentissent le chargement — impact direct sur le classement.",
  avgInlinks:    "Nombre moyen de liens internes pointant vers chaque page. Un bon maillage diffuse le PageRank et améliore l'indexation.",
  avgOutlinks:   "Nombre moyen de liens sortants par page. Un excès peut diluer l'autorité et perturber le crawl.",
  avgDepth:      "Profondeur de crawl moyenne depuis la home. Au-delà de 4 niveaux, les pages sont moins bien indexées.",
  avgFlesch:     "Score de lisibilité Flesch (0-100). Au-dessus de 60 = texte accessible. Important pour l'engagement et la compréhension GEO.",
  tableRate:     "% de pages avec un tableau HTML. Les tableaux structurent l'information et favorisent les rich snippets et réponses AI.",
  schemaRate:    "% de pages avec un schema JSON-LD. Aide Google et les LLMs à comprendre le type et le contenu de la page.",
  errorRate:     "% de pages en erreur HTTP 4xx. Ces pages nuisent au crawl budget et à l'expérience utilisateur.",
  redirectRate:  "% d'URLs en redirection 3xx. Consomment du crawl budget et peuvent diluer le PageRank si en chaîne.",
  totalPages:    "Nombre total de pages HTML crawlées. Donne la taille du site indexable.",
};

// ── KPI TOOLTIPS ─────────────────────────────────────────────────
const KPI_TOOLTIPS = {
  "Clics GSC":             "Nombre total de clics organiques reçus depuis Google Search. Mesure directe de la performance SEO en trafic réel.",
  "Impressions GSC":       "Nombre de fois où vos pages sont apparues dans les résultats Google. Élevé avec peu de clics = problème de CTR ou de pertinence.",
  "CTR (%)":               "Taux de clic (Clics ÷ Impressions). Un CTR faible peut indiquer un title/meta peu attractif ou un mauvais positionnement.",
  "Position moy.":         "Position moyenne dans Google Search. En dessous de 10 = première page. Chaque point gagné peut multiplier le trafic.",
  "Sessions GA4":          "Nombre de sessions initiées sur le site. Reflète le volume de visites réel, toutes sources confondues.",
  "Vues GA4":              "Nombre total de pages vues (GA4 Views). Inclut les visites multiples d'une même page dans une session.",
  "Citations Bing AI":     "Nombre de fois où vos pages sont citées dans les réponses générées par Bing AI (Copilot). Métrique clé du GEO.",
};

// ── LLMS STATUS BADGE ─────────────────────────────────────────────
function LlmsStatus({ sf }) {
  if (!sf) return null;
  const files = [
    { key: "llms",     label: "llms.txt",      data: sf.llms },
    { key: "llmsFull", label: "llms-full.txt",  data: sf.llmsFull },
  ];
  return (
    <div style={{ marginTop: 12, padding: "12px 14px", background: C.bg, borderRadius: 10, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8, fontWeight: 600 }}>
        🤖 Fichiers LLMs
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {files.map(({ key, label, data }) => {
          const ok  = data?.present && data?.status >= 200 && data?.status < 300;
          const err = data?.present && (data?.status >= 400 || data?.status === 0);
          const rdr = data?.present && data?.status >= 300 && data?.status < 400;
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

// ── MAIN APP ────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("import");
  const [pageMode, setPageMode] = useState("all");
  const [matrixSites, setMatrixSites] = useState(["wedig", "deux", "lets"]);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  const [sfData,   setSfData]   = useState({ wedig: [], deux: [], lets: [] });
  const [gscData,  setGscData]  = useState({ wedig: [], deux: [], lets: [] });
  const [gaData,   setGaData]   = useState({ wedig: [], deux: [], lets: [] });
  const [bingData, setBingData] = useState({ wedig: [], deux: [], lets: [] });

  const today = new Date().toISOString().slice(0,10);
  const m3ago = new Date(Date.now() - 90*86400000).toISOString().slice(0,10);
  const [dates, setDates] = useState({ from: m3ago, to: today });

  // Supabase state
  const [dbHistory,    setDbHistory]    = useState([]);
  const [dbLoading,    setDbLoading]    = useState(true);
  const [dbAutoLoaded, setDbAutoLoaded] = useState(false);
  const [showHistory,  setShowHistory]  = useState(false);

  const loadCsv = useCallback(async (row) => {
    const setterMap = { sf: setSfData, gsc: setGscData, ga: setGaData, bing: setBingData };
    try {
      const text = await sbDownload(row.storage_path);
      const rows = parseCSV(text);
      setterMap[row.source](p => ({ ...p, [row.site_id]: rows }));
    } catch(e) { console.warn("Load error", e); }
  }, [setSfData, setGscData, setGaData, setBingData]);

  // Auto-load latest imports on mount
  useEffect(() => {
    (async () => {
      setDbLoading(true);
      try {
        const [latest, history] = await Promise.all([sbGetLatest(), sbGetHistory()]);
        setDbHistory(history);
        if (Object.keys(latest).length > 0) {
          await Promise.all(Object.values(latest).map(row => loadCsv(row)));
          setDbAutoLoaded(true);
        }
      } catch(e) { console.warn("Supabase init error", e); }
      finally { setDbLoading(false); }
    })();
  }, [loadCsv]);

  const refreshHistory = useCallback(async () => {
    const history = await sbGetHistory();
    setDbHistory(history);
  }, []);

  // Computed metrics, mode-aware
  const metrics = useMemo(() => {
    return SITES.map(s => {
      const sfRows   = sfData[s.id];
      const bingRows = bingData[s.id];
      return {
        site: s,
        sf:   extractSF(sfRows, pageMode, bingRows, gscData[s.id]),
        gsc:  gscData[s.id].length > 0 ? extractGSC(gscData[s.id]) : null,
        ga:   gaData[s.id].length  > 0 ? extractGA(gaData[s.id])   : null,
        bing: extractBing(bingRows),
      };
    });
  }, [sfData, gscData, gaData, bingData, pageMode]);

  const resultVals = useMemo(() => metrics.map(m => ({
    clicks:          m.gsc?.clicks          ?? 0,
    impressions:     m.gsc?.impressions      ?? 0,
    ctr:             m.gsc?.ctr              ?? 0,
    position:        m.gsc?.position         ?? 0,
    sessions: m.ga?.sessions ?? 0,
    views:    m.ga?.views    ?? 0,
    geoMentions:     m.bing?.geoMentions     ?? 0,
  })), [metrics]);

  const corrMatrix = useMemo(() => SF_DIMS.map(dim => ({
    dim,
    corrs: RES_KPIS.map(kpi => ({
      kpi,
      value: pearson(
        metrics.map(m => m.sf ? (m.sf[dim.key] ?? 0) : 0),
        resultVals.map(r => r[kpi.key] ?? 0)
      ),
    })),
  })), [metrics, resultVals]);

  const filteredCorrMatrix = useMemo(() => {
    // Always intra-site page-level Pearson — concat pages from all selected sites
    const sfRows   = matrixSites.flatMap(id => sfData[id]   || []);
    const gscRows  = matrixSites.flatMap(id => gscData[id]  || []);
    const gaRows   = matrixSites.flatMap(id => gaData[id]   || []);
    const bingRows = matrixSites.flatMap(id => bingData[id] || []);
    return SF_DIMS.map(dim => ({
      dim,
      corrs: RES_KPIS.map(kpi => ({
        kpi,
        value: intraCorr(sfRows, gscRows, gaRows, bingRows, dim.key, kpi.key),
      })),
    }));
  }, [matrixSites, sfData, gscData, gaData, bingData]);

  const RADAR_DIMS = [
    { key: "totalPages",    label: "Pages",         max: 5000  },
    { key: "totalImg",      label: "Images",        max: 2000  },
    { key: "avgInlinks",    label: "Inlinks moy.",  max: 100   },
    { key: "avgOutlinks",   label: "Outlinks moy.", max: 100   },
    { key: "indexableRate", label: "Indexables %",  max: 100   },
    { key: "avgWords",      label: "Mots moy.",     max: 1000  },
  ];
  const radarData = useMemo(() => RADAR_DIMS.map(d => {
    const row = { dim: d.label };
    metrics.forEach(m => { row[m.site.id] = m.sf ? Math.min(((m.sf[d.key] ?? 0) / d.max) * 100, 100) : 0; });
    return row;
  }), [metrics]);

  const TABS = ["import","overview","matrix","pages","analyse","sites"];

  return (
    <div style={{ fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: C.bg, minHeight: "100vh", color: C.text }}>
      {/* NAV */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, background: C.blue, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontSize: 14, fontWeight: 800 }}>C</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.3 }}>CorrelDash</span>
            <span style={{ color: C.textLight, fontSize: 13, marginLeft: 4 }}>· SEO × GEO × Performance</span>
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "6px 16px", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 500,
                background: tab === t ? C.blue : "transparent", color: tab === t ? "#fff" : C.textMid, transition: "all 0.15s",
              }}>
                {t === "import" ? "Import" : t === "overview" ? "Vue d'ensemble" : t === "matrix" ? "Matrice" : t === "pages" ? "Pages" : t === "analyse" ? "✦ Analyse IA" : "Sites"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "32px 28px" }}>

        {/* ── IMPORT ── */}
        {tab === "import" && (
          <div>
            <SectionHeader title="Import des données" sub="Chargez les exports CSV pour chaque site" />

            {/* DB status banner */}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: dbLoading ? C.amber : dbAutoLoaded ? C.green : C.textLight }} />
                <span style={{ fontSize: 13, color: C.textMid }}>
                  {dbLoading ? "Chargement des derniers imports…" : dbAutoLoaded ? `Données auto-chargées depuis Supabase (${dbHistory.length} imports en base)` : "Aucun import en base — chargez vos CSV ci-dessous"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setShowHistory(h => !h); refreshHistory(); }} style={{ padding: "5px 14px", background: showHistory ? C.blue : C.white, color: showHistory ? "#fff" : C.textMid, border: `1px solid ${showHistory ? C.blue : C.border}`, borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 500 }}>
                  📋 Historique {dbHistory.length > 0 ? `(${dbHistory.length})` : ""}
                </button>
              </div>
            </div>

            {/* History panel */}
            {showHistory && (
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: C.text, marginBottom: 14 }}>Historique des imports</div>
                {dbHistory.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.textLight }}>Aucun import enregistré</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                    {dbHistory.map(row => {
                      const site = SITES.find(s => s.id === row.site_id);
                      const srcLabel = { sf: "🕷️ SF", gsc: "🔍 GSC", ga: "📊 GA4", bing: "🤖 Bing" }[row.source] || row.source;
                      return (
                        <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: C.bg, borderRadius: 8, fontSize: 12 }}>
                          <span style={{ fontWeight: 600, color: site?.color || C.text, minWidth: 90 }}>{site?.label || row.site_id}</span>
                          <span style={{ color: C.textMid, minWidth: 60 }}>{srcLabel}</span>
                          <span style={{ color: C.textLight, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.filename}</span>
                          <span style={{ color: C.textLight, minWidth: 70 }}>{row.row_count} lignes</span>
                          <span style={{ color: C.textLight, minWidth: 140 }}>{new Date(row.uploaded_at).toLocaleString("fr-FR")}</span>
                          <button onClick={() => loadCsv(row)} style={{ padding: "3px 10px", background: C.blueLight, color: C.blue, border: `1px solid ${C.blue}22`, borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
                            ↺ Charger
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px", marginBottom: 24, display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textMid }}>📅 Période GSC / GA4</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {["from","to"].map((k, i) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {i === 1 && <span style={{ color: C.textLight }}>→</span>}
                    <div>
                      <label style={{ fontSize: 11, color: C.textLight, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>{k === "from" ? "Du" : "Au"}</label>
                      <input type="date" value={dates[k]} onChange={e => setDates(d => ({...d, [k]: e.target.value}))}
                        style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 12px", fontSize: 13, color: C.text, background: C.white, outline: "none" }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginLeft: "auto", fontSize: 12, color: C.blue, background: C.blueLight, padding: "6px 14px", borderRadius: 20 }}>
                {dates.from} → {dates.to}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
              {SITES.map(site => (
                <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${C.borderLight}` }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: site.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🌐</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: site.color }}>{site.label}</div>
                      <div style={{ fontSize: 11, color: C.textLight }}>4 sources</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <UploadCard label="Screaming Frog Internal" icon="🕷️" hint="Export interne SF · données techniques uniquement" color={site.color}
                      loaded={sfData[site.id].length > 0} onData={rows => setSfData(p => ({...p, [site.id]: rows}))} siteId={site.id} source="sf" />
                    <UploadCard label="Google Search Console" icon="🔍" hint="Export GSC · clics, impressions, CTR, position" color={site.color}
                      loaded={gscData[site.id].length > 0} onData={rows => setGscData(p => ({...p, [site.id]: rows}))} siteId={site.id} source="gsc" />
                    <UploadCard label="Google Analytics 4" icon="📊" hint="Export GA4 · sessions, vues" color={site.color}
                      loaded={gaData[site.id].length > 0} onData={rows => setGaData(p => ({...p, [site.id]: rows}))} siteId={site.id} source="ga" />
                    <UploadCard label="Bing AI Performance" icon="🤖" hint="Export Bing Webmaster · colonne Citations" color={site.color}
                      loaded={bingData[site.id].length > 0} onData={rows => setBingData(p => ({...p, [site.id]: rows}))} siteId={site.id} source="bing" />
                  </div>
                  <div style={{ marginTop: 16, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[["SF", sfData[site.id].length], ["GSC", gscData[site.id].length], ["GA4", gaData[site.id].length], ["Bing", bingData[site.id].length]].map(([src, n]) => (
                      <div key={src} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, fontWeight: 600, background: n > 0 ? site.bg : C.borderLight, color: n > 0 ? site.color : C.textLight }}>
                        {src} {n > 0 ? `· ${n}` : "· vide"}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <SectionHeader title="Vue d'ensemble" sub="Scores agrégés et comparaison des 3 sites" />
              <PageModeSelector value={pageMode} onChange={setPageMode} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginBottom: 28 }}>
              {metrics.map(({ site, sf, gsc, ga, bing }) => (
                <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ background: site.bg, padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: site.color }}>{site.label}</div>
                    {sf && <Badge color={site.color} bg={site.bg}>{sf.totalPages} pages</Badge>}
                  </div>
                  <div style={{ padding: 20 }}>
                    {sf ? (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 10 }}>🕷️ Screaming Frog</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                          {[
                            ["Title moy.", `${sf.avgTitleLen} car.`],
                            ["Meta moy.", `${sf.avgMetaLen} car.`],
                            ["H1 moy.", `${sf.avgH1Len} car.`],
                            ["Mots moy.", sf.avgWords],
                            ["Poids pages", `${sf.avgPageSizeKB}KB`],
                            ["Poids images", `${sf.avgImgSizeKB}KB`],
                            ["Inlinks", sf.avgInlinks],
                            ["Outlinks", sf.avgOutlinks],
                            ["Profondeur", sf.avgDepth],
                            ["Flesch", sf.avgFlesch],
                            ["Tableaux", `${sf.tableRate}%`],
                            ["Schemas", `${sf.schemaRate}%`],
                            ["Indexables", `${sf.indexableRate}%`],
                            ["Erreurs", `${sf.errorRate}%`],
                            ["Redirects", `${sf.redirectRate}%`],
                          ].map(([k, v]) => <MetricRow key={k} label={k} value={v} />)}
                        </div>
                      </div>
                    ) : <div style={{ color: C.textLight, fontSize: 12, padding: "10px 0 14px", borderBottom: `1px solid ${C.borderLight}` }}>Aucun CSV SF chargé</div>}

                    {/* Schema types breakdown */}
                    {sf && Object.keys(sf.schemaTypes || {}).length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>🏷️ Types de Schema</div>
                        <SchemaBreakdown schemaTypes={sf.schemaTypes} color={site.color} />
                      </div>
                    )}
                    {sf && <LlmsStatus sf={sf} />}

                    {gsc && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>🔍 GSC</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <StatPill label="Clics" value={gsc.clicks.toLocaleString()} color={C.blue} />
                          <StatPill label="Impressions" value={gsc.impressions.toLocaleString()} />
                          <StatPill label="CTR" value={`${gsc.ctr}%`} color={C.green} />
                          <StatPill label="Position" value={gsc.position} color={C.amber} />
                        </div>
                      </div>
                    )}
                    {ga && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>📊 GA4</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <StatPill label="Sessions" value={ga.sessions.toLocaleString()} color={C.blue} />
                          <StatPill label="Vues" value={ga.views.toLocaleString()} />
                        </div>
                      </div>
                    )}
                    {bing && (
                      <div>
                        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>🤖 Bing AI</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <StatPill label="Citations" value={bing.geoMentions.toLocaleString()} color={C.purple} />
                          <StatPill label="Pages citées" value={bing.pageCount} color={C.teal} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textMid, marginBottom: 4 }}>Profil technique SF — radar</div>
              <div style={{ fontSize: 12, color: C.textLight, marginBottom: 16 }}>Scores normalisés 0–100</div>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke={C.border} />
                  <PolarAngleAxis dataKey="dim" tick={{ fill: C.textLight, fontSize: 11 }} />
                  {SITES.map(s => <Radar key={s.id} name={s.label} dataKey={s.id} stroke={s.color} fill={s.color} fillOpacity={0.08} strokeWidth={2} dot={{ r: 3 }} />)}
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ── MATRIX ── */}
        {tab === "matrix" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <SectionHeader title="Matrice de corrélation" sub="Pearson · SF (ordonnées) × KPIs résultats (abscisses)" />
              <PageModeSelector value={pageMode} onChange={setPageMode} />
            </div>

            {/* Site toggles */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: C.textLight, fontWeight: 500 }}>Sites inclus dans le calcul :</span>
              {SITES.map(s => {
                const active = matrixSites.includes(s.id);
                return (
                  <button key={s.id} onClick={() => setMatrixSites(prev =>
                    active
                      ? prev.filter(id => id !== s.id)
                      : [...prev, s.id]
                  )} style={{
                    padding: "5px 14px", border: `1.5px solid ${active ? s.color : C.border}`,
                    borderRadius: 20, cursor: "pointer", fontSize: 12, fontWeight: 600,
                    background: active ? s.bg : C.white, color: active ? s.color : C.textLight,
                    transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6,
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: active ? s.color : C.border, display: "inline-block" }} />
                    {s.label}
                  </button>
                );
              })}
              {matrixSites.length === 0 && (
                <span style={{ fontSize: 12, color: C.red, fontStyle: "italic" }}>Aucun site sélectionné — matrice vide</span>
              )}
              {matrixSites.length > 0 && (
                <span style={{ fontSize: 11, color: C.purple, background: C.purpleLight, padding: "3px 10px", borderRadius: 20 }}>
                  Pearson par page · {matrixSites.length === 1
                    ? SITES.find(s => s.id === matrixSites[0])?.label
                    : `${matrixSites.length} sites combinés`}
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              {[[C.green,"#DCFCE7","#86EFAC","≥ 0.7","Corrélation positive forte"],[C.red,"#FEE2E2","#FCA5A5","≤ -0.7","Corrélation négative forte"],[C.amber,"#FEF9C3","#FDE68A","0.4–0.7","Modérée"],[C.textLight,"#F1F5F9","#CBD5E1","< 0.4","Faible"],[C.textLight,"#F5F5F7",C.border,"—","Données insuffisantes"]].map(([tc,bg,bc,label,desc]) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 28, height: 22, background: bg, border: `1px solid ${bc}`, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: tc, fontWeight: 700 }}>{label}</div>
                  <span style={{ fontSize: 12, color: C.textMid }}>{desc}</span>
                </div>
              ))}
            </div>

            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={{ padding: "14px 18px", textAlign: "left", fontSize: 12, fontWeight: 600, color: C.textMid, background: C.bg, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, minWidth: 210, position: "sticky", left: 0, zIndex: 2 }}>
                      SF \ Résultats
                    </th>
                    {RES_KPIS.map(kpi => (
                      <KpiHeaderCell key={kpi.key} kpi={kpi} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixSites.length === 0 ? (
                    <tr><td colSpan={RES_KPIS.length + 1} style={{ padding: 40, textAlign: "center", color: C.textLight, fontSize: 13 }}>Sélectionnez au moins un site pour afficher la matrice</td></tr>
                  ) : filteredCorrMatrix.map(({ dim, corrs }, ri) => (
                    <tr key={dim.key} style={{ background: ri % 2 === 0 ? C.white : "#FAFBFC" }}>
                      <SfDimCell dim={dim} rowBg={ri % 2 === 0 ? C.white : "#FAFBFC"} />
                      {corrs.map(({ kpi, value }) => {
                        const col = corrColor(value);
                        return (
                          <td key={kpi.key} style={{ padding: "8px 6px", textAlign: "center", borderRight: `1px solid ${C.borderLight}`, borderBottom: `1px solid ${C.borderLight}` }}>
                            <div style={{ background: col.bg, color: col.text, border: `1px solid ${col.border}`, borderRadius: 7, padding: "5px 6px", fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                              {value !== null ? (value > 0 ? "+" : "") + value : "—"}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {[["🟢 Top corrélations positives", (a,b) => b.value-a.value, v => v >= 0.4, C.green, C.greenLight],
                ["🔴 Top corrélations négatives", (a,b) => a.value-b.value, v => v <= -0.4, C.red, C.redLight]
              ].map(([title, sort, filter, color, bg]) => (
                <div key={title} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: C.text, marginBottom: 12 }}>{title}</div>
                  {filteredCorrMatrix.flatMap(({ dim, corrs }) => corrs.filter(c => c.value !== null && filter(c.value)).map(c => ({ dim, kpi: c.kpi, value: c.value })))
                    .sort(sort).slice(0,5).map((item, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                      <div>
                        <div style={{ fontSize: 12, color: C.text }}>{item.dim.label}</div>
                        <div style={{ fontSize: 11, color: C.textLight }}>→ {item.kpi.label}</div>
                      </div>
                      <Badge color={color} bg={bg}>{item.value > 0 ? "+" : ""}{item.value}</Badge>
                    </div>
                  ))}
                  {filteredCorrMatrix.flatMap(({ dim, corrs }) => corrs.filter(c => c.value !== null && filter(c.value))).length === 0 &&
                    <div style={{ fontSize: 12, color: C.textLight }}>Pas encore de données suffisantes</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── PAGES ── */}
        {tab === "pages" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <SectionHeader title="Analyse par pages" sub="Scoring et filtrage des pages selon leur présence GEO et SEO" />
              <PageModeSelector value={pageMode} onChange={setPageMode} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
              {SITES.map(site => {
                const sfRows   = sfData[site.id];
                const bingRows = bingData[site.id];
                const filtered = filterByMode(sfRows, pageMode, bingRows);
                const html     = filtered.filter(r => {
                  const ct = (r["type de contenu"] || r["content type"] || "").toLowerCase();
                  const sc = safeNum(r["code http"] || r["status code"] || 200);
                  return (ct.includes("html") || ct === "") && sc < 400;
                });

                const geoPages = sfRows.filter(r => {
                  const url = (r["adresse"] || r["url"] || "").toLowerCase();
                  return bingRows.some(b => (b["page"] || b["url"] || "").toLowerCase() === url && safeNum(b["citations"] || 0) >= 1);
                });
                const seoPages = sfRows.filter(r => safeNum(r["clics"] || r["clicks"] || 0) > 0);

                return (
                  <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                    <div style={{ background: site.bg, padding: "14px 20px", borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: site.color }}>{site.label}</div>
                    </div>
                    <div style={{ padding: 20 }}>
                      {/* Page counts */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
                        {[
                          ["📄 Total HTML", sfRows.filter(r => (r["type de contenu"]||r["content type"]||"").toLowerCase().includes("html")).length, C.text],
                          ["🤖 Pages GEO", geoPages.length, C.purple],
                          ["🔍 Pages SEO", seoPages.length, C.blue],
                        ].map(([label, count, color]) => (
                          <div key={label} style={{ background: C.bg, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                            <div style={{ fontSize: 11, color: C.textLight, marginBottom: 4 }}>{label}</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color }}>{count}</div>
                          </div>
                        ))}
                      </div>

                      {/* Mode info */}
                      <div style={{ marginBottom: 16, padding: "10px 14px", background: pageMode === "geo" ? C.purpleLight : pageMode === "seo" ? C.blueLight : C.bg, borderRadius: 8, fontSize: 12, color: pageMode === "geo" ? C.purple : pageMode === "seo" ? C.blue : C.textMid }}>
                        {pageMode === "all"  && `Analyse sur ${html.length} pages HTML`}
                        {pageMode === "geo"  && `${html.length} pages présentes dans Bing AI`}
                        {pageMode === "seo"  && `${html.length} pages top 30% clics GSC`}
                      </div>

                      {/* Top pages by mode */}
                      {pageMode !== "all" && html.length > 0 && (
                        <div>
                          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 10 }}>
                            Top pages {pageMode === "geo" ? "citées Bing" : "clics GSC"}
                          </div>
                          {html.slice(0, 8).map((r, i) => {
                            const url = r["adresse"] || r["url"] || "";
                            const score = pageMode === "geo"
                              ? safeNum(bingRows.find(b => (b["page"]||"").toLowerCase() === url.toLowerCase())?.["citations"] || 0)
                              : safeNum(r["clics"] || r["clicks"] || 0);
                            const label = url.replace(/https?:\/\/[^/]+/, "").slice(0, 45) || url.slice(0, 45);
                            return (
                              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${C.borderLight}`, gap: 8 }}>
                                <div style={{ fontSize: 11, color: C.textMid, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={url}>
                                  {label || url}
                                </div>
                                <Badge color={pageMode === "geo" ? C.purple : C.blue} bg={pageMode === "geo" ? C.purpleLight : C.blueLight}>
                                  {score} {pageMode === "geo" ? "cit." : "clics"}
                                </Badge>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {html.length === 0 && sfRows.length === 0 && (
                        <div style={{ fontSize: 12, color: C.textLight, textAlign: "center", padding: 20 }}>Chargez un CSV SF dans l'onglet Import</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}


        {/* ── ANALYSE IA ── */}
        {tab === "analyse" && (
          <AnalyseTab
            metrics={metrics}
            corrMatrix={corrMatrix}
            resultVals={resultVals}
            analysis={analysis}
            setAnalysis={setAnalysis}
            analysisLoading={analysisLoading}
            setAnalysisLoading={setAnalysisLoading}
            analysisError={analysisError}
            setAnalysisError={setAnalysisError}
          />
        )}

        {/* ── SITES ── */}
        {tab === "sites" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <SectionHeader title="Détail par site" sub="Toutes les métriques brutes extraites des CSV" />
              <PageModeSelector value={pageMode} onChange={setPageMode} />
            </div>
            {metrics.map(({ site, sf, gsc, ga, bing }) => (
              <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 20, overflow: "hidden" }}>
                <div style={{ background: site.bg, padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: site.color }} />
                  <span style={{ fontWeight: 700, fontSize: 16, color: site.color }}>{site.label}</span>
                </div>
                <div style={{ padding: 24 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
                    <div>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 12, fontWeight: 600 }}>🕷️ Screaming Frog</div>
                      {sf ? SF_DIMS.map(d => (
                        <div key={d.key} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.borderLight}`, fontSize: 12 }}>
                          <span style={{ color: C.textMid }}>{d.label}</span>
                          <span style={{ fontWeight: 600 }}>{sf[d.key] ?? "—"}</span>
                        </div>
                      )) : <div style={{ color: C.textLight, fontSize: 12 }}>Aucun fichier chargé</div>}
                      {sf && Object.keys(sf.schemaTypes || {}).length > 0 && (
                        <div style={{ marginTop: 14 }}>
                          <div style={{ fontSize: 11, color: C.textLight, marginBottom: 8 }}>Types de Schema :</div>
                          <SchemaBreakdown schemaTypes={sf.schemaTypes} color={site.color} />
                        </div>
                      )}
                      {sf && <LlmsStatus sf={sf} />}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 12, fontWeight: 600 }}>🔍 Google Search Console</div>
                      {gsc ? Object.entries(gsc).map(([k,v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.borderLight}`, fontSize: 12 }}>
                          <span style={{ color: C.textMid }}>{k}</span>
                          <span style={{ fontWeight: 600 }}>{typeof v === "number" ? v.toLocaleString() : v}</span>
                        </div>
                      )) : <div style={{ color: C.textLight, fontSize: 12 }}>Aucun fichier chargé</div>}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 12, fontWeight: 600 }}>📊 Google Analytics 4</div>
                      {ga ? Object.entries(ga).map(([k,v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.borderLight}`, fontSize: 12 }}>
                          <span style={{ color: C.textMid }}>{k}</span>
                          <span style={{ fontWeight: 600 }}>{typeof v === "number" ? v.toLocaleString() : v}</span>
                        </div>
                      )) : <div style={{ color: C.textLight, fontSize: 12 }}>Aucun fichier chargé</div>}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 12, fontWeight: 600 }}>🤖 Bing AI Performance</div>
                      {bing ? (
                        <div>
                          {[["Citations totales", bing.geoMentions.toLocaleString()], ["Pages citées (≥1)", bing.pageCount]].map(([k,v]) => (
                            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.borderLight}`, fontSize: 12 }}>
                              <span style={{ color: C.textMid }}>{k}</span>
                              <span style={{ fontWeight: 600 }}>{v}</span>
                            </div>
                          ))}
                        </div>
                      ) : <div style={{ color: C.textLight, fontSize: 12 }}>Aucun fichier chargé</div>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}