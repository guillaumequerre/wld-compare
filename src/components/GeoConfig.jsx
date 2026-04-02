// components/GeoConfig.jsx
// Shared UI components for provider config and brand setup
// Used in both ImportTab (Section 3 & 4) and GeoTab

import { useState, useEffect } from "react";
import { C } from "../lib/constants";
import { sbSaveProviderKeys, sbSaveBrand, sbGetBrand } from "../lib/supabase";

function encodeKey(k) { try { return btoa(k); } catch { return ""; } }
function decodeKey(e) { try { return atob(e); } catch { return ""; } }

const PROVIDERS = [
  { id: "openai",     label: "OpenAI",     icon: "🟢", color: "#059669", keyField: "openai_key_enc",     keyPrefix: "sk-",      keyPlaceholder: "sk-…",      model: "gpt-4o-mini" },
  { id: "gemini",     label: "Gemini",     icon: "🔵", color: "#2563EB", keyField: "gemini_key_enc",     keyPrefix: "AIza",     keyPlaceholder: "AIza…",     model: "gemini-2.0-flash" },
  { id: "perplexity", label: "Perplexity", icon: "🟣", color: "#7C3AED", keyField: "perplexity_key_enc", keyPrefix: "pplx-",    keyPlaceholder: "pplx-…",    model: "sonar" },
  { id: "claude",     label: "Claude",     icon: "🟠", color: "#D97706", keyField: "claude_geo_key_enc", keyPrefix: "sk-ant-",  keyPlaceholder: "sk-ant-…",  model: "claude-haiku-4-5-20251001" },
];

// ── ProviderConfigPanel ───────────────────────────────────────────
export function ProviderConfigPanel({ project, projectId, sites, onSaveProviderKeys }) {
  const [open, setOpen]       = useState(false);
  const [keys, setKeys]       = useState(() => {
    const init = {};
    if (project) {
      PROVIDERS.forEach(p => {
        const enc = project[p.keyField] || "";
        if (enc) { const dec = decodeKey(enc); init[p.id] = { enc, dec, input: "", status: "ok" }; }
        else init[p.id] = { enc: "", dec: "", input: "", status: "idle" };
      });
    }
    return init;
  });
  const [semrushInput, setSemrushInput] = useState("");
  const [semrushEnc,   setSemrushEnc]   = useState(project?.semrush_key_enc || "");

  // Sync when project changes
  useEffect(() => {
    if (!project) return;
    const updates = {};
    PROVIDERS.forEach(p => {
      const enc = project[p.keyField] || "";
      const dec = enc ? decodeKey(enc) : "";
      updates[p.id] = { enc, dec, input: "", status: dec ? "ok" : "idle" };
    });
    setKeys(updates);
    setSemrushEnc(project.semrush_key_enc || "");
  }, [project?.id, project?.openai_key_enc, project?.gemini_key_enc, project?.perplexity_key_enc, project?.claude_geo_key_enc, project?.semrush_key_enc]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveKey = async (p) => {
    const k = keys[p.id]?.input?.trim();
    if (!k) return;
    const enc = encodeKey(k);
    const dec = decodeKey(enc);
    setKeys(prev => ({ ...prev, [p.id]: { enc, dec, input: "", status: "ok" } }));
    await sbSaveProviderKeys(projectId, { [p.keyField]: enc });
    onSaveProviderKeys?.({ [p.keyField]: enc });
  };

  const saveSemrush = async () => {
    const k = semrushInput.trim();
    if (!k) return;
    const enc = encodeKey(k);
    setSemrushEnc(enc);
    setSemrushInput("");
    await sbSaveProviderKeys(projectId, { semrush_key_enc: enc });
    onSaveProviderKeys?.({ semrush_key_enc: enc });
  };

  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>⚙️ Gestion des Providers</span>
          <div style={{ display: "flex", gap: 4 }}>
            {PROVIDERS.map(p => (
              <span key={p.id} style={{ fontSize: 11, fontWeight: 700, color: keys[p.id]?.dec ? "#059669" : C.textLight }}>
                {keys[p.id]?.dec ? "●" : "○"}
              </span>
            ))}
          </div>
        </div>
        <span style={{ fontSize: 13, color: C.textLight }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 20px 20px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 16 }}>
            {PROVIDERS.map(p => {
              const pk = keys[p.id] || { enc: "", dec: "", input: "", status: "idle" };
              const hasKey = !!pk.dec;
              return (
                <div key={p.id}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: p.color, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>
                    {p.icon} {p.label}
                    {hasKey
                      ? <span style={{ color: "#059669", marginLeft: 6, fontWeight: 700 }}>✓ OK</span>
                      : <span style={{ color: C.textLight, marginLeft: 6, fontWeight: 400 }}>· non configuré</span>
                    }
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="password"
                      placeholder={hasKey ? "••••••••••• (déjà configurée)" : p.keyPlaceholder}
                      value={pk.input || ""}
                      onChange={e => setKeys(prev => ({ ...prev, [p.id]: { ...prev[p.id], input: e.target.value, status: "idle" } }))}
                      onKeyDown={e => e.key === "Enter" && saveKey(p)}
                      style={{ flex: 1, padding: "6px 10px", border: `1px solid ${hasKey ? "#059669" : C.border}`, borderRadius: 7, fontSize: 12, color: C.text, background: hasKey ? "#F0FDF4" : C.white }}
                    />
                    <button onClick={() => saveKey(p)} disabled={!pk.input?.trim()}
                      style={{ padding: "6px 12px", borderRadius: 7, background: p.color, color: "#fff", border: "none", fontSize: 12, fontWeight: 700, cursor: pk.input?.trim() ? "pointer" : "not-allowed", opacity: pk.input?.trim() ? 1 : 0.5 }}>
                      ✓
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Semrush */}
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#FF642B", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>
                📊 Semrush
                {semrushEnc
                  ? <span style={{ color: "#059669", marginLeft: 6, fontWeight: 700 }}>✓ OK</span>
                  : <span style={{ color: C.textLight, marginLeft: 6, fontWeight: 400 }}>· non configuré</span>
                }
                <span style={{ fontSize: 9, color: C.textLight, marginLeft: 6, fontWeight: 400, textTransform: "none" }}>volumes mots-clés</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="password"
                  placeholder={semrushEnc ? "••••••••••• (déjà configurée)" : "Clé API Semrush…"}
                  value={semrushInput}
                  onChange={e => setSemrushInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && saveSemrush()}
                  style={{ flex: 1, padding: "6px 10px", border: `1px solid ${semrushEnc ? "#059669" : C.border}`, borderRadius: 7, fontSize: 12, color: C.text, background: semrushEnc ? "#F0FDF4" : C.white }}
                />
                <button onClick={saveSemrush} disabled={!semrushInput.trim()}
                  style={{ padding: "6px 12px", borderRadius: 7, background: "#FF642B", color: "#fff", border: "none", fontSize: 12, fontWeight: 700, cursor: semrushInput.trim() ? "pointer" : "not-allowed", opacity: semrushInput.trim() ? 1 : 0.5 }}>
                  ✓
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── BrandConfigPanel ──────────────────────────────────────────────
export function BrandConfigPanel({ site, projectId, onBrandSaved }) {
  const [brand, setBrand]         = useState(null);
  const [editing, setEditing]     = useState(false);
  const [draft, setDraft]         = useState({ brand_name: "", brand_domain: "", brand_aliases: "", competitors: "", context: "" });
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    if (!projectId || !site?.id) return;
    sbGetBrand(projectId, site.id).then(b => {
      if (b) {
        setBrand(b);
        setDraft({
          brand_name:    b.brand_name || "",
          brand_domain:  b.brand_domain || "",
          brand_aliases: (b.brand_aliases || []).join(", "),
          competitors:   (b.competitors || []).join(", "),
          context:       b.context || "",
        });
      }
    });
  }, [projectId, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true);
    const b = {
      project_id:    projectId,
      site_id:       site.id,
      brand_name:    draft.brand_name.trim(),
      brand_domain:  draft.brand_domain.trim(),
      brand_aliases: draft.brand_aliases.split(",").map(s => s.trim()).filter(Boolean),
      competitors:   draft.competitors.split(",").map(s => s.trim()).filter(Boolean),
      context:       draft.context.trim(),
    };
    await sbSaveBrand(b);
    setBrand(b);
    setEditing(false);
    onBrandSaved?.(b);
    setSaving(false);
  };

  if (!site) return null;

  return (
    <div style={{ background: site.bg || C.bg, border: `1px solid ${site.color || C.border}33`, borderRadius: 14, padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: editing ? 14 : 0 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: site.color }}>🏷️ {site.label}</span>
          {brand?.brand_name && !editing && (
            <>
              <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>Marque : <strong>{brand.brand_name}</strong></span>
              {brand.competitors?.length > 0 && <span style={{ fontSize: 11, color: C.textLight }}>{brand.competitors.length} concurrent{brand.competitors.length > 1 ? "s" : ""} trackés</span>}
            </>
          )}
          {!brand?.brand_name && !editing && <span style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucune marque configurée pour ce site</span>}
        </div>
        <button onClick={() => setEditing(e => !e)}
          style={{ padding: "5px 12px", border: `1px solid ${site.color || C.border}`, borderRadius: 7, background: "transparent", color: site.color || C.text, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
          {editing ? "Annuler" : brand ? "✏️ Modifier" : "➕ Configurer"}
        </button>
      </div>

      {editing && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[
            { label: "Nom de la marque *", key: "brand_name", placeholder: "ex: Acme Corp", span: false },
            { label: "Domaine principal *", key: "brand_domain", placeholder: "ex: acme.com", span: false },
            { label: "Alias / variantes", key: "brand_aliases", placeholder: "ex: Acme, ACME Inc (séparés par virgule)", span: true },
            { label: "Concurrents", key: "competitors", placeholder: "ex: rival.com, concurrent.fr (séparés par virgule)", span: true },
            { label: "Contexte", key: "context", placeholder: "Décrivez votre activité en 1-2 phrases", span: true },
          ].map(f => (
            <div key={f.key} style={{ gridColumn: f.span ? "1 / -1" : "auto" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 5 }}>{f.label}</div>
              {f.key === "context" ? (
                <textarea rows={2} value={draft[f.key]} onChange={e => setDraft(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  style={{ width: "100%", padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
              ) : (
                <input value={draft[f.key]} onChange={e => setDraft(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  style={{ width: "100%", padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, boxSizing: "border-box" }} />
              )}
            </div>
          ))}
          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
            <button onClick={save} disabled={saving || !draft.brand_name.trim()}
              style={{ padding: "7px 20px", background: site.color || C.blue, color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              {saving ? "⏳…" : "💾 Sauvegarder"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}