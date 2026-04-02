import InfoCard from "../components/InfoCard";
import { C, SITE_PALETTE } from "../lib/constants";
import { newProject, parseCSV, parseSemrushCSV } from "../lib/helpers";
import { sbSaveProject, sbDeleteProject, sbDownload } from "../lib/supabase";
import { parseSemrush } from "../lib/parsers";
import UploadCard from "../components/UploadCard";
import PageTypeClassifier from "../components/PageTypeClassifier";

// ── Section wrapper ───────────────────────────────────────────────
function Section({ number, title, sub, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 8, background: C.blue, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 800, flexShrink: 0,
        }}>{number}</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{title}</div>
          {sub && <div style={{ fontSize: 11, color: C.textLight, marginTop: 1 }}>{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function ImportTab({ projects, currentProjectId, setCurrentProjectId, editingProjectName, setEditingProjectName, setProjects, ownerEmail = null, sites, setSites, sfData, gscData, gaData, bingData, smData, setSfData, setGscData, setGaData, setBingData, setSmData, confirmModal, setConfirmModal, dbHistory, dbLoading, showHistory, setShowHistory, refreshHistory, pageTypes, setPageTypes, onSemrushVolumes }) {

  // ── Last import dates ─────────────────────────────────────────
  const lastBySrc = {};
  for (const row of dbHistory) {
    if (!lastBySrc[row.source] || row.uploaded_at > lastBySrc[row.source].uploaded_at)
      lastBySrc[row.source] = row;
  }
  const fmtDate = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: 0 }}>Setup</h1>
          <div style={{ fontSize: 13, color: C.textLight, marginTop: 4 }}>Configuration du projet et chargement des données</div>
        </div>
        <InfoCard tabKey="import" />
      </div>

      {/* ── 1. PROJET ──────────────────────────────────────────── */}
      <Section number="1" title="Projet actif" sub="Gérez vos projets et les sites associés">
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>

          {/* Project selector */}
          <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: `1px solid ${C.borderLight}` }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, fontWeight: 600, marginBottom: 10 }}>Projets</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {projects.map(p => (
                <button key={p.id} onClick={() => setCurrentProjectId(p.id)} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600,
                  border: `2px solid ${p.id === currentProjectId ? C.blue : C.border}`,
                  background: p.id === currentProjectId ? C.blueLight : C.white,
                  color: p.id === currentProjectId ? C.blue : C.textMid,
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.id === currentProjectId ? C.blue : C.textLight, display: "inline-block", flexShrink: 0 }} />
                  {editingProjectName === p.id ? (
                    <input autoFocus value={p.name} onClick={e => e.stopPropagation()}
                      onChange={e => setProjects(prev => prev.map(x => x.id === p.id ? {...x, name: e.target.value} : x))}
                      onBlur={() => setEditingProjectName(null)}
                      onKeyDown={e => e.key === "Enter" && setEditingProjectName(null)}
                      style={{ border: "none", outline: "none", background: "transparent", fontSize: 13, fontWeight: 600, color: C.blue, width: 100 }}
                    />
                  ) : <span>{p.name}</span>}
                  <span style={{ fontSize: 11, color: C.textLight, fontWeight: 400 }}>{p.sites.length} site{p.sites.length > 1 ? "s" : ""}</span>
                  <button title="Renommer" onClick={e => { e.stopPropagation(); setEditingProjectName(p.id); }}
                    style={{ padding: "1px 4px", border: "none", background: "transparent", cursor: "pointer", fontSize: 11, color: C.textLight }}>✏️</button>
                  {projects.length > 1 && (
                    <button title="Supprimer" onClick={e => { e.stopPropagation(); setConfirmModal({ message: `Supprimer le projet "${p.name}" ?`, onConfirm: () => {
                      sbDeleteProject(p.id).catch(() => {});
                      setProjects(prev => { const next = prev.filter(x => x.id !== p.id); if (currentProjectId === p.id) setCurrentProjectId(next[0].id); return next; });
                    }}); }}
                    style={{ padding: "1px 4px", border: "none", background: "transparent", cursor: "pointer", fontSize: 11, color: "#DC2626" }}>✕</button>
                  )}
                </button>
              ))}
              {projects.length < 20 && (
                <button onClick={() => {
                  const p = newProject(`Projet ${projects.length + 1}`, [{ id: `site-${Date.now()}`, label: "Nouveau site", ...SITE_PALETTE[0] }], ownerEmail);
                  setProjects(prev => [...prev, p]);
                  setCurrentProjectId(p.id);
                  sbSaveProject(p).catch(() => {});
                }} style={{ padding: "8px 16px", borderRadius: 10, border: `2px dashed ${C.blue}`, background: C.blueLight, color: C.blue, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  + Nouveau projet
                </button>
              )}
            </div>
          </div>

          {/* Sites of current project */}
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, fontWeight: 600, marginBottom: 10 }}>Sites du projet</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {sites.map(site => (
                <div key={site.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 10, border: `1px solid ${site.color}33`, background: site.bg }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: site.color, flexShrink: 0 }} />
                  <input
                    value={site.label}
                    onChange={e => setSites(prev => prev.map(s => s.id === site.id ? {...s, label: e.target.value} : s))}
                    style={{ fontWeight: 600, fontSize: 13, color: site.color, border: "none", outline: "none", background: "transparent", width: 120 }}
                    placeholder="Nom du site"
                  />
                  <button title="Vider les imports" onClick={() => setConfirmModal({ message: `Vider tous les imports de "${site.label}" ?`, onConfirm: () => {
                    setSfData(p => ({...p, [site.id]: []}));
                    setGscData(p => ({...p, [site.id]: []}));
                    setGaData(p => ({...p, [site.id]: []}));
                    setBingData(p => ({...p, [site.id]: []}));
                    setSmData(p => ({...p, [site.id]: []}));
                  }})} style={{ padding: "2px 6px", border: `1px solid ${C.border}`, borderRadius: 5, background: C.white, cursor: "pointer", fontSize: 11, color: C.textLight }}>🗑</button>
                  {sites.length > 1 && (
                    <button title="Supprimer" onClick={() => setConfirmModal({ message: `Supprimer le site "${site.label}" ?`, onConfirm: () => {
                      setSites(prev => prev.filter(s => s.id !== site.id));
                      ["sfData","gscData","gaData","bingData","smData"].forEach(k => {
                        const setter = { sfData: setSfData, gscData: setGscData, gaData: setGaData, bingData: setBingData, smData: setSmData }[k];
                        setter(p => { const n = {...p}; delete n[site.id]; return n; });
                      });
                    }})} style={{ padding: "2px 6px", border: "1px solid #FCA5A5", borderRadius: 5, background: "#FFF5F5", cursor: "pointer", fontSize: 11, color: "#DC2626" }}>✕</button>
                  )}
                </div>
              ))}
              {sites.length < 3 && (
                <button onClick={() => {
                  const palette = SITE_PALETTE[sites.length] || SITE_PALETTE[0];
                  const newId = `site-${Date.now()}`;
                  setSites(prev => [...prev, { id: newId, label: `Site ${sites.length + 1}`, ...palette }]);
                  setSfData(p => ({...p, [newId]: []}));
                  setGscData(p => ({...p, [newId]: []}));
                  setGaData(p => ({...p, [newId]: []}));
                  setBingData(p => ({...p, [newId]: []}));
                  setSmData(p => ({...p, [newId]: []}));
                }} style={{ padding: "8px 14px", borderRadius: 10, border: `2px dashed ${C.border}`, background: C.white, color: C.blue, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  + Ajouter un site
                </button>
              )}
            </div>
          </div>

          {/* DB status + history */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.borderLight}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: dbLoading ? C.amber : dbHistory.length > 0 ? C.green : C.textLight }} />
              <span style={{ fontSize: 12, color: C.textMid }}>
                {dbLoading ? "Chargement…" : dbHistory.length > 0 ? `${dbHistory.length} import${dbHistory.length > 1 ? "s" : ""} en base` : "Aucun import en base"}
              </span>
            </div>
            <button onClick={() => { setShowHistory(h => !h); refreshHistory(); }} style={{
              padding: "5px 14px", background: showHistory ? C.blue : C.white,
              color: showHistory ? "#fff" : C.textMid,
              border: `1px solid ${showHistory ? C.blue : C.border}`,
              borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 500,
            }}>
              📋 Historique {dbHistory.length > 0 ? `(${dbHistory.length})` : ""}
            </button>
          </div>

          {showHistory && (
            <div style={{ marginTop: 14 }}>
              {dbHistory.length === 0 ? (
                <div style={{ fontSize: 12, color: C.textLight }}>Aucun import enregistré</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 260, overflowY: "auto" }}>
                  {dbHistory.map(row => {
                    const site = sites.find(s => s.id === row.site_id);
                    const srcLabel = { sf: "🐸 SF", gsc: "🔍 GSC", ga: "📊 GA4", bing: "🤖 Bing", sm: "📈 Semrush" }[row.source] || row.source;
                    return (
                      <div key={row.id} draggable onDragStart={e => { e.dataTransfer.setData("historyRow", JSON.stringify(row)); e.dataTransfer.effectAllowed = "copy"; }}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", background: C.bg, borderRadius: 7, fontSize: 11, cursor: "grab", userSelect: "none" }}
                        title="Glisser vers une case d'import">
                        <span style={{ color: C.textLight, flexShrink: 0 }}>⠿</span>
                        <span style={{ fontWeight: 600, color: site?.color || C.text, minWidth: 80 }}>{site?.label || row.site_id}</span>
                        <span style={{ color: C.textMid, minWidth: 60 }}>{srcLabel}</span>
                        <span style={{ color: C.textLight, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.filename}</span>
                        <span style={{ color: C.textLight }}>{new Date(row.uploaded_at).toLocaleString("fr-FR")}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* ── 2. IMPORTS CSV ──────────────────────────────────────── */}
      <Section number="2" title="Import des fichiers" sub="Glissez-déposez vos exports CSV par site et par source">

        {/* Last import dates summary */}
        {Object.keys(lastBySrc).length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {[
              { src: "sf",  icon: "🐸", label: "SF" },
              { src: "gsc", icon: "🔍", label: "GSC" },
              { src: "ga",  icon: "📊", label: "GA4" },
              { src: "bing",icon: "🤖", label: "Bing" },
              { src: "sm",  icon: "📈", label: "Semrush" },
            ].filter(i => lastBySrc[i.src]).map(({ src, icon, label }) => (
              <div key={src} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", background: C.white, border: `1px solid ${C.border}`, borderRadius: 20, fontSize: 11 }}>
                <span>{icon}</span>
                <span style={{ fontWeight: 600, color: C.textMid }}>{label}</span>
                <span style={{ color: C.textLight }}>·</span>
                <span style={{ color: C.text }}>{fmtDate(lastBySrc[src].uploaded_at)}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(Math.max(sites.length, 1) + (sites.length < 3 ? 1 : 0), 3)}, 1fr)`, gap: 20 }}>
          {sites.length === 0 && (
            <div style={{ gridColumn: "1 / -1", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: "20px 24px", fontSize: 13, color: "#92400E" }}>
              ⚠️ Aucun site configuré — créez un projet avec au moins un site dans la section <strong>Projet actif</strong> ci-dessus pour importer des fichiers.
            </div>
          )}
          {sites.map(site => (
            <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
              {/* Site header */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.borderLight}` }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: site.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 14, color: site.color }}>{site.label}</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <UploadCard label="Screaming Frog" icon="🐸" hint="Export interne SF" color={site.color}
                  loaded={sfData[site.id]?.length > 0} rows={sfData[site.id]}
                  onData={rows => setSfData(p => ({...p, [site.id]: rows}))}
                  onClear={() => setSfData(p => ({...p, [site.id]: []}))}
                  siteId={site.id} source="sf" projectId={currentProjectId}
                  onLoadFromHistory={async row => { try { const text = await sbDownload(row.storage_path); setSfData(p => ({...p, [site.id]: parseCSV(text)})); } catch(e) { console.warn("History load error", e); } }} />
                <UploadCard label="Google Search Console" icon="🔍" hint="Clics, impressions, CTR, position" color={site.color}
                  loaded={gscData[site.id]?.length > 0} rows={gscData[site.id]}
                  onData={rows => setGscData(p => ({...p, [site.id]: rows}))}
                  onClear={() => setGscData(p => ({...p, [site.id]: []}))}
                  siteId={site.id} source="gsc" projectId={currentProjectId}
                  onLoadFromHistory={async row => { try { const text = await sbDownload(row.storage_path); setGscData(p => ({...p, [site.id]: parseCSV(text)})); } catch(e) { console.warn("History load error", e); } }} />
                <UploadCard label="Google Analytics 4" icon="📊" hint="Sessions, vues" color={site.color}
                  loaded={gaData[site.id]?.length > 0} rows={gaData[site.id]}
                  onData={rows => setGaData(p => ({...p, [site.id]: rows}))}
                  onClear={() => setGaData(p => ({...p, [site.id]: []}))}
                  siteId={site.id} source="ga" projectId={currentProjectId}
                  onLoadFromHistory={async row => { try { const text = await sbDownload(row.storage_path); setGaData(p => ({...p, [site.id]: parseCSV(text)})); } catch(e) { console.warn("History load error", e); } }} />
                <UploadCard label="Bing AI Performance" icon="🤖" hint="Citations dans Bing Copilot" color={site.color}
                  loaded={bingData[site.id]?.length > 0} rows={bingData[site.id]}
                  onData={rows => setBingData(p => ({...p, [site.id]: rows}))}
                  onClear={() => setBingData(p => ({...p, [site.id]: []}))}
                  siteId={site.id} source="bing" projectId={currentProjectId}
                  onLoadFromHistory={async row => { try { const text = await sbDownload(row.storage_path); setBingData(p => ({...p, [site.id]: parseCSV(text)})); } catch(e) { console.warn("History load error", e); } }} />
                <UploadCard label="Semrush Organic Pages" icon="📈" hint="Positions, trafic estimé, volumes" color={site.color}
                  loaded={smData[site.id]?.length > 0} rows={smData[site.id]}
                  onData={(_, rawText) => {
                    const rows = parseSemrush(parseSemrushCSV(rawText));
                    setSmData(p => ({...p, [site.id]: rows}));
                    // Auto-match keyword volumes if Keyword Overview format
                    const parsed = parseSemrushCSV(rawText);
                    if (parsed.length > 0 && parsed[0].keyword !== undefined) {
                      onSemrushVolumes?.(site.id, parsed);
                    }
                  }}
                  onClear={() => setSmData(p => ({...p, [site.id]: []}))}
                  rawMode siteId={site.id} source="sm" projectId={currentProjectId}
                  onLoadFromHistory={async row => { try { const text = await sbDownload(row.storage_path); const rows = parseSemrush(parseSemrushCSV(text)); setSmData(p => ({...p, [site.id]: rows})); } catch(e) { console.warn("History load error", e); } }} />
              </div>

              {/* Data status badges */}
              <div style={{ marginTop: 12, display: "flex", gap: 5, flexWrap: "wrap" }}>
                {[["SF", sfData[site.id]?.length || 0], ["GSC", gscData[site.id]?.length || 0], ["GA4", gaData[site.id]?.length || 0], ["Bing", bingData[site.id]?.length || 0], ["SM", smData[site.id]?.length || 0]].map(([src, n]) => (
                  <div key={src} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 600, background: n > 0 ? site.bg : C.borderLight, color: n > 0 ? site.color : C.textLight }}>
                    {src} {n > 0 ? `· ${n}` : "· vide"}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Add site card */}
          {sites.length < 3 && (
            <div onClick={() => {
              const palette = SITE_PALETTE[sites.length] || SITE_PALETTE[0];
              const newId = `site-${Date.now()}`;
              setSites(prev => [...prev, { id: newId, label: `Site ${sites.length + 1}`, ...palette }]);
              setSfData(p => ({...p, [newId]: []}));
              setGscData(p => ({...p, [newId]: []}));
              setGaData(p => ({...p, [newId]: []}));
              setBingData(p => ({...p, [newId]: []}));
              setSmData(p => ({...p, [newId]: []}));
            }}
              style={{ background: C.white, border: `2px dashed ${C.border}`, borderRadius: 14, padding: 24, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, cursor: "pointer", minHeight: 180 }}
              onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
              onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
            >
              <div style={{ width: 44, height: 44, borderRadius: 11, background: C.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: C.blue }}>+</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.blue }}>Ajouter un site</div>
              <div style={{ fontSize: 11, color: C.textLight }}>Max 3 sites par projet</div>
            </div>
          )}
        </div>
      </Section>

      {/* ── 3. CONNEXIONS API ───────────────────────────────────── */}
      <Section number="3" title="Connexions API" sub="Récupération automatique des données sans export CSV">
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
            {[
              { icon: "🔍", label: "Google Search Console", desc: "Clics, impressions, CTR, position via GSC API", color: "#2563EB", soon: true },
              { icon: "📊", label: "Google Analytics 4",    desc: "Sessions et vues via GA4 Data API",            color: "#EA580C", soon: true },
              { icon: "🤖", label: "Bing Webmaster",        desc: "Citations AI via Bing Webmaster API",          color: "#0891B2", soon: true },
              { icon: "📈", label: "Semrush API",           desc: "Position tracking via Semrush API",            color: "#059669", soon: true },
            ].map(({ icon, label, desc, color, soon }) => (
              <div key={label} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, opacity: soon ? 0.7 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 12, color: C.text }}>{label}</span>
                  {soon && <span style={{ marginLeft: "auto", fontSize: 9, padding: "2px 7px", borderRadius: 10, background: C.bg, color: C.textLight, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Bientôt</span>}
                </div>
                <div style={{ fontSize: 11, color: C.textLight }}>{desc}</div>
                <button disabled style={{ padding: "6px 0", border: `1px solid ${color}44`, borderRadius: 7, background: `${color}0D`, color: color, fontSize: 11, fontWeight: 600, cursor: "not-allowed", opacity: 0.6 }}>
                  Connecter
                </button>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── 4. CLASSIFICATION DES PAGES ────────────────────────── */}
      <Section number="4" title="Classification des pages" sub="Attribuez un type à chaque page pour filtrer la matrice par template">
        {sites.filter(site => sfData[site.id]?.length > 0).length === 0 ? (
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "28px 24px", textAlign: "center", color: C.textLight }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>🐸</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>Importez d'abord un fichier Screaming Frog</div>
            <div style={{ fontSize: 12 }}>La classification est basée sur les données SF (URL, title, H1, content-type…)</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {sites.filter(site => sfData[site.id]?.length > 0).map(site => (
              <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.borderLight}` }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: site.color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: 14, color: site.color }}>{site.label}</span>
                  <span style={{ fontSize: 11, color: C.textLight }}>· {sfData[site.id].length} pages</span>
                </div>
                <PageTypeClassifier
                  siteId={site.id}
                  projectId={currentProjectId}
                  sfRows={sfData[site.id]}
                  pageTypes={pageTypes}
                  setPageTypes={setPageTypes}
                />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Confirm modal */}
      {/* ── 5. CONFIGURATION PROVIDERS ─────────────────────────── */}
      <Section number="5" title="Gestion des Providers" sub="Clés API pour les Fan-outs GEO — configurées par projet">
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px" }}>
          <div style={{ fontSize: 13, color: C.textMid, marginBottom: 16, lineHeight: 1.6 }}>
            Les clés API sont associées à chaque projet et configurées dans l'onglet <strong>🔍 Fan-outs → ⚙️ Gestion des Providers</strong>.
            Elles sont sauvegardées automatiquement et rechargées à chaque session.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { label: "OpenAI",     field: "openai_key_enc",      icon: "🟢", color: "#059669" },
              { label: "Gemini",     field: "gemini_key_enc",      icon: "🔵", color: "#2563EB" },
              { label: "Perplexity", field: "perplexity_key_enc",  icon: "🟣", color: "#7C3AED" },
              { label: "Claude",     field: "claude_geo_key_enc",  icon: "🟠", color: "#D97706" },
              { label: "Semrush",    field: "semrush_key_enc",     icon: "📊", color: "#FF642B" },
            ].map(p => {
              const hasKey = !!(projects.find(pr => pr.id === currentProjectId)?.[p.field]);
              return (
                <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, background: hasKey ? "#ECFDF5" : C.bg, border: `1px solid ${hasKey ? "#BBF7D0" : C.border}` }}>
                  <span style={{ fontSize: 14 }}>{p.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: hasKey ? "#059669" : C.textLight }}>{p.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: hasKey ? "#059669" : "#DC2626" }}>{hasKey ? "✓ OK" : "✗"}</span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 14, fontSize: 11, color: C.textLight }}>
            → Configurez vos clés dans <strong>🔍 Fan-outs → ⚙️ Gestion des Providers</strong> (en haut de page)
          </div>
        </div>
      </Section>

      {confirmModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: C.white, borderRadius: 14, padding: 32, maxWidth: 400, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 12 }}>Confirmer</div>
            <div style={{ fontSize: 14, color: C.textMid, marginBottom: 24 }}>{confirmModal.message}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmModal(null)} style={{ padding: "8px 20px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, cursor: "pointer", fontSize: 13, color: C.textMid }}>Annuler</button>
              <button onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }} style={{ padding: "8px 20px", border: "none", borderRadius: 8, background: "#DC2626", cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}