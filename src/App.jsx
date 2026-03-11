import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { C, SF_DIMS, RES_KPIS, RADAR_DIMS, DEFAULT_SITES } from "./lib/constants";
import { emptyDataMap, newProject, makeInitialProject, parseCSV } from "./lib/helpers";
import { pearson } from "./lib/helpers";
import { extractSF, extractGSC, extractGA, extractBing, filterByMode } from "./lib/parsers";
import { buildUrlMaps, buildSfPageVectors, intraCorrFast } from "./lib/correlations";
import { sbSaveProject, sbLoadProjects, sbGetHistory, sbGetLatest, sbDownload } from "./lib/supabase";
import AnalyseTab from "./components/AnalyseTab";
import ImportTab from "./tabs/ImportTab";
import OverviewTab from "./tabs/OverviewTab";
import MatrixTab from "./tabs/MatrixTab";
import PagesTab from "./tabs/PagesTab";
import SitesTab from "./tabs/SitesTab";
import AllProjectsTab from "./tabs/AllProjectsTab";

const INITIAL_PROJECT = makeInitialProject();
const NAV_TABS = [
  { key: "import",      label: "Import"            },
  { key: "overview",    label: "Vue d'ensemble"     },
  { key: "matrix",      label: "Matrice"            },
  { key: "pages",       label: "Pages"              },
  { key: "analyse",     label: "✦ Analyse IA"       },
  { key: "sites",       label: "Sites"              },
  { key: "allprojects", label: "◈ Tous les projets" },
];

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

  const setSfData   = useCallback((fn) => updateProject(p => ({ sfData:   typeof fn === "function" ? fn(p.sfData)   : fn })), [updateProject]);
  const setGscData  = useCallback((fn) => updateProject(p => ({ gscData:  typeof fn === "function" ? fn(p.gscData)  : fn })), [updateProject]);
  const setGaData   = useCallback((fn) => updateProject(p => ({ gaData:   typeof fn === "function" ? fn(p.gaData)   : fn })), [updateProject]);
  const setBingData = useCallback((fn) => updateProject(p => ({ bingData: typeof fn === "function" ? fn(p.bingData) : fn })), [updateProject]);

  // ── UI state ─────────────────────────────────────────────────────
  const [confirmModal, setConfirmModal] = useState(null);
  const [tab, setTab]                   = useState("import");
  const [pageMode, setPageMode]         = useState("all");
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
    await Promise.all(Object.values(latest).map(async (row) => {
      try {
        const text = await sbDownload(row.storage_path);
        const rows = parseCSV(text);
        const sid = row.site_id, src = row.source;
        const key = src === "sf" ? "sfData" : src === "gsc" ? "gscData" : src === "ga" ? "gaData" : src === "bing" ? "bingData" : null;
        if (key) setProjects(prev => prev.map(p => p.id === pid ? { ...p, [key]: { ...p[key], [sid]: rows } } : p));
      } catch (e) { console.warn("Auto-load row failed:", row.source, e); }
    }));
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
          }));
          setProjects(restored);
          const firstId = restored[0].id;
          setCurrentProjectId(firstId);
          loadedProjectsRef.current.add(firstId);
          await loadProjectData(firstId);
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
    };
  }), [sites, sfData, gscData, gaData, bingData, pageMode, baseMetrics]);

  const resultVals = useMemo(() => metrics.map(m => ({
    clicks:      m.gsc?.clicks      ?? 0,
    impressions: m.gsc?.impressions  ?? 0,
    ctr:         m.gsc?.ctr          ?? 0,
    position:    m.gsc?.position     ?? 0,
    sessions:    m.ga?.sessions      ?? 0,
    views:       m.ga?.views         ?? 0,
    geoMentions: m.bing?.geoMentions ?? 0,
  })), [metrics]);

  const corrMatrix = useMemo(() => {
    const hasAny = metrics.some(m => m.sf !== null);
    return SF_DIMS.map(dim => ({
      dim,
      corrs: RES_KPIS.map(kpi => ({
        kpi,
        value: hasAny ? pearson(
          metrics.map(m => m.sf ? (m.sf[dim.key] ?? 0) : 0),
          resultVals.map(r => r[kpi.key] ?? 0)
        ) : null,
      })),
    }));
  }, [metrics, resultVals]);

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
    const sfPages    = buildSfPageVectors(sfFiltered);
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
  }, [matrixSites, sfData, gscData, gaData, bingData, pageMode, baseMatrix]);

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
    const sfPages = buildSfPageVectors(allSf);
    const urlMaps = buildUrlMaps(allGsc, allGa, allBing);
    return SF_DIMS.map(dim => ({
      dim,
      corrs: RES_KPIS.map(kpi => {
        const res = intraCorrFast(sfPages, urlMaps, dim.key, kpi.key);
        return { kpi, value: res ? res.value : null, n: res ? res.n : 0 };
      }),
    }));
  }, [projects]);

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
  }, [projects]);

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
            <div style={{ display: "flex", gap: 2 }}>
              {NAV_TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)} style={{
                  padding: "6px 16px", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 500,
                  background: tab === t.key ? C.blue : "transparent",
                  color: tab === t.key ? "#fff" : C.textMid,
                  transition: "all 0.15s",
                }}>
                  {t.label}
                </button>
              ))}
            </div>
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
              sfData={sfData}
              gscData={gscData}
              gaData={gaData}
              bingData={bingData}
              setSfData={setSfData}
              setGscData={setGscData}
              setGaData={setGaData}
              setBingData={setBingData}
              setConfirmModal={setConfirmModal}
              dbHistory={dbHistory}
              dbLoading={dbLoading}
              showHistory={showHistory}
              setShowHistory={setShowHistory}
              refreshHistory={refreshHistory}
            />
          )}

          {tab === "overview" && (
            <OverviewTab
              sites={sites}
              pageMode={pageMode}
              setPageMode={setPageMode}
              radarSites={radarSites}
              setRadarSites={setRadarSites}
              metrics={metrics}
              radarData={radarData}
            />
          )}

          {tab === "matrix" && (
            <MatrixTab
              sites={sites}
              sfData={sfData}
              pageMode={pageMode}
              setPageMode={setPageMode}
              matrixSites={matrixSites}
              setMatrixSites={setMatrixSites}
              filteredCorrMatrix={filteredCorrMatrix}
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
            />
          )}

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

          {tab === "sites" && (
            <SitesTab
              sites={sites}
              pageMode={pageMode}
              setPageMode={setPageMode}
              metrics={metrics}
            />
          )}

          {tab === "allprojects" && (
            <AllProjectsTab
              projects={projects}
              sites={sites}
              sfData={sfData}
              allProjectsMatrix={allProjectsMatrix}
              allProjectsRadar={allProjectsRadar}
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