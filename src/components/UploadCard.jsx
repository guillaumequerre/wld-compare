import { useState, useCallback, useRef } from "react";
import { C } from "../lib/constants";
import { parseCSV, isSemrushCSV } from "../lib/helpers";
import { sbUpload, sbInsertImport, sbDeleteImport, sbDeleteFile, sbGetHistory } from "../lib/supabase";
import { SnapshotModal } from "./SnapshotSaver";

const MAX_STORAGE_BYTES = 49 * 1024 * 1024; // 49MB

// ── Confirmation mini-dialog ──────────────────────────────────────
function ConfirmPopover({ message, onConfirm, onCancel, loading }) {
  return (
    <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 200, background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", width: 230 }}
      onClick={e => e.stopPropagation()}>
      <div style={{ fontSize: 12, color: C.text, marginBottom: 10 }}>{message}</div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button onClick={onCancel}
          style={{ padding: "5px 12px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.textMid, fontSize: 11, cursor: "pointer" }}>
          Annuler
        </button>
        <button onClick={onConfirm} disabled={loading}
          style={{ padding: "5px 12px", border: "none", borderRadius: 6, background: "#DC2626", color: "#fff", fontSize: 11, fontWeight: 700, cursor: loading ? "wait" : "pointer" }}>
          {loading ? "…" : "Supprimer"}
        </button>
      </div>
    </div>
  );
}

// ── Large file modal ──────────────────────────────────────────────
function LargeFileModal({ file, text, onTruncate, onSkipStorage, onCancel }) {
  const sizeMB = (file.size / 1024 / 1024).toFixed(1);
  const opts = [
    {
      icon: "✂️",
      title: "Importer une partie du fichier",
      desc: `Tronquer à 49MB (${sizeMB}MB → 49MB). Les dernières lignes seront perdues mais le fichier sera sauvegardé en base.`,
      color: "#D97706",
      bg: "#FFFBEB",
      border: "#FDE68A",
      action: onTruncate,
      label: "Tronquer et importer",
    },
    {
      icon: "⚡",
      title: "Importer sans stocker",
      desc: "Charger les données en mémoire pour cette session uniquement. Le fichier ne sera pas sauvegardé en base — vous devrez le réimporter à la prochaine session.",
      color: "#2563EB",
      bg: "#EFF6FF",
      border: "#BFDBFE",
      action: onSkipStorage,
      label: "Importer sans sauvegarder",
    },
    {
      icon: "📂",
      title: "Choisir un autre fichier",
      desc: "Annuler et sélectionner un export plus léger (ex : filtrer les colonnes dans Screaming Frog avant d'exporter).",
      color: "#059669",
      bg: "#ECFDF5",
      border: "#BBF7D0",
      action: onCancel,
      label: "Choisir un autre fichier",
    },
    {
      icon: "🚀",
      title: "Upgrader le plan Supabase",
      desc: "Le plan Pro ($25/mois) supporte jusqu'à 250GB. Contactez l'admin du projet.",
      color: "#7C3AED",
      bg: "#F5F3FF",
      border: "#DDD6FE",
      action: () => window.open("mailto:guillaume@deux.io?subject=Upgrade Supabase — CorrelDash", "_blank"),
      label: "Contacter l'admin",
      external: true,
    },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{ background: C.white, borderRadius: 16, padding: 28, maxWidth: 500, width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
          <span style={{ fontSize: 28 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 4 }}>Fichier trop volumineux</div>
            <div style={{ fontSize: 13, color: C.textLight, lineHeight: 1.5 }}>
              <strong>{file.name}</strong> ({sizeMB}MB) dépasse la limite de stockage Supabase (50MB).
              Choisissez comment procéder :
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {opts.map((opt, i) => (
            <button key={i} onClick={opt.action}
              style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 14px", background: opt.bg, border: `1.5px solid ${opt.border}`, borderRadius: 10, cursor: "pointer", textAlign: "left", width: "100%" }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>{opt.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: opt.color, marginBottom: 3 }}>
                  {opt.title}{opt.external ? " ↗" : ""}
                </div>
                <div style={{ fontSize: 11, color: C.textMid, lineHeight: 1.5 }}>{opt.desc}</div>
              </div>
            </button>
          ))}
        </div>

        <button onClick={onCancel}
          style={{ width: "100%", padding: "8px", border: `1px solid ${C.border}`, borderRadius: 8, background: "transparent", color: C.textLight, fontSize: 12, cursor: "pointer" }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────
export default function UploadCard({ label, icon, hint, onData, onClear, loaded, color, siteId, source, projectId, onLoadFromHistory, rawMode, rows, onAfterUpload }) {
  const [drag, setDrag]               = useState(false);
  const [dragHistory, setDragHistory] = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [uploadErr, setUploadErr]     = useState(null);
  const [lastImportId, setLastImportId] = useState(null);
  const [lastStoragePath, setLastStoragePath] = useState(null);
  const [largeFileModal, setLargeFileModal] = useState(null); // { file, text }

  const [showSnapshot,     setShowSnapshot]     = useState(false);
  const [showConfirmFull,  setShowConfirmFull]  = useState(false);
  const [showConfirmLocal, setShowConfirmLocal] = useState(false);
  const [deleting,         setDeleting]         = useState(false);

  const ref = useRef();

  const fetchLastImport = useCallback(async () => {
    if (!siteId || !source || !projectId) return null;
    try {
      const rows = await sbGetHistory(projectId, 50);
      const match = rows.find(r => r.site_id === siteId && r.source === source);
      if (match) { setLastImportId(match.id); setLastStoragePath(match.storage_path); return match; }
    } catch {}
    return null;
  }, [siteId, source, projectId]);

  // Core: parse + load data into app state
  const loadData = useCallback((text) => {
    const parsedRows = rawMode ? null : parseCSV(text);
    rawMode ? onData(null, text) : onData(parsedRows);
    return rawMode ? parseCSV(text).length : parsedRows.length;
  }, [onData, rawMode]);

  // Upload to Supabase Storage + insert import record
  const saveToStorage = useCallback(async (file, text) => {
    const ts       = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path     = `${projectId || "proj-default"}/${siteId}/${source}/${ts}_${safeName}`;
    await sbUpload(path, text);
    const rc     = rawMode ? parseCSV(text).length : parseCSV(text).length;
    const result = await sbInsertImport({ project_id: projectId || "proj-default", site_id: siteId, source, filename: file.name, storage_path: path, row_count: rc });
    if (result?.[0]) { setLastImportId(result[0].id); setLastStoragePath(result[0].storage_path); }
  }, [projectId, siteId, source, rawMode]);

  // Insert record only (no file storage)
  const saveMetaOnly = useCallback(async (file, rowCount) => {
    const result = await sbInsertImport({
      project_id: projectId || "proj-default", site_id: siteId, source,
      filename: file.name + " (non stocké — fichier trop volumineux)",
      storage_path: "", row_count: rowCount,
    });
    if (result?.[0]) { setLastImportId(result[0].id); setLastStoragePath(""); }
  }, [projectId, siteId, source]);

  const handle = useCallback(async (file) => {
    if (!file) return;
    setUploadErr(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      if (source === "sm" && !isSemrushCSV(text)) {
        setUploadErr("Format non reconnu — attendu : export Semrush");
        return;
      }

      // Check file size before attempting upload
      if (file.size > MAX_STORAGE_BYTES && siteId && source) {
        // Load data into app state immediately regardless
        loadData(text);
        // Show choice modal
        setLargeFileModal({ file, text });
        return;
      }

      // Normal flow: load + upload
      loadData(text);
      if (siteId && source) {
        setUploading(true);
        try {
          await saveToStorage(file, text);
          onAfterUpload?.();
        } catch (err) {
          setUploadErr(`Sauvegarde échouée — ${(err?.message || String(err)).slice(0, 80)}`);
          console.warn("Upload error:", err);
        } finally {
          setUploading(false);
        }
      }
    };
    reader.readAsText(file);
  }, [siteId, source, loadData, saveToStorage]);

  // Modal actions
  const handleTruncate = useCallback(async () => {
    if (!largeFileModal) return;
    const { file, text } = largeFileModal;
    setLargeFileModal(null);
    setUploading(true);
    try {
      // Truncate text to 49MB
      const truncated = text.slice(0, MAX_STORAGE_BYTES);
      // Keep header line + truncate at last complete line
      const lastNewline = truncated.lastIndexOf("\n");
      const safe = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
      await saveToStorage({ ...file, name: file.name }, safe);
      onAfterUpload?.();
    } catch (err) {
      setUploadErr(`Sauvegarde tronquée échouée — ${(err?.message || String(err)).slice(0, 80)}`);
    } finally {
      setUploading(false);
    }
  }, [largeFileModal, saveToStorage]);

  const handleSkipStorage = useCallback(async () => {
    if (!largeFileModal) return;
    const { file, text } = largeFileModal;
    setLargeFileModal(null);
    setUploading(true);
    try {
      const rowCount = parseCSV(text).length;
      await saveMetaOnly(file, rowCount);
      onAfterUpload?.();
    } catch (err) {
      setUploadErr(`Erreur métadonnées — ${(err?.message || String(err)).slice(0, 80)}`);
    } finally {
      setUploading(false);
    }
  }, [largeFileModal, saveMetaOnly]);

  const handleCancelLarge = useCallback(() => {
    setLargeFileModal(null);
    if (ref.current) ref.current.value = "";
  }, []);

  const handleDeleteFull = async () => {
    setDeleting(true);
    try {
      let importId = lastImportId, storagePath = lastStoragePath;
      if (!importId) { const rec = await fetchLastImport(); importId = rec?.id; storagePath = rec?.storage_path; }
      if (storagePath) await sbDeleteFile(storagePath).catch(() => {});
      if (importId) await sbDeleteImport(importId);
      onClear?.();
      setLastImportId(null); setLastStoragePath(null);
      setShowConfirmFull(false);
    } catch (err) {
      setUploadErr(`Suppression échouée — ${(err?.message || String(err)).slice(0, 60)}`);
    } finally { setDeleting(false); }
  };

  const handleDeleteLocal = () => { onClear?.(); setShowConfirmLocal(false); };

  const handleDragOver = (e) => {
    e.preventDefault();
    const types = Array.from(e.dataTransfer.types);
    if (types.includes("historyrow")) { setDragHistory(true); setDrag(false); }
    else { setDrag(true); setDragHistory(false); }
  };
  const handleDragLeave = () => { setDrag(false); setDragHistory(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setDrag(false); setDragHistory(false);
    const histJson = e.dataTransfer.getData("historyRow");
    if (histJson) { try { onLoadFromHistory?.(JSON.parse(histJson)); } catch {} }
    else { handle(e.dataTransfer.files[0]); }
  };

  const borderColor = dragHistory ? C.blue : drag ? color : loaded ? color : "#D1D5DB";
  const bgColor     = dragHistory ? `${C.blue}12` : drag ? `${color}08` : loaded ? `${color}0D` : "#FAFAFA";

  return (
    <div style={{ position: "relative" }}>
      <div
        onClick={() => { if (!showConfirmFull && !showConfirmLocal && !showSnapshot && !largeFileModal) ref.current.click(); }}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        style={{ border: `1.5px dashed ${borderColor}`, borderRadius: 10, padding: "11px 14px", cursor: "pointer", background: bgColor, transition: "all 0.18s", display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
        {dragHistory && (
          <div style={{ position: "absolute", inset: 0, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: `${C.blue}18`, fontSize: 13, fontWeight: 700, color: C.blue, pointerEvents: "none" }}>
            Déposer ici
          </div>
        )}
        <input ref={ref} type="file" accept=".csv" style={{ display: "none" }} onChange={e => handle(e.target.files[0])} />

        <div style={{ fontSize: 20, flexShrink: 0 }}>{uploading ? "⏳" : loaded ? "✅" : icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: loaded ? color : C.textMid }}>{label}</div>
          <div style={{ fontSize: 11, color: uploadErr ? "#DC2626" : C.textLight, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {uploading ? "Chargement…" : uploadErr ? uploadErr : loaded ? "Fichier chargé · sauvegardé" : hint}
          </div>
        </div>

        {loaded && (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button title="Sauvegarder un snapshot d'évolution" onClick={() => setShowSnapshot(true)}
              style={{ padding: "3px 8px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.textMid, fontSize: 11, cursor: "pointer", lineHeight: "18px" }}>📌</button>
            <button title="Retirer du projet (conserver dans la BDD)" onClick={() => { setShowConfirmFull(false); setShowConfirmLocal(true); }}
              style={{ padding: "3px 8px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.textMid, fontSize: 11, cursor: "pointer", lineHeight: "18px" }}>↩</button>
            <button title="Supprimer l'import (fichier + BDD)" onClick={() => { setShowConfirmLocal(false); setShowConfirmFull(true); }}
              style={{ padding: "3px 8px", border: "1px solid #FECACA", borderRadius: 6, background: "#FEF2F2", color: "#DC2626", fontSize: 11, cursor: "pointer", lineHeight: "18px" }}>🗑</button>
          </div>
        )}
      </div>

      {showConfirmFull && (
        <ConfirmPopover message="Supprimer définitivement cet import de la BDD et du stockage ?"
          onConfirm={handleDeleteFull} onCancel={() => setShowConfirmFull(false)} loading={deleting} />
      )}
      {showConfirmLocal && (
        <ConfirmPopover message="Retirer cet import du projet ? (le fichier reste dans la BDD)"
          onConfirm={handleDeleteLocal} onCancel={() => setShowConfirmLocal(false)} loading={false} />
      )}
      {showSnapshot && (
        <SnapshotModal source={source} rows={rows || []} filename={null}
          projectId={projectId} siteId={siteId} onClose={() => setShowSnapshot(false)} onSaved={() => {}} />
      )}
      {largeFileModal && (
        <LargeFileModal
          file={largeFileModal.file}
          text={largeFileModal.text}
          onTruncate={handleTruncate}
          onSkipStorage={handleSkipStorage}
          onCancel={handleCancelLarge}
        />
      )}
    </div>
  );
}