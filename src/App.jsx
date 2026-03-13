import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { C, SF_DIMS, RES_KPIS, RADAR_DIMS, DEFAULT_SITES, SEMRUSH_DIMS } from "./lib/constants";
import { emptyDataMap, makeInitialProject, parseCSV } from "./lib/helpers";
import { extractSF, extractGSC, extractGA, extractBing, extractSemrush, parseSemrush, filterByMode } from "./lib/parsers";
import { buildUrlMaps, buildSfPageVectors, intraCorrFast, smIntraCorr } from "./lib/correlations";
import { sbSaveProject, sbLoadProjects, sbGetHistory, sbGetLatest, sbDownload, sbGetPageTypes } from "./lib/supabase";
import AnalyseTab from "./tabs/AnalyseTab";
import ImportTab from "./tabs/ImportTab";
import OverviewTab from "./tabs/OverviewTab";
import MatrixTab from "./tabs/MatrixTab";
import PagesTab from "./tabs/PagesTab";
import SitesTab from "./tabs/SitesTab";
import AllProjectsTab from "./tabs/AllProjectsTab";
import SemrushTab from "./tabs/SemrushTab";
import EvolutionTab from "./tabs/EvolutionTab";

const INITIAL_PROJECT = makeInitialProject();
const NAV_TABS = [
  { key: "import",      label: "⚙️ Setup"      },
  { key: "overview",    label: "Vue d'ensemble" },
  { key: "pages",       label: "Pages"          },
  { key: "sites",       label: "Sites"          },
  { key: "evolution",   label: "📅 Évolution"   },
  { key: "analyse",     label: "✦ Analyse IA"   },
];

const BURGER_TABS = [
  { key: "matrix",      label: "Matrice"            },
  { key: "semrush",     label: "📊 Semrush"         },
  { key: "allprojects", label: "◈ Tous les projets" },
];

function NavBar({ tab, setTab }) {
  const [burgerOpen, setBurgerOpen] = useState(false);
  const burgerRef = useRef(null);
  const isBurgerTab = BURGER_TABS.some(t => t.key === tab);

  // Close on outside click
  useEffect(() => {
    if (!burgerOpen) return;
    const handler = (e) => { if (!burgerRef.current?.contains(e.target)) setBurgerOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [burgerOpen]);

  const tabBtn = (t) => (
    <button key={t.key} onClick={() => { setTab(t.key); setBurgerOpen(false); }} style={{
      padding: "6px 14px", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 500,
      background: tab === t.key ? C.blue : "transparent",
      color: tab === t.key ? "#fff" : C.textMid,
      transition: "all 0.15s", whiteSpace: "nowrap",
    }}>{t.label}</button>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {NAV_TABS.map(tabBtn)}

      {/* Burger */}
      <div ref={burgerRef} style={{ position: "relative" }}>
        <button
          onClick={() => setBurgerOpen(o => !o)}
          style={{
            padding: "6px 10px", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13,
            background: isBurgerTab || burgerOpen ? C.blue : "transparent",
            color: isBurgerTab || burgerOpen ? "#fff" : C.textMid,
            transition: "all 0.15s", display: "flex", alignItems: "center", gap: 5,
          }}
          title="Plus d'onglets"
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>☰</span>
          {isBurgerTab && (
            <span style={{ fontSize: 12 }}>{BURGER_TABS.find(t => t.key === tab)?.label}</span>
          )}
        </button>

        {burgerOpen && (
          <div style={{
            position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 300,
            background: C.white, border: `1px solid ${C.border}`, borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.1)", padding: "6px", minWidth: 180,
            display: "flex", flexDirection: "column", gap: 2,
          }}>
            {BURGER_TABS.map(t => (
              <button key={t.key} onClick={() => { setTab(t.key); setBurgerOpen(false); }} style={{
                padding: "8px 14px", border: "none", borderRadius: 7, cursor: "pointer",
                fontSize: 13, fontWeight: 500, textAlign: "left",
                background: tab === t.key ? C.blueLight : "transparent",
                color: tab === t.key ? C.blue : C.textMid,
                transition: "background 0.12s",
              }}
                onMouseEnter={e => { if (tab !== t.key) e.currentTarget.style.background = C.bg; }}
                onMouseLeave={e => { if (tab !== t.key) e.currentTarget.style.background = "transparent"; }}
              >{t.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  // ── Projects ─────────────────────────────────────────────────────
  const [projects, setProjects]             = useState([INITIAL_PROJECT]);
  const [currentProjectId, setCurrentProjectId] = useState(INITIAL_PROJECT.id);
  const [editingProjectName, setEditingProjectName] = useState(null);

  const currentProject = projects.find(p => p.id === currentProjectId) || projects[0];

  const currentProjectIdRef = useRef(currentProjectId);
  useEffect(() => { currentProjectIdRef.current = currentProjectId; }, [currentProjectId]);

  const updateProject = useCallback(
    (updater) => setProjects(prev => prev.map(p =>
      p.id === currentProjectIdRef.current ? { ...p, ...updater(p) } : p
    )),
    []
  );

  const sites    = currentProject.sites;
  const sfData   = currentProject.sfData;
  const gscData  = currentProject.gscData;
  const gaData   = currentProject.gaData;
  const bingData = currentProject.bingData;
  const smData   = currentProject.smData;

  const setSfData   = useCallback((fn) => updateProject(p => ({ sfData:   typeof fn === "function" ? fn(p.sfData)   : fn })), [updateProject]);
  const setGscData  = useCallback((fn) => updateProject(p => ({ gscData:  typeof fn === "function" ? fn(p.gscData)  : fn })), [updateProject]);
  const setGaData   = useCallback((fn) => updateProject(p => ({ gaData:   typeof fn === "function" ? fn(p.gaData)   : fn })), [updateProject]);
  const setBingData = useCallback((fn) => updateProject(p => ({ bingData: typeof fn === "function" ? fn(p.bingData) : fn })), [updateProject]);
  const setSites    = useCallback((fn) => updateProject(p => ({ sites:    typeof fn === "function" ? fn(p.sites)    : fn })), [updateProject]);
  const setSmData   = useCallback((fn) => updateProject(p => ({ smData:   typeof fn === "function" ? fn(p.smData)   : fn })), [updateProject]);

  // ── UI state ─────────────────────────────────────────────────────
  const [confirmModal, setConfirmModal] = useState(null);
  const [tab, setTab]                   = useState("import");
  const [pageMode, setPageMode]         = useState("all");
  const [templateFilter, setTemplateFilter] = useState([]); // [] = all types, array for multi-select
  const [pageTypes, setPageTypes]           = useState({}); // { siteId: { urlPath: type } }
  const [matrixSites, setMatrixSites]   = useState(DEFAULT_SITES.map(s => s.id));
  const [radarSites, setRadarSites]     = useState(DEFAULT_SITES.map(s => s.id));
  const [analysis, setAnalysis]         = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError]     = useState(null);

  // Sync selection states when project or sites change
  useEffect(() => {
    const ids = sites.map(s => s.id);
    setMatrixSites(ids);
    setRadarSites(ids);
    setAnalysis(null);
    setAnalysisError(null);
    setTemplateFilter([]);
    setPageTypes({});
  }, [currentProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ids = sites.map(s => s.id);
    setMatrixSites(prev => { const kept = prev.filter(id => ids.includes(id)); return kept.length ? kept : ids; });
    setRadarSites(prev  => { const kept = prev.filter(id => ids.includes(id)); return kept.length ? kept : ids; });
  }, [sites]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Supabase ─────────────────────────────────────────────────────
  const [dbHistory, setDbHistory]   = useState([]);
  const [dbLoading, setDbLoading]   = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadedProjectsRef = useRef(new Set());

  const loadProjectData = useCallback(async (pid) => {
    const [latest, history] = await Promise.all([sbGetLatest(pid), sbGetHistory(pid)]);
    setDbHistory(history);
    const updates = await Promise.all(Object.values(latest).map(async (row) => {
      try {
        const text = await sbDownload(row.storage_path);
        const src = row.source;
        const key = src === "sf" ? "sfData" : src === "gsc" ? "gscData" : src === "ga" ? "gaData" : src === "bing" ? "bingData" : src === "sm" ? "smData" : null;
        if (!key) return null;
        const rawRows = parseCSV(text);
        const rows = src === "sm" ? parseSemrush(rawRows) : rawRows;
        return { key, storedSid: row.site_id, rows };
      } catch (e) { console.warn("Auto-load failed:", row.source, e); return null; }
    }));
    const valid = updates.filter(Boolean);
    if (valid.length > 0) {
      setProjects(prev => prev.map(p => {
        if (p.id !== pid) return p;
        const patch = {};
        const siteIds = new Set(p.sites.map(s => s.id));
        for (const { key, storedSid, rows } of valid) {
          if (siteIds.has(storedSid)) {
            patch[key] = { ...(patch[key] || p[key]), [storedSid]: rows };
          }
        }
        return { ...p, ...patch };
      }));
    }
    // Load page types for all sites
    const ptUpdates = await Promise.all(
      Object.keys(latest).map(async sid => {
        const rows = await sbGetPageTypes(pid, sid);
        if (!rows.length) return null;
        const map = {};
        rows.forEach(r => { map[r.url] = r.page_type; });
        return { sid, map };
      })
    );
    const ptValid = ptUpdates.filter(Boolean);
    if (ptValid.length) {
      setPageTypes(prev => {
        const next = { ...prev };
        ptValid.forEach(({ sid, map }) => { next[sid] = map; });
        return next;
      });
    }
    return valid.length; // return import count so caller can pick best project
  }, []);

  useEffect(() => {
    (async () => {
      setDbLoading(true);
      try {
        const savedProjects = await sbLoadProjects();
          if (savedProjects && savedProjects.length > 0) {
          const restored = savedProjects.map(p => ({
            ...p,
            sfData:   emptyDataMap(p.sites),
            gscData:  emptyDataMap(p.sites),
            gaData:   emptyDataMap(p.sites),
            bingData: emptyDataMap(p.sites),
            smData:   emptyDataMap(p.sites),
          }));
          // Load all CSV data first (before touching state)
          const allData = await Promise.all(restored.map(async (p) => {
            loadedProjectsRef.current.add(p.id);
            const [latest, history] = await Promise.all([sbGetLatest(p.id), sbGetHistory(p.id)]);
            if (p.id === restored[0].id) setDbHistory(history);
            const updates = await Promise.all(Object.values(latest).map(async (row) => {
              try {
                const text = await sbDownload(row.storage_path);
                const rows = parseCSV(text);
                const src = row.source;
                const key = src === "sf" ? "sfData" : src === "gsc" ? "gscData" : src === "ga" ? "gaData" : src === "bing" ? "bingData" : src === "sm" ? "smData" : null;
                return key ? { key, sid: row.site_id, rows } : null;
              } catch(e) { return null; }
            }));
            const valid = updates.filter(Boolean);
            return { id: p.id, count: valid.length, valid };
          }));
          // Build fully-loaded projects in one shot, then set state once
          const loaded = restored.map(p => {
            const { valid } = allData.find(d => d.id === p.id) || { valid: [] };
            const patch = {};
            const siteIds = new Set(p.sites.map(s => s.id));
            for (const { key, sid, rows } of valid) {
              if (siteIds.has(sid)) patch[key] = { ...(patch[key] || p[key]), [sid]: rows };
            }
            return { ...p, ...patch };
          });
          setProjects(loaded);
          // Activate the project with the most imports
          const bestId = allData.sort((a, b) => b.count - a.count)[0]?.id || restored[0].id;
          setCurrentProjectId(bestId);
        } else {
          await sbSaveProject(INITIAL_PROJECT);
          loadedProjectsRef.current.add(INITIAL_PROJECT.id);
          const history = await sbGetHistory(INITIAL_PROJECT.id);
          setDbHistory(history);
        }
      } catch (e) { console.warn("Supabase init error", e); }
      finally { setDbLoading(false); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (loadedProjectsRef.current.has(currentProjectId)) return;
    loadedProjectsRef.current.add(currentProjectId);
    (async () => {
      setDbLoading(true);
      try { await loadProjectData(currentProjectId); }
      catch (e) { console.warn("Supabase project switch error", e); }
      finally { setDbLoading(false); }
    })();
  }, [currentProjectId, loadProjectData]);

  useEffect(() => {
    if (!currentProject) return;
    const t = setTimeout(() => sbSaveProject(currentProject), 800);
    return () => clearTimeout(t);
  }, [currentProject]);

  const refreshHistory = useCallback(async () => {
    const history = await sbGetHistory(currentProjectId);
    setDbHistory(history);
  }, [currentProjectId]);

  // ── Computed metrics ─────────────────────────────────────────────
  const baseMetrics = useMemo(() => sites.map(s => ({
    site: s,
    sf: extractSF(sfData[s.id] || [], "all", bingData[s.id] || [], gscData[s.id] || []),
  })), [sites, sfData, gscData, bingData]);

  const metrics = useMemo(() => sites.map((s, si) => {
    const base = baseMetrics[si];
    return {
      site: s,
      sf:     pageMode === "all" ? (base?.sf ?? null) : extractSF(sfData[s.id] || [], pageMode, bingData[s.id] || [], gscData[s.id] || []),
      sfBase: base?.sf ?? null,
      gsc:    gscData[s.id]?.length  > 0 ? extractGSC(gscData[s.id])   : null,
      ga:     gaData[s.id]?.length   > 0 ? extractGA(gaData[s.id])     : null,
      bing:   bingData[s.id]?.length > 0 ? extractBing(bingData[s.id]) : null,
      sm:     smData[s.id]?.length   > 0 ? extractSemrush(smData[s.id]) : null,
    };
  }), [sites, sfData, gscData, gaData, bingData, smData, pageMode, baseMetrics]);

  const resultVals = useMemo(() => metrics.map(m => ({
    clicks:      m.gsc?.clicks      ?? 0,
    impressions: m.gsc?.impressions  ?? 0,
    ctr:         m.gsc?.ctr          ?? 0,
    position:    m.gsc?.position     ?? 0,
    sessions:    m.ga?.sessions      ?? 0,
    views:       m.ga?.views         ?? 0,
    geoMentions: m.bing?.geoMentions ?? 0,
  })), [metrics]);

  const semrushCorrMatrix = useMemo(() => {
    const smRows = matrixSites.flatMap(id => smData[id] || []);
    if (!smRows.length) return SEMRUSH_DIMS.map(dim => ({ dim, corrs: RES_KPIS.map(kpi => ({ kpi, value: null, n: 0 })) }));
    const gscRows  = matrixSites.flatMap(id => gscData[id]  || []);
    const gaRows   = matrixSites.flatMap(id => gaData[id]   || []);
    const bingRows = matrixSites.flatMap(id => bingData[id] || []);
    const urlMaps  = buildUrlMaps(gscRows, gaRows, bingRows);
    return SEMRUSH_DIMS.map(dim => ({
      dim,
      corrs: RES_KPIS.map(kpi => {
        const res = smIntraCorr(smRows, urlMaps, dim.key, kpi.key);
        return { kpi, value: res?.value ?? null, n: res?.n ?? 0 };
      }),
    }));
  }, [matrixSites, smData, gscData, gaData, bingData]);



  const baseMatrix = useMemo(() => {
    const sfRows = matrixSites.flatMap(id => sfData[id] || []);
    if (!sfRows.length) return SF_DIMS.map(dim => ({ dim, corrs: RES_KPIS.map(kpi => ({ kpi, value: null })) }));
    const gscRows  = matrixSites.flatMap(id => gscData[id]  || []);
    const gaRows   = matrixSites.flatMap(id => gaData[id]   || []);
    const bingRows = matrixSites.flatMap(id => bingData[id] || []);
    const sfPages  = buildSfPageVectors(sfRows);
    const urlMaps  = buildUrlMaps(gscRows, gaRows, bingRows);
    return SF_DIMS.map(dim => ({
      dim,
      corrs: RES_KPIS.map(kpi => {
        const res = intraCorrFast(sfPages, urlMaps, dim.key, kpi.key);
        return { kpi, value: res ? res.value : null };
      }),
    }));
  }, [matrixSites, sfData, gscData, gaData, bingData]);

  const filteredCorrMatrix = useMemo(() => {
    const sfRowsAll = matrixSites.flatMap(id => sfData[id] || []);
    if (!sfRowsAll.length) return SF_DIMS.map((dim, di) => ({
      dim,
      corrs: RES_KPIS.map((kpi, ki) => ({ kpi, value: null, n: 0, base: baseMatrix[di]?.corrs[ki]?.value ?? null, delta: null })),
    }));
    const gscRows  = matrixSites.flatMap(id => gscData[id]  || []);
    const gaRows   = matrixSites.flatMap(id => gaData[id]   || []);
    const bingRows = matrixSites.flatMap(id => bingData[id] || []);
    const sfFiltered = filterByMode(sfRowsAll, pageMode, bingRows, gscRows);
    const sfByTemplate = templateFilter?.length
      ? sfFiltered.filter(r => {
          const url = (r["adresse"] || r["address"] || r["url"] || "").trim();
          const type = matrixSites.reduce((found, sid) => found || (pageTypes[sid] || {})[url] || null, null);
          return type && templateFilter.includes(type);
        })
      : sfFiltered;
    const sfPages    = buildSfPageVectors(sfByTemplate);
    const urlMaps    = buildUrlMaps(gscRows, gaRows, bingRows);
    return SF_DIMS.map((dim, di) => ({
      dim,
      corrs: RES_KPIS.map((kpi, ki) => {
        const res   = intraCorrFast(sfPages, urlMaps, dim.key, kpi.key);
        const base  = baseMatrix[di]?.corrs[ki]?.value ?? null;
        const val   = res ? res.value : null;
        const delta = val !== null && base !== null ? Math.round((val - base) * 100) / 100 : null;
        return { kpi, value: val, n: res ? res.n : 0, base, delta };
      }),
    }));
  }, [matrixSites, sfData, gscData, gaData, bingData, pageMode, baseMatrix, templateFilter, pageTypes]);

  const radarData = useMemo(() => RADAR_DIMS.map(d => {
    const row = { dim: d.label };
    metrics.forEach(m => { row[m.site.id] = m.sf ? Math.min(((m.sf[d.key] ?? 0) / d.max) * 100, 100) : 0; });
    return row;
  }), [metrics]);

  const allProjectsMatrix = useMemo(() => {
    const allSf = projects.flatMap(p => Object.values(p.sfData || {}).flat());
    if (!allSf.length) return SF_DIMS.map(dim => ({ dim, corrs: RES_KPIS.map(kpi => ({ kpi, value: null, n: 0 })) }));
    const allGsc  = projects.flatMap(p => Object.values(p.gscData  || {}).flat());
    const allGa   = projects.flatMap(p => Object.values(p.gaData   || {}).flat());
    const allBing = projects.flatMap(p => Object.values(p.bingData || {}).flat());
    const allSfFiltered = templateFilter?.length
      ? allSf.filter(r => {
          const url = (r["adresse"] || r["address"] || r["url"] || "").trim();
          const type = projects.flatMap(p => Object.keys(pageTypes[Object.keys(p.sfData||{})[0]]||{})).length
            ? Object.values(pageTypes).reduce((found, map) => found || map[url] || null, null)
            : null;
          return type && templateFilter.includes(type);
        })
      : allSf;
    const sfPages = buildSfPageVectors(allSfFiltered);
    const urlMaps = buildUrlMaps(allGsc, allGa, allBing);
    return SF_DIMS.map(dim => ({
      dim,
      corrs: RES_KPIS.map(kpi => {
        const res = intraCorrFast(sfPages, urlMaps, dim.key, kpi.key);
        return { kpi, value: res ? res.value : null, n: res ? res.n : 0 };
      }),
    }));
  }, [projects]); // eslint-disable-line react-hooks/exhaustive-deps

  const allProjectsRadar = useMemo(() => {
    const anyData = projects.some(p => Object.values(p.sfData || {}).flat().length > 0);
    if (!anyData) return RADAR_DIMS.map(d => ({ dim: d.label }));
    return RADAR_DIMS.map(d => {
      const row = { dim: d.label };
      projects.forEach(p => {
        const allSfRows = Object.values(p.sfData || {}).flat();
        if (!allSfRows.length) { row[p.id] = 0; return; }
        const sfAgg = extractSF(allSfRows, "all", Object.values(p.bingData || {}).flat(), Object.values(p.gscData || {}).flat());
        row[p.id] = sfAgg ? Math.min(((sfAgg[d.key] ?? 0) / d.max) * 100, 100) : 0;
      });
      return row;
    });
  }, [projects]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ───────────────────────────────────────────────────────
  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: C.bg, minHeight: "100vh", color: C.text }}>

        {/* ── NAV ── */}
        <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 100 }}>
          <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 28, height: 28, background: C.blue, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "#fff", fontSize: 14, fontWeight: 800 }}>C</span>
              </div>
              <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.3 }}>CorrelDash</span>
              <span style={{ color: C.textLight, fontSize: 13 }}>· SEO × GEO</span>
            </div>
            <NavBar tab={tab} setTab={setTab} />
          </div>
        </div>

        {/* ── CONTENT ── */}
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "32px 28px" }}>

          {tab === "import" && (
            <ImportTab
              projects={projects}
              currentProjectId={currentProjectId}
              setCurrentProjectId={setCurrentProjectId}
              editingProjectName={editingProjectName}
              setEditingProjectName={setEditingProjectName}
              setProjects={setProjects}
              sites={sites}
              setSites={setSites}
              sfData={sfData}
              gscData={gscData}
              gaData={gaData}
              bingData={bingData}
              setSfData={setSfData}
              setGscData={setGscData}
              setGaData={setGaData}
              setBingData={setBingData}
              smData={smData}
              setSmData={setSmData}
              confirmModal={confirmModal}
              setConfirmModal={setConfirmModal}
              dbHistory={dbHistory}
              dbLoading={dbLoading}
              showHistory={showHistory}
              setShowHistory={setShowHistory}
              refreshHistory={refreshHistory}
            pageTypes={pageTypes}
            setPageTypes={setPageTypes}
            />
          )}

          {tab === "overview" && (
            <OverviewTab
              sites={sites}
              smData={smData}
              pageMode={pageMode}
              setPageMode={setPageMode}
              radarSites={radarSites}
              setRadarSites={setRadarSites}
              metrics={metrics}
              radarData={radarData}
              pageTypes={pageTypes}
              templateFilter={templateFilter}
              setTemplateFilter={setTemplateFilter}
            />
          )}

          {tab === "matrix" && (
            <MatrixTab
              sites={sites}
              sfData={sfData}
              smData={smData}
              semrushCorrMatrix={semrushCorrMatrix}
              pageMode={pageMode}
              setPageMode={setPageMode}
              matrixSites={matrixSites}
              setMatrixSites={setMatrixSites}
              filteredCorrMatrix={filteredCorrMatrix}
              templateFilter={templateFilter}
              setTemplateFilter={setTemplateFilter}
              pageTypes={pageTypes}
            />
          )}

          {tab === "pages" && (
            <PagesTab
              sites={sites}
              sfData={sfData}
              gscData={gscData}
              bingData={bingData}
              pageMode={pageMode}
              setPageMode={setPageMode}
              templateFilter={templateFilter}
              setTemplateFilter={setTemplateFilter}
              pageTypes={pageTypes}
            />
          )}

          {tab === "analyse" && (
            <AnalyseTab
              metrics={metrics}
              corrMatrix={filteredCorrMatrix}
              resultVals={resultVals}
              analysis={analysis}
              setAnalysis={setAnalysis}
              analysisLoading={analysisLoading}
              setAnalysisLoading={setAnalysisLoading}
              analysisError={analysisError}
              setAnalysisError={setAnalysisError}
              currentProjectId={currentProjectId}
              sites={sites}
              sfData={sfData}
              gscData={gscData}
              smData={smData}
              pageTypes={pageTypes}
            />
          )}

          {tab === "sites" && (
            <SitesTab
              sites={sites}
              smData={smData}
              pageMode={pageMode}
              setPageMode={setPageMode}
              metrics={metrics}
            />
          )}

          {tab === "semrush" && (
            <SemrushTab
              sites={sites}
              smData={smData}
              metrics={metrics}
            />
          )}

          {tab === "evolution" && (
            <EvolutionTab
              projects={projects}
              sites={currentProject?.sites || []}
              currentProjectId={currentProjectId}
            />
          )}
          {tab === "allprojects" && (
            <AllProjectsTab
              projects={projects}
              sites={sites}
              sfData={sfData}
              allProjectsMatrix={allProjectsMatrix}
              allProjectsRadar={allProjectsRadar}
              templateFilter={templateFilter}
              setTemplateFilter={setTemplateFilter}
              pageTypes={pageTypes}
            />
          )}

        </div>

        {/* ── CONFIRM MODAL ── */}
        {confirmModal && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: C.white, borderRadius: 14, padding: 32, maxWidth: 400, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 12 }}>Confirmer</div>
              <div style={{ fontSize: 14, color: C.textMid, marginBottom: 24 }}>{confirmModal.message}</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setConfirmModal(null)} style={{ padding: "8px 20px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, cursor: "pointer", fontSize: 13, color: C.textMid }}>
                  Annuler
                </button>
                <button onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }} style={{ padding: "8px 20px", border: "none", borderRadius: 8, background: "#DC2626", cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>
                  Confirmer
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  );
}