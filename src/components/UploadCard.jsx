import { useState, useCallback, useRef } from "react";
import { C } from "../lib/constants";
import { parseCSV, isSemrushCSV } from "../lib/helpers";
import { sbUpload, sbInsertImport, sbDeleteImport, sbDeleteFile, sbGetHistory } from "../lib/supabase";
import { SnapshotModal } from "./SnapshotSaver";

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

// ── Main component ────────────────────────────────────────────────
export default function UploadCard({ label, icon, hint, onData, onClear, loaded, color, siteId, source, projectId, onLoadFromHistory, rawMode, rows }) {
  const [drag, setDrag]               = useState(false);
  const [dragHistory, setDragHistory] = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [uploadErr, setUploadErr]     = useState(null);
  const [lastImportId, setLastImportId] = useState(null);
  const [lastStoragePath, setLastStoragePath] = useState(null);

  // Modals/popovers
  const [showSnapshot,      setShowSnapshot]      = useState(false);
  const [showConfirmFull,   setShowConfirmFull]    = useState(false);
  const [showConfirmLocal,  setShowConfirmLocal]   = useState(false);
  const [deleting,          setDeleting]           = useState(false);

  const ref = useRef();

  // Fetch last import record to get id + storage_path
  const fetchLastImport = useCallback(async () => {
    if (!siteId || !source || !projectId) return null;
    try {
      const rows = await sbGetHistory(projectId, 50);
      const match = rows.find(r => r.site_id === siteId && r.source === source);
      if (match) {
        setLastImportId(match.id);
        setLastStoragePath(match.storage_path);
        return match;
      }
    } catch { /* silent */ }
    return null;
  }, [siteId, source, projectId]);

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
      const parsedRows = rawMode ? null : parseCSV(text);
      rawMode ? onData(null, text) : onData(parsedRows);
      if (siteId && source) {
        setUploading(true);
        try {
          const ts   = new Date().toISOString().replace(/[:.]/g, "-");
          const path = `${projectId || "proj-default"}/${siteId}/${source}/${ts}_${file.name}`;
          await sbUpload(path, text);
          const rc = rawMode ? parseCSV(text).length : parsedRows.length;
          const result = await sbInsertImport({ project_id: projectId || "proj-default", site_id: siteId, source, filename: file.name, storage_path: path, row_count: rc });
          if (result?.[0]) { setLastImportId(result[0].id); setLastStoragePath(result[0].storage_path); }
        } catch (err) {
          setUploadErr(`Sauvegarde échouée — ${(err?.message || String(err)).slice(0, 60)}`);
          console.warn("Supabase upload error:", err);
        } finally {
          setUploading(false);
        }
      }
    };
    reader.readAsText(file);
  }, [onData, siteId, source, projectId, rawMode]);

  // Delete from DB + storage, and clear local state
  const handleDeleteFull = async () => {
    setDeleting(true);
    try {
      let importId = lastImportId;
      let storagePath = lastStoragePath;
      if (!importId) {
        const rec = await fetchLastImport();
        importId = rec?.id;
        storagePath = rec?.storage_path;
      }
      if (storagePath) await sbDeleteFile(storagePath).catch(() => {});
      if (importId) await sbDeleteImport(importId);
      onClear?.();
      setLastImportId(null);
      setLastStoragePath(null);
      setShowConfirmFull(false);
    } catch (err) {
      setUploadErr(`Suppression échouée — ${(err?.message || String(err)).slice(0, 60)}`);
    } finally {
      setDeleting(false);
    }
  };

  // Only clear local state (keep DB)
  const handleDeleteLocal = () => {
    onClear?.();
    setShowConfirmLocal(false);
  };

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
    if (histJson) {
      try { const row = JSON.parse(histJson); onLoadFromHistory?.(row); } catch {}
    } else {
      handle(e.dataTransfer.files[0]);
    }
  };

  const borderColor = dragHistory ? C.blue : drag ? color : loaded ? color : "#D1D5DB";
  const bgColor     = dragHistory ? `${C.blue}12` : drag ? `${color}08` : loaded ? `${color}0D` : "#FAFAFA";

  return (
    <div style={{ position: "relative" }}>
      {/* ── Main card ── */}
      <div
        onClick={() => { if (!showConfirmFull && !showConfirmLocal && !showSnapshot) ref.current.click(); }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ border: `1.5px dashed ${borderColor}`, borderRadius: 10, padding: "11px 14px", cursor: "pointer", background: bgColor, transition: "all 0.18s", display: "flex", alignItems: "center", gap: 10, position: "relative" }}
      >
        {dragHistory && (
          <div style={{ position: "absolute", inset: 0, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: `${C.blue}18`, fontSize: 13, fontWeight: 700, color: C.blue, pointerEvents: "none" }}>
            Déposer ici
          </div>
        )}
        <input ref={ref} type="file" accept=".csv" style={{ display: "none" }} onChange={e => handle(e.target.files[0])} />

        {/* Icon */}
        <div style={{ fontSize: 20, flexShrink: 0 }}>{uploading ? "⏳" : loaded ? "✅" : icon}</div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: loaded ? color : C.textMid }}>{label}</div>
          <div style={{ fontSize: 11, color: uploadErr ? "#DC2626" : C.textLight, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {uploading ? "Chargement…" : uploadErr ? uploadErr : loaded ? "Fichier chargé · sauvegardé" : hint}
          </div>
        </div>

        {/* Action buttons — only when loaded */}
        {loaded && (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>

            {/* Snapshot */}
            <button
              title="Sauvegarder un snapshot d'évolution"
              onClick={() => setShowSnapshot(true)}
              style={{ padding: "3px 8px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.textMid, fontSize: 11, cursor: "pointer", lineHeight: "18px" }}>
              📌
            </button>

            {/* Delete local only */}
            <button
              title="Retirer du projet (conserver dans la BDD)"
              onClick={() => { setShowConfirmFull(false); setShowConfirmLocal(true); }}
              style={{ padding: "3px 8px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.textMid, fontSize: 11, cursor: "pointer", lineHeight: "18px" }}>
              ↩
            </button>

            {/* Delete full */}
            <button
              title="Supprimer l'import (fichier + BDD)"
              onClick={() => { setShowConfirmLocal(false); setShowConfirmFull(true); }}
              style={{ padding: "3px 8px", border: "1px solid #FECACA", borderRadius: 6, background: "#FEF2F2", color: "#DC2626", fontSize: 11, cursor: "pointer", lineHeight: "18px" }}>
              🗑
            </button>
          </div>
        )}
      </div>

      {/* ── Confirm: delete full (BDD + file) ── */}
      {showConfirmFull && (
        <ConfirmPopover
          message="Supprimer définitivement cet import de la BDD et du stockage ?"
          onConfirm={handleDeleteFull}
          onCancel={() => setShowConfirmFull(false)}
          loading={deleting}
        />
      )}

      {/* ── Confirm: remove local only ── */}
      {showConfirmLocal && (
        <ConfirmPopover
          message="Retirer cet import du projet ? (le fichier reste dans la BDD)"
          onConfirm={handleDeleteLocal}
          onCancel={() => setShowConfirmLocal(false)}
          loading={false}
        />
      )}

      {/* ── Snapshot modal ── */}
      {showSnapshot && (
        <SnapshotModal
          source={source}
          rows={rows || []}
          filename={null}
          projectId={projectId}
          siteId={siteId}
          onClose={() => setShowSnapshot(false)}
          onSaved={() => {}}
        />
      )}
    </div>
  );
}