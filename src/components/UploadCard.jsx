import { useState, useCallback, useRef } from "react";
import { C } from "../lib/constants";
import { parseCSV, isSemrushCSV } from "../lib/helpers";
import { sbUpload, sbInsertImport } from "../lib/supabase";

export default function UploadCard({ label, icon, hint, onData, loaded, color, siteId, source, projectId, onLoadFromHistory, rawMode }) {
  const [drag, setDrag]               = useState(false);
  const [dragHistory, setDragHistory] = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [uploadErr, setUploadErr]     = useState(null);
  const ref = useRef();

  const handle = useCallback(async (file) => {
    if (!file) return;
    setUploadErr(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      // Validate Semrush format
      if (source === "sm" && !isSemrushCSV(text)) {
        setUploadErr("Format non reconnu — attendu : export Semrush (Organic Pages ou Position Tracking)");
        return;
      }
      // rawMode: pass raw text to onData (let caller parse), else parse CSV here
      const rows = rawMode ? null : parseCSV(text);
      rawMode ? onData(null, text) : onData(rows);
      if (siteId && source) {
        setUploading(true);
        try {
          const ts   = new Date().toISOString().replace(/[:.]/g, "-");
          const path = `${projectId || "proj-default"}/${siteId}/${source}/${ts}_${file.name}`;
          await sbUpload(path, text);
          await sbInsertImport({ project_id: projectId || "proj-default", site_id: siteId, source, filename: file.name, storage_path: path, row_count: rawMode ? 0 : rows.length });
        } catch (err) {
          const msg = err?.message || String(err);
          setUploadErr(`Sauvegarde échouée — ${msg.slice(0, 60)}`);
          console.warn("Supabase upload error:", err);
        } finally {
          setUploading(false);
        }
      }
    };
    reader.readAsText(file);
  }, [onData, siteId, source, projectId, rawMode]);

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
      try { const row = JSON.parse(histJson); onLoadFromHistory && onLoadFromHistory(row); } catch {}
    } else {
      handle(e.dataTransfer.files[0]);
    }
  };

  const borderColor = dragHistory ? C.blue : drag ? color : loaded ? color : "#D1D5DB";
  const bgColor     = dragHistory ? `${C.blue}12` : drag ? `${color}08` : loaded ? `${color}0D` : "#FAFAFA";

  return (
    <div
      onClick={() => ref.current.click()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ border: `1.5px dashed ${borderColor}`, borderRadius: 10, padding: "14px 16px", cursor: "pointer", background: bgColor, transition: "all 0.18s", display: "flex", alignItems: "center", gap: 12, position: "relative" }}
    >
      {dragHistory && (
        <div style={{ position: "absolute", inset: 0, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: `${C.blue}18`, fontSize: 13, fontWeight: 700, color: C.blue, pointerEvents: "none" }}>
          Déposer ici
        </div>
      )}
      <input ref={ref} type="file" accept=".csv" style={{ display: "none" }} onChange={e => handle(e.target.files[0])} />
      <div style={{ fontSize: 22 }}>{uploading ? "⏳" : loaded ? "✅" : icon}</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: loaded ? color : C.textMid }}>{label}</div>
        <div style={{ fontSize: 11, color: uploadErr ? C.red : C.textLight, marginTop: 2 }}>
          {uploading ? "Chargement…" : uploadErr ? uploadErr : loaded ? "Fichier chargé · sauvegardé" : hint}
        </div>
      </div>
    </div>
  );
}