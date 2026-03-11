import { C, SITE_PALETTE } from "../lib/constants";
import { newProject, parseCSV } from "../lib/helpers";
import { sbSaveProject, sbDeleteProject, sbDownload } from "../lib/supabase";
import UploadCard from "../components/UploadCard";
import { SectionHeader } from "../components/ui";

export default function ImportTab({ projects, currentProjectId, setCurrentProjectId, editingProjectName, setEditingProjectName, setProjects, sites, setSites, sfData, gscData, gaData, bingData, setSfData, setGscData, setGaData, setBingData, confirmModal, setConfirmModal, dbHistory, dbLoading, showHistory, setShowHistory, refreshHistory }) {
  return (
  <div>
    {/* ── Project selector ── */}
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, fontWeight: 600, marginBottom: 8 }}>Projet actif</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {projects.map(p => (
              <button
                key={p.id}
                onClick={() => setCurrentProjectId(p.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600,
                  border: `2px solid ${p.id === currentProjectId ? C.blue : C.border}`,
                  background: p.id === currentProjectId ? C.blueLight : C.white,
                  color: p.id === currentProjectId ? C.blue : C.textMid,
                  transition: "all 0.15s",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.id === currentProjectId ? C.blue : C.textLight, display: "inline-block", flexShrink: 0 }} />
                {editingProjectName === p.id ? (
                  <input
                    autoFocus
                    value={p.name}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setProjects(prev => prev.map(x => x.id === p.id ? {...x, name: e.target.value} : x))}
                    onBlur={() => setEditingProjectName(null)}
                    onKeyDown={e => e.key === "Enter" && setEditingProjectName(null)}
                    style={{ border: "none", outline: "none", background: "transparent", fontSize: 13, fontWeight: 600, color: C.blue, width: 100 }}
                  />
                ) : (
                  <span>{p.name}</span>
                )}
                <span style={{ fontSize: 11, color: C.textLight, fontWeight: 400 }}>{p.sites.length} site{p.sites.length > 1 ? "s" : ""}</span>
                <button title="Renommer" onClick={e => { e.stopPropagation(); setEditingProjectName(p.id); }}
                  style={{ padding: "1px 4px", border: "none", background: "transparent", cursor: "pointer", fontSize: 11, color: C.textLight, lineHeight: 1 }}>✏️</button>
                {projects.length > 1 && (
                  <button title="Supprimer" onClick={e => { e.stopPropagation(); setConfirmModal({ message: `Supprimer le projet "${p.name}" ?`, onConfirm: () => {
                    sbDeleteProject(p.id).catch(() => {});
                    setProjects(prev => { const next = prev.filter(x => x.id !== p.id); if (currentProjectId === p.id) setCurrentProjectId(next[0].id); return next; });
                  }}); }}
                  style={{ padding: "1px 4px", border: "none", background: "transparent", cursor: "pointer", fontSize: 11, color: "#DC2626", lineHeight: 1 }}>✕</button>
                )}
              </button>
            ))}
            {projects.length < 5 && (
              <button
                onClick={() => {
                  const p = newProject(`Projet ${projects.length + 1}`, [{ id: `site-${Date.now()}`, label: "Nouveau site", ...SITE_PALETTE[0] }]);
                  setProjects(prev => [...prev, p]);
                  setCurrentProjectId(p.id);
                  sbSaveProject(p).catch(() => {});
                }}
                style={{ padding: "8px 16px", borderRadius: 10, border: `2px dashed ${C.blue}`, background: C.blueLight, color: C.blue, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
              >+ Nouveau projet</button>
            )}
          </div>
        </div>
      </div>
    </div>

    <SectionHeader title="Import des données" sub="Chargez les exports CSV pour chaque site" />

    {/* DB status banner */}
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: dbLoading ? C.amber : dbHistory.length > 0 ? C.green : C.textLight }} />
        <span style={{ fontSize: 13, color: C.textMid }}>
          {dbLoading ? "Chargement de l'historique…" : dbHistory.length > 0 ? `${dbHistory.length} import${dbHistory.length > 1 ? "s" : ""} en base` : "Aucun import en base — chargez vos CSV ci-dessous"}
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
              const site = sites.find(s => s.id === row.site_id);
              const srcLabel = { sf: "🕷️ SF", gsc: "🔍 GSC", ga: "📊 GA4", bing: "🤖 Bing" }[row.source] || row.source;
              return (
                <div
                  key={row.id}
                  draggable
                  onDragStart={e => { e.dataTransfer.setData("historyRow", JSON.stringify(row)); e.dataTransfer.effectAllowed = "copy"; }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: C.bg, borderRadius: 8, fontSize: 12, cursor: "grab", userSelect: "none" }}
                  title="Glisser vers une case d'import"
                >
                  <span style={{ fontSize: 14, color: C.textLight, flexShrink: 0 }}>⠿</span>
                  <span style={{ fontWeight: 600, color: site?.color || C.text, minWidth: 90 }}>{site?.label || row.site_id}</span>
                  <span style={{ color: C.textMid, minWidth: 60 }}>{srcLabel}</span>
                  <span style={{ color: C.textLight, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.filename}</span>
                  <span style={{ color: C.textLight, minWidth: 70 }}>{row.row_count} lignes</span>
                  <span style={{ color: C.textLight, minWidth: 140 }}>{new Date(row.uploaded_at).toLocaleString("fr-FR")}</span>

                </div>
              );
            })}
          </div>
        )}
      </div>
    )}
    {/* Last import dates per source — derived from dbHistory */}
    {dbHistory.length > 0 && (() => {
      const fmt = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
      const lastBySrc = {};
      for (const row of dbHistory) {
        if (!lastBySrc[row.source] || row.uploaded_at > lastBySrc[row.source].uploaded_at) lastBySrc[row.source] = row;
      }
      const items = [
        { src: "gsc",  icon: "🔍", label: "GSC" },
        { src: "ga",   icon: "📊", label: "GA4" },
        { src: "bing", icon: "🤖", label: "Bing AI" },
        { src: "sf",   icon: "🕷️", label: "Screaming Frog" },
      ].filter(i => lastBySrc[i.src]);
      if (!items.length) return null;
      return (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 20px", marginBottom: 24, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: C.textLight, fontWeight: 600, marginRight: 4 }}>📅 Derniers imports :</span>
          {items.map(({ src, icon, label }) => (
            <div key={src} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", background: C.bg, borderRadius: 20, fontSize: 12 }}>
              <span>{icon}</span>
              <span style={{ fontWeight: 600, color: C.textMid }}>{label}</span>
              <span style={{ color: C.textLight }}>·</span>
              <span style={{ color: C.text }}>{fmt(lastBySrc[src].uploaded_at)}</span>
            </div>
          ))}
        </div>
      );
    })()}

    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(sites.length + (sites.length < 3 ? 1 : 0), 3)}, 1fr)`, gap: 20 }}>
      {sites.map(site => (
        <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
          {/* Site header with editable name */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${C.borderLight}` }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: site.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🌐</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                value={site.label}
                onChange={e => setSites(prev => prev.map(s => s.id === site.id ? {...s, label: e.target.value} : s))}
                style={{ fontWeight: 700, fontSize: 15, color: site.color, border: "none", outline: "none", background: "transparent", width: "100%", padding: "2px 0" }}
                placeholder="Nom du site"
              />
              <div style={{ fontSize: 11, color: C.textLight }}>4 sources</div>
            </div>
            {/* Actions menu */}
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button
                title="Vider les imports"
                onClick={() => setConfirmModal({ message: `Vider tous les imports de "${site.label}" ?`, onConfirm: () => {
                  setSfData(p => ({...p, [site.id]: []}));
                  setGscData(p => ({...p, [site.id]: []}));
                  setGaData(p => ({...p, [site.id]: []}));
                  setBingData(p => ({...p, [site.id]: []}));
                }})}
                style={{ padding: "4px 8px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, cursor: "pointer", fontSize: 13, color: C.textLight }}
              >🗑</button>
              {sites.length > 1 && (
                <button
                  title="Supprimer ce site"
                  onClick={() => setConfirmModal({ message: `Supprimer le site "${site.label}" et tous ses imports ?`, onConfirm: () => {
                    setSites(prev => prev.filter(s => s.id !== site.id));
                    setSfData(p => { const n = {...p}; delete n[site.id]; return n; });
                    setGscData(p => { const n = {...p}; delete n[site.id]; return n; });
                    setGaData(p => { const n = {...p}; delete n[site.id]; return n; });
                    setBingData(p => { const n = {...p}; delete n[site.id]; return n; });
                  }})}
                  style={{ padding: "4px 8px", border: `1px solid #FCA5A5`, borderRadius: 6, background: "#FFF5F5", cursor: "pointer", fontSize: 13, color: "#DC2626" }}
                >✕</button>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <UploadCard label="Screaming Frog Internal" icon="🕷️" hint="Export interne SF · données techniques uniquement" color={site.color}
              loaded={sfData[site.id]?.length > 0} onData={rows => setSfData(p => ({...p, [site.id]: rows}))} siteId={site.id} source="sf" projectId={currentProjectId}
              onLoadFromHistory={async row => { try { const text = await sbDownload(row.storage_path); setSfData(p => ({...p, [site.id]: parseCSV(text)})); } catch(e) { console.warn("History load error", e); } }} />
            <UploadCard label="Google Search Console" icon="🔍" hint="Export GSC · clics, impressions, CTR, position" color={site.color}
              loaded={gscData[site.id]?.length > 0} onData={rows => setGscData(p => ({...p, [site.id]: rows}))} siteId={site.id} source="gsc" projectId={currentProjectId}
              onLoadFromHistory={async row => { try { const text = await sbDownload(row.storage_path); setGscData(p => ({...p, [site.id]: parseCSV(text)})); } catch(e) { console.warn("History load error", e); } }} />
            <UploadCard label="Google Analytics 4" icon="📊" hint="Export GA4 · sessions, vues" color={site.color}
              loaded={gaData[site.id]?.length > 0} onData={rows => setGaData(p => ({...p, [site.id]: rows}))} siteId={site.id} source="ga" projectId={currentProjectId}
              onLoadFromHistory={async row => { try { const text = await sbDownload(row.storage_path); setGaData(p => ({...p, [site.id]: parseCSV(text)})); } catch(e) { console.warn("History load error", e); } }} />
            <UploadCard label="Bing AI Performance" icon="🤖" hint="Export Bing Webmaster · colonne Citations" color={site.color}
              loaded={bingData[site.id]?.length > 0} onData={rows => setBingData(p => ({...p, [site.id]: rows}))} siteId={site.id} source="bing" projectId={currentProjectId}
              onLoadFromHistory={async row => { try { const text = await sbDownload(row.storage_path); setBingData(p => ({...p, [site.id]: parseCSV(text)})); } catch(e) { console.warn("History load error", e); } }} />
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[["SF", sfData[site.id]?.length || 0], ["GSC", gscData[site.id]?.length || 0], ["GA4", gaData[site.id]?.length || 0], ["Bing", bingData[site.id]?.length || 0]].map(([src, n]) => (
              <div key={src} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, fontWeight: 600, background: n > 0 ? site.bg : C.borderLight, color: n > 0 ? site.color : C.textLight }}>
                {src} {n > 0 ? `· ${n}` : "· vide"}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add site button */}
      {sites.length < 3 && (
        <div
          onClick={() => {
            const palette = SITE_PALETTE[sites.length] || SITE_PALETTE[0];
            const newId = `site-${Date.now()}`;
            const newSite = { id: newId, label: `Site ${sites.length + 1}`, ...palette };
            setSites(prev => [...prev, newSite]);
            setSfData(p => ({...p, [newId]: []}));
            setGscData(p => ({...p, [newId]: []}));
            setGaData(p => ({...p, [newId]: []}));
            setBingData(p => ({...p, [newId]: []}));
          }}
          style={{ background: C.white, border: `2px dashed ${C.border}`, borderRadius: 14, padding: 24, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, cursor: "pointer", minHeight: 200, transition: "border-color 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
          onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
        >
          <div style={{ width: 48, height: 48, borderRadius: 12, background: C.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, color: C.blue }}>+</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.blue }}>Ajouter un site</div>
          <div style={{ fontSize: 12, color: C.textLight, textAlign: "center" }}>Max 3 sites par projet</div>
        </div>
      )}
    </div>

    {/* Confirm modal */}
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
)}