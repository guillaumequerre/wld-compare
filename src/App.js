import { useState, useCallback, useMemo, useRef } from "react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Legend } from "recharts";

// ── PALETTE ────────────────────────────────────────────────────
const C = {
  bg: "#FAFAFA",
  white: "#FFFFFF",
  border: "#E8E8ED",
  borderLight: "#F0F0F5",
  text: "#0D0D14",
  textMid: "#4A4A5A",
  textLight: "#9090A0",
  blue: "#2563EB",
  blueLight: "#EFF6FF",
  green: "#059669",
  greenLight: "#ECFDF5",
  amber: "#D97706",
  amberLight: "#FFFBEB",
  red: "#DC2626",
  redLight: "#FEF2F2",
  purple: "#7C3AED",
  purpleLight: "#F5F3FF",
};

const SITES = [
  { id: "wedig", label: "wedig.fr",      color: "#2563EB", bg: "#EFF6FF" },
  { id: "deux",  label: "deux.io",       color: "#059669", bg: "#ECFDF5" },
  { id: "lets",  label: "lets-clic.com", color: "#7C3AED", bg: "#F5F3FF" },
];

// ── SF DIMENSIONS (ordonnées de la matrice) ──────────────────
const SF_DIMS = [
  { key: "titleOptRate",  label: "Title optimisé (%)",     higher: true  },
  { key: "metaOptRate",   label: "Meta desc. optimisée (%)", higher: true },
  { key: "h1Rate",        label: "H1 unique (%)",           higher: true  },
  { key: "avgWords",      label: "Mots moyens / page",      higher: true  },
  { key: "avgSizeKB",     label: "Poids moyen (KB)",        higher: false },
  { key: "avgImages",     label: "Images moy. / page",      higher: true  },
  { key: "avgInlinks",    label: "Inlinks internes moy.",   higher: true  },
  { key: "avgOutlinks",   label: "Outlinks moy.",           higher: true  },
  { key: "errorRate",     label: "Taux d'erreurs (%)",      higher: false },
  { key: "redirectRate",  label: "Taux redirections (%)",   higher: false },
  { key: "totalPages",    label: "Nb pages crawlées",       higher: true  },
];

// ── RESULT KPIs (abscisses de la matrice) ───────────────────
const RES_KPIS = [
  { key: "clicks",       label: "Clics GSC",        src: "gsc"  },
  { key: "impressions",  label: "Impressions GSC",  src: "gsc"  },
  { key: "ctr",          label: "CTR (%)",           src: "gsc"  },
  { key: "position",     label: "Position moy.",     src: "gsc"  },
  { key: "sessions",     label: "Sessions GA4",      src: "ga"   },
  { key: "users",        label: "Utilisateurs GA4",  src: "ga"   },
  { key: "bounceRate",   label: "Taux rebond GA4",   src: "ga"   },
  { key: "geoMentions",  label: "Mentions Bing AI",  src: "bing" },
  { key: "geoClicks",    label: "Clics Bing AI",     src: "bing" },
];

// ── HELPERS ─────────────────────────────────────────────────
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

// ── EXTRACT SF ───────────────────────────────────────────────
function extractSF(rows) {
  if (!rows.length) return null;
  const html = rows.filter(r => {
    const ct = (r["content type"] || r["content_type"] || r["type"] || "").toLowerCase();
    const sc = safeNum(r["status code"] || r["status_code"] || r["statuscode"] || 200);
    return (ct.includes("html") || ct === "") && sc < 400;
  });
  const total = html.length || 1;
  const allTotal = rows.length || 1;

  const col = (r, ...keys) => { for (const k of keys) { if (r[k] !== undefined && r[k] !== "") return r[k]; } return ""; };

  const titlesOk = html.filter(r => { const l = col(r,"title 1","title","page title","title 1").length; return l >= 30 && l <= 65; }).length;
  const metaOk   = html.filter(r => { const l = col(r,"meta description 1","meta description","meta desc").length; return l >= 100 && l <= 160; }).length;
  const h1Ok     = html.filter(r => { const v = safeNum(col(r,"h1-1","h1","h1 count")||"1"); return v === 1 || col(r,"h1-1","h1") !== ""; }).length;
  const words    = html.map(r => safeNum(col(r,"word count","wordcount","words")));
  const sizes    = html.map(r => safeNum(col(r,"size","page size","pagesize")));
  const imgs     = html.map(r => safeNum(col(r,"images","image count","img count")));
  const inlk     = html.map(r => safeNum(col(r,"inlinks","unique inlinks")));
  const outlk    = html.map(r => safeNum(col(r,"outlinks","unique outlinks")));
  const redirects = rows.filter(r => { const sc = safeNum(col(r,"status code","status_code","statuscode")||200); return sc >= 300 && sc < 400; }).length;
  const errors   = rows.filter(r => { const sc = safeNum(col(r,"status code","status_code","statuscode")||200); return sc >= 400; }).length;

  return {
    totalPages:    total,
    titleOptRate:  Math.round((titlesOk / total) * 100),
    metaOptRate:   Math.round((metaOk / total) * 100),
    h1Rate:        Math.round((h1Ok / total) * 100),
    avgWords:      Math.round(avg(words)),
    avgSizeKB:     Math.round(avg(sizes) / 1024),
    avgImages:     Math.round(avg(imgs) * 10) / 10,
    avgInlinks:    Math.round(avg(inlk) * 10) / 10,
    avgOutlinks:   Math.round(avg(outlk) * 10) / 10,
    errorRate:     Math.round((errors / allTotal) * 100),
    redirectRate:  Math.round((redirects / allTotal) * 100),
  };
}

// ── EXTRACT GSC ──────────────────────────────────────────────
function extractGSC(rows) {
  if (!rows.length) return null;
  const clicks     = rows.map(r => safeNum(r["clicks"] || r["clics"] || 0));
  const impressions= rows.map(r => safeNum(r["impressions"] || 0));
  const ctr        = rows.map(r => safeNum((r["ctr"] || r["taux de clics"] || "0").replace("%","")));
  const position   = rows.map(r => safeNum(r["position"] || r["position moyenne"] || 0));
  return {
    clicks:      clicks.reduce((a,b)=>a+b,0),
    impressions: impressions.reduce((a,b)=>a+b,0),
    ctr:         Math.round(avg(ctr) * 100) / 100,
    position:    Math.round(avg(position.filter(x=>x>0)) * 10) / 10,
  };
}

// ── EXTRACT GA ───────────────────────────────────────────────
function extractGA(rows) {
  if (!rows.length) return null;
  const sessions  = rows.map(r => safeNum(r["sessions"] || r["séances"] || 0));
  const users     = rows.map(r => safeNum(r["users"] || r["utilisateurs"] || r["total users"] || 0));
  const bounce    = rows.map(r => safeNum((r["bounce rate"] || r["taux de rebond"] || "0").replace("%","")));
  return {
    sessions:   sessions.reduce((a,b)=>a+b,0),
    users:      users.reduce((a,b)=>a+b,0),
    bounceRate: Math.round(avg(bounce.filter(x=>x>0)) * 10) / 10,
  };
}

// ── EXTRACT BING ─────────────────────────────────────────────
function extractBing(rows) {
  if (!rows.length) return null;
  const mentions = rows.map(r => safeNum(r["mentions"] || r["impressions"] || r["appearancecount"] || 0));
  const clicks   = rows.map(r => safeNum(r["clicks"] || r["clics"] || r["clickcount"] || 0));
  return {
    geoMentions: mentions.reduce((a,b)=>a+b,0),
    geoClicks:   clicks.reduce((a,b)=>a+b,0),
  };
}

// ── CORRELATION CELL COLOR ───────────────────────────────────
function corrColor(v) {
  if (v === null) return { bg: "#F5F5F7", text: "#C0C0CC", border: "#E8E8ED" };
  const a = Math.abs(v);
  if (a >= 0.7) return v > 0
    ? { bg: "#DCFCE7", text: "#15803D", border: "#86EFAC" }
    : { bg: "#FEE2E2", text: "#B91C1C", border: "#FCA5A5" };
  if (a >= 0.4) return { bg: "#FEF9C3", text: "#92400E", border: "#FDE68A" };
  return { bg: "#F1F5F9", text: "#64748B", border: "#CBD5E1" };
}

// ── SCORE BADGE ──────────────────────────────────────────────
function Badge({ children, color, bg }) {
  return (
    <span style={{ background: bg, color, borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 600, letterSpacing: 0.3 }}>
      {children}
    </span>
  );
}

// ── UPLOAD CARD ──────────────────────────────────────────────
function UploadCard({ label, icon, hint, onData, loaded, color }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef();

  const handle = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => { onData(parseCSV(e.target.result)); };
    reader.readAsText(file);
  }, [onData]);

  return (
    <div
      onClick={() => ref.current.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); }}
      style={{
        border: `1.5px dashed ${drag ? color : loaded ? color : "#D1D5DB"}`,
        borderRadius: 10,
        padding: "14px 16px",
        cursor: "pointer",
        background: loaded ? `${color}0D` : drag ? `${color}08` : "#FAFAFA",
        transition: "all 0.18s",
        display: "flex", alignItems: "center", gap: 12,
      }}
    >
      <input ref={ref} type="file" accept=".csv" style={{ display: "none" }} onChange={e => handle(e.target.files[0])} />
      <div style={{ fontSize: 22 }}>{loaded ? "✅" : icon}</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: loaded ? color : C.textMid }}>{label}</div>
        <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>{loaded ? "Fichier chargé" : hint}</div>
      </div>
    </div>
  );
}

// ── SECTION HEADER ───────────────────────────────────────────
function SectionHeader({ title, sub }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text, fontFamily: "'Georgia', serif", letterSpacing: -0.5 }}>{title}</h2>
      {sub && <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textLight }}>{sub}</p>}
    </div>
  );
}

// ── STAT PILL ────────────────────────────────────────────────
function StatPill({ label, value, color }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", minWidth: 110 }}>
      <div style={{ fontSize: 11, color: C.textLight, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || C.text, fontVariantNumeric: "tabular-nums" }}>{value ?? "—"}</div>
    </div>
  );
}

// ── MAIN ─────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("import");

  // Raw CSV rows per site per source
  const [sfData,   setSfData]   = useState({ wedig: [], deux: [], lets: [] });
  const [gscData,  setGscData]  = useState({ wedig: [], deux: [], lets: [] });
  const [gaData,   setGaData]   = useState({ wedig: [], deux: [], lets: [] });
  const [bingData, setBingData] = useState({ wedig: [], deux: [], lets: [] });

  // Date ranges
  const today = new Date().toISOString().slice(0,10);
  const m3ago = new Date(Date.now() - 90*86400000).toISOString().slice(0,10);
  const [dates, setDates] = useState({ from: m3ago, to: today });

  // Computed metrics per site
  const metrics = useMemo(() => {
    return SITES.map(s => ({
      site: s,
      sf:   extractSF(sfData[s.id]),
      gsc:  extractGSC(gscData[s.id]),
      ga:   extractGA(gaData[s.id]),
      bing: extractBing(bingData[s.id]),
    }));
  }, [sfData, gscData, gaData, bingData]);

  // Flatten result KPIs per site
  const resultVals = useMemo(() => metrics.map(m => ({
    clicks:      m.gsc?.clicks      ?? 0,
    impressions: m.gsc?.impressions ?? 0,
    ctr:         m.gsc?.ctr         ?? 0,
    position:    m.gsc?.position    ?? 0,
    sessions:    m.ga?.sessions     ?? 0,
    users:       m.ga?.users        ?? 0,
    bounceRate:  m.ga?.bounceRate   ?? 0,
    geoMentions: m.bing?.geoMentions?? 0,
    geoClicks:   m.bing?.geoClicks  ?? 0,
  })), [metrics]);

  // Correlation matrix: SF dim × Result KPI
  const corrMatrix = useMemo(() => {
    return SF_DIMS.map(dim => ({
      dim,
      corrs: RES_KPIS.map(kpi => {
        const sfVals  = metrics.map(m => m.sf ? (m.sf[dim.key] ?? 0) : 0);
        const resVals = resultVals.map(r => r[kpi.key] ?? 0);
        const v = pearson(sfVals, resVals);
        return { kpi, value: v };
      }),
    }));
  }, [metrics, resultVals]);

  // Radar data
  const radarData = useMemo(() => SF_DIMS.slice(0,7).map(d => {
    const row = { dim: d.label.split(" ")[0] };
    metrics.forEach(m => { row[m.site.id] = m.sf ? Math.min((m.sf[d.key] / (d.key==="avgWords"?800:d.key==="avgSizeKB"?300:100))*100, 100) : 0; });
    return row;
  }), [metrics]);

  const TABS = ["import","overview","matrix","sites"];

  return (
    <div style={{ fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: C.bg, minHeight: "100vh", color: C.text }}>
      {/* TOP NAV */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
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
                background: tab === t ? C.blue : "transparent",
                color: tab === t ? "#fff" : C.textMid,
                transition: "all 0.15s",
                textTransform: "capitalize",
              }}>{t === "import" ? "Import" : t === "overview" ? "Vue d'ensemble" : t === "matrix" ? "Matrice" : "Sites"}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 28px" }}>

        {/* ── IMPORT TAB ── */}
        {tab === "import" && (
          <div>
            <SectionHeader title="Import des données" sub="Chargez les exports CSV pour chaque site et chaque source de données" />

            {/* Date range */}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px", marginBottom: 24, display: "flex", alignItems: "center", gap: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textMid, minWidth: 120 }}>📅 Période GSC / GA4</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: C.textLight, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>Du</label>
                  <input type="date" value={dates.from} onChange={e => setDates(d => ({...d, from: e.target.value}))}
                    style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 12px", fontSize: 13, color: C.text, background: C.white, outline: "none" }} />
                </div>
                <div style={{ color: C.textLight, marginTop: 16 }}>→</div>
                <div>
                  <label style={{ fontSize: 11, color: C.textLight, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>Au</label>
                  <input type="date" value={dates.to} onChange={e => setDates(d => ({...d, to: e.target.value}))}
                    style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 12px", fontSize: 13, color: C.text, background: C.white, outline: "none" }} />
                </div>
              </div>
              <div style={{ marginLeft: "auto", fontSize: 12, color: C.textLight, background: C.blueLight, color: C.blue, padding: "6px 14px", borderRadius: 20 }}>
                Période : {dates.from} → {dates.to}
              </div>
            </div>

            {/* Upload grids per site */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
              {SITES.map(site => (
                <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
                  {/* Site header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${C.borderLight}` }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: site.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 16 }}>🌐</span>
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: site.color }}>{site.label}</div>
                      <div style={{ fontSize: 11, color: C.textLight }}>4 sources de données</div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <UploadCard label="Screaming Frog Internal" icon="🕷️" hint="internal_html.csv" color={site.color}
                      loaded={sfData[site.id].length > 0}
                      onData={rows => setSfData(p => ({...p, [site.id]: rows}))} />
                    <UploadCard label="Google Search Console" icon="🔍" hint="Export GSC · clics, impressions, CTR" color={site.color}
                      loaded={gscData[site.id].length > 0}
                      onData={rows => setGscData(p => ({...p, [site.id]: rows}))} />
                    <UploadCard label="Google Analytics 4" icon="📊" hint="Export GA4 · sessions, users, rebond" color={site.color}
                      loaded={gaData[site.id].length > 0}
                      onData={rows => setGaData(p => ({...p, [site.id]: rows}))} />
                    <UploadCard label="Bing AI Performance" icon="🤖" hint="Export Bing · mentions GEO, clics" color={site.color}
                      loaded={bingData[site.id].length > 0}
                      onData={rows => setBingData(p => ({...p, [site.id]: rows}))} />
                  </div>

                  {/* Status summary */}
                  <div style={{ marginTop: 16, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[
                      ["SF", sfData[site.id].length],
                      ["GSC", gscData[site.id].length],
                      ["GA4", gaData[site.id].length],
                      ["Bing", bingData[site.id].length],
                    ].map(([src, n]) => (
                      <div key={src} style={{
                        fontSize: 11, padding: "3px 9px", borderRadius: 20, fontWeight: 600,
                        background: n > 0 ? site.bg : C.borderLight,
                        color: n > 0 ? site.color : C.textLight,
                      }}>{src} {n > 0 ? `· ${n} lignes` : "· vide"}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── OVERVIEW TAB ── */}
        {tab === "overview" && (
          <div>
            <SectionHeader title="Vue d'ensemble" sub="Scores agrégés et comparaison des 3 sites" />

            {/* KPI cards per site */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginBottom: 28 }}>
              {metrics.map(({ site, sf, gsc, ga, bing }) => (
                <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ background: site.bg, padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: site.color }}>{site.label}</div>
                      {sf && <Badge color={site.color} bg={site.bg}>{sf.totalPages} pages</Badge>}
                    </div>
                  </div>

                  <div style={{ padding: "20px" }}>
                    {/* SF metrics */}
                    {sf ? (
                      <div>
                        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 10 }}>🕷️ Screaming Frog</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 16 }}>
                          {[
                            ["Title OK", `${sf.titleOptRate}%`],
                            ["Meta OK", `${sf.metaOptRate}%`],
                            ["H1 unique", `${sf.h1Rate}%`],
                            ["Mots moy.", sf.avgWords],
                            ["Poids", `${sf.avgSizeKB}KB`],
                            ["Images", sf.avgImages],
                            ["Inlinks", sf.avgInlinks],
                            ["Erreurs", `${sf.errorRate}%`],
                          ].map(([k,v]) => (
                            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 8px", background: C.bg, borderRadius: 6 }}>
                              <span style={{ fontSize: 12, color: C.textMid }}>{k}</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : <div style={{ color: C.textLight, fontSize: 12, padding: "10px 0 14px", borderBottom: `1px solid ${C.borderLight}` }}>Aucun CSV SF chargé</div>}

                    {/* GSC */}
                    {gsc && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>🔍 GSC</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <StatPill label="Sessions" value={ga.sessions.toLocaleString()} color={C.blue} />
                          <StatPill label="Users" value={ga.users.toLocaleString()} />
                          <StatPill label="Rebond" value={`${ga.bounceRate}%`} color={ga.bounceRate > 60 ? C.red : C.green} />
                        </div>
                      </div>
                    )}
                    {bing && (
                      <div>
                        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>🤖 Bing AI</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <StatPill label="Mentions" value={bing.geoMentions.toLocaleString()} color={C.purple} />
                          <StatPill label="Clics" value={bing.geoClicks.toLocaleString()} color={C.blue} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Radar chart */}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textMid, marginBottom: 4 }}>Profil technique SF — comparaison radar</div>
              <div style={{ fontSize: 12, color: C.textLight, marginBottom: 16 }}>Scores normalisés 0–100 par dimension</div>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke={C.border} />
                  <PolarAngleAxis dataKey="dim" tick={{ fill: C.textLight, fontSize: 11 }} />
                  {SITES.map(s => (
                    <Radar key={s.id} name={s.label} dataKey={s.id} stroke={s.color} fill={s.color} fillOpacity={0.08} strokeWidth={2} dot={{ r: 3 }} />
                  ))}
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ── MATRIX TAB ── */}
        {tab === "matrix" && (
          <div>
            <SectionHeader
              title="Matrice de corrélation"
              sub="Pearson calculé sur les 3 sites · Abscisses = KPIs résultats · Ordonnées = Mesures Screaming Frog"
            />

            {/* Legend */}
            <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
              {[
                [C.green, "#DCFCE7", "#86EFAC", "≥ 0.7", "Corrélation positive forte"],
                [C.red,   "#FEE2E2", "#FCA5A5", "≤ -0.7","Corrélation négative forte"],
                [C.amber, "#FEF9C3", "#FDE68A", "0.4–0.7","Corrélation modérée"],
                ["#64748B","#F1F5F9","#CBD5E1",  "< 0.4", "Corrélation faible"],
                [C.textLight,"#F5F5F7",C.border, "—",    "Données insuffisantes"],
              ].map(([tc, bg, bc, label, desc]) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 28, height: 22, background: bg, border: `1px solid ${bc}`, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: tc, fontWeight: 700 }}>{label}</div>
                  <span style={{ fontSize: 12, color: C.textMid }}>{desc}</span>
                </div>
              ))}
            </div>

            {/* Matrix table */}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={{ padding: "14px 18px", textAlign: "left", fontSize: 12, fontWeight: 600, color: C.textMid, background: C.bg, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, minWidth: 200, position: "sticky", left: 0, zIndex: 2 }}>
                      SF \ Résultats
                    </th>
                    {RES_KPIS.map(kpi => (
                      <th key={kpi.key} style={{ padding: "14px 12px", textAlign: "center", fontSize: 11, fontWeight: 600, color: C.textMid, background: C.bg, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.borderLight}`, minWidth: 100, lineHeight: 1.3 }}>
                        <div>{kpi.label}</div>
                        <div style={{ fontSize: 10, fontWeight: 400, color: C.textLight, marginTop: 2 }}>
                          {kpi.src === "gsc" ? "🔍 GSC" : kpi.src === "ga" ? "📊 GA4" : "🤖 Bing"}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {corrMatrix.map(({ dim, corrs }, ri) => (
                    <tr key={dim.key} style={{ background: ri % 2 === 0 ? C.white : "#FAFBFC" }}>
                      <td style={{ padding: "12px 18px", fontSize: 13, fontWeight: 500, color: C.text, borderRight: `1px solid ${C.border}`, borderBottom: `1px solid ${C.borderLight}`, position: "sticky", left: 0, background: ri % 2 === 0 ? C.white : "#FAFBFC", zIndex: 1 }}>
                        {dim.label}
                        <span style={{ marginLeft: 6, fontSize: 10, color: C.textLight }}>{dim.higher ? "↑ bon" : "↓ bon"}</span>
                      </td>
                      {corrs.map(({ kpi, value }) => {
                        const col = corrColor(value);
                        return (
                          <td key={kpi.key} style={{ padding: "10px 8px", textAlign: "center", borderRight: `1px solid ${C.borderLight}`, borderBottom: `1px solid ${C.borderLight}` }}>
                            <div style={{
                              background: col.bg, color: col.text, border: `1px solid ${col.border}`,
                              borderRadius: 7, padding: "6px 8px", fontSize: 13, fontWeight: 700,
                              fontVariantNumeric: "tabular-nums", letterSpacing: -0.3,
                              transition: "all 0.2s",
                              cursor: "default",
                            }}>
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

            {/* Top correlations */}
            <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {/* Top positive */}
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: C.text, marginBottom: 12 }}>🟢 Top corrélations positives</div>
                {corrMatrix.flatMap(({ dim, corrs }) =>
                  corrs.filter(c => c.value !== null && c.value >= 0.4).map(c => ({ dim, kpi: c.kpi, value: c.value }))
                ).sort((a,b) => b.value - a.value).slice(0,5).map((item, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                    <div>
                      <div style={{ fontSize: 13, color: C.text }}>{item.dim.label}</div>
                      <div style={{ fontSize: 11, color: C.textLight }}>→ {item.kpi.label}</div>
                    </div>
                    <Badge color={C.green} bg={C.greenLight}>+{item.value}</Badge>
                  </div>
                ))}
                {corrMatrix.flatMap(({ dim, corrs }) => corrs.filter(c => c.value !== null && c.value >= 0.4)).length === 0 &&
                  <div style={{ fontSize: 13, color: C.textLight }}>Pas encore de données suffisantes</div>}
              </div>
              {/* Top negative */}
              <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: C.text, marginBottom: 12 }}>🔴 Top corrélations négatives</div>
                {corrMatrix.flatMap(({ dim, corrs }) =>
                  corrs.filter(c => c.value !== null && c.value <= -0.4).map(c => ({ dim, kpi: c.kpi, value: c.value }))
                ).sort((a,b) => a.value - b.value).slice(0,5).map((item, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                    <div>
                      <div style={{ fontSize: 13, color: C.text }}>{item.dim.label}</div>
                      <div style={{ fontSize: 11, color: C.textLight }}>→ {item.kpi.label}</div>
                    </div>
                    <Badge color={C.red} bg={C.redLight}>{item.value}</Badge>
                  </div>
                ))}
                {corrMatrix.flatMap(({ dim, corrs }) => corrs.filter(c => c.value !== null && c.value <= -0.4)).length === 0 &&
                  <div style={{ fontSize: 13, color: C.textLight }}>Pas encore de données suffisantes</div>}
              </div>
            </div>
          </div>
        )}

        {/* ── SITES TAB ── */}
        {tab === "sites" && (
          <div>
            <SectionHeader title="Détail par site" sub="Toutes les métriques brutes extraites des CSV" />
            {metrics.map(({ site, sf, gsc, ga, bing }) => (
              <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 20, overflow: "hidden" }}>
                <div style={{ background: site.bg, padding: "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: site.color }} />
                  <span style={{ fontWeight: 700, fontSize: 16, color: site.color }}>{site.label}</span>
                </div>
                <div style={{ padding: 24 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
                    {/* SF */}
                    <div>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 12, fontWeight: 600 }}>🕷️ Screaming Frog</div>
                      {sf ? SF_DIMS.map(d => (
                        <div key={d.key} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.borderLight}`, fontSize: 12 }}>
                          <span style={{ color: C.textMid }}>{d.label}</span>
                          <span style={{ fontWeight: 600 }}>{sf[d.key] ?? "—"}</span>
                        </div>
                      )) : <div style={{ color: C.textLight, fontSize: 12 }}>Aucun fichier chargé</div>}
                    </div>
                    {/* GSC */}
                    <div>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 12, fontWeight: 600 }}>🔍 Google Search Console</div>
                      {gsc ? Object.entries(gsc).map(([k,v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.borderLight}`, fontSize: 12 }}>
                          <span style={{ color: C.textMid }}>{k}</span>
                          <span style={{ fontWeight: 600 }}>{typeof v === "number" ? v.toLocaleString() : v}</span>
                        </div>
                      )) : <div style={{ color: C.textLight, fontSize: 12 }}>Aucun fichier chargé</div>}
                    </div>
                    {/* GA */}
                    <div>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 12, fontWeight: 600 }}>📊 Google Analytics 4</div>
                      {ga ? Object.entries(ga).map(([k,v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.borderLight}`, fontSize: 12 }}>
                          <span style={{ color: C.textMid }}>{k}</span>
                          <span style={{ fontWeight: 600 }}>{typeof v === "number" ? v.toLocaleString() : v}</span>
                        </div>
                      )) : <div style={{ color: C.textLight, fontSize: 12 }}>Aucun fichier chargé</div>}
                    </div>
                    {/* Bing */}
                    <div>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 12, fontWeight: 600 }}>🤖 Bing AI Performance</div>
                      {bing ? Object.entries(bing).map(([k,v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.borderLight}`, fontSize: 12 }}>
                          <span style={{ color: C.textMid }}>{k}</span>
                          <span style={{ fontWeight: 600 }}>{typeof v === "number" ? v.toLocaleString() : v}</span>
                        </div>
                      )) : <div style={{ color: C.textLight, fontSize: 12 }}>Aucun fichier chargé</div>}
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
