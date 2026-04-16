import { useState, useMemo, useCallback, useEffect } from "react";
import TourGuide from "./TourGuide";
import { sbGetBrand, sbGetQuestions, sbGetGeoResults, sbGetUrlIndex,
  sbSaveProject, sbDeleteProject, sbDownload,
  sbGetCalendarEntriesBatch, sbGetKeywords, sbGetCategories, sbGetCompetitors } from "./lib/supabase";
import UploadCard from "./components/UploadCard";
import PageTypeClassifier from "./components/PageTypeClassifier";
import { newProject } from "./lib/helpers";
import { C, SITE_PALETTE } from "./lib/constants";

const ANTHROPIC_PROXY = "/api/anthropic";

// Catégories concurrents — miroir de GeoTab
const COMP_CAT_DEFS = {
  direct:  { label: "Direct",    color: "#DC2626", bg: "#FEF2F2" },
  geo:     { label: "GEO",       color: "#D97706", bg: "#FFFBEB" },
  partner: { label: "Partenaire", color: "#059669", bg: "#ECFDF5" },
  other:   { label: "Autre",     color: "#64748B", bg: "#F1F5F9" },
};

// Rend les **texte** en <strong> dans toute l'app
function renderBold(text) {
  if (!text || !text.includes("**")) return text;
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? <strong key={i} style={{ fontSize: "1.05em" }}>{part}</strong> : part
  );
}

function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
function getDomain(url) { try { return new URL(url).hostname.replace("www.", ""); } catch { return url; } }
function dayKey(d) { return d.toISOString().slice(0, 10); }
function decodeKey(enc) { try { return enc ? atob(enc) : ""; } catch { return ""; } }
function getProviderId(model) {
  const m = (model || "").toLowerCase();
  if (m.includes("gpt") || m.includes("openai")) return "openai";
  if (m.includes("gemini")) return "gemini";
  if (m.includes("perplexity") || m.includes("sonar")) return "perplexity";
  if (m.includes("claude")) return "claude";
  return "other";
}


// ── AuditSetupPanel — vue props-only, zéro état local projet ────────
function SetupSection({ icon, title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <span>{icon}</span>{title}
      </div>
      {children}
    </div>
  );
}

function AuditSetupPanel({
  projects, currentProjectId, setCurrentProjectId, setProjects, ownerEmail,
  sites, setSites, sfData, setSfData, gscData, setGscData, gaData, setGaData, bingData, setBingData,
  dbHistory, dbLoading, refreshHistory, confirmModal, setConfirmModal,
  pageTypes, setPageTypes, project, projectId,
}) {
  const [showHistory, setShowHistory] = useState(false);

  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeSites    = Array.isArray(sites)    ? sites    : [];
  const safeHistory  = Array.isArray(dbHistory)? dbHistory: [];

  const lastImports = {};
  for (const row of safeHistory) {
    const k = `${row.site_id}_${row.source}`;
    if (!lastImports[k] && row.storage_path) lastImports[k] = row;
  }

  return (
    <div style={{ maxWidth: 680 }}>

      {/* ── Projet actif ── */}
      <SetupSection icon="📁" title="Projet actif">
        <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
              <select value={currentProjectId || ""} onChange={e => setCurrentProjectId(e.target.value)}
                style={{ width: "100%", padding: "7px 28px 7px 10px", border: "1.5px solid #2563EB", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#2563EB", background: "#EFF6FF", cursor: "pointer", appearance: "none" }}>
                {safeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#2563EB", fontSize: 11 }}>▾</span>
            </div>
            {safeProjects.length > 1 && (
              <button onClick={() => setConfirmModal?.({ message: `Supprimer "${safeProjects.find(p => p.id === currentProjectId)?.name}" ?`, onConfirm: () => {
                sbDeleteProject(currentProjectId).catch(() => {});
                setProjects(prev => { const next = prev.filter(x => x.id !== currentProjectId); if (next.length) setCurrentProjectId(next[0].id); return next; });
              }})} style={{ padding: "6px 10px", border: "1px solid #FECACA", borderRadius: 7, background: "#FEF2F2", cursor: "pointer", fontSize: 11, color: "#DC2626" }}>🗑</button>
            )}
            {safeProjects.length < 20 && (
              <button onClick={() => {
                const p = newProject(`Projet ${safeProjects.length + 1}`, [{ id: `site-${Date.now()}`, label: "Nouveau site", ...SITE_PALETTE[0] }], ownerEmail);
                setProjects(prev => [...prev, p]);
                setCurrentProjectId(p.id);
                sbSaveProject(p).catch(() => {});
              }} style={{ padding: "6px 10px", borderRadius: 7, border: "1.5px dashed #2563EB", background: "#EFF6FF", color: "#2563EB", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>+ Nouveau</button>
            )}
          </div>

          {/* Sites */}
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {safeSites.map(site => (
              <div key={site.id} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, border: `1px solid ${site.color}44`, background: site.bg }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: site.color, flexShrink: 0 }} />
                <input value={site.label} onChange={e => setSites(prev => (Array.isArray(prev) ? prev : []).map(s => s.id === site.id ? {...s, label: e.target.value} : s))}
                  style={{ fontSize: 12, fontWeight: 600, color: site.color, border: "none", outline: "none", background: "transparent", width: 100 }} />
                {safeSites.length > 1 && (
                  <button onClick={() => setConfirmModal?.({ message: `Supprimer "${site.label}" ?`, onConfirm: () => {
                    setSites(prev => (Array.isArray(prev) ? prev : []).filter(s => s.id !== site.id));
                    [setSfData, setGscData, setGaData, setBingData].forEach(fn => fn?.(p => { const n={...p}; delete n[site.id]; return n; }));
                  }})} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#DC2626", padding: 0 }}>✕</button>
                )}
              </div>
            ))}
            {safeSites.length < 3 && (
              <button onClick={() => {
                const palette = SITE_PALETTE[safeSites.length] || SITE_PALETTE[0];
                const newId = `site-${Date.now()}`;
                setSites(prev => [...(Array.isArray(prev) ? prev : []), { id: newId, label: `Site ${safeSites.length + 1}`, ...palette }]);
                [setSfData, setGscData, setGaData, setBingData].forEach(fn => fn?.(p => ({...p, [newId]: []})));
              }} style={{ padding: "4px 10px", borderRadius: 20, border: "1px dashed #E2E8F0", background: "#fff", color: "#2563EB", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>+ Site</button>
            )}
          </div>

          {/* Historique */}
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, color: "#94A3B8" }}>
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: dbLoading ? "#F59E0B" : safeHistory.length > 0 ? "#059669" : "#CBD5E1", marginRight: 5 }} />
              {dbLoading ? "Chargement…" : `${safeHistory.length} imports en base`}
            </span>
            <button onClick={() => { setShowHistory(h => !h); refreshHistory?.(); }}
              style={{ fontSize: 11, color: showHistory ? "#2563EB" : "#94A3B8", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              {showHistory ? "▲ Masquer" : "📋 Historique"}
            </button>
          </div>
          {showHistory && (
            <div style={{ marginTop: 8, maxHeight: 140, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
              {safeHistory.slice(0, 20).map(row => {
                const site = safeSites.find(s => s.id === row.site_id);
                const lbl = { sf:"🐸 SF", gsc:"🔍 GSC", ga:"📊 GA4", bing:"🤖 Bing" }[row.source] || row.source;
                return (
                  <div key={row.id} style={{ display: "flex", gap: 8, padding: "4px 8px", background: "#F1F5F9", borderRadius: 5, fontSize: 10, alignItems: "center" }}>
                    <span style={{ color: site?.color || "#1E293B", fontWeight: 600, minWidth: 60 }}>{site?.label || "—"}</span>
                    <span style={{ color: "#64748B" }}>{lbl}</span>
                    <span style={{ color: "#94A3B8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.filename}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SetupSection>

      {/* ── Imports CSV ── */}
      <SetupSection icon="📥" title="Imports CSV — SF, GSC, GA4, Bing">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {safeSites.map(site => (
            <div key={site.id} style={{ flex: "1 1 200px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: site.color, marginBottom: 8 }}>{site.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  { key: "sf",   label: "Screaming Frog", icon: "🐸", data: sfData,   setter: setSfData },
                  { key: "gsc",  label: "Search Console",  icon: "🔍", data: gscData,  setter: setGscData },
                  { key: "ga",   label: "Analytics 4",     icon: "📊", data: gaData,   setter: setGaData },
                  { key: "bing", label: "Bing Webmaster",  icon: "🤖", data: bingData, setter: setBingData },
                ].map(({ key, label, icon, data, setter }) => {
                  const hasData = data?.[site.id]?.length > 0;
                  const lastRow = lastImports[`${site.id}_${key}`];
                  return (
                    <UploadCard key={key} label={`${icon} ${label}`} siteId={site.id} source={key}
                      projectId={projectId} project={project}
                      hasData={hasData} lastImport={lastRow}
                      onParsed={rows => setter?.(prev => ({...prev, [site.id]: rows}))}
                      onDownload={lastRow ? () => sbDownload(lastRow.storage_path).then(rows => setter?.(prev => ({...prev, [site.id]: rows}))) : null}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </SetupSection>

      {/* ── Classification des pages ── */}
      <SetupSection icon="🏷️" title="Classification des pages">
        <PageTypeClassifier projectId={projectId} sites={safeSites} pageTypes={pageTypes} setPageTypes={setPageTypes} />
      </SetupSection>

    </div>
  );
}


// ── Stat card ─────────────────────────────────────────────────────
// ── Analyse par catégorie de mots-clés ───────────────────────────
function CategoryAnalysisCard({ siteQuestions, siteResults, keywords, categories, brand, claudeKey }) {
  const [status, setStatus]   = useState("idle"); // idle | warning | loading | done | error
  const [analysis, setAnalysis] = useState("");
  const [open, setOpen]         = useState(false);

  // Construire la map keyword → category pour enrichir les questions
  const kwCatMap = useMemo(() => {
    const m = {};
    keywords.forEach(k => { if (k.category_id) m[k.id] = k.category_id; });
    return m;
  }, [keywords]);

  // Vérifier si des catégories sont assignées aux mots-clés
  const kwWithCat   = keywords.filter(k => k.category_id).length;
  const kwTotal     = keywords.length;
  const hasCats     = kwWithCat > 0;
  const catCoverage = kwTotal > 0 ? Math.round(kwWithCat / kwTotal * 100) : 0;

  // Grouper les questions par catégorie via keyword_id → category_id
  const byCategory = useMemo(() => {
    const map = {}; // category_id → { cat, questions, results }
    siteQuestions.forEach(q => {
      const catId = kwCatMap[q.keyword_id] || "__none__";
      if (!map[catId]) map[catId] = { questions: [], results: [] };
      map[catId].questions.push(q);
    });
    siteResults.forEach(r => {
      const q = siteQuestions.find(q => q.id === r.question_id);
      const catId = (q && kwCatMap[q.keyword_id]) || "__none__";
      if (!map[catId]) map[catId] = { questions: [], results: [] };
      map[catId].results.push(r);
    });
    return map;
  }, [siteQuestions, siteResults, kwCatMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const catStats = useMemo(() => {
    return Object.entries(byCategory)
      .filter(([id]) => id !== "__none__")
      .map(([id, { questions, results }]) => {
        const cat = categories.find(c => c.id === id);
        const total = results.length;
        const present = results.filter(r => r.brand_mentioned === true || r.brand_mentioned === 1).length;
        const pct = total > 0 ? Math.round(present / total * 100) : null;
        return { id, cat, questions: questions.length, results: total, present, pct };
      })
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  }, [byCategory, categories]); // eslint-disable-line react-hooks/exhaustive-deps

  const noneStats = byCategory["__none__"] ? (() => {
    const { questions, results } = byCategory["__none__"];
    const present = results.filter(r => r.brand_mentioned === true || r.brand_mentioned === 1).length;
    return { questions: questions.length, results: results.length, present };
  })() : null;

  const run = async () => {
    if (!claudeKey) return;
    setStatus("loading"); setAnalysis(""); setOpen(true);
    const brandName = brand?.brand_name || "la marque";
    const rows = catStats.map(s =>
      `- ${s.cat?.name || s.id} : ${s.pct !== null ? s.pct + "%" : "—"} présence (${s.present}/${s.results} rép., ${s.questions} questions)`
    ).join("\n");
    const prompt = `Tu es un expert GEO (Generative Engine Optimization).
Voici la présence de "${brandName}" dans les réponses LLM, ventilée par catégorie de mots-clés :

${rows || "Aucune donnée de catégorie disponible."}

${noneStats ? `Questions non catégorisées : ${noneStats.results} réponses, ${Math.round((noneStats.present/Math.max(noneStats.results,1))*100)}% de présence.\n` : ""}

Analyse en 3 sections :
## Forces par catégorie
Quelles catégories ont la meilleure présence et pourquoi (2-3 phrases max par catégorie forte).

## Axes prioritaires
Les 3 catégories avec le plus grand potentiel de progression. Pour chacune : diagnostic et action concrète.

## Recommandation transversale
Une recommandation de contenu ou de stratégie qui s'applique à toutes les catégories faibles.

Sois direct, concis, actionnable. Pas de généralités.`;

    try {
      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 900, messages: [{ role: "user", content: prompt }], apiKey: claudeKey }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || data.error?.message || "Erreur de génération.";
      setAnalysis(text);
      setStatus("done");
    } catch(e) {
      setAnalysis("Erreur : " + e.message);
      setStatus("error");
    }
  };

  const handleCTA = () => {
    if (!hasCats) {
      setStatus("warning");
    } else {
      run();
    }
  };

  // Couleur de présence
  const pctColor = (p) => p === null ? C.textLight : p >= 60 ? "#059669" : p >= 30 ? "#D97706" : "#DC2626";
  const pctBg    = (p) => p === null ? C.bg : p >= 60 ? "#ECFDF5" : p >= 30 ? "#FFFBEB" : "#FEF2F2";

  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, background: C.bg, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>📂</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Analyse par catégorie</div>
            <div style={{ fontSize: 11, color: C.textLight, marginTop: 1 }}>
              Présence de la marque ventilée par catégorie de mots-clés
            </div>
          </div>
        </div>
        <button
          onClick={handleCTA}
          disabled={status === "loading" || !claudeKey}
          style={{ padding: "8px 18px", background: status === "loading" ? C.bg : "#7C3AED", color: status === "loading" ? C.textLight : "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: status === "loading" || !claudeKey ? "default" : "pointer", opacity: !claudeKey ? 0.5 : 1 }}
          title={!claudeKey ? "Clé Claude manquante dans ⚙️ Providers" : undefined}
        >
          {status === "loading" ? "⏳ Analyse…" : "✦ Analyser par catégorie"}
        </button>
      </div>

      {/* Warning — pas de catégories */}
      {status === "warning" && (
        <div style={{ padding: "14px 20px", background: "#FFFBEB", borderBottom: `1px solid #FDE68A` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>
            ⚠️ Aucun mot-clé catégorisé ({catCoverage}% des {kwTotal} mots-clés ont une catégorie)
          </div>
          <div style={{ fontSize: 11, color: "#B45309", marginBottom: 10 }}>
            Pour une analyse pertinente, catégorisez vos mots-clés dans <strong>Fan-outs → Mots-clés</strong>.
            Les catégories s'appliquent aux questions liées au mot-clé.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={run} style={{ padding: "5px 14px", background: "#D97706", color: "#fff", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              Analyser quand même
            </button>
            <button onClick={() => setStatus("idle")} style={{ padding: "5px 14px", background: "none", border: `1px solid #D97706`, color: "#D97706", borderRadius: 7, fontSize: 11, cursor: "pointer" }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Tableau des catégories — toujours visible */}
      {catStats.length > 0 && (
        <div style={{ padding: "14px 20px", borderBottom: status === "done" ? `1px solid ${C.border}` : "none" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["Catégorie", "Questions", "Réponses", "Présence"].map(h => (
                  <th key={h} style={{ padding: "6px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catStats.map(s => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                  <td style={{ padding: "7px 12px", fontWeight: 600 }}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: s.cat?.color || "#94A3B8", marginRight: 8 }} />
                    {s.cat?.name || s.id}
                  </td>
                  <td style={{ padding: "7px 12px", color: C.textMid }}>{s.questions}</td>
                  <td style={{ padding: "7px 12px", color: C.textMid }}>{s.results}</td>
                  <td style={{ padding: "7px 12px" }}>
                    {s.pct !== null
                      ? <span style={{ fontWeight: 700, color: pctColor(s.pct), background: pctBg(s.pct), borderRadius: 5, padding: "2px 8px" }}>{s.pct}%</span>
                      : <span style={{ color: C.textLight, fontSize: 11 }}>—</span>}
                  </td>
                </tr>
              ))}
              {noneStats && noneStats.questions > 0 && (
                <tr style={{ borderBottom: `1px solid ${C.borderLight}`, opacity: 0.6 }}>
                  <td style={{ padding: "7px 12px", fontStyle: "italic", color: C.textLight }}>Non catégorisées</td>
                  <td style={{ padding: "7px 12px", color: C.textLight }}>{noneStats.questions}</td>
                  <td style={{ padding: "7px 12px", color: C.textLight }}>{noneStats.results}</td>
                  <td style={{ padding: "7px 12px", color: C.textLight }}>{noneStats.results > 0 ? Math.round(noneStats.present/noneStats.results*100)+"%" : "—"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {catStats.length === 0 && status !== "warning" && (
        <div style={{ padding: "14px 20px", fontSize: 12, color: C.textLight, fontStyle: "italic" }}>
          Catégorisez vos mots-clés dans Fan-outs → Mots-clés pour voir la présence par axe thématique.
        </div>
      )}

      {/* Résultat analyse IA */}
      {status === "done" && analysis && (
        <div style={{ padding: "16px 20px" }}>
          <button onClick={() => setOpen(o => !o)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#7C3AED", fontWeight: 700, padding: 0, marginBottom: open ? 10 : 0 }}>
            {open ? "▲ Masquer l'analyse IA" : "▼ Voir l'analyse IA"}
          </button>
          {open && (
            <div style={{ fontSize: 12, color: C.text, lineHeight: 1.7 }}>
              {analysis.split("\n").map((line, i) => {
                if (line.startsWith("## ")) return <div key={i} style={{ fontWeight: 700, fontSize: 13, color: "#7C3AED", marginTop: 14, marginBottom: 4 }}>{line.slice(3)}</div>;
                if (line.startsWith("- ")) return <div key={i} style={{ paddingLeft: 14, marginBottom: 3 }}>• {line.slice(2)}</div>;
                if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
                return <div key={i} style={{ marginBottom: 3 }}>{line}</div>;
              })}
            </div>
          )}
        </div>
      )}
      {status === "error" && (
        <div style={{ padding: "12px 20px", fontSize: 11, color: "#DC2626" }}>⚠️ {analysis}</div>
      )}
    </div>
  );
}

function Section({ icon, title, sub, children, accent }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${accent ? accent + "44" : C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, background: accent ? accent + "08" : C.bg, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{title}</div>
          {sub && <div style={{ fontSize: 11, color: C.textLight, marginTop: 1 }}>{sub}</div>}
        </div>
      </div>
      <div style={{ padding: "16px 24px" }}>{children}</div>
    </div>
  );
}

// ── Scatter plot concurrents : citations (X) × position moy. (Y) ──
function CompetitorScatter({ compStats, total, brandName, brandWithBrand, brandAvgPos }) {
  const W = 560, H = 300, PL = 44, PR = 16, PT = 16, PB = 36;
  const plotW = W - PL - PR, plotH = H - PT - PB;

  const COLORS = ["#DC2626","#D97706","#7C3AED","#2563EB","#0891B2","#059669","#9333EA","#EA580C"];

  // Préparer les points concurrents — utilise la couleur de catégorie si dispo
  const entries = Object.entries(compStats).map(([name, s], idx) => ({
    name,
    citations: s.mentions,
    pct: Math.round(s.mentions / Math.max(total, 1) * 100),
    avgPos: s.positions.length ? +(s.positions.reduce((a, b) => a + b, 0) / s.positions.length).toFixed(1) : null,
    color: s.color || COLORS[idx % COLORS.length],
    category: s.category || "other",
  }));

  // Ajouter la marque si données dispo
  const brandEntry = brandName && brandWithBrand > 0 ? {
    name: brandName, citations: brandWithBrand,
    pct: Math.round(brandWithBrand / Math.max(total, 1) * 100),
    avgPos: brandAvgPos ? +brandAvgPos : null,
    isBrand: true,
  } : null;
  const allPoints = brandEntry ? [...entries, brandEntry] : entries;
  const withPos = allPoints.filter(p => p.avgPos !== null);

  if (!withPos.length) {
    return <div style={{ fontSize: 11, color: "#94A3B8", fontStyle: "italic" }}>Données de position insuffisantes pour le graphique</div>;
  }

  const maxCit = Math.max(...withPos.map(p => p.citations), 1);
  const maxPos = Math.max(...withPos.map(p => p.avgPos), 5);
  const minPos = Math.min(...withPos.map(p => p.avgPos), 1);
  const posRange = Math.max(maxPos - minPos + 1, 3);

  const toX = (cit) => PL + (cit / maxCit) * plotW;
  // Y inversé : position 1 en haut
  const toY = (pos) => PT + ((pos - minPos) / posRange) * plotH;

  // Quadrant labels
  const midPos = (maxPos + minPos) / 2;

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", background: "#FAFAFA", borderRadius: 10, border: "1px solid #E8E8ED" }}>
        {/* Axes */}
        <line x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} stroke="#E2E8F0" strokeWidth={1} />
        <line x1={PL} x2={PL} y1={PT} y2={H - PB} stroke="#E2E8F0" strokeWidth={1} />

        {/* Quadrant background */}
        <rect x={PL} y={PT} width={plotW / 2} height={plotH / 2} fill="#FEF2F2" opacity={0.5} />
        <rect x={PL + plotW / 2} y={PT} width={plotW / 2} height={plotH / 2} fill="#FFFBEB" opacity={0.5} />
        <rect x={PL} y={PT + plotH / 2} width={plotW / 2} height={plotH / 2} fill="#EFF6FF" opacity={0.5} />
        <rect x={PL + plotW / 2} y={PT + plotH / 2} width={plotW / 2} height={plotH / 2} fill="#ECFDF5" opacity={0.5} />

        {/* Quadrant dividers */}
        <line x1={PL + plotW / 2} x2={PL + plotW / 2} y1={PT} y2={H - PB} stroke="#CBD5E1" strokeWidth={1} strokeDasharray="4,3" />
        <line x1={PL} x2={W - PR} y1={PT + plotH / 2} y2={PT + plotH / 2} stroke="#CBD5E1" strokeWidth={1} strokeDasharray="4,3" />

        {/* Quadrant labels */}
        <text x={PL + 6} y={PT + 12} fontSize={8} fill="#DC2626" opacity={0.7}>Peu cités · mal positionnés</text>
        <text x={PL + plotW / 2 + 6} y={PT + 12} fontSize={8} fill="#D97706" opacity={0.7}>Très cités · mal positionnés</text>
        <text x={PL + 6} y={PT + plotH / 2 + 12} fontSize={8} fill="#2563EB" opacity={0.7}>Peu cités · bien positionnés</text>
        <text x={PL + plotW / 2 + 6} y={PT + plotH / 2 + 12} fontSize={8} fill="#059669" opacity={0.7}>Très cités · bien positionnés</text>

        {/* Ticks X (citations) */}
        {[0, Math.round(maxCit / 2), maxCit].map(v => {
          const x = toX(v);
          return <g key={v}>
            <line x1={x} x2={x} y1={H - PB} y2={H - PB + 4} stroke="#CBD5E1" strokeWidth={1} />
            <text x={x} y={H - PB + 14} fontSize={8} fill="#94A3B8" textAnchor="middle">{v}</text>
          </g>;
        })}

        {/* Ticks Y (position — inversé) */}
        {[Math.ceil(minPos), Math.round(midPos), Math.floor(maxPos)].map(v => {
          const y = toY(v);
          return <g key={v}>
            <line x1={PL - 4} x2={PL} y1={y} y2={y} stroke="#CBD5E1" strokeWidth={1} />
            <text x={PL - 6} y={y + 3} fontSize={8} fill="#94A3B8" textAnchor="end">#{v}</text>
          </g>;
        })}

        {/* Axis labels */}
        <text x={PL + plotW / 2} y={H - 2} fontSize={9} fill="#64748B" textAnchor="middle">Citations dans les réponses LLM →</text>
        <text x={10} y={PT + plotH / 2} fontSize={9} fill="#64748B" textAnchor="middle" transform={`rotate(-90, 10, ${PT + plotH / 2})`}>Position moy. ↓</text>

        {/* Points */}
        {withPos.map((p, i) => {
          const x = toX(p.citations);
          const y = toY(p.avgPos);
          const color = p.isBrand ? "#059669" : (p.color || COLORS[i % COLORS.length]);
          const r = 6 + Math.sqrt(p.citations) * 1.2;
          return (
            <g key={p.name}>
              <circle cx={x} cy={y} r={r} fill={color} opacity={0.85} stroke="#fff" strokeWidth={1.5} />
              <text x={x} y={y - r - 3} fontSize={9} fill={color} textAnchor="middle" fontWeight={p.isBrand ? "800" : "600"}>
                {p.name.length > 12 ? p.name.slice(0, 11) + "…" : p.name}
              </text>
              <text x={x} y={y + 3} fontSize={8} fill="#fff" textAnchor="middle" fontWeight="700">{p.pct}%</text>
            </g>
          );
        })}
      </svg>

      {/* Légende */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
        {withPos.map((p, i) => {
          const color = p.isBrand ? "#059669" : (p.color || COLORS[i % COLORS.length]);
          return (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ fontWeight: p.isBrand ? 700 : 400 }}>{p.name}</span>
              <span style={{ color: "#94A3B8" }}>({p.citations} cit. · pos. {p.avgPos ?? "—"})</span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>Taille des bulles proportionnelle au nombre de citations · % = part des résultats</div>
    </div>
  );
}

// ── Bandeau de score GEO ───────────────────────────────────────────
function GeoScoreBanner({ audit, brand, site }) {
  const score = audit.presenceRate;
  const level = score >= 70 ? { label: "Excellent", color: "#059669", bg: "#ECFDF5", bar: "#059669" }
              : score >= 50 ? { label: "Bon", color: "#2563EB", bg: "#EFF6FF", bar: "#2563EB" }
              : score >= 30 ? { label: "À améliorer", color: "#D97706", bg: "#FFFBEB", bar: "#D97706" }
              : { label: "Critique", color: "#DC2626", bg: "#FEF2F2", bar: "#DC2626" };

  return (
    <div style={{ background: level.bg, border: `1.5px solid ${level.color}33`, borderRadius: 16, padding: "20px 28px", marginBottom: 20, display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>
      {/* Score visuel */}
      <div style={{ textAlign: "center", minWidth: 90 }}>
        <div style={{ fontSize: 48, fontWeight: 900, color: level.color, lineHeight: 1 }}>{score}%</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: level.color, marginTop: 4 }}>Score GEO</div>
      </div>
      {/* Barre de progression */}
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ height: 10, background: "#E2E8F0", borderRadius: 5, overflow: "hidden", marginBottom: 10 }}>
          <div style={{ height: "100%", width: `${score}%`, background: level.bar, borderRadius: 5, transition: "width 0.4s" }} />
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div><span style={{ fontSize: 11, color: C.textLight }}>Marque</span> <strong style={{ fontSize: 13, color: C.text }}>{brand?.brand_name || "—"}</strong></div>
          <div><span style={{ fontSize: 11, color: C.textLight }}>Site</span> <strong style={{ fontSize: 13, color: C.text }}>{site?.label || "—"}</strong></div>
          <div><span style={{ fontSize: 11, color: C.textLight }}>Questions testées</span> <strong style={{ fontSize: 13, color: C.text }}>{audit.questions}</strong></div>
          <div><span style={{ fontSize: 11, color: C.textLight }}>Résultats</span> <strong style={{ fontSize: 13, color: C.text }}>{audit.total}</strong></div>
        </div>
      </div>
      {/* Cibles */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 140 }}>
        {[
          { label: "Présence", val: `${audit.withBrand}/${audit.total}`, color: level.color },
          { label: "Pos. moy.", val: audit.avgPos ? `#${audit.avgPos}` : "—", color: C.text },
          { label: "Cité source", val: String(audit.withSources), color: C.blue },
          { label: "Concurrents", val: String(Object.keys(audit.compStats).length), color: C.amber },
        ].map(k => (
          <div key={k.label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 11, color: C.textLight }}>{k.label}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: k.color }}>{k.val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


// ── Normalise une URL pour comparaison et groupement ─────────────
function normalizeUrl(raw) {
  if (!raw) return "";
  let u = raw.trim();
  // Supprimer le query string et fragment
  u = u.replace(/[?#].*$/, "");
  // Supprimer le slash final
  u = u.replace(/\/$/, "");
  // Supprimer https:// http://
  u = u.replace(/^https?:\/\//i, "");
  // Supprimer www.
  u = u.replace(/^www\./i, "");
  return u.toLowerCase();
}

function computeAudit(questions, results, urlIndex, brand, site, calendarEntries = [], keywords = [], competitors = []) {
  const brandName = brand?.brand_name || "";
  const brandAliases = brand?.brand_aliases || [];
  const total = results.length;
  const withBrand = results.filter(r => r.brand_mentioned).length;
  const withSources = results.filter(r => r.brand_in_sources).length;
  const positions = results.filter(r => r.brand_position).map(r => r.brand_position);
  const avgPos = positions.length ? (positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(1) : null;

  // ── TrendChart — basé sur geo_calendar_dates ─────────────────
  // Compter par test_date : total d'interrogations et présences de la marque
  const calByDate = {};
  calendarEntries.forEach(e => {
    const d = e.test_date || (e.created_at || "").slice(0, 10);
    if (!d) return;
    if (!calByDate[d]) calByDate[d] = { tested: 0, present: 0 };
    calByDate[d].tested++;
    if (e.brand_present === true || e.brand_present === 1) calByDate[d].present++;
  });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const trendDays = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const day = calByDate[key] || { tested: 0, present: 0 };
    trendDays.push({
      date: key,
      tested: day.tested,
      present: day.present,
      rate: day.tested > 0 ? pct(day.present, day.tested) : null,
    });
  }

  // ── URLs marque — normalisation et cumul ─────────────────────
  const brandTerms = [brandName, ...brandAliases].filter(Boolean).map(t => t.toLowerCase());
  const isBrandTerm = (str) => brandTerms.some(t => t && str.toLowerCase().includes(t));

  // Grouper urlIndex par URL normalisée
  const normGroups = {};
  urlIndex.forEach(u => {
    const norm = normalizeUrl(u.url);
    if (!norm) return;
    if (!normGroups[norm]) normGroups[norm] = { norm, url: u.url, count_as_source: 0, count_in_answer: 0, domain: null, linkedQs: [], linkedKeywords: [] };
    normGroups[norm].count_as_source += u.count_as_source || 0;
    normGroups[norm].count_in_answer += u.count_in_answer || 0;
    if (!normGroups[norm].domain) normGroups[norm].domain = u.domain;
  });
  const mergedUrls = Object.values(normGroups).sort((a, b) => (b.count_as_source + b.count_in_answer) - (a.count_as_source + a.count_in_answer));

  const sortedUrls = mergedUrls;
  const brandUrls = mergedUrls.filter(u =>
    isBrandTerm(u.norm) || isBrandTerm(u.domain || "")
  );
  const competitorUrls = mergedUrls.filter(u =>
    !isBrandTerm(u.norm) && competitors.some(c => c && u.norm.includes(c.toLowerCase()))
  );
  const referenceUrls = mergedUrls
    .filter(u => !brandUrls.includes(u) && !competitorUrls.includes(u))
    .slice(0, 10);

  // urlDetails — relier les URLs marque aux questions
  const qMap = {};
  questions.forEach(q => { qMap[q.id] = q; });
  const urlDetails = brandUrls.map(u => {
    const linkedResults = results.filter(r =>
      (r.sources || []).some(s => normalizeUrl(s) === u.norm) ||
      (r.answer || "").includes(u.norm)
    );
    const linkedQIds = [...new Set(linkedResults.map(r => r.question_id))];
    const linkedQs = linkedQIds.map(id => qMap[id]).filter(Boolean);
    const linkedKeywords = [...new Set(linkedQs.map(q => q.keyword_id).filter(Boolean))];
    return { ...u, linkedQs, linkedKeywords };
  });

  const topDomains = {};
  sortedUrls.forEach(u => {
    if (!topDomains[u.norm]) topDomains[u.norm] = 0;
    topDomains[u.norm] += u.count_as_source + u.count_in_answer;
  });

  const urlsToOptimize = brandUrls.filter(u => u.count_as_source < 3).slice(0, 15);
  const urlsToRework   = brandUrls.filter(u => u.count_as_source === 0 && u.count_in_answer > 0).slice(0, 15);
  const urlsToInspire  = referenceUrls.filter(u => u.count_as_source >= 3).slice(0, 10);

  const intentCount = {};
  results.forEach(r => { if (r.intent_type) intentCount[r.intent_type] = (intentCount[r.intent_type] || 0) + 1; });
  const typeCount = {};
  results.forEach(r => { if (r.answer_type) typeCount[r.answer_type] = (typeCount[r.answer_type] || 0) + 1; });
  const compStats = {};
  // 1. Depuis competitors_mentioned (résultats récents)
  results.forEach(r => (r.competitors_mentioned || []).forEach(c => {
    if (!compStats[c.name]) compStats[c.name] = { mentions: 0, positions: [], category: null, color: null };
    compStats[c.name].mentions++;
    if (c.position) compStats[c.name].positions.push(c.position);
  }));

  // 2. Enrichir avec les concurrents qualifiés (catégorie + recherche rétroactive)
  competitors.forEach(comp => {
    const key = comp.name;
    if (!compStats[key]) compStats[key] = { mentions: 0, positions: [], category: null, color: null };
    // Attacher la catégorie et la couleur depuis geo_competitors
    compStats[key].category = comp.category || "other";
    compStats[key].color    = comp.color || "#64748B";
    // Recherche rétroactive dans les réponses non encore comptées
    const re = new RegExp(comp.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    results.forEach(r => {
      const alreadyCounted = (r.competitors_mentioned || []).some(c => c.name?.toLowerCase() === key.toLowerCase());
      if (!alreadyCounted && re.test(r.answer || "")) {
        compStats[key].mentions++;
      }
    });
  });

  const presenceRate = pct(withBrand, total);

  // ── Questions 25 max — favoris d'abord, puis par volume de keyword ─
  const kwVolMap = {};
  keywords.forEach(k => { if (k.search_volume > 0) kwVolMap[k.id] = k.search_volume; });

  // Trier toutes les questions : favoris d'abord, puis par volume desc, puis par création
  const sortedQuestions = [...questions].sort((a, b) => {
    if (a.is_favorite && !b.is_favorite) return -1;
    if (!a.is_favorite && b.is_favorite) return 1;
    const va = kwVolMap[a.keyword_id] || 0;
    const vb = kwVolMap[b.keyword_id] || 0;
    if (vb !== va) return vb - va;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  const hasResult = (q) => results.some(r => r.question_id === q.id);
  const hasBrand  = (q) => results.some(r => r.question_id === q.id && (r.brand_mentioned === true || r.brand_mentioned === 1));

  // Prendre max 25 questions avec résultats, puis compléter avec sans résultats
  const withResults = sortedQuestions.filter(hasResult);
  const withoutRes  = sortedQuestions.filter(q => !hasResult(q));
  const top25 = [...withResults, ...withoutRes].slice(0, 25);

  const presentBrandQs = top25
    .filter(hasBrand)
    .map(q => ({ question: q.question, isFav: !!q.is_favorite, volume: kwVolMap[q.keyword_id] || 0 }));
  const missingBrandQs = top25
    .filter(q => !hasBrand(q))
    .map(q => ({ question: q.question, isFav: !!q.is_favorite, volume: kwVolMap[q.keyword_id] || 0 }));

  const hasFavFilter = questions.some(q => q.is_favorite);
  const favCount = questions.filter(q => q.is_favorite).length;

  const leads = [];
  if (presenceRate < 30) leads.push({ priority: "🔴 Critique", label: "Présence < 30%", action: "**Créer des contenus de recommandation** spécifiquement ciblés sur les questions sans présence. Structurez avec des listes comparatives explicites." });
  if (presenceRate >= 30 && presenceRate < 50) leads.push({ priority: "🟠 À améliorer", label: `Présence ${presenceRate}%`, action: "**Enrichir les pages existantes** pour répondre directement aux questions fan-out. Ajoutez des sections dédiées aux comparatifs." });
  if (avgPos && parseFloat(avgPos) > 3) leads.push({ priority: "🟠 Position", label: `Position moyenne ${avgPos}`, action: "**Optimiser le contenu pour remonter en top 3** des fan-outs. Répondez à la question dès le premier paragraphe et structurez avec des listes." });
  if (withSources < withBrand) leads.push({ priority: "🟡 Sources", label: "Peu cité en source", action: "**Renforcer l'autorité des pages** via des backlinks depuis les domaines fréquemment cités. Soumettez vos URLs prioritaires à IndexNow." });
  if (Object.keys(compStats).length > 0) {
    const topComp = Object.entries(compStats).sort((a, b) => b[1].mentions - a[1].mentions)[0];
    leads.push({ priority: "🟠 Concurrence", label: `${topComp[0]} dominant`, action: `**Analyser le contenu de ${topComp[0]}** et créer des pages alternatives plus complètes avec données propriétaires et avis d'experts.` });
  }
  leads.push({ priority: "📝 Contenu", label: "Volume et structure", action: "**Viser 1 500–2 500 mots** sur les pages à forte intention. Structurez avec H2/H3 clairs, FAQ en bas de page, et schema JSON-LD Organization + FAQ." });
  leads.push({ priority: "🔗 Maillage", label: "Hubs thématiques", action: "**Créer des hubs de contenu** regroupant toutes les pages liées à chaque axe fan-out. Le maillage interne fort signale l'importance aux LLMs." });

  const providerStats = {};
  results.forEach(r => {
    const pid = getProviderId(r.model);
    if (!providerStats[pid]) providerStats[pid] = { total: 0, withBrand: 0 };
    providerStats[pid].total++;
    if (r.brand_mentioned) providerStats[pid].withBrand++;
  });

  return { total, withBrand, withSources, avgPos, presenceRate, trendDays, sortedUrls, brandUrls, urlDetails, competitorUrls, referenceUrls, topDomains, intentCount, typeCount, compStats, urlsToOptimize, urlsToRework, urlsToInspire, leads, questions: questions.length, providerStats, missingBrandQs, presentBrandQs, hasFavFilter, favCount };
}


function TrendChart({ trendDays }) {
  const W = 600, H = 110, PAD = 36, plotW = W - PAD - 16, plotH = H - 24;
  const active = trendDays.filter(d => d.tested > 0);
  if (!active.length) return <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucun test effectué ces 30 derniers jours</div>;
  // Ordonnée = citations brutes (present), max = max_du_jour * 1.5 (min 4 pour lisibilité)
  const maxPresent = Math.max(...trendDays.map(d => d.present || 0));
  const yMax = Math.max(Math.ceil(maxPresent * 1.5), 4);
  const toY = (v) => H - 12 - (v / yMax) * plotH;
  const pts = trendDays.map((d, i) => ({
    x: PAD + (i / (trendDays.length - 1)) * plotW,
    y: d.present !== null ? toY(d.present) : null,
    ...d,
  }));
  const pathPts = pts.filter(p => p.y !== null && p.tested > 0);
  const pathD = pathPts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  // Graduations : 0, mi, max
  const ticks = [0, Math.round(yMax / 2), yMax];
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* Grille */}
      {ticks.map(v => {
        const y = toY(v);
        return <g key={v}>
          <line x1={PAD} x2={W - 16} y1={y} y2={y} stroke={C.border} strokeWidth={0.5} strokeDasharray="3,3" />
          <text x={PAD - 5} y={y + 3} fontSize={8} fill={C.textLight} textAnchor="end">{v}</text>
        </g>;
      })}
      {/* Axe X */}
      <line x1={PAD} x2={W - 16} y1={H - 12} y2={H - 12} stroke={C.border} strokeWidth={1} />
      {/* Étiquettes dates début/milieu/fin */}
      {[0, 14, 29].map(i => (
        <text key={i} x={PAD + (i / 29) * plotW} y={H - 2} fontSize={7} fill={C.textLight} textAnchor="middle">
          {trendDays[i]?.date?.slice(5)}
        </text>
      ))}
      {/* Ligne de tendance */}
      {pathPts.length > 1 && <path d={pathD} fill="none" stroke="#059669" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
      {/* Zone sous la courbe */}
      {pathPts.length > 1 && (
        <path
          d={`${pathD} L ${pathPts[pathPts.length-1].x} ${toY(0)} L ${pathPts[0].x} ${toY(0)} Z`}
          fill="#05966918"
        />
      )}
      {/* Points */}
      {pts.map((p, i) => p.y !== null && p.tested > 0 && (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3.5} fill={p.present > 0 ? "#059669" : C.border} stroke={C.white} strokeWidth={1} />
          {p.present > 0 && (
            <text x={p.x} y={p.y - 6} fontSize={7} fill="#059669" textAnchor="middle" fontWeight="700">{p.present}</text>
          )}
        </g>
      ))}
      {/* Label ordonnée */}
      <text x={8} y={H / 2} fontSize={8} fill={C.textLight} textAnchor="middle" transform={`rotate(-90, 8, ${H/2})`}>Citations</text>
    </svg>
  );
}

function AIAnalysis({ audit, brand, site, questions, onTextReady }) {
  const [status, setStatus] = useState("idle");
  const [analysis, setAnalysis] = useState("");

  const generate = useCallback(async () => {
    setStatus("loading"); setAnalysis("");
    const summary = {
      site: site?.label, brand: brand?.brand_name,
      totalQuestions: audit.questions, totalResults: audit.total,
      presenceRate: audit.presenceRate + "%", avgPosition: audit.avgPos,
      topIntents: Object.entries(audit.intentCount).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}(${v})`).join(", "),
      competitors: Object.entries(audit.compStats).sort((a,b)=>b[1].mentions-a[1].mentions).slice(0,5).map(([k,v])=>`${k}(${v.mentions}x)`).join(", "),
      urlsToOptimize: audit.urlsToOptimize.slice(0,5).map(u => u.norm || u.url).join(", "),
    };
    const prompt = `Tu es un expert GEO. Génère un audit GEO actionnable pour ${summary.site} / "${summary.brand}".
Données : ${JSON.stringify(summary, null, 2)}

Sections (titres ## markdown) :
## 1. Synthèse exécutive (score GEO /10)
## 2. Analyse de la visibilité
## 3. Analyse concurrentielle
## 4. Plan d'action priorisé (10 actions)
## 5. KPIs à suivre (cibles 3 et 6 mois)
Sois concret et utilise les données.`;

    try {
      // Le proxy /api/anthropic rassemble le stream SSE côté serveur
      // et renvoie un JSON standard { content: [{ type:"text", text:"..." }] }
      const res = await fetch(ANTHROPIC_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} — ${errBody.slice(0, 120)}`);
      }
      const data = await res.json();
      const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
      if (!text) throw new Error("Réponse vide du proxy");
      setAnalysis(text);
      onTextReady?.(text);
      setStatus("done");
    } catch(e) { console.error("[AIAnalysis]", e); setStatus("error"); }
  }, [audit, brand, site, questions]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === "idle") return (
    <div style={{ textAlign: "center", padding: "24px 0" }}>
      <div style={{ fontSize: 12, color: C.textLight, marginBottom: 12 }}>L'analyse IA utilise Claude pour interpréter vos données GEO.</div>
      <button onClick={generate} style={{ padding: "10px 24px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✦ Générer l'analyse IA</button>
    </div>
  );
  if (status === "loading" && !analysis) return <div style={{ textAlign: "center", padding: 24, color: C.textLight, fontSize: 12 }}>✦ Génération en cours…</div>;
  return (
    <div>
      <div style={{ fontSize: 12, lineHeight: 1.8, color: C.text }}>
        {analysis.split("\n").map((line, i) => {
          if (line.startsWith("## ")) return <div key={i} style={{ fontSize: 14, fontWeight: 800, color: C.text, marginTop: 20, marginBottom: 6, borderBottom: `2px solid ${C.border}`, paddingBottom: 4 }}>{line.slice(3)}</div>;
          if (line.startsWith("- ")) return <div key={i} style={{ paddingLeft: 16, marginBottom: 3 }}>• {renderBold(line.slice(2))}</div>;
          if (!line.trim()) return <div key={i} style={{ height: 8 }} />;
          return <div key={i} style={{ marginBottom: 4 }}>{renderBold(line)}</div>;
        })}
      </div>
      {status === "done" && <button onClick={generate} style={{ marginTop: 12, padding: "6px 14px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, fontSize: 11, cursor: "pointer", color: C.textMid }}>🔄 Regénérer</button>}
      {status === "error" && <div style={{ color: "#DC2626", fontSize: 11, marginTop: 8 }}>Erreur — réessayez.</div>}
    </div>
  );
}

function FanoutAnalysis({ questions, results, brand, claudeKey }) {
  const [status, setStatus] = useState("idle");
  const [analysis, setAnalysis] = useState("");
  const [open, setOpen] = useState(false);
  const brandName = brand?.brand_name || "";
  const brandDomain = brand?.brand_domain || "";
  const brandAliases = brand?.brand_aliases || [];

  const run = async () => {
    if (!claudeKey || !results.length) return;
    setStatus("loading"); setAnalysis(""); setOpen(true);
    const total = results.length, withBrand = results.filter(r => r.brand_mentioned).length;
    const urlCount = {};
    results.forEach(r => (r.sources || []).forEach(rawUrl => {
      const norm = rawUrl.trim().replace(/[?#].*$/, "").replace(/\/$/, "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").toLowerCase();
      if (norm) urlCount[norm] = (urlCount[norm] || 0) + 1;
    }));
    const topUrls = Object.entries(urlCount).sort((a,b)=>b[1]-a[1]).slice(0,15);
    const allBrandTerms = [brandDomain, brandName, ...brandAliases].filter(Boolean).map(t => t.toLowerCase());
    const brandUrls = topUrls.filter(([url]) => allBrandTerms.some(t => url.toLowerCase().includes(t)));
    const competitorUrls = topUrls.filter(([url]) => !allBrandTerms.some(t => url.toLowerCase().includes(t)));
    const compCount = {}; results.forEach(r => { const seen = new Set(); (r.competitors_mentioned||[]).forEach(c => { if(!seen.has(c.name)){seen.add(c.name);compCount[c.name]=(compCount[c.name]||0)+1;} }); });
    const topComps = Object.entries(compCount).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const qMap = {}; questions.forEach(q => { qMap[q.id] = q.question; });
    const missingQs = [...new Set(results.filter(r=>!r.brand_mentioned).map(r=>qMap[r.question_id]).filter(Boolean))].slice(0,10);
    const presentQs = [...new Set(results.filter(r=>r.brand_mentioned).map(r=>qMap[r.question_id]).filter(Boolean))].slice(0,6);
    const provStats = {}; results.forEach(r => { const pid=getProviderId(r.model); if(!provStats[pid])provStats[pid]={total:0,withBrand:0}; provStats[pid].total++; if(r.brand_mentioned)provStats[pid].withBrand++; });

    const prompt = `Tu es un expert GEO.
Présence de "${brandName}" (${brandDomain||"—"}) :
- ${withBrand}/${total} (${total?Math.round(withBrand/total*100):0}%)
- Par provider : ${Object.entries(provStats).map(([p,s])=>`${p} ${s.withBrand}/${s.total}`).join(" | ")}
Questions présentes : ${presentQs.slice(0,4).join(" | ")||"Aucune"}
Questions absentes : ${missingQs.slice(0,4).join(" | ")||"Aucune"}
Concurrents : ${topComps.map(([n,c])=>`${n}:${c}×`).join(", ")||"Aucun"}
URLs marque : ${brandUrls.slice(0,4).map(([u,c])=>`${u}(${c}×)`).join(", ")||"Aucune"}
URLs concurrentes : ${competitorUrls.slice(0,4).map(([u,c])=>`${u}(${c}×)`).join(", ")||"Aucune"}

Format EXACT :
## 🔍 ÉTAT DES LIEUX
[4-6 points basés sur les chiffres]
## 📈 RECOMMANDATIONS — PAGES CITÉES PAR LES IA
[3-5 recommandations]
## 🏠 RECOMMANDATIONS — PAGES MARQUE
[3-5 recommandations pour ${brandDomain||"la marque"}]
Commence directement par ## 🔍. Chiffres précis. Actionnable.`;

    try {
      const res = await fetch("/api/claude-geo", { method: "POST", headers: { "Content-Type": "application/json", "X-Claude-Key": claudeKey },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1200, messages: [{ role: "user", content: prompt }] }) });
      const raw = await res.text();
      if (raw.trimStart().startsWith("<")) throw new Error("Proxy claude-geo introuvable");
      const data = JSON.parse(raw);
      if (!res.ok) throw new Error(data.error?.message || `Claude ${res.status}`);
      const text = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n").trim();
      setAnalysis(text || "Aucune analyse."); setStatus("done");
    } catch(e) { setAnalysis(`Erreur : ${e.message}`); setStatus("error"); }
  };

  const sections = analysis ? analysis.split(/(?=## )/).filter(Boolean) : [];
  const sectionColors = { "ÉTAT": { bg:"#EFF6FF", border:"#BFDBFE", title:"#1D4ED8" }, "PAGES CITÉES": { bg:"#F0FDF4", border:"#BBF7D0", title:"#15803D" }, "PAGES MARQUE": { bg:"#FFFBEB", border:"#FDE68A", title:"#B45309" } };
  const getColor = (text) => { const key = Object.keys(sectionColors).find(k => text.toUpperCase().includes(k)); return sectionColors[key] || { bg: C.bg, border: C.border, title: C.text }; };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: status === "done" && open ? 16 : 0 }}>
        {!claudeKey && <span style={{ fontSize: 11, color: "#D97706", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 6, padding: "4px 10px" }}>⚠️ Clé Claude requise</span>}
        {claudeKey && status === "idle" && <button onClick={run} style={{ padding: "8px 18px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✨ Lancer l'analyse Fan-out</button>}
        {status === "loading" && <span style={{ fontSize: 12, color: C.textLight }}>⏳ Analyse en cours…</span>}
        {status === "done" && (<>
          <button onClick={() => setOpen(o => !o)} style={{ padding: "6px 14px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, fontSize: 11, cursor: "pointer", color: C.textMid }}>{open ? "▲ Masquer" : "▼ Voir l'analyse"}</button>
          <button onClick={run} style={{ padding: "6px 14px", border: "none", borderRadius: 7, background: "#7C3AED", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>↺ Relancer</button>
        </>)}
        {status === "error" && <button onClick={run} style={{ padding: "6px 14px", background: "#DC2626", color: "#fff", border: "none", borderRadius: 7, fontSize: 11, cursor: "pointer" }}>↺ Réessayer</button>}
      </div>
      {open && status === "done" && sections.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          {sections.map((section, i) => {
            const lines = section.trim().split("\n"); const title = lines[0].replace(/^## /, ""); const body = lines.slice(1).join("\n").trim(); const col = getColor(title);
            return <div key={i} style={{ background: col.bg, border: `1px solid ${col.border}`, borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: col.title, marginBottom: 8 }}>{title}</div>
              <div style={{ fontSize: 12, color: C.text, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{renderBold(body)}</div>
            </div>;
          })}
        </div>
      )}
      {open && status === "error" && <div style={{ marginTop: 8, fontSize: 12, color: "#DC2626", padding: "10px 14px", background: "#FEF2F2", borderRadius: 8 }}>{analysis}</div>}
    </div>
  );
}

function exportPDF(audit, brand, site, aiText) {
  const brandName = brand?.brand_name || "Marque";
  const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const dateFile = new Date().toLocaleDateString("fr-FR").replace(/\//g, "-");

  // ── Palette Sonate ────────────────────────────────────────────
  const S = {
    green:      "#1A3C2E",
    greenMid:   "#2D5A42",
    greenLight: "#4A8C6A",
    greenPale:  "#EAF2ED",
    cream:      "#F5F0E8",
    creamDark:  "#E8E0CE",
    ink:        "#1C1C1C",
    inkMid:     "#4A4A4A",
    inkLight:   "#909090",
    white:      "#FFFFFF",
    ok:         "#2D6A4F",   okBg:   "#D8F3DC",
    warn:       "#92400E",   warnBg: "#FEF3C7",
    danger:     "#9B2335",   dangerBg:"#FCE4E8",
    blue:       "#1A4A7A",   blueBg: "#DBEAFE",
  };

  const scoreColor = audit.presenceRate >= 70 ? S.ok     : audit.presenceRate >= 50 ? S.blue   : audit.presenceRate >= 30 ? S.warn   : S.danger;
  const scoreBg    = audit.presenceRate >= 70 ? S.okBg   : audit.presenceRate >= 50 ? S.blueBg  : audit.presenceRate >= 30 ? S.warnBg  : S.dangerBg;
  const scoreLabel = audit.presenceRate >= 70 ? "Excellent" : audit.presenceRate >= 50 ? "Bon" : audit.presenceRate >= 30 ? "À améliorer" : "Critique";

  // ── Helpers HTML ──────────────────────────────────────────────
  const section = (num, title) =>
    `<div class="section-hd"><div class="section-num">${num}</div><div class="section-title">${title}</div></div>`;

  const kpi = (val, label, color = S.green, bg = S.white, border = S.creamDark) =>
    `<div class="kpi" style="background:${bg};border-color:${border}"><div class="kpi-val" style="color:${color}">${val}</div><div class="kpi-label">${label}</div></div>`;

  const bar = (p, color) =>
    `<div class="bar-track"><div class="bar-fill" style="width:${Math.min(p,100)}%;background:${color}"></div></div>`;

  const pill = (text, color, bg) =>
    `<span class="pill" style="color:${color};background:${bg}">${text}</span>`;

  const lead = (title, body, color = S.green, bg = S.greenPale) =>
    `<div class="lead" style="border-color:${color};background:${bg}"><div class="lead-title" style="color:${color}">${title}</div><div class="lead-body">${body}</div></div>`;

  const tbl = (headers, rows) =>
    `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${
      rows.map((r, i) => `<tr${i % 2 ? ' class="alt"' : ""}>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")
    }</tbody></table>`;

  const urlRow = (url, meta, badge, bColor, bBg) =>
    `<div class="url-row"><a href="${url}" target="_blank" class="url-link">${url.replace(/^https?:\/\//, "")}</a><span class="url-meta">${meta}</span>${pill(badge, bColor, bBg)}</div>`;

  // ── CSS ───────────────────────────────────────────────────────
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500;600;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { background: ${S.cream}; }
    body { font-family: 'DM Sans', system-ui, sans-serif; font-weight: 400; max-width: 960px; margin: 0 auto; color: ${S.ink}; line-height: 1.6; background: ${S.cream}; padding: 0 0 60px; }

    /* ── Cover ── */
    .cover { background: ${S.green}; padding: 48px 56px 40px; position: relative; overflow: hidden; }
    .cover::after { content: ""; position: absolute; top: -60px; right: -60px; width: 280px; height: 280px; border-radius: 50%; background: rgba(255,255,255,.04); pointer-events: none; }
    .cover-logo { display: flex; align-items: center; gap: 14px; margin-bottom: 40px; }
    .cover-logo-mark { width: 40px; height: 40px; background: ${S.greenLight}; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
    .cover-logo-mark svg { width: 22px; height: 22px; fill: ${S.white}; }
    .cover-logo-name { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; color: rgba(255,255,255,.7); letter-spacing: 2px; text-transform: uppercase; }
    .cover-eyebrow { font-size: 10px; font-weight: 600; color: ${S.greenLight}; letter-spacing: 2.5px; text-transform: uppercase; margin-bottom: 10px; }
    .cover-title { font-family: 'Playfair Display', Georgia, serif; font-size: 38px; font-weight: 900; color: ${S.white}; line-height: 1.15; margin-bottom: 6px; }
    .cover-sub { font-size: 15px; color: rgba(255,255,255,.55); font-weight: 300; margin-bottom: 32px; }
    .cover-meta { display: flex; gap: 28px; flex-wrap: wrap; }
    .cover-meta-item { font-size: 11px; }
    .cover-meta-label { color: rgba(255,255,255,.4); text-transform: uppercase; letter-spacing: 1px; font-size: 9px; display: block; margin-bottom: 2px; }
    .cover-meta-val { color: ${S.white}; font-weight: 600; }

    /* ── Score banner ── */
    .score-banner { margin: 32px 40px 0; background: ${S.white}; border-radius: 16px; padding: 28px 32px; display: flex; gap: 36px; align-items: center; flex-wrap: wrap; box-shadow: 0 4px 24px rgba(26,60,46,.1); }
    .score-circle { text-align: center; min-width: 90px; }
    .score-pct { font-family: 'Playfair Display', Georgia, serif; font-size: 56px; font-weight: 900; color: ${S.green}; line-height: 1; }
    .score-label { font-size: 10px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 4px; }
    .score-sub { font-size: 9px; color: ${S.inkLight}; }
    .score-bar-wrap { flex: 1; min-width: 220px; }
    .score-track { height: 8px; background: ${S.creamDark}; border-radius: 4px; overflow: hidden; margin-bottom: 14px; }
    .score-fill { height: 100%; border-radius: 4px; }
    .score-facts { display: flex; gap: 20px; flex-wrap: wrap; font-size: 12px; }
    .score-fact span { color: ${S.inkLight}; font-size: 10px; display: block; margin-bottom: 1px; }
    .score-kpis { display: flex; flex-direction: column; gap: 4px; min-width: 130px; font-size: 11px; }
    .score-kpi-row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; border-bottom: 1px solid ${S.creamDark}; }
    .score-kpi-row:last-child { border-bottom: none; }

    /* ── Content wrapper ── */
    .content { padding: 0 40px; margin-top: 32px; }

    /* ── Section header ── */
    .section-hd { display: flex; align-items: center; gap: 14px; margin: 36px 0 16px; }
    .section-num { width: 28px; height: 28px; background: ${S.green}; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: ${S.white}; flex-shrink: 0; }
    .section-title { font-family: 'Playfair Display', Georgia, serif; font-size: 18px; font-weight: 700; color: ${S.green}; border-bottom: 2px solid ${S.creamDark}; padding-bottom: 8px; flex: 1; }

    /* ── KPI grid ── */
    .kpi-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin: 16px 0; }
    .kpi { border: 1px solid ${S.creamDark}; border-radius: 12px; padding: 14px 12px; text-align: center; }
    .kpi-val { font-family: 'Playfair Display', Georgia, serif; font-size: 24px; font-weight: 900; }
    .kpi-label { font-size: 9px; color: ${S.inkLight}; text-transform: uppercase; letter-spacing: .6px; margin-top: 3px; }

    /* ── Tables ── */
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 10px 0; }
    th { background: ${S.green}; color: ${S.white}; padding: 9px 14px; text-align: left; font-size: 10px; font-weight: 600; letter-spacing: .8px; text-transform: uppercase; }
    th:first-child { border-radius: 8px 0 0 0; }
    th:last-child  { border-radius: 0 8px 0 0; }
    td { padding: 9px 14px; border-bottom: 1px solid ${S.creamDark}; color: ${S.inkMid}; vertical-align: middle; }
    tr.alt td { background: ${S.cream}; }
    tr:last-child td { border-bottom: none; }

    /* ── Bars ── */
    .bar-track { height: 5px; background: ${S.creamDark}; border-radius: 3px; margin-top: 5px; overflow: hidden; }
    .bar-fill   { height: 100%; border-radius: 3px; }

    /* ── Pills ── */
    .pill { font-size: 9px; font-weight: 700; border-radius: 20px; padding: 2px 8px; letter-spacing: .4px; text-transform: uppercase; white-space: nowrap; }

    /* ── Leads ── */
    .lead { border-left: 3px solid ${S.green}; border-radius: 0 10px 10px 0; padding: 10px 16px; margin: 6px 0; }
    .lead-title { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
    .lead-body  { font-size: 12px; color: ${S.inkMid}; line-height: 1.5; }

    /* ── 2-col / 3-col ── */
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 16px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 16px; }
    .col-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .7px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid ${S.creamDark}; }

    /* ── URL rows ── */
    .url-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid ${S.creamDark}; flex-wrap: wrap; }
    .url-link { font-size: 11px; color: ${S.greenMid}; text-decoration: none; flex: 1; min-width: 160px; word-break: break-all; }
    .url-link:hover { text-decoration: underline; }
    .url-meta { font-size: 10px; color: ${S.inkLight}; white-space: nowrap; }

    /* ── Q lists ── */
    .q-list { list-style: none; padding: 0; margin: 0; font-size: 12px; }
    .q-list li { padding: 5px 0; border-bottom: 1px solid ${S.creamDark}; display: flex; gap: 8px; }
    .q-list li:last-child { border-bottom: none; }

    /* ── AI block ── */
    .ai-block { background: ${S.white}; border: 1px solid ${S.creamDark}; border-left: 4px solid ${S.green}; border-radius: 0 12px 12px 0; padding: 20px 24px; font-size: 12px; line-height: 1.85; color: ${S.inkMid}; white-space: pre-wrap; margin-top: 12px; }

    /* ── Footer ── */
    .footer { margin: 48px 40px 0; padding-top: 20px; border-top: 1px solid ${S.creamDark}; display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: ${S.inkLight}; }
    .footer-brand { font-family: 'Playfair Display', serif; font-size: 13px; font-weight: 700; color: ${S.green}; }

    @media print {
      html, body { background: ${S.white}; }
      .cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .score-banner { box-shadow: none; }
      .section-hd { break-before: auto; }
    }
  `;

  // ── COVER ─────────────────────────────────────────────────────
  const cover = `
<div class="cover">
  <div class="cover-logo">
    <div class="cover-logo-mark">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
    </div>
    <div class="cover-logo-name">Sonate · GEO Monitor</div>
  </div>
  <div class="cover-eyebrow">Rapport d'audit</div>
  <div class="cover-title">Audit GEO<br>${brandName}</div>
  <div class="cover-sub">Analyse de visibilité générative — IA & LLMs</div>
  <div class="cover-meta">
    <div class="cover-meta-item"><span class="cover-meta-label">Site analysé</span><span class="cover-meta-val">${site?.label || "—"}</span></div>
    <div class="cover-meta-item"><span class="cover-meta-label">Date de génération</span><span class="cover-meta-val">${dateStr}</span></div>
    <div class="cover-meta-item"><span class="cover-meta-label">Questions testées</span><span class="cover-meta-val">${audit.questions}</span></div>
    <div class="cover-meta-item"><span class="cover-meta-label">Résultats analysés</span><span class="cover-meta-val">${audit.total}</span></div>
  </div>
</div>

<div class="score-banner">
  <div class="score-circle">
    <div class="score-pct" style="color:${scoreColor}">${audit.presenceRate}%</div>
    <div class="score-label" style="color:${scoreColor}">${scoreLabel}</div>
    <div class="score-sub">Score GEO</div>
  </div>
  <div class="score-bar-wrap">
    <div class="score-track"><div class="score-fill" style="width:${audit.presenceRate}%;background:${scoreColor}"></div></div>
    <div class="score-facts">
      <div class="score-fact"><span>Marque</span><strong>${brandName}</strong></div>
      <div class="score-fact"><span>Questions</span><strong>${audit.questions}</strong></div>
      <div class="score-fact"><span>Résultats</span><strong>${audit.total}</strong></div>
      <div class="score-fact"><span>Concurrents</span><strong>${Object.keys(audit.compStats).length}</strong></div>
    </div>
  </div>
  <div class="score-kpis">
    ${[
      ["Présence marque", audit.withBrand + "/" + audit.total, scoreColor],
      ["Position moy.",   audit.avgPos ? "#" + audit.avgPos : "—", S.ink],
      ["Cité en source",  String(audit.withSources), S.blue],
      ["Concurrents",     String(Object.keys(audit.compStats).length), S.warn],
    ].map(([l, v, c]) => `<div class="score-kpi-row"><span style="color:${S.inkLight};font-size:10px">${l}</span><strong style="color:${c}">${v}</strong></div>`).join("")}
  </div>
</div>`;

  // ── BLOC 1 : KPIs ─────────────────────────────────────────────
  const bloc1 = `
${section("01", "Indicateurs clés")}
<div class="kpi-grid">
  ${kpi(audit.presenceRate + "%", "Présence marque",  scoreColor, scoreBg)}
  ${kpi(audit.avgPos ? "#" + audit.avgPos : "—", "Position moy.", S.ink)}
  ${kpi(audit.withSources, "Cité en source", S.blue, S.blueBg)}
  ${kpi(audit.withBrand + "/" + audit.total, "Avec mention", S.ink)}
  ${kpi(audit.questions, "Questions testées", S.green, S.greenPale)}
  ${kpi(Object.keys(audit.compStats).length, "Concurrents", S.warn, S.warnBg)}
</div>`;

  // ── BLOC 2 : Visibilité ───────────────────────────────────────
  const providerRows = Object.entries(audit.providerStats).map(([pid, s]) => {
    const rate = pct(s.withBrand, s.total);
    const c = rate >= 50 ? S.ok : rate > 0 ? S.warn : S.danger;
    return [`<strong>${pid}</strong>`, `<span style="color:${c};font-weight:700">${rate}%</span>`, `${s.withBrand}/${s.total}`, bar(rate, c)];
  });

  const presentList = audit.presentBrandQs.map(q =>
    `<li><span style="color:${S.ok};font-weight:700">✓</span>${q.isFav ? "⭐ " : ""}${q.question}${q.volume > 0 ? ` <span style="color:#2563EB;font-size:10px">(🔍${q.volume >= 1000 ? (q.volume/1000).toFixed(1)+"k" : q.volume})</span>` : ""}</li>`).join("");
  const missingList = audit.missingBrandQs.map(q =>
    `<li><span style="color:${S.danger};font-weight:700">✗</span>${q.isFav ? "⭐ " : ""}${q.question}${q.volume > 0 ? ` <span style="color:#2563EB;font-size:10px">(🔍${q.volume >= 1000 ? (q.volume/1000).toFixed(1)+"k" : q.volume})</span>` : ""}</li>`).join("");

  const bloc2 = `
${section("02", "Visibilité marque")}
${tbl(["Provider", "Présence", "Ratio", ""], providerRows)}
<div class="grid-2">
  <div>
    <div class="col-label" style="color:${S.ok}">✓ Questions avec présence (${audit.presentBrandQs.length})</div>
    <ul class="q-list">${presentList || `<li style="color:${S.inkLight};font-style:italic">Aucune présence</li>`}</ul>
  </div>
  <div>
    <div class="col-label" style="color:${S.danger}">✗ Questions sans présence (${audit.missingBrandQs.length})</div>
    <ul class="q-list">${missingList || `<li style="color:${S.inkLight};font-style:italic">Toutes les questions ont une présence !</li>`}</ul>
  </div>
</div>`;

  // ── BLOC 3 : Concurrentiel ────────────────────────────────────
  const compRows = Object.entries(audit.compStats).sort((a, b) => b[1].mentions - a[1].mentions).map(([name, s]) => [
    `<strong>${name}</strong>`,
    s.mentions,
    `<span style="color:${S.warn}">${pct(s.mentions, audit.total)}%</span>`,
    s.positions.length ? (s.positions.reduce((a, b) => a + b, 0) / s.positions.length).toFixed(1) : "—",
  ]);
  const intentRows = Object.entries(audit.intentCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => [
    k, v, `<span style="color:${S.green}">${pct(v, audit.total)}%</span>`, bar(pct(v, audit.total), S.green),
  ]);
  const typeRows = Object.entries(audit.typeCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [
    k, v, `<span style="color:${S.blue}">${pct(v, audit.total)}%</span>`, bar(pct(v, audit.total), S.blue),
  ]);

  const bloc3 = `
${section("03", "Paysage concurrentiel")}
${compRows.length ? tbl(["Concurrent", "Mentions", "% résultats", "Pos. moy."], compRows) : `<p style="color:${S.inkLight};font-style:italic;font-size:12px">Aucun concurrent détecté dans les réponses LLM</p>`}
<div class="grid-2">
  <div>
    <div class="col-label">Répartition par intention</div>
    ${intentRows.length ? tbl(["Intention", "Count", "%", ""], intentRows) : `<p style="color:${S.inkLight};font-style:italic;font-size:11px">—</p>`}
  </div>
  <div>
    <div class="col-label">Types de réponses LLM</div>
    ${typeRows.length ? tbl(["Type", "Count", "%", ""], typeRows) : `<p style="color:${S.inkLight};font-style:italic;font-size:11px">—</p>`}
  </div>
</div>`;

  // ── BLOC 4 : Sources & URLs ───────────────────────────────────
  const domainRows = Object.entries(audit.topDomains).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d, cnt], i) => {
    const isBrand = audit.brandUrls.some(u => u.domain === d);
    const isComp  = audit.competitorUrls.some(u => u.domain === d);
    const badge   = isBrand ? pill("marque",     S.ok,     S.okBg)
                  : isComp  ? pill("concurrent", S.danger, S.dangerBg) : "";
    return [
      `<span style="color:${S.inkLight};font-weight:700">#${i+1}</span>`,
      `<strong style="color:${isBrand ? S.ok : isComp ? S.danger : S.ink}">${d}</strong> ${badge}`,
      `<strong>${cnt}×</strong>`,
    ];
  });

  const urlsOpt     = audit.urlsToOptimize.slice(0, 8).map(u  => urlRow(u.norm || u.url, `${u.count_as_source} src · ${u.count_in_answer} rép`, "À booster",  S.warn,   S.warnBg)).join("");
  const urlsRework  = audit.urlsToRework.slice(0, 8).map(u    => urlRow(u.norm || u.url, `${u.count_as_source} src · ${u.count_in_answer} rép`, "À refaire",  S.danger, S.dangerBg)).join("");
  const urlsInspire = audit.urlsToInspire.slice(0, 8).map(u   => urlRow(u.norm || u.url, `${getDomain(u.url)} · ${u.count_as_source} cit.`,     "Inspiration", S.blue,   S.blueBg)).join("");

  const bloc4 = `
${section("04", "Sources & URLs")}
${domainRows.length ? tbl(["#", "Domaine", "Citations"], domainRows) : `<p style="color:${S.inkLight};font-style:italic;font-size:12px">Aucun domaine indexé</p>`}
<div class="grid-3">
  <div>
    <div class="col-label" style="color:${S.warn}">⚡ À optimiser</div>
    ${urlsOpt || `<p style="color:${S.inkLight};font-style:italic;font-size:11px">Aucune</p>`}
  </div>
  <div>
    <div class="col-label" style="color:${S.danger}">🔄 À reprendre</div>
    ${urlsRework || `<p style="color:${S.inkLight};font-style:italic;font-size:11px">Aucune</p>`}
  </div>
  <div>
    <div class="col-label" style="color:${S.blue}">💡 Référence</div>
    ${urlsInspire || `<p style="color:${S.inkLight};font-style:italic;font-size:11px">Aucune</p>`}
  </div>
</div>`;

  // ── BLOC 5 : Plan d'action ────────────────────────────────────
  const leadsHtml = audit.leads.map(l => lead(
    l.priority + " — " + l.label, l.action,
    l.priority.includes("🔴") ? S.danger : l.priority.includes("🟠") ? S.warn : l.priority.includes("🟡") ? "#856404" : S.green,
    l.priority.includes("🔴") ? S.dangerBg : l.priority.includes("🟠") ? S.warnBg : l.priority.includes("🟡") ? "#FFF9E6" : S.greenPale,
  )).join("");

  const bloc5 = `
${section("05", "Plan d'action")}
${leadsHtml || `<p style="color:${S.inkLight};font-style:italic;font-size:12px">Aucune piste générée</p>`}
${aiText ? `${section("06", "Analyse IA détaillée")}<div class="ai-block">${aiText}</div>` : ""}`;

  // ── Footer ────────────────────────────────────────────────────
  const footer = `
<div class="footer">
  <div><div class="footer-brand">Sonate</div><div>Rapport généré le ${dateStr}</div></div>
  <div style="text-align:right">${brandName} · ${site?.label || "—"}</div>
</div>`;

  // ── Assemblage final ──────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Audit GEO — ${brandName} — ${dateStr}</title>
<style>${css}</style>
</head>
<body>
${cover}
<div class="content">
${bloc1}
${bloc2}
${bloc3}
${bloc4}
${bloc5}
</div>
${footer}
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `audit-geo-${brandName.toLowerCase().replace(/\s+/g, "-")}-${dateFile}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Main export ───────────────────────────────────────────────────
export default function GeoAuditTab({
  sites, projectId, project = null, corrMatrix = [], metrics = [], resultVals = [], bingData = {},
  // Props setup depuis App.jsx
  projects, currentProjectId, setCurrentProjectId, setProjects, ownerEmail,
  setSites, sfData, setSfData, gscData, setGscData, gaData, setGaData,
  setBingData, dbHistory, dbLoading, refreshHistory,
  confirmModal, setConfirmModal, pageTypes, setPageTypes,
  isReadOnly = false, autoStartTour = false, onTourStarted = null,
}) {
  const [mainTab, setMainTab]           = useState("audit");
  const [selectedSite, setSelectedSite] = useState(sites[0]?.id || "");
  // Sync selectedSite quand le projet change
  useEffect(() => {
    setSelectedSite(sites[0]?.id || "");
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [aiText, setAiText]             = useState("");
  const [exporting, setExporting]       = useState(false);
  const [showTour, setShowTour]         = useState(false);
  const [brand, setBrand]               = useState(null);
  const [questions, setQuestions]       = useState([]);
  const [results, setResults]           = useState([]);
  const [urlIndex, setUrlIndex]         = useState([]);
  const [calendarEntries, setCalendarEntries] = useState([]); // geo_calendar_dates — 30 derniers jours
  const [keywords, setKeywords]         = useState([]); // pour tri par volume
  const [categories, setCategories]     = useState([]); // catégories de mots-clés
  const [competitors, setCompetitors]   = useState([]); // concurrents qualifiés
  const [loading, setLoading]           = useState(true);

  const site = (Array.isArray(sites) ? sites : []).find(s => s.id === selectedSite) || (Array.isArray(sites) ? sites : [])[0];
  const claudeKey = decodeKey(project?.claude_geo_key_enc || "");

  useEffect(() => {
    if (!projectId || !site?.id) return;
    setLoading(true);
    Promise.all([sbGetBrand(projectId, site.id), sbGetQuestions(projectId, site.id), sbGetGeoResults(projectId, site.id), sbGetUrlIndex(projectId), sbGetCalendarEntriesBatch(projectId, site.id), sbGetKeywords(projectId, site.id), sbGetCategories(projectId), sbGetCompetitors(projectId, site.id)])
      .then(([b, q, r, u, cal, kws, cats, comps]) => { setBrand(b); setQuestions(q); setResults(r); setUrlIndex(u); setCalendarEntries(cal || []); setKeywords(kws || []); setCategories(cats || []); setCompetitors(comps || []); setLoading(false); });
  }, [projectId, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const siteResults   = useMemo(() => results.filter(r => r.site_id === site?.id), [results, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const siteQuestions = useMemo(() => questions.filter(q => q.site_id === site?.id), [questions, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const siteUrls      = useMemo(() => urlIndex.filter(u => u.project_id === projectId), [urlIndex, projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const audit = useMemo(() => computeAudit(siteQuestions, siteResults, siteUrls, brand, site, calendarEntries, keywords, competitors), [siteQuestions, siteResults, siteUrls, brand, site, calendarEntries, keywords, competitors]); // eslint-disable-line react-hooks/exhaustive-deps
  const noData        = !siteResults.length;

  // Démarrer le tour automatiquement si demandé (depuis HomeTab) — après loading et noData
  useEffect(() => {
    if (autoStartTour && !loading && !noData) { setShowTour(true); onTourStarted?.(); }
  }, [autoStartTour, loading, noData]); // eslint-disable-line react-hooks/exhaustive-deps

  const AUDIT_TOUR_STEPS = [
    {
      target: "audit-score",
      icon: "📊",
      title: "Score de présence GEO",
      desc: "Le score GEO mesure le % de réponses LLM où votre marque est citée. En dessous, les KPIs clés : total de tests, présence en sources, position moyenne.",
      tip: "Visez un score > 60% pour une bonne visibilité GEO.",
      position: "bottom",
    },
    {
      target: "audit-visibility",
      icon: "📡",
      title: "Visibilité marque",
      desc: "Ce bloc détaille la présence par provider (OpenAI, Claude, Gemini…) et la tendance sur 30 jours. Les questions avec et sans présence sont listées.",
      tip: "Les questions sans présence sont vos priorités de contenu.",
      position: "bottom",
    },
    {
      target: "audit-competitors",
      icon: "⚔️",
      title: "Paysage concurrentiel",
      desc: "Tableau des concurrents avec leur catégorie (Direct / GEO / Partenaire), nombre de mentions et position moyenne.",
      tip: "Qualifiez les concurrents dans Fan-outs → ⚔️ pour enrichir cette section.",
      position: "top",
    },
    {
      target: "audit-export",
      icon: "⬇",
      title: "Export PDF",
      desc: "Génère un rapport PDF complet : score, KPIs, concurrents, URLs à optimiser, recommandations et analyse IA.",
      tip: "Cliquez '✦ Générer l'analyse IA' avant d'exporter pour un rapport plus riche.",
      position: "top",
    },
  ];

  return (
    <div>
      {showTour && (
        <TourGuide steps={AUDIT_TOUR_STEPS} onClose={() => setShowTour(false)} />
      )}
      {/* ── Header + onglets principaux ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>📋 Audit GEO</div>
          <button onClick={() => setShowTour(true)} disabled={noData || loading}
            style={{ fontSize: 11, fontWeight: 700, color: "#1A3C2E", background: "#EAF0EC", border: "1px solid #B2CCBC", borderRadius: 8, padding: "5px 12px", cursor: noData || loading ? "not-allowed" : "pointer", opacity: noData || loading ? 0.4 : 1 }}>
            🎓 Guide
          </button>
        </div>
        <div style={{ display: "inline-flex", gap: 2, background: "#F1F5F9", borderRadius: 20, padding: 3 }}>
          {[{ key: "setup", label: "⚙️ Setup" }, { key: "audit", label: "📋 Génération Audit GEO" }].map(t => (
            <button key={t.key} onClick={() => setMainTab(t.key)} style={{
              padding: "6px 16px", borderRadius: 16, fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", transition: "all 0.15s",
              background: mainTab === t.key ? "#fff" : "transparent",
              color: mainTab === t.key ? "#1A3C2E" : "#94A3B8",
              boxShadow: mainTab === t.key ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* ── Setup ── */}
      {mainTab === "setup" && (
        <AuditSetupPanel
          projects={projects} currentProjectId={currentProjectId} setCurrentProjectId={setCurrentProjectId}
          setProjects={setProjects} ownerEmail={ownerEmail} sites={sites} setSites={setSites}
          sfData={sfData} setSfData={setSfData} gscData={gscData} setGscData={setGscData}
          gaData={gaData} setGaData={setGaData} bingData={bingData} setBingData={setBingData}
          dbHistory={dbHistory} dbLoading={dbLoading} refreshHistory={refreshHistory}
          confirmModal={confirmModal} setConfirmModal={setConfirmModal}
          pageTypes={pageTypes} setPageTypes={setPageTypes} project={project} projectId={projectId}
        />
      )}

      {/* ── Génération Audit GEO ── */}
      {mainTab === "audit" && (
        <div>
          {/* Sélecteur de site + Export */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(Array.isArray(sites) ? sites : []).length > 1 && (Array.isArray(sites) ? sites : []).map(s => (
                <button key={s.id} onClick={() => setSelectedSite(s.id)} style={{ padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `2px solid ${s.color}`, background: selectedSite === s.id ? s.color : "transparent", color: selectedSite === s.id ? "#fff" : s.color }}>{s.label}</button>
              ))}
            </div>
            <span data-tour="audit-export"><button onClick={() => { setExporting(true); exportPDF(audit, brand, site, aiText); setTimeout(() => setExporting(false), 1000); }}
              disabled={noData || exporting}
              style={{ padding: "8px 18px", background: noData ? C.bg : "#2563EB", color: noData ? C.textLight : "#fff", border: "none", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: noData ? "not-allowed" : "pointer" }}>
              {exporting ? "⏳ Export…" : "⬇ Export PDF"}
            </button></span>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 60, color: C.textLight, fontSize: 12 }}>Chargement des données…</div>
          ) : noData ? (
            <div style={{ textAlign: "center", padding: 60, color: C.textLight }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>Aucun résultat disponible</div>
              <div style={{ fontSize: 12 }}>Interrogez des questions dans l'onglet Fan-outs pour générer des données d'audit</div>
            </div>
          ) : (<>

            {/* ══════════════════════════════════════════════════════
                BLOC 1 — SYNTHÈSE EXÉCUTIVE
                Score GEO + KPIs clés en un coup d'œil
            ══════════════════════════════════════════════════════ */}
            <div data-tour="audit-score"><GeoScoreBanner audit={audit} brand={brand} site={site} /></div>

            {/* ══════════════════════════════════════════════════════
                BLOC 2 — VISIBILITÉ MARQUE
                Présence par provider + tendance 30j + questions
            ══════════════════════════════════════════════════════ */}
            <div data-tour="audit-visibility" style={{ display: "contents" }}><Section icon="📡" title="Visibilité marque" sub="Présence dans les réponses LLM par provider et dans le temps" accent={C.blue}>

              {/* Présence par provider */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>Par provider LLM</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                  {Object.entries(audit.providerStats).map(([pid, s]) => {
                    const rate = pct(s.withBrand, s.total); const color = rate >= 50 ? "#059669" : rate > 0 ? "#D97706" : "#DC2626";
                    return <div key={pid} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>{pid}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color }}>{rate}%</div>
                      <div style={{ fontSize: 11, color: C.textLight }}>{s.withBrand}/{s.total}</div>
                      <div style={{ marginTop: 6, height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${rate}%`, background: color, borderRadius: 2 }} />
                      </div>
                    </div>;
                  })}
                </div>
              </div>

              {/* Tendance 30 jours */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>Tendance — 30 derniers jours</div>
                <TrendChart trendDays={audit.trendDays} />
              </div>

              {/* Questions ✓ / ✗ */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>✓ Questions avec présence</div>
                  <div style={{ fontSize: 10, color: C.textLight, marginBottom: 8, fontStyle: "italic" }}>
                    Favoris en premier · max 25 · triées par volume
                  </div>
                  {audit.presentBrandQs.length ? audit.presentBrandQs.map((q, i) => (
                    <div key={i} style={{ fontSize: 12, padding: "6px 0", borderBottom: `1px solid ${C.borderLight}`, display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ color: "#059669", fontWeight: 700, flexShrink: 0 }}>✓</span>
                      {q.isFav && <span style={{ flexShrink: 0, fontSize: 11 }} title="Question favorite">⭐</span>}
                      <span style={{ flex: 1 }}>{q.question}</span>
                      {q.volume > 0 && <span style={{ fontSize: 10, color: "#2563EB", background: "#EFF6FF", borderRadius: 4, padding: "1px 5px", flexShrink: 0, fontWeight: 600 }}>🔍 {q.volume >= 1000 ? (q.volume/1000).toFixed(1)+"k" : q.volume}</span>}
                    </div>
                  )) : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucune présence</div>}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#DC2626", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>✗ Questions sans présence</div>
                  <div style={{ fontSize: 10, color: C.textLight, marginBottom: 8, fontStyle: "italic" }}>
                    Favoris en premier · max 25 · triées par volume
                  </div>
                  {audit.missingBrandQs.length ? audit.missingBrandQs.map((q, i) => (
                    <div key={i} style={{ fontSize: 12, padding: "6px 0", borderBottom: `1px solid ${C.borderLight}`, display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ color: "#DC2626", fontWeight: 700, flexShrink: 0 }}>✗</span>
                      {q.isFav && <span style={{ flexShrink: 0, fontSize: 11 }} title="Question favorite">⭐</span>}
                      <span style={{ flex: 1 }}>{q.question}</span>
                      {q.volume > 0 && <span style={{ fontSize: 10, color: "#2563EB", background: "#EFF6FF", borderRadius: 4, padding: "1px 5px", flexShrink: 0, fontWeight: 600 }}>🔍 {q.volume >= 1000 ? (q.volume/1000).toFixed(1)+"k" : q.volume}</span>}
                    </div>
                  )) : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Toutes les questions ont une présence !</div>}
                </div>
              </div>
            </Section>

            </div>{/* ══════════════════════════════════════════════════════
                BLOC 2B — ANALYSE PAR CATÉGORIE
            ══════════════════════════════════════════════════════ */}
            <CategoryAnalysisCard
              siteQuestions={siteQuestions}
              siteResults={siteResults}
              keywords={keywords}
              categories={categories}
              brand={brand}
              claudeKey={claudeKey}
            />

            {/* ══════════════════════════════════════════════════════
                BLOC 3 — ANALYSE CONCURRENTIELLE
                Concurrents + intentions + types de réponses
            ══════════════════════════════════════════════════════ */}
            <div data-tour="audit-competitors" style={{ display: "contents" }}><Section icon="⚔️" title="Paysage concurrentiel" sub="Concurrents détectés dans les réponses LLM" accent={C.amber}>

              {/* Table concurrents */}
              {Object.keys(audit.compStats).length > 0 ? (
                <div style={{ marginBottom: 20 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: C.bg }}>{["Concurrent","Catégorie","Mentions","% des résultats","Position moy."].map(h => <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 11, color: C.textLight, textTransform: "uppercase", borderBottom: `1px solid ${C.border}` }}>{h}</th>)}</tr></thead>
                    <tbody>{Object.entries(audit.compStats)
                      .filter(([, s]) => s.category !== "other" || s.mentions > 0)
                      .sort((a, b) => {
                        // Non-"other" en premier, puis par mentions
                        const aOther = !a[1].category || a[1].category === "other";
                        const bOther = !b[1].category || b[1].category === "other";
                        if (aOther !== bOther) return aOther ? 1 : -1;
                        return b[1].mentions - a[1].mentions;
                      })
                      .map(([name, stats]) => {
                        const catKey = stats.category || "other";
                        const cat = COMP_CAT_DEFS[catKey] || COMP_CAT_DEFS.other;
                        const avgPos = stats.positions.length
                          ? (stats.positions.reduce((a, b) => a + b, 0) / stats.positions.length).toFixed(1)
                          : null;
                        return (
                          <tr key={name} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                            <td style={{ padding: "8px 12px", fontWeight: 600 }}>
                              {stats.color && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: stats.color, marginRight: 7, verticalAlign: "middle" }} />}
                              {name}
                            </td>
                            <td style={{ padding: "8px 12px" }}>
                              {catKey !== "other" ? (
                                <span style={{ fontSize: 10, fontWeight: 700, color: cat.color, background: cat.bg, borderRadius: 5, padding: "2px 7px" }}>{cat.label}</span>
                              ) : (
                                <span style={{ fontSize: 10, color: C.textLight }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: "8px 12px" }}>{stats.mentions}</td>
                            <td style={{ padding: "8px 12px", color: "#D97706" }}>{pct(stats.mentions, audit.total)}%</td>
                            <td style={{ padding: "8px 12px", fontWeight: avgPos ? 600 : 400, color: avgPos ? C.text : C.textLight }}>
                              {avgPos ? `#${avgPos}` : "—"}
                            </td>
                          </tr>
                        );
                      })
                    }</tbody>
                  </table>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic", marginBottom: 16 }}>Aucun concurrent détecté dans les réponses LLM</div>
              )}

              {/* Répartition intention + types réponses */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>Répartition par intention</div>
                  {Object.entries(audit.intentCount).sort((a,b)=>b[1]-a[1]).map(([k,v]) => (
                    <div key={k} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}><span style={{ fontWeight: 600 }}>{k}</span><span style={{ color: C.textLight }}>{v} ({pct(v, audit.total)}%)</span></div>
                      <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${pct(v, audit.total)}%`, background: "#7C3AED", borderRadius: 3 }} /></div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>Types de réponses LLM</div>
                  {Object.entries(audit.typeCount).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v]) => (
                    <div key={k} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}><span style={{ fontWeight: 600 }}>{k}</span><span style={{ color: C.textLight }}>{v} ({pct(v, audit.total)}%)</span></div>
                      <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${pct(v, audit.total)}%`, background: "#2563EB", borderRadius: 3 }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            </div>{/* ══════════════════════════════════════════════════════
                BLOC 4 — ANALYSE DES SOURCES & URLS
                Top domaines + URLs marque catégorisées
            ══════════════════════════════════════════════════════ */}
            <Section icon="🔗" title="Sources & URLs" sub="URLs de la marque citées dans les réponses LLM" accent={C.purple}>

              {/* Top domaines */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>Top domaines cités</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                  {Object.entries(audit.topDomains).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([d, cnt], i) => {
                    const isComp = audit.competitorUrls.some(u => u.domain === d); const isBrand = audit.brandUrls.some(u => u.domain === d);
                    return <div key={d} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: C.bg, borderRadius: 8, border: `1px solid ${isBrand ? "#05966633" : isComp ? "#DC262633" : C.border}` }}>
                      <div><span style={{ fontSize: 13, fontWeight: 800, color: C.textLight, marginRight: 8 }}>#{i+1}</span>
                        <span style={{ fontSize: 12, color: isBrand ? "#059669" : isComp ? "#DC2626" : C.text, fontWeight: 600 }}>{d}</span>
                        {isBrand && <span style={{ fontSize: 9, marginLeft: 4, background: "#ECFDF5", color: "#059669", borderRadius: 4, padding: "1px 5px" }}>marque</span>}
                        {isComp && <span style={{ fontSize: 9, marginLeft: 4, background: "#FEF2F2", color: "#DC2626", borderRadius: 4, padding: "1px 5px" }}>concurrent</span>}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{cnt}×</span>
                    </div>;
                  })}
                </div>
              </div>

              {/* Tableau URLs marque */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>URLs de la marque citées</div>
                {audit.brandUrls.length === 0 ? (
                  <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucune URL de la marque détectée dans les sources</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: C.bg }}>
                        {["URL", "Citations src", "Mentions rép.", "Questions liées", "Statut"].map(h => (
                          <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 10, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {audit.brandUrls.slice(0, 20).map((u, i) => {
                        const src = u.count_as_source || 0;
                        const rep = u.count_in_answer || 0;
                        const detail = (audit.urlDetails || []).find(d => d.norm === u.norm);
                        const qCount = detail?.linkedQs?.length || 0;
                        const status = src >= 3 ? { label: "✓ Performante", color: "#059669", bg: "#ECFDF5" }
                                     : rep > 0 && src === 0 ? { label: "⚠ À sourcer", color: "#DC2626", bg: "#FEF2F2" }
                                     : src > 0 ? { label: "↑ À booster", color: "#D97706", bg: "#FFFBEB" }
                                     : { label: "— Peu citée", color: C.textLight, bg: C.bg };
                        // Afficher la version normalisée (sans https, www, slash final)
                        const displayUrl = u.norm || u.url.replace(/^https?:\/\//, "");
                        return (
                          <tr key={i} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                            <td style={{ padding: "8px 12px", maxWidth: 260, wordBreak: "break-all" }}>
                              <a href={u.url} target="_blank" rel="noreferrer" style={{ color: "#2563EB", fontSize: 11, textDecoration: "none" }}>{displayUrl}</a>
                            </td>
                            <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: src > 0 ? "#059669" : C.textLight }}>{src}</td>
                            <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: rep > 0 ? "#2563EB" : C.textLight }}>{rep}</td>
                            <td style={{ padding: "8px 12px", textAlign: "center", color: qCount > 0 ? C.text : C.textLight }}>
                              {qCount > 0 ? `${qCount} question${qCount > 1 ? "s" : ""}` : "—"}
                            </td>
                            <td style={{ padding: "8px 12px" }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: status.color, background: status.bg, borderRadius: 6, padding: "2px 8px" }}>{status.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </Section>

            {/* ══════════════════════════════════════════════════════
                BLOC 5 — CROISEMENTS DATA × GEO
                SF technique / Bing AI / GSC SEO
            ══════════════════════════════════════════════════════ */}
            {(() => {
              const hasGSC     = metrics.some(m => m.gsc);
              const hasBing    = metrics.some(m => m.bing);
              const hasCorr    = corrMatrix.length > 0 && corrMatrix.some(r => r.corrs.some(c => c.value !== null));
              const geoPct     = audit.presenceRate;
              const avgPos2    = audit.avgPos;
              const total2     = audit.total;

              const gscClicks  = metrics.reduce((s, m) => s + (m.gsc?.clicks || 0), 0);
              const gscPos     = metrics.filter(m => m.gsc?.position).map(m => m.gsc.position);
              const gscAvgPos  = gscPos.length ? (gscPos.reduce((a,b)=>a+b,0)/gscPos.length).toFixed(1) : null;

              const CrossCard = ({ icon, title, sub, children }) => (
                <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, background: C.bg, display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 18 }}>{icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{title}</div>
                      {sub && <div style={{ fontSize: 11, color: C.textLight, marginTop: 1 }}>{sub}</div>}
                    </div>
                  </div>
                  <div style={{ padding: "16px 20px" }}>{children}</div>
                </div>
              );

              const Signal = ({ label, value, note, color = C.text }) => (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "7px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                  <span style={{ fontSize: 12, color: C.textMid }}>{label}</span>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color }}>{value}</span>
                    {note && <div style={{ fontSize: 10, color: C.textLight }}>{note}</div>}
                  </div>
                </div>
              );


              return (
                <Section icon="📊" title="Croisements data × présence GEO" sub="Bing AI, SEO et corrélations Screaming Frog" accent={C.teal}>

                  {/* B5 — Bing AI × Fan-outs — URLs marque uniquement */}
                  <CrossCard icon="🤖" title="Bing AI × Fan-outs" sub="URLs de la marque — top citations Bing vs top citations LLM">
                    {(() => {
                      const siteId = site?.id;
                      const bingRows = (bingData[siteId] || []);
                      // Construire map url → citations Bing
                      const bingByUrl = {};
                      bingRows.forEach(r => {
                        const url = (r["url"] || r["adresse"] || r["address"] || "").trim().toLowerCase();
                        if (!url) return;
                        const cits = Number(r["citations"] || r["mentions"] || r["appearancecount"] || 0);
                        if (!bingByUrl[url]) bingByUrl[url] = { url, citations: 0 };
                        bingByUrl[url].citations += cits;
                      });
                      // Filtrer UNIQUEMENT les URLs de la marque
                      const brandTerms = [brand?.brand_name, ...(brand?.brand_aliases || []), brand?.brand_domain]
                        .filter(Boolean).map(t => t.toLowerCase().replace(/\s+/g, ""));
                      const isBrandUrl = (url) => brandTerms.some(t => t && url.toLowerCase().includes(t));

                      const bingBrandUrls = Object.values(bingByUrl)
                        .filter(b => isBrandUrl(b.url))
                        .sort((a, b) => b.citations - a.citations)
                        .slice(0, 10);

                      const fanoutBrandUrls = urlIndex
                        .filter(u => u.project_id === projectId && isBrandUrl(u.url || ""))
                        .sort((a, b) => (b.count_as_source + b.count_in_answer) - (a.count_as_source + a.count_in_answer))
                        .slice(0, 10);

                      const alignScore = bingBrandUrls.length > 0 && fanoutBrandUrls.length > 0 ? (() => {
                        const bingSet = new Set(bingBrandUrls.map(b => b.url));
                        const both = fanoutBrandUrls.filter(f => bingSet.has((f.url || "").toLowerCase())).length;
                        return Math.round((both / Math.max(bingBrandUrls.length, fanoutBrandUrls.length)) * 100);
                      })() : null;
                      const scoreColor = alignScore === null ? C.textLight : alignScore >= 60 ? "#059669" : alignScore >= 30 ? "#D97706" : "#DC2626";

                      return (
                        <div>
                          {/* KPIs */}
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
                            {[
                              { label: "URLs marque sur Bing", value: bingBrandUrls.length, color: "#7C3AED" },
                              { label: "URLs marque sur LLMs", value: fanoutBrandUrls.length, color: "#2563EB" },
                              { label: "Alignement", value: alignScore !== null ? `${alignScore}%` : "—", color: scoreColor },
                            ].map(k => (
                              <div key={k.label} style={{ background: C.bg, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                                <div style={{ fontSize: 10, color: C.textLight, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>{k.label}</div>
                                <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
                              </div>
                            ))}
                          </div>

                          {!hasBing ? (
                            <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 10, padding: "12px 16px", fontSize: 12, color: "#92400E" }}>
                              Importez un export Bing Webmaster Tools dans ⚙️ Setup pour débloquer cette analyse.
                            </div>
                          ) : (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                              {/* Colonne Bing */}
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>
                                  🤖 Top URLs marque — Bing
                                </div>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                  <thead><tr style={{ background: C.bg }}>
                                    <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: C.textLight, fontSize: 10, borderBottom: `1px solid ${C.border}` }}>URL</th>
                                    <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600, color: C.textLight, fontSize: 10, borderBottom: `1px solid ${C.border}` }}>Cit. Bing</th>
                                  </tr></thead>
                                  <tbody>
                                    {bingBrandUrls.length === 0
                                      ? <tr><td colSpan={2} style={{ padding: "8px", color: C.textLight, fontStyle: "italic" }}>Aucune URL marque dans Bing</td></tr>
                                      : bingBrandUrls.map((u, i) => (
                                        <tr key={i} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                                          <td style={{ padding: "5px 8px", wordBreak: "break-all", color: "#7C3AED" }}>{u.url.replace(/^https?:\/\/[^/]+/, "") || "/"}</td>
                                          <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700 }}>{u.citations}</td>
                                        </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {/* Colonne Fan-outs */}
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "#2563EB", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>
                                  🔗 Top URLs marque — Fan-outs LLM
                                </div>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                  <thead><tr style={{ background: C.bg }}>
                                    <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: C.textLight, fontSize: 10, borderBottom: `1px solid ${C.border}` }}>URL</th>
                                    <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600, color: C.textLight, fontSize: 10, borderBottom: `1px solid ${C.border}` }}>Src</th>
                                    <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600, color: C.textLight, fontSize: 10, borderBottom: `1px solid ${C.border}` }}>Rép</th>
                                  </tr></thead>
                                  <tbody>
                                    {fanoutBrandUrls.length === 0
                                      ? <tr><td colSpan={3} style={{ padding: "8px", color: C.textLight, fontStyle: "italic" }}>Aucune URL marque dans les fan-outs</td></tr>
                                      : fanoutBrandUrls.map((u, i) => (
                                        <tr key={i} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                                          <td style={{ padding: "5px 8px", wordBreak: "break-all", color: "#2563EB" }}>{(u.url || "").replace(/^https?:\/\/[^/]+/, "") || "/"}</td>
                                          <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700, color: "#059669" }}>{u.count_as_source}</td>
                                          <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700 }}>{u.count_in_answer}</td>
                                        </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </CrossCard>

                  {/* GSC × GEO */}
                  <CrossCard icon="🔍" title="Données SEO (GSC) × Présence GEO"
                    sub="Relation entre les performances SEO organiques et la visibilité générative">
                    <div style={{ display: "grid", gridTemplateColumns: hasGSC ? "1fr 1fr" : "1fr", gap: 20 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>État actuel</div>
                        {hasGSC ? (<>
                          <Signal label="Clics GSC totaux" value={gscClicks >= 1000 ? (gscClicks/1000).toFixed(1)+"k" : String(gscClicks)} color="#2563EB" />
                          <Signal label="Position moy. GSC" value={gscAvgPos || "—"} note="toutes pages" color="#2563EB" />
                          <Signal label="Présence GEO" value={`${geoPct}%`} note={`${audit.withBrand}/${total2} fan-outs`} color={geoPct >= 50 ? "#059669" : "#DC2626"} />
                          {avgPos2 && <Signal label="Position moy. fan-out" value={avgPos2} note="dans les listes LLM" color="#7C3AED" />}
                        </>) : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Importez un export GSC dans ⚙️ Setup</div>}
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>Interprétation</div>
                        {hasGSC ? (
                          <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.7 }}>
                            {gscAvgPos && parseFloat(gscAvgPos) <= 10 && geoPct < 30
                              ? "Paradoxe SEO/GEO : bonne position organique mais faible présence GEO. Restructurez le contenu pour répondre directement aux questions de recommandation."
                              : gscAvgPos && parseFloat(gscAvgPos) <= 10 && geoPct >= 50
                              ? "Corrélation positive SEO/GEO : la forte autorité SEO se traduit en présence GEO."
                              : "Améliorer le SEO on-page renforcera la visibilité GEO via l'autorité accrue."}
                          </div>
                        ) : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>—</div>}
                      </div>
                    </div>
                  </CrossCard>

                  {/* B7 — Corrélations Screaming Frog — tableau unique */}
                  {hasCorr && (
                    <CrossCard icon="🕷️" title="Corrélations Screaming Frog" sub="SF × Bing AI · SF × GSC · SF × Fan-outs">
                      {(() => {
                        // SF × Fan-outs : corrélations avec brand_mentioned (src=bing proxy)
                        const fanoutCorrs = corrMatrix.flatMap(row =>
                          row.corrs.filter(c => c.kpi.src === "bing" && c.value !== null)
                            .map(c => ({ dim: row.dim.label, kpi: c.kpi.label, src: "bing", value: c.value }))
                        );
                        const gscCorrsAll = corrMatrix.flatMap(row =>
                          row.corrs.filter(c => c.kpi.src === "gsc" && c.value !== null)
                            .map(c => ({ dim: row.dim.label, kpi: c.kpi.label, src: "gsc", value: c.value }))
                        );
                        const allCorrs = [...fanoutCorrs, ...gscCorrsAll]
                          .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
                          .slice(0, 15);

                        if (!allCorrs.length) return (
                          <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>
                            Importez un CSV Screaming Frog et interrogez plus de questions pour calculer les corrélations.
                          </div>
                        );

                        return (
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <thead>
                              <tr style={{ background: C.bg }}>
                                {["Dimension SF", "KPI", "Type", "Corrélation"].map(h => (
                                  <th key={h} style={{ padding: "7px 12px", textAlign: "left", fontWeight: 600, fontSize: 10, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {allCorrs.map((c, i) => {
                                const pos = c.value > 0;
                                const strong = Math.abs(c.value) >= 0.4;
                                const srcLabel = c.src === "gsc" ? "SF × GSC" : "SF × Fan-out";
                                const srcColor = c.src === "gsc" ? "#2563EB" : "#7C3AED";
                                return (
                                  <tr key={i} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                                    <td style={{ padding: "7px 12px", color: C.text }}>{c.dim}</td>
                                    <td style={{ padding: "7px 12px", color: C.textMid }}>{c.kpi}</td>
                                    <td style={{ padding: "7px 12px" }}>
                                      <span style={{ fontSize: 10, fontWeight: 700, color: srcColor, background: srcColor + "15", borderRadius: 4, padding: "1px 6px" }}>{srcLabel}</span>
                                    </td>
                                    <td style={{ padding: "7px 12px" }}>
                                      <span style={{ fontSize: 12, fontWeight: strong ? 700 : 500, color: pos ? "#059669" : "#DC2626", background: pos ? "#ECFDF5" : "#FEF2F2", borderRadius: 5, padding: "2px 10px" }}>
                                        {pos ? "▲" : "▼"} r={c.value.toFixed(2)}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        );
                      })()}
                    </CrossCard>
                  )}
                </Section>
              );
            })()}

            {/* ══════════════════════════════════════════════════════
                BLOC 6 — PLAN D'ACTION
                Pistes prioritaires + analyse Fan-out IA
            ══════════════════════════════════════════════════════ */}
            {/* ══════════════════════════════════════════════════════
                BLOC 6 — PLAN D'ACTION
            ══════════════════════════════════════════════════════ */}
            <Section icon="🎯" title="Plan d'action" sub="Recommandations data, analyses IA et graphique concurrentiel" accent={C.green}>

              {/* B8 — Pistes prioritaires globales avec renderBold */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>Pistes prioritaires</div>
                {audit.leads.map((l, i) => {
                  const borderColor = l.priority.includes("🔴") ? "#DC2626" : l.priority.includes("🟠") ? "#D97706" : l.priority.includes("🟡") ? "#CA8A04" : C.green;
                  const bgColor     = l.priority.includes("🔴") ? "#FEF2F2"  : l.priority.includes("🟠") ? "#FFFBEB"  : l.priority.includes("🟡") ? "#FEFCE8"  : "#ECFDF5";
                  return (
                    <div key={i} style={{ padding: "10px 14px", borderLeft: `3px solid ${borderColor}`, background: bgColor, borderRadius: "0 8px 8px 0", marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 3 }}>{l.priority} — {l.label}</div>
                      <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>{renderBold(l.action)}</div>
                    </div>
                  );
                })}
              </div>

              {/* B1 — Scatter plot concurrents : citations × position */}
              {Object.keys(audit.compStats).length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>
                    Cartographie concurrentielle — Citations × Position
                  </div>
                  <CompetitorScatter compStats={audit.compStats} total={audit.total} brandName={brand?.brand_name} brandWithBrand={audit.withBrand} brandAvgPos={audit.avgPos} />
                </div>
              )}

              {/* B9 — CTAs harmonisés : Analyse Fan-out + Analyse Détaillée côte à côte */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>✨ Analyse Fan-out</div>
                  <div style={{ fontSize: 11, color: C.textLight, marginBottom: 12 }}>Recommandations basées sur vos données de présence et sources</div>
                  <FanoutAnalysis questions={siteQuestions} results={siteResults} brand={brand} claudeKey={claudeKey} />
                </div>
                <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>✦ Analyse IA détaillée</div>
                  <div style={{ fontSize: 11, color: C.textLight, marginBottom: 12 }}>Interprétation contextuelle complète générée par Claude</div>
                  <AIAnalysis audit={audit} brand={brand} site={site} questions={siteQuestions} onTextReady={setAiText} />
                </div>
              </div>
            </Section>

          </>)}
        </div>
      )}
    </div>
  );
}