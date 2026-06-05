import { useState, useMemo, useCallback, useEffect } from "react";
import "./geo-responsive.css";
import TourGuide from "./TourGuide";
import { sbGetBrand, sbGetQuestions, sbGetGeoResults, sbGetUrlIndex,
  sbSaveProject, sbDeleteProject, sbDownload,
  sbGetCalendarEntriesBatch, sbGetKeywords, sbGetCategories, sbGetCompetitors,
  sbSaveGeoAnalysis, sbGetGeoAnalyses } from "../lib/supabase";
import {
  urlPath, sfRowMetrics, gscRowMetrics, gaRowMetrics,
  computePagesToUnblock, computeCitabilityScores, computeOrphanCited,
  computeSeoGeoGap, computeReverseCannibalization, computeBingGap,
  computeBusinessValue, computeAITraffic,
  buildCSV, downloadCSV, CSV_COLUMNS,
} from "../lib/audit-tools";
import UploadCard from "../components/UploadCard";
import PageTypeClassifier from "../components/PageTypeClassifier";
import { newProject } from "../lib/helpers";
import { C, SITE_PALETTE } from "../lib/constants";

const ANTHROPIC_PROXY = "/api/anthropic";

// Catégories concurrents — miroir de GeoTab

// Rend les **texte** en <strong> dans toute l'app
// ── Modèles Claude utilisés dans l'audit ─────────────────────────
// AIAnalysis = analyse experte longue et sourcée (sonnet recommandé pour la qualité).
// FanoutAnalysis & CompetitorPageAnalyzer = analyses courtes (haiku, plus rapide/économique).
// Pour basculer AIAnalysis sur haiku : remplacer AUDIT_AI_MODEL par "claude-haiku-4-5-20251001".
const AUDIT_AI_MODEL = "claude-sonnet-4-6";

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
          style={{ padding: "5px 14px", background: (status === "loading" || !claudeKey) ? "transparent" : "#1A3C2E", color: (status === "loading" || !claudeKey) ? "#1A3C2E44" : "#F0EBE0", border: "0.5px solid #1A3C2E22", borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: (status === "loading" || !claudeKey) ? "default" : "pointer" }}
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
            Pour une analyse pertinente, catégorisez vos mots-clés dans <strong>Suivi GEO → Mots-clés</strong>.
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
          Catégorisez vos mots-clés dans Suivi GEO → Mots-clés pour voir la présence par axe thématique.
        </div>
      )}

      {/* Résultat analyse IA */}
      {status === "done" && analysis && (
        <div style={{ padding: "16px 20px" }}>
          <button onClick={() => setOpen(o => !o)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#1A3C2E55", fontWeight: 500, padding: 0, marginBottom: open ? 10 : 0 }}>
            {open ? "▲ Masquer l'analyse IA" : "▼ Voir l'analyse IA"}
          </button>
          {open && (
            <div style={{ fontSize: 12, color: C.text, lineHeight: 1.7 }}>
              {analysis.split("\n").map((line, i) => {
                if (line.startsWith("## ")) return <div key={i} style={{ fontWeight: 600, fontSize: 11, color: "#1A3C2E", marginTop: 12, marginBottom: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>{line.slice(3)}</div>;
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

function Section({ icon, title, sub, children }) {
  return (
    <div style={{ background: "#fff", border: "0.5px solid #1A3C2E0D", borderRadius: 10, padding: "18px 20px", marginBottom: 12 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "#1A3C2E55" }}>
          {title}
        </div>
        {sub && <div style={{ fontSize: 11, color: "#1A3C2E44", marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

// ── Scatter plot concurrents : citations (X) × position moy. (Y) ──
// ── FavoritesPerformance — met en avant les questions favorites ──
// 4 buckets : À défendre (#1-3) / À surveiller (#4-10) / Conquête prioritaire / À conquérir
// ── Mini graphe en barres verticales pour l'audit (style Fan-out) ──
// data: [{ name, count, kind }] · kind ∈ brand|competitor|other
function AuditBarChart({ data, accent = "#1A3C2E" }) {
  const [hover, setHover] = useState(null);
  const rows = (data || []).slice(0, 14);
  const max = rows.length ? Math.max(...rows.map(d => d.count)) : 0;
  const colorFor = (kind) => kind === "brand" ? "#1A7A4A" : kind === "competitor" ? "#C0352A" : "#9AAEA4";
  if (!rows.length) return <div style={{ fontSize: 11, color: "#1A3C2E44", fontStyle: "italic" }}>Aucune donnée</div>;
  return (
    <div>
      <div style={{ position: "relative", height: 140, display: "flex", alignItems: "flex-end", gap: rows.length > 9 ? 3 : 6, padding: "18px 0 0" }}>
        {rows.map((d, i) => {
          const h = max ? Math.max((d.count / max) * 100, 4) : 4;
          const isHover = hover === i;
          return (
            <div key={d.name + i}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", position: "relative" }}>
              {isHover && (
                <div style={{ position: "absolute", bottom: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)", background: "#1A3C2E", color: "#F0EBE0", borderRadius: 6, padding: "5px 9px", fontSize: 11, whiteSpace: "nowrap", zIndex: 5, boxShadow: "0 2px 8px #1A3C2E33", pointerEvents: "none" }}>
                  <div style={{ fontWeight: 600 }}>{d.name}</div>
                  <div style={{ opacity: 0.8 }}>{d.count} citation{d.count > 1 ? "s" : ""}</div>
                </div>
              )}
              <div style={{ width: "100%", height: `${h}%`, background: colorFor(d.kind), borderRadius: "3px 3px 0 0", opacity: isHover ? 1 : 0.88, transition: "opacity 0.12s", minHeight: 3 }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: rows.length > 9 ? 3 : 6, marginTop: 6, height: 64 }}>
        {rows.map((d, i) => (
          <div key={d.name + i} style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center" }}>
            <span style={{ fontSize: 9, color: hover === i ? "#1A3C2E" : "#1A3C2E66", whiteSpace: "nowrap", transform: "rotate(-45deg)", transformOrigin: "top left", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 80, display: "inline-block", marginTop: 2 }}>{d.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FanoutAnalysisRecap — récupère l'analyse produite dans Fan-out ──
// Affiche (lecture seule) la dernière analyse "fanout" générée dans l'onglet
// Fan-outs (GeoAnalysis), pour la retrouver directement dans l'audit.
function FanoutAnalysisRecap({ projectId, siteId }) {
  const [sections, setSections] = useState(null);
  const [savedDate, setSavedDate] = useState(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!projectId || !siteId) { setSections(null); return; }
    let cancelled = false;
    sbGetGeoAnalyses(projectId, siteId, "fanout").then(rows => {
      if (cancelled || !rows?.length) { setSections(null); return; }
      const c = rows[0].content;
      if (c?.sections?.length) { setSections(c.sections); setSavedDate(rows[0].created_at); }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, siteId]);

  if (!sections?.length) return null;

  const META = {
    "ÉTAT DES LIEUX":    { icon: "◎", color: "#1A3C2E" },
    "MAILLAGE INTERNE":  { icon: "⟶", color: "#1A3C2E" },
    "PAGES À CRÉER":     { icon: "✦", color: "#C97820" },
    "URLS CONCURRENTES": { icon: "↗", color: "#1A3C2E77" },
  };
  const getMeta = (title) => {
    const key = Object.keys(META).find(k => (title || "").toUpperCase().includes(k));
    return META[key] || { icon: "•", color: "#1A3C2E" };
  };

  return (
    <div data-tour="audit-fanout-recap" style={{ display: "contents" }}>
      <Section title="Analyse Fan-out" sub="Recommandations générées dans l'onglet Suivi GEO">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          {savedDate && (
            <span style={{ fontSize: 10, color: "#1A3C2E55" }}>
              Générée le {new Date(savedDate).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button onClick={() => setOpen(o => !o)}
            style={{ marginLeft: "auto", fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "0.5px solid #1A3C2E22", background: "transparent", color: "#1A3C2E77", cursor: "pointer" }}>
            {open ? "Réduire" : "Déployer"}
          </button>
        </div>
        {open && sections.map((s, i) => {
          const meta = getMeta(s.title);
          if (s.title === "Erreur") return null;
          return (
            <div key={i} style={{ borderLeft: "2px solid #1A3C2E0D", paddingLeft: 16, paddingBottom: 16, marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: meta.color }}>{meta.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: meta.color }}>{s.title}</span>
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.7, color: "#1A3C2E", whiteSpace: "pre-wrap" }}>{renderBold(s.body || "")}</div>
            </div>
          );
        })}
      </Section>
    </div>
  );
}

function FavoritesPerformance({ questions, results, projectId = null, siteId = null }) {
  // Overrides manuels de bucket par question (drag & drop), persistés en localStorage
  const storageKey = `geoFavBuckets_${projectId || "p"}_${siteId || "s"}`;
  const [overrides, setOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { return {}; }
  });
  const [dragOverBucket, setDragOverBucket] = useState(null);

  const persistOverrides = useCallback((next) => {
    setOverrides(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* quota */ }
  }, [storageKey]);

  const order = ["defend", "watch", "conquest_priority", "conquer"];

  const data = useMemo(() => {
    const favs = questions.filter(q => q.is_favorite);
    if (!favs.length) return null;
    const byQ = {};
    results.forEach(r => { (byQ[r.question_id] = byQ[r.question_id] || []).push(r); });
    const posOf = (qId) => {
      const rs = byQ[qId] || [];
      const ps = rs.map(r => r.brand_mention_position || r.brand_position).filter(p => p != null && p > 0);
      return ps.length ? Math.min(...ps) : null;
    };
    const mentioned = (qId) => (byQ[qId] || []).some(r => r.brand_mentioned === true || r.brand_mentioned === 1);
    const computedBucket = (q, pos, ment) => {
      if (ment && pos != null && pos <= 3) return "defend";
      if (ment && pos != null && pos >= 4 && pos <= 10) return "watch";
      if (!ment && q.keyword_id) return "conquest_priority";
      return "conquer";
    };
    const buckets = { defend: [], watch: [], conquest_priority: [], conquer: [] };
    favs.forEach(q => {
      const pos = posOf(q.id), ment = mentioned(q.id);
      const auto = computedBucket(q, pos, ment);
      const b = overrides[q.id] && order.includes(overrides[q.id]) ? overrides[q.id] : auto;
      buckets[b].push({ id: q.id, question: q.question, pos, moved: !!overrides[q.id] && overrides[q.id] !== auto });
    });
    return { buckets, total: favs.length };
  }, [questions, results, overrides]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return (
    <div style={{ fontSize: 12, color: "#1A3C2E44", fontStyle: "italic", padding: "8px 0" }}>
      Aucune question favorite. Marquez vos questions stratégiques (★) dans l'onglet Suivi GEO pour les suivre ici.
    </div>
  );

  const META = {
    defend:            { label: "À défendre",          color: "#1A7A4A", desc: "La marque lead (#1-3)" },
    watch:             { label: "À surveiller",         color: "#C97820", desc: "Top 4-10" },
    conquest_priority: { label: "Conquête prioritaire", color: "#E8541A", desc: "Non positionnée · fort potentiel" },
    conquer:           { label: "À conquérir",          color: "#1A3C2E77", desc: "Non positionnée" },
  };

  const moveToBucket = (qId, targetBucket) => {
    if (!qId || !order.includes(targetBucket)) return;
    persistOverrides({ ...overrides, [qId]: targetBucket });
  };
  const resetOverride = (qId) => {
    const next = { ...overrides };
    delete next[qId];
    persistOverrides(next);
  };

  const hasOverrides = Object.keys(overrides).length > 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: "#1A3C2E66" }}>
          Glissez-déposez une question d'une colonne à l'autre pour ajuster sa priorité.
        </div>
        {hasOverrides && (
          <button onClick={() => persistOverrides({})}
            style={{ fontSize: 10, padding: "3px 10px", borderRadius: 6, border: "0.5px solid #1A3C2E22", background: "transparent", color: "#1A3C2E77", cursor: "pointer" }}>
            ↺ Réinitialiser le classement
          </button>
        )}
      </div>

      {/* Barre de répartition */}
      <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "#1A3C2E0C", marginBottom: 14 }}>
        {order.map(b => {
          const n = data.buckets[b].length;
          if (!n) return null;
          return <div key={b} style={{ width: `${n / data.total * 100}%`, background: META[b].color }} title={`${META[b].label} : ${n}`} />;
        })}
      </div>

      {/* Grille des 4 buckets (drop zones) */}
      <div className="audit-questions-grid">
        {order.map(b => {
          const items = data.buckets[b];
          const meta = META[b];
          const isDropTarget = dragOverBucket === b;
          return (
            <div key={b}
              onDragOver={(e) => { e.preventDefault(); if (dragOverBucket !== b) setDragOverBucket(b); }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOverBucket(null); }}
              onDrop={(e) => {
                e.preventDefault();
                const qId = e.dataTransfer.getData("text/plain");
                setDragOverBucket(null);
                if (qId) moveToBucket(qId, b);
              }}
              style={{
                border: `0.5px solid ${isDropTarget ? meta.color : "#1A3C2E0D"}`,
                background: isDropTarget ? `${meta.color}0A` : "transparent",
                borderRadius: 10, padding: "12px 14px", transition: "background 0.15s, border-color 0.15s",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: meta.color }}>{meta.label}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: meta.color, marginLeft: "auto" }}>{items.length}</span>
              </div>
              <div style={{ fontSize: 10, color: "#1A3C2E44", marginBottom: 8 }}>{meta.desc}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, minHeight: 30, maxHeight: 200, overflowY: "auto" }}>
                {items.map((it) => (
                  <div key={it.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", it.id); e.dataTransfer.effectAllowed = "move"; }}
                    title={it.moved ? "Déplacée manuellement — double-clic pour rétablir le classement auto" : "Glissez pour déplacer"}
                    onDoubleClick={() => it.moved && resetOverride(it.id)}
                    style={{ fontSize: 11, color: "#1A3C2E", lineHeight: 1.4, display: "flex", gap: 6, alignItems: "baseline", cursor: "grab", padding: "3px 4px", borderRadius: 4, background: it.moved ? `${meta.color}0C` : "transparent" }}>
                    <span style={{ color: "#1A3C2E22", flexShrink: 0, fontSize: 10 }}>⋮⋮</span>
                    <span style={{ flex: 1 }}>{it.question}{it.moved && <span style={{ color: meta.color, marginLeft: 4 }}>•</span>}</span>
                    {it.pos != null && <span style={{ fontSize: 10, color: meta.color, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>#{it.pos}</span>}
                  </div>
                ))}
                {!items.length && <div style={{ fontSize: 10, color: "#1A3C2E22", fontStyle: "italic", padding: "8px 0", textAlign: "center" }}>Déposez ici</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GeoScoreBanner({ audit, auditFav = null, brand, site }) {
  const score = audit.presenceRate;
  const favScore = auditFav ? auditFav.presenceRate : null;
  const favDelta = favScore != null ? favScore - score : null;
  const level = score >= 70 ? { label: "Excellente",            color: "#1A7A4A", bar: "#1A7A4A" }
              : score >= 50 ? { label: "Bonne présence",           color: "#1A3C2E", bar: "#1A3C2E" }
              : score >= 30 ? { label: "Potentiel à développer",   color: "#C97820", bar: "#C97820" }
              :               { label: "Potentiel à exploiter",    color: "#C97820", bar: "#C97820" };
  return (
    <div style={{ background: "#fff", border: "0.5px solid #1A3C2E0D", borderRadius: 12, padding: "20px 24px", marginBottom: 16 }}>
      <div className="audit-banner-inner">
        {/* Score */}
        <div style={{ minWidth: 100 }}>
          <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "#1A3C2E44", marginBottom: 6 }}>Présence GEO</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 44, fontWeight: 700, color: level.color, lineHeight: 1, letterSpacing: "-0.02em" }}>{score}</span>
            <span style={{ fontSize: 18, color: level.color, fontWeight: 500 }}>%</span>
          </div>
          <div style={{ marginTop: 8, height: 3, background: "#1A3C2E0C", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${score}%`, background: level.bar, borderRadius: 2, transition: "width 0.5s" }} />
          </div>
          <div style={{ marginTop: 5, fontSize: 11, color: level.color, fontWeight: 500 }}>{level.label}</div>
          {/* Score favoris en parallèle */}
          {favScore != null && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "0.5px solid #1A3C2E0C" }}>
              <div style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#C9782099", marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: "#C97820" }}>★</span> Favoris
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                <span style={{ fontSize: 26, fontWeight: 700, color: "#C97820", lineHeight: 1, letterSpacing: "-0.02em" }}>{favScore}</span>
                <span style={{ fontSize: 13, color: "#C97820", fontWeight: 500 }}>%</span>
                {favDelta != null && favDelta !== 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: favDelta > 0 ? "#1A7A4A" : "#C0352A", marginLeft: 2 }}>
                    {favDelta > 0 ? "▲ +" : "▼ "}{favDelta} pts
                  </span>
                )}
              </div>
              <div style={{ fontSize: 10, color: "#1A3C2E44", marginTop: 3 }}>{auditFav.withBrand}/{auditFav.total} réponses favorites</div>
            </div>
          )}
        </div>

        {/* Séparateur */}
        <div className="audit-banner-sep" />

        {/* Barre proportion M/É/C */}
        <div style={{ flex: "0 0 auto", minWidth: 140 }}>
          <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "#1A3C2E44", marginBottom: 8 }}>Répartition</div>
          <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", background: "#1A3C2E0C", marginBottom: 10 }}>
            {audit.total > 0 && <>
              <div style={{ width: `${(audit.withRanked||0)/audit.total*100}%`, background: "#1A7A4A" }} />
              <div style={{ width: `${(audit.withMentionOnly||0)/audit.total*100}%`, background: "#C97820" }} />
              <div style={{ width: `${(audit.withSourceOnly||0)/audit.total*100}%`, background: "#1A3C2E55" }} />
            </>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {[
              { sym: "◎", label: "Mention",   val: audit.withRanked||0,      color: "#1A7A4A" },
              { sym: "⟶", label: "Évocation", val: audit.withMentionOnly||0, color: "#C97820" },
              { sym: "↗",  label: "Citation",  val: audit.withSourceOnly||0,  color: "#1A3C2E77" },
            ].map(k => (
              <div key={k.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: "#1A3C2E55" }}><span style={{ color: k.color }}>{k.sym}</span> {k.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: k.color }}>{k.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Séparateur */}
        <div className="audit-banner-sep" />

        {/* KPIs contextuels */}
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "#1A3C2E44", marginBottom: 8 }}>Contexte</div>
          <div className="audit-banner-context">
            {[
              { label: "Marque",                  val: brand?.brand_name || "—" },
              { label: "Site",                    val: site?.label || "—" },
              { label: "Questions",               val: audit.questions },
              { label: "Résultats",               val: audit.total },
              { label: "Pos. moy.",               val: audit.avgPos ? `#${audit.avgPos}` : "—" },
              { label: "Concurrents renseignés",  val: Object.keys(audit.compStats).length },
            ].map(k => (
              <div key={k.label} style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                <span style={{ fontSize: 10, color: "#1A3C2E44" }}>{k.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#1A3C2E" }}>{k.val}</span>
              </div>
            ))}
          </div>
        </div>
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

  // ── Positions moyennes par type de présence (Mention / Évocation / Citation) ──
  // Exploite brand_mention_position / brand_evocation_position / brand_citation_position
  const avgOf = (vals) => vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
  const mentionPositions   = results.map(r => r.brand_mention_position).filter(p => p != null && p > 0);
  const evocationPositions = results.map(r => r.brand_evocation_position).filter(p => p != null && p > 0);
  const citationPositions  = results.map(r => r.brand_citation_position).filter(p => p != null && p > 0);
  const avgMentionPos   = avgOf(mentionPositions);
  const avgEvocationPos = avgOf(evocationPositions);
  const avgCitationPos  = avgOf(citationPositions);
  const mentionCount    = mentionPositions.length;
  const evocationCount  = evocationPositions.length;
  const citationCount   = citationPositions.length;

  // ── Breakdown 3 types de présence (mutuellement exclusifs) ───────
  const getPresType = (r) => {
    if (!r) return null;
    if (r.brand_position && (r.brand_mentioned === true || r.brand_mentioned === 1)) return "ranked";
    if (r.brand_in_sources) return "source";
    if (r.brand_mentioned === true || r.brand_mentioned === 1) return "mention";
    return null;
  };
  const withRanked      = results.filter(r => getPresType(r) === "ranked").length;
  const withSourceOnly  = results.filter(r => getPresType(r) === "source").length;
  const withMentionOnly = results.filter(r => getPresType(r) === "mention").length;

  // ── TrendChart — basé sur les résultats + geo_calendar_dates ─────
  // Combinaison des deux sources pour toujours avoir une tendance à jour :
  // 1. calendarEntries : entrées DB détaillées (par test)
  // 2. results : résultats en mémoire (toujours à jour après un run)
  const calByDate = {};

  // Source 1 : geo_calendar_dates (données historiques précises)
  calendarEntries.forEach(e => {
    const d = e.test_date || (e.created_at || "").slice(0, 10);
    if (!d) return;
    if (!calByDate[d]) calByDate[d] = { tested: 0, present: 0, mentions: 0, citations: 0, evocations: 0 };
    calByDate[d].tested++;
    if (e.brand_present === true || e.brand_present === 1) calByDate[d].present++;
    // Ventilation M/É/C depuis les champs étendus si disponibles
    if (e.brand_mention_position != null) calByDate[d].mentions++;
    else if (e.brand_in_sources) calByDate[d].citations++;
    else if (e.brand_present === true || e.brand_present === 1) calByDate[d].evocations++;
  });

  // Source 2 : résultats en mémoire — TOUJOURS ventiler M/É/C
  // On crée l'entrée si elle n'existe pas (nouveaux jours sans calendarEntries)
  // ET on enrichit les entrées existantes avec la ventilation précise
  const calByDateFromResults = {};
  results.forEach(r => {
    const d = (r.created_at || "").slice(0, 10);
    if (!d) return;
    if (!calByDateFromResults[d]) calByDateFromResults[d] = { tested: 0, present: 0, mentions: 0, citations: 0, evocations: 0 };
    calByDateFromResults[d].tested++;
    if (r.brand_mention_position != null || (r.brand_position != null && r.brand_position > 0)) {
      calByDateFromResults[d].mentions++;
      calByDateFromResults[d].present++;
    } else if (r.brand_in_sources) {
      calByDateFromResults[d].citations++;
      calByDateFromResults[d].present++;
    } else if (r.brand_mentioned === true || r.brand_mentioned === 1) {
      calByDateFromResults[d].evocations++;
      calByDateFromResults[d].present++;
    }
  });
  // Fusionner : calendarEntries a priorité pour tested/present (historique précis)
  // mais les results fournissent toujours la ventilation M/É/C
  Object.entries(calByDateFromResults).forEach(([d, rv]) => {
    if (!calByDate[d]) {
      // Jour non couvert par calendarEntries → utiliser les results directement
      calByDate[d] = rv;
    } else {
      // Enrichir la ventilation M/É/C sans toucher tested/present (déjà calculés)
      calByDate[d].mentions  = rv.mentions;
      calByDate[d].citations = rv.citations;
      calByDate[d].evocations= rv.evocations;
    }
  });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const trendDays = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const day = calByDate[key] || { tested: 0, present: 0 };
    trendDays.push({
      date: key,
      tested:    day.tested,
      present:   day.present,
      mentions:  day.mentions  || 0,
      citations: day.citations || 0,
      evocations:day.evocations|| 0,
      rate: day.tested > 0 ? pct(day.present, day.tested) : null,
    });
  }

  // ── URLs marque — normalisation et cumul ─────────────────────
  const brandTerms = [brandName, ...brandAliases]
    .filter(v => typeof v === "string" && v.trim())
    .map(t => t.toLowerCase());
  const isBrandTerm = (str) => brandTerms.some(t => t && String(str || "").toLowerCase().includes(t));

  // Pré-calculer les noms de concurrents normalisés (objets ou strings)
  const competitorNames = competitors
    .map(c => typeof c === "string" ? c : c?.name)
    .filter(Boolean)
    .map(name => name.toLowerCase());

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
    !isBrandTerm(u.norm) && competitorNames.some(name => u.norm.includes(name))
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
  // Chaque entrée concurrent : { name, mentioned, position, in_sources }
  // → Mention = position numérotée · Évocation = citée sans position · Citation = dans les sources
  results.forEach(r => (r.competitors_mentioned || []).forEach(c => {
    if (!c.name) return;
    if (!compStats[c.name]) compStats[c.name] = { mentions: 0, evocations: 0, citations: 0, positions: [], category: null, color: null };
    const st = compStats[c.name];
    const hasPos = c.position != null && c.position > 0;
    if (hasPos) { st.mentions++; st.positions.push(c.position); }
    else if (c.mentioned) { st.evocations++; }
    if (c.in_sources) { st.citations++; }
  }));

  // 2. Enrichir avec les concurrents qualifiés (catégorie + recherche rétroactive)
  competitors.forEach(comp => {
    const key = comp.name;
    if (!compStats[key]) compStats[key] = { mentions: 0, evocations: 0, citations: 0, positions: [], category: null, color: null, enabled: true };
    // Attacher la catégorie, la couleur et le statut actif depuis geo_competitors
    compStats[key].category = comp.category || "other";
    compStats[key].color    = comp.color || "#64748B";
    compStats[key].enabled  = comp.enabled !== false;
    // Recherche rétroactive dans les réponses non encore comptées
    const re = new RegExp(comp.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    results.forEach(r => {
      const alreadyCounted = (r.competitors_mentioned || []).some(c => c.name?.toLowerCase() === key.toLowerCase());
      if (!alreadyCounted && re.test(r.answer || "")) {
        // Apparition dans le texte sans position structurée → évocation
        compStats[key].evocations = (compStats[key].evocations || 0) + 1;
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
  // hasMention : présence dans un top numéroté — même logique que getPresType("ranked")
  const hasMention  = (q) => results.some(r => r.question_id === q.id && (
    r.brand_mention_position != null ||
    (r.brand_position != null && r.brand_position > 0 && (r.brand_mentioned === true || r.brand_mentioned === 1))
  ));

  const withResults = sortedQuestions.filter(hasResult);
  const withoutRes  = sortedQuestions.filter(q => !hasResult(q));

  // presentBrandQs : questions avec MENTION (top LLM) — max 10
  const presentBrandQs = withResults
    .filter(hasMention)
    .slice(0, 10)
    .map(q => ({ question: q.question, isFav: !!q.is_favorite, volume: kwVolMap[q.keyword_id] || 0 }));

  // missingBrandQs : "Questions sans mentions" — favoris d'abord, puis par volume — max 10
  const missingBrandQs = [
    ...withResults.filter(q => q.is_favorite && !hasMention(q)),
    ...withResults.filter(q => !q.is_favorite && !hasMention(q))
      .sort((a, b) => (kwVolMap[b.keyword_id] || 0) - (kwVolMap[a.keyword_id] || 0)),
    ...withoutRes.filter(q => q.is_favorite),
  ].slice(0, 10)
   .map(q => ({ question: q.question, isFav: !!q.is_favorite, volume: kwVolMap[q.keyword_id] || 0 }));

  const hasFavFilter = questions.some(q => q.is_favorite);
  const favCount = questions.filter(q => q.is_favorite).length;

  const leads = [];
  if (presenceRate < 30) leads.push({ priority: "🔴 Priorité haute", label: "Présence < 30%", action: "**Créer des contenus de recommandation** spécifiquement ciblés sur les questions sans présence. Structurez avec des listes comparatives explicites." });
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


  // ── Top 5 concurrents depuis les mentions ─────────────────────
  const top5Competitors = Object.entries(compStats)
    .sort((a, b) => (b[1].mentions + (b[1].evocations||0)) - (a[1].mentions + (a[1].evocations||0)))
    .slice(0, 5);

  // ── Analyse par catégorie des questions ───────────────────────
  const resultsByQ = {};
  results.forEach(r => {
    if (!resultsByQ[r.question_id]) resultsByQ[r.question_id] = [];
    resultsByQ[r.question_id].push(r);
  });
  const byQuestionCategory = {};
  questions.forEach(q => {
    const catIds = Array.isArray(q.tags) && q.tags.length > 0
      ? q.tags : (q.category_id ? [q.category_id] : ["__none__"]);
    catIds.forEach(catId => {
      if (!byQuestionCategory[catId]) byQuestionCategory[catId] = { total: 0, withBrand: 0, positions: [], qCount: 0 };
      const qResults = resultsByQ[q.id] || [];
      byQuestionCategory[catId].qCount++;
      byQuestionCategory[catId].total += qResults.length;
      qResults.forEach(r => {
        if (r.brand_mentioned === true || r.brand_mentioned === 1) byQuestionCategory[catId].withBrand++;
        const pos = r.brand_mention_position || r.brand_position;
        if (pos) byQuestionCategory[catId].positions.push(pos);
      });
    });
  });
  Object.keys(byQuestionCategory).forEach(catId => {
    const c = byQuestionCategory[catId];
    c.presenceRate = c.total ? Math.round(c.withBrand / c.total * 100) : 0;
    c.avgPos = c.positions.length ? (c.positions.reduce((a, b) => a + b, 0) / c.positions.length).toFixed(1) : null;
  });

  // ── URLs marque : 2 listes (propres + externes) ───────────────
  const brandDomainClean = (brand?.brand_domain || "").toLowerCase().replace("www.", "");
  const allBrandTerms = [brandName, ...brandAliases, brand?.brand_domain || ""].filter(Boolean).map(t => t.toLowerCase());
  const brandOwnUrls = sortedUrls.filter(u =>
    brandDomainClean && (u.url || "").toLowerCase().replace("www.", "").includes(brandDomainClean)
  ).slice(0, 15);
  const brandExternalUrls = sortedUrls.filter(u => {
    if (!u.url) return false;
    try {
      const parsed = new URL(u.url);
      const domain = parsed.hostname.replace("www.", "").toLowerCase();
      if (brandDomainClean && domain.includes(brandDomainClean)) return false;
      const slug = (parsed.pathname + parsed.search).toLowerCase();
      return allBrandTerms.some(t => t.length > 2 && slug.includes(t.replace(/\s+/g, "-")));
    } catch { return false; }
  }).slice(0, 10);

  return { total, withBrand, withSources, withRanked, withSourceOnly, withMentionOnly, avgPos, avgMentionPos, avgEvocationPos, avgCitationPos, mentionCount, evocationCount, citationCount, presenceRate, trendDays, sortedUrls, brandUrls, brandOwnUrls, brandExternalUrls, urlDetails, competitorUrls, referenceUrls, topDomains, intentCount, typeCount, compStats, top5Competitors, byQuestionCategory, urlsToOptimize, urlsToRework, urlsToInspire, leads, questions: questions.length, providerStats, missingBrandQs, presentBrandQs, hasFavFilter, favCount, _rawResults: results };
}


function TrendChart({ trendDays }) {
  const W = 620, H = 140, PAD = 32, PADT = 12, plotW = W - PAD - 12, plotH = H - PADT - 28;
  const active = trendDays.filter(d => d.tested > 0);
  if (!active.length) return (
    <div style={{ fontSize: 11, color: "#1A3C2E44", fontStyle: "italic", padding: "20px 0" }}>
      Aucun résultat enregistré ces 30 derniers jours.
    </div>
  );

  // ── Normaliser les données ─────────────────────────────────────
  // Si les données ventilées (M/É/C) ne sont pas encore en base,
  // on estime à partir de withRanked/withMentionOnly/withSourceOnly du jour
  // OU on utilise present comme proxy pour les 3 courbes si rien d'autre.
  const normalized = trendDays.map(d => {
    const tot = d.mentions + d.citations + d.evocations;
    if (tot > 0 || d.tested === 0) return d; // données ventilées disponibles
    // Pas encore de ventilation → estimer depuis present
    // (tous les présents comptent comme "évocations" au sens large)
    return {
      ...d,
      mentions:   0,
      citations:  0,
      evocations: d.present || 0,
    };
  });

  // Toujours afficher les 3 séries — les données sont normalisées ci-dessus
  const SERIES = [
    { key: "mentions",   label: "Mention",   color: "#1A7A4A" },
    { key: "evocations", label: "Évocation", color: "#C97820" },
    { key: "citations",  label: "Citation",  color: "#1A3C2E" },
  ];

  const yMax = Math.max(
    ...normalized.flatMap(d => SERIES.map(s => d[s.key] || 0)),
    ...normalized.map(d => d.tested || 0),
    2
  );
  const toX = (i) => PAD + (i / Math.max(normalized.length - 1, 1)) * plotW;
  const toY = (v) => PADT + plotH - (v / yMax) * plotH;
  const ticks = yMax <= 4
    ? [0, 1, 2, yMax].filter((v, i, a) => a.indexOf(v) === i)
    : [0, Math.round(yMax / 2), yMax];

  // Courbe tracée uniquement sur les jours avec au moins 1 résultat
  const makePath = (key) => {
    const pts = normalized
      .map((d, i) => ({ x: toX(i), y: toY(d[key] || 0), v: d[key] || 0, tested: d.tested }))
      .filter(p => p.tested > 0);
    if (pts.length < 1) return null;
    if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`; // point isolé
    return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  };

  // Courbe de volume total (tested) — grisée en fond
  const makeTestedPath = () => {
    const pts = normalized
      .map((d, i) => ({ x: toX(i), y: toY(d.tested || 0), tested: d.tested }))
      .filter(p => p.tested > 0);
    if (pts.length < 2) return null;
    return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  };

  return (
    <div>
      {/* Légende */}
      <div style={{ display: "flex", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
        {SERIES.map(s => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#1A3C2E55" }}>
            <span style={{ width: 16, height: 2, background: s.color, display: "inline-block", borderRadius: 1 }} />
            {s.label}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#1A3C2E33" }}>
          <span style={{ width: 16, height: 1.5, background: "#1A3C2E22", display: "inline-block", borderRadius: 1, borderTop: "1px dashed #1A3C2E33" }} />
          Interrogations
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
        {/* Grille */}
        {ticks.map(v => (
          <g key={v}>
            <line x1={PAD} x2={W - 12} y1={toY(v)} y2={toY(v)} stroke="#1A3C2E06" strokeWidth={1} />
            <text x={PAD - 5} y={toY(v) + 3} fontSize={7} fill="#1A3C2E28" textAnchor="end">{v}</text>
          </g>
        ))}
        {/* Axe X */}
        <line x1={PAD} x2={W - 12} y1={toY(0)} y2={toY(0)} stroke="#1A3C2E10" strokeWidth={1} />
        {/* Étiquettes dates */}
        {[0, 7, 14, 21, 29].map(i => (
          <text key={i} x={toX(i)} y={H - 6} fontSize={7} fill="#1A3C2E33" textAnchor="middle">
            {normalized[i]?.date?.slice(5)}
          </text>
        ))}

        {/* Courbe interrogations totales (fond) */}
        {(() => { const d = makeTestedPath(); return d ? <path d={d} fill="none" stroke="#1A3C2E18" strokeWidth={1} strokeDasharray="3,2" /> : null; })()}

        {/* Courbes M/É/C */}
        {SERIES.map(s => {
          const d = makePath(s.key);
          return d ? <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} /> : null;
        })}

        {/* Points par date — 3 points distincts par jour actif */}
        {normalized.map((day, i) => {
          if (!day.tested) return null;
          return (
            <g key={i}>
              {SERIES.map((s, si) => {
                const val = day[s.key] || 0;
                // Toujours afficher le point sur l'axe si val=0 (marque l'absence)
                const cy = toY(val);
                const isZero = val === 0;
                return (
                  <g key={s.key}>
                    {/* Tooltip simple — title SVG */}
                    <title>{s.label} : {val} · {day.date}</title>
                    <circle
                      cx={toX(i)}
                      cy={cy}
                      r={isZero ? 1.5 : 3}
                      fill={isZero ? "#1A3C2E18" : s.color}
                      stroke={isZero ? "none" : "#fff"}
                      strokeWidth={isZero ? 0 : 1}
                      opacity={isZero ? 0.4 : 0.9}
                    />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function AIAnalysis({ audit, brand, site, questions, onTextReady, projectId = null, siteId = null }) {
  const [status, setStatus] = useState("idle");
  const [analysis, setAnalysis] = useState("");
  const [savedDate, setSavedDate] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Recharger la dernière analyse IA persistée au montage
  useEffect(() => {
    if (!projectId || !siteId) return;
    let cancelled = false;
    sbGetGeoAnalyses(projectId, siteId, "audit-ai").then(rows => {
      if (cancelled || !rows?.length) return;
      const latest = rows[0];
      const txt = typeof latest.content === "string" ? latest.content : latest.content?.text;
      if (txt) {
        setAnalysis(txt);
        setStatus("done");
        setSavedDate(latest.created_at);
        onTextReady?.(txt);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = useCallback(async () => {
    setStatus("loading"); setAnalysis("");
    const summary = {
      site: site?.label, brand: brand?.brand_name,
      totalQuestions: audit.questions, totalResults: audit.total,
      presenceRate: audit.presenceRate + "%", avgPosition: audit.avgPos,
      topIntents: Object.entries(audit.intentCount).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}(${v})`).join(", "),
      competitors: Object.entries(audit.compStats).sort((a,b)=>b[1].mentions-a[1].mentions).slice(0,5).map(([k,v])=>`${k}(${v.mentions}x)`).join(", "),
      urlsToOptimize: audit.urlsToOptimize.slice(0,5).map(u => u.norm || u.url).join(", "),
      favorites: (() => {
        const favs = (questions || []).filter(q => q.is_favorite);
        if (!favs.length) return "aucune";
        const byQ = {};
        (audit._rawResults || []).forEach(r => { (byQ[r.question_id] = byQ[r.question_id] || []).push(r); });
        const ment = (qId) => (byQ[qId] || []).some(r => r.brand_mentioned);
        const presentFav = favs.filter(q => ment(q.id)).length;
        return `${favs.length} questions favorites (périmètre stratégique prioritaire), dont ${presentFav} avec présence marque`;
      })(),
    };
    const prompt = `Tu es un expert senior en SEO et GEO (Generative Engine Optimization). Tu maîtrises les études publiées par Moz, Ahrefs, Search Engine Land, Google, Bing, et les travaux académiques sur les LLMs. Produis un audit GEO expert et rigoureusement sourcé pour ${summary.site} / "${summary.brand}".

DONNÉES D'ANALYSE :
${JSON.stringify(summary, null, 2)}

CONSIGNES STRICTES :
- PRIORISE les recommandations qui concernent les questions favorites (périmètre stratégique du client, voir champ "favorites")
- Chaque recommandation concrète DOIT se terminer par [En savoir plus](URL) avec une vraie source reconnue (2022-2025)
- Sources autorisées : moz.com, ahrefs.com, searchengineland.com, developers.google.com, bing.com/webmasters, perplexity.ai/blog, etudes HubSpot, Nielsen, Semrush
- Citer le % ou chiffre exact de l'étude quand disponible
- Être précis sur les délais et résultats attendus

Sections OBLIGATOIRES (titres ## markdown) :

## 1. Synthèse exécutive
Présence GEO actuelle : ${summary.presenceRate}%. Diagnostic en 3 phrases. Ce qui fonctionne et ce qui bloque.

## 2. Analyse de la visibilité LLM
Analyse par provider avec taux de présence. Pourquoi ces providers citent ou ne citent pas la marque. Analyse des ${summary.withRanked} mentions vs ${summary.withMentionOnly} évocations vs ${summary.withSourceOnly} citations.

## 3. Analyse concurrentielle GEO
Positionnement réel vs concurrents cités. Ce qu'ils font pour être davantage mentionnés. 2-3 actions spécifiques de différenciation.

## 4. Plan d'action priorisé — 10 actions
Format strict pour chaque action :
**[HAUTE/MOYENNE/BASE] Titre de l'action**
Pourquoi : donnée précise justifiant l'action.
Comment : 2-3 étapes concrètes.
Résultat attendu : métrique chiffrée et délai.
[En savoir plus](URL_SOURCE)

## 5. KPIs à suivre
Cibles à 3 mois et 6 mois basées sur le score actuel de ${summary.presenceRate}%. Métriques GEO spécifiques (taux mention, position moyenne, couverture providers).

Commence DIRECTEMENT par ## 1. Synthèse exécutive.`;

    try {
      // Le proxy /api/anthropic rassemble le stream SSE côté serveur
      // et renvoie un JSON standard { content: [{ type:"text", text:"..." }] }
      const res = await fetch(ANTHROPIC_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: AUDIT_AI_MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
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
      const now = new Date().toISOString();
      setSavedDate(now);
      if (projectId && siteId) {
        sbSaveGeoAnalysis({ project_id: projectId, site_id: siteId, kind: "audit-ai", content: { text, generated_at: now } }).catch(() => {});
      }
    } catch(e) { console.error("[AIAnalysis]", e); setStatus("error"); }
  }, [audit, brand, site, questions, projectId, siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Édition manuelle du texte de l'audit
  const startEdit = () => { setDraft(analysis); setEditing(true); };
  const cancelEdit = () => { setEditing(false); setDraft(""); };
  const saveEdit = () => {
    const text = draft;
    setAnalysis(text);
    onTextReady?.(text);
    const now = new Date().toISOString();
    setSavedDate(now);
    setEditing(false);
    if (projectId && siteId) {
      sbSaveGeoAnalysis({ project_id: projectId, site_id: siteId, kind: "audit-ai", content: { text, generated_at: now, edited: true } }).catch(() => {});
    }
  };

  if (status === "idle") return (
    <div style={{ textAlign: "center", padding: "24px 0" }}>
      <div style={{ fontSize: 12, color: C.textLight, marginBottom: 12 }}>L'analyse IA utilise Claude pour interpréter vos données GEO.</div>
      <button onClick={generate} style={{ padding: "6px 16px", background: "#1A3C2E", color: "#F0EBE0", border: "0.5px solid #1A3C2E22", borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: "pointer" }}>Générer l'analyse IA</button>
    </div>
  );
  if (status === "loading" && !analysis) return <div style={{ textAlign: "center", padding: 24, color: C.textLight, fontSize: 12 }}>✦ Génération en cours…</div>;
  return (
    <div>
      {savedDate && (
        <div style={{ fontSize: 10, color: "#1A3C2E55", marginBottom: 10 }}>
          Analyse générée le {new Date(savedDate).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </div>
      )}
      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ width: "100%", minHeight: 320, fontSize: 12, lineHeight: 1.7, color: C.text, border: "0.5px solid #1A3C2E22", borderRadius: 8, padding: "12px 14px", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
          />
          <div style={{ fontSize: 10, color: "#1A3C2E44", marginTop: 6 }}>
            Astuce : « ## Titre » crée un titre de section, « **gras** » met en gras.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={saveEdit} style={{ padding: "5px 14px", border: "none", borderRadius: 6, background: "#1A3C2E", color: "#F0EBE0", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Enregistrer</button>
            <button onClick={cancelEdit} style={{ padding: "5px 14px", border: "0.5px solid #1A3C2E22", borderRadius: 6, background: "transparent", color: "#1A3C2E77", fontSize: 11, cursor: "pointer" }}>Annuler</button>
          </div>
        </div>
      ) : (
      <div style={{ fontSize: 12, lineHeight: 1.8, color: C.text }}>
        {analysis.split("\n").map((line, i) => {
          if (line.startsWith("## ")) return <div key={i} style={{ fontSize: 14, fontWeight: 800, color: C.text, marginTop: 20, marginBottom: 6, borderBottom: `2px solid ${C.border}`, paddingBottom: 4 }}>{line.slice(3)}</div>;
          if (line.startsWith("- ")) return <div key={i} style={{ paddingLeft: 16, marginBottom: 3 }}>• {renderBold(line.slice(2))}</div>;
          if (!line.trim()) return <div key={i} style={{ height: 8 }} />;
          return <div key={i} style={{ marginBottom: 4 }}>{renderBold(line)}</div>;
        })}
      </div>
      )}
      {status === "done" && !editing && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={generate} style={{ padding: "4px 12px", border: "0.5px solid #1A3C2E18", borderRadius: 6, background: "transparent", fontSize: 11, cursor: "pointer", color: "#1A3C2E55" }}>↺ Regénérer</button>
          <button onClick={startEdit} style={{ padding: "4px 12px", border: "0.5px solid #1A3C2E18", borderRadius: 6, background: "transparent", fontSize: 11, cursor: "pointer", color: "#1A3C2E55" }}>✎ Éditer</button>
        </div>
      )}
      {status === "error" && <div style={{ color: "#DC2626", fontSize: 11, marginTop: 8 }}>Erreur — réessayez.</div>}
    </div>
  );
}

// ── Matrice de corrélation interactive ───────────────────────────
// Calcule la corrélation de Pearson entre 2 vecteurs
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
  const num = xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0);
  const dx  = Math.sqrt(xs.reduce((s,x)=>s+(x-mx)**2,0));
  const dy  = Math.sqrt(ys.reduce((s,y)=>s+(y-my)**2,0));
  if (dx===0||dy===0) return null;
  return parseFloat((num/(dx*dy)).toFixed(3));
}

function CorrelationMatrix({ sfRows = [], gscRows = [], gaRows = [], bingData = {}, results, audit, sfCorrFilter, setSfCorrFilter }) {
  // ── Définitions des sources disponibles ──────────────────────
  const SOURCES = [
    { key: "fanout", label: "Fan-outs",       available: results.length > 0 },
    { key: "sf",     label: "Screaming Frog", available: sfRows.length > 0 },
    { key: "gsc",    label: "GSC",            available: gscRows.length > 0 },
    { key: "ga",     label: "Analytics",      available: gaRows.length > 0 },
    { key: "bing",   label: "Bing",           available: Object.keys(bingData || {}).length > 0 },
  ];

  const [srcA, setSrcA] = useState("sf");
  const [srcB, setSrcB] = useState("fanout");

  // ── Calculer la matrice selon les 2 sources choisies ─────────
  const matrix = useMemo(() => {
    // ── Présence GEO par URL citée ────────────────────────────────
    // On rapproche chaque source d'outils avec le GEO PAR LA MÊME CLÉ (URL).
    // Corréler par index de position (ancien bug) n'avait aucun sens car
    // les questions GEO et les URLs d'outils sont des entités différentes.
    //
    // geoByUrl[urlPath] = taux de citation de cette URL dans les réponses LLM
    const geoByUrl = {};
    (results || []).forEach(r => {
      (r.sources || []).forEach(src => {
        const u = typeof src === "string" ? src : (src?.url || src?.link || "");
        const p = urlPath(u);
        if (!p) return;
        if (!geoByUrl[p]) geoByUrl[p] = { citations: 0 };
        geoByUrl[p].citations++;
      });
    });

    // Helper : corrélation entre une métrique d'outil (par URL) et les citations GEO (par URL)
    // sur l'INTERSECTION des URLs présentes dans les deux jeux.
    const corrByUrl = (toolIdx, metricKey) => {
      const xs = [], ys = [];
      Object.entries(toolIdx).forEach(([p, m]) => {
        if (geoByUrl[p] === undefined) return; // URL absente du GEO → exclue
        const xv = m[metricKey];
        if (xv == null || !Number.isFinite(xv)) return;
        xs.push(xv);
        ys.push(geoByUrl[p].citations);
      });
      return { r: pearson(xs, ys), n: xs.length };
    };

    // ── Construire les index d'outils par URL ─────────────────────
    const sfIdx = {}; (sfRows || []).forEach(row => { const s = sfRowMetrics(row); const p = urlPath(s.url); if (p) sfIdx[p] = s; });
    const gscIdx = {}; (gscRows || []).forEach(row => { const g = gscRowMetrics(row); const p = urlPath(g.url); if (p) gscIdx[p] = g; });
    const gaIdx  = {}; (gaRows  || []).forEach(row => { const g = gaRowMetrics(row);  const p = urlPath(g.url); if (p) gaIdx[p]  = g; });

    // ── SF × GEO ───────────────────────────────────────────────────
    if ((srcA === "sf" || srcB === "sf") && (srcA === "fanout" || srcB === "fanout")) {
      const dims = [
        { key: "inlinks",    label: "Liens entrants" },
        { key: "crawlDepth", label: "Profondeur de crawl" },
        { key: "wordCount",  label: "Nombre de mots" },
        { key: "titleLen",   label: "Longueur du title" },
        { key: "metaLen",    label: "Longueur meta desc." },
        { key: "flesch",     label: "Lisibilité (Flesch)" },
      ];
      return dims.map(d => { const { r, n } = corrByUrl(sfIdx, d.key); return { dimA: d.label, dimB: "Citations GEO", r, n }; })
        .filter(x => x.r !== null).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    }

    // ── GSC × GEO ──────────────────────────────────────────────────
    if ((srcA === "gsc" || srcB === "gsc") && (srcA === "fanout" || srcB === "fanout")) {
      const dims = [
        { key: "clicks",      label: "Clics GSC" },
        { key: "impressions", label: "Impressions GSC" },
        { key: "ctr",         label: "CTR GSC" },
        { key: "position",    label: "Position GSC" },
      ];
      return dims.map(d => { const { r, n } = corrByUrl(gscIdx, d.key); return { dimA: d.label, dimB: "Citations GEO", r, n }; })
        .filter(x => x.r !== null).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    }

    // ── GA × GEO ───────────────────────────────────────────────────
    if ((srcA === "ga" || srcB === "ga") && (srcA === "fanout" || srcB === "fanout")) {
      const dims = [
        { key: "sessions",    label: "Sessions GA" },
        { key: "views",       label: "Vues GA" },
        { key: "conversions", label: "Conversions GA" },
        { key: "revenue",     label: "Revenus GA" },
      ];
      return dims.map(d => { const { r, n } = corrByUrl(gaIdx, d.key); return { dimA: d.label, dimB: "Citations GEO", r, n }; })
        .filter(x => x.r !== null).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    }

    // ── SF × GSC (croisement technique × SEO, par URL) ─────────────
    if ((srcA === "sf" || srcB === "sf") && (srcA === "gsc" || srcB === "gsc")) {
      const rows = [];
      const pairs = [
        { sf: "wordCount", g: "clicks",      label: "Nb mots × Clics" },
        { sf: "inlinks",   g: "impressions", label: "Liens entrants × Impressions" },
        { sf: "crawlDepth",g: "position",    label: "Profondeur × Position" },
      ];
      pairs.forEach(pr => {
        const px = [], py = [];
        Object.entries(sfIdx).forEach(([p, s]) => {
          const g = gscIdx[p]; if (!g) return;
          const xv = s[pr.sf], yv = g[pr.g];
          if (xv == null || yv == null) return;
          px.push(xv); py.push(yv);
        });
        const r = pearson(px, py);
        if (r !== null) rows.push({ dimA: pr.label.split(" × ")[0], dimB: pr.label.split(" × ")[1], r, n: px.length });
      });
      return rows.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    }

    // ── Bing × GEO : pas d'alignement par URL fiable → afficher un message via tableau vide ──
    if (srcA === "bing" || srcB === "bing") {
      return [];
    }

    return [];
  }, [srcA, srcB, sfRows, gscRows, gaRows, bingData, results]); // eslint-disable-line react-hooks/exhaustive-deps

  const srcADef = SOURCES.find(s=>s.key===srcA);
  const srcBDef = SOURCES.find(s=>s.key===srcB);

  return (
    <div>
      {/* Sélecteur 2 sources */}
      <div className="audit-corr-sources">
        <div>
          <div style={{ fontSize: 10, color: "#1A3C2E44", marginBottom: 5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase" }}>Source A</div>
          <div className="audit-corr-source-btns">
            {SOURCES.map(s => (
              <button key={s.key} onClick={() => { setSrcA(s.key); if (s.key === srcB) setSrcB(srcA); }}
                disabled={!s.available}
                style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, cursor: s.available ? "pointer" : "not-allowed",
                  border: "0.5px solid " + (srcA===s.key ? "#1A3C2E" : "#1A3C2E22"),
                  background: srcA===s.key ? "#1A3C2E" : "transparent",
                  color: srcA===s.key ? "#F0EBE0" : s.available ? "#1A3C2E77" : "#1A3C2E22",
                  fontWeight: srcA===s.key ? 500 : 400,
                }}>
                {s.label}{!s.available ? " ·" : ""}
              </button>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 18, color: "#1A3C2E22", fontWeight: 300 }}>×</div>
        <div>
          <div style={{ fontSize: 10, color: "#1A3C2E44", marginBottom: 5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase" }}>Source B</div>
          <div style={{ display: "flex", gap: 4 }}>
            {SOURCES.filter(s => s.key !== srcA).map(s => (
              <button key={s.key} onClick={() => setSrcB(s.key)}
                disabled={!s.available}
                style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, cursor: s.available ? "pointer" : "not-allowed",
                  border: "0.5px solid " + (srcB===s.key ? "#1A7A4A" : "#1A3C2E22"),
                  background: srcB===s.key ? "#1A7A4A" : "transparent",
                  color: srcB===s.key ? "#F0EBE0" : s.available ? "#1A3C2E77" : "#1A3C2E22",
                  fontWeight: srcB===s.key ? 500 : 400,
                }}>
                {s.label}{!s.available ? " ·" : ""}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Légende */}
      <div style={{ display: "flex", gap: 16, marginBottom: 14, fontSize: 10, color: "#1A3C2E44" }}>
        <span><span style={{ fontWeight: 600, color: "#1A7A4A" }}>▲ ≥ 0.4</span> Corrélation forte positive</span>
        <span><span style={{ fontWeight: 600, color: "#C0352A" }}>▼ ≤ -0.4</span> Corrélation forte négative</span>
        <span><span style={{ color: "#1A3C2E33" }}>±0.1–0.4</span> Corrélation faible</span>
      </div>

      {/* Matrice */}
      {matrix.length === 0 ? (
        <div style={{ fontSize: 11, color: "#1A3C2E44", fontStyle: "italic", padding: "12px 0" }}>
          {(srcA === "bing" || srcB === "bing")
            ? "La corrélation avec Bing n'est pas fiable : les données Bing ne sont pas alignables par URL avec la présence GEO. Croisez plutôt SF, GSC ou GA avec les Fan-outs."
            : srcADef?.available && srcBDef?.available
            ? `Aucune URL commune entre ${srcADef.label} et ${srcBDef.label} (corrélation calculée sur l'intersection des URLs). Vérifiez que les exports couvrent les mêmes pages.`
            : `Importez ${!srcADef?.available ? srcADef?.label : srcBDef?.label} dans Setup pour activer cette corrélation.`}
        </div>
      ) : (
        <div className="audit-corr-table-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "0.5px solid #1A3C2E12" }}>
                <th style={{ padding: "7px 0", textAlign: "left", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1A3C2E44" }}>{srcADef?.label}</th>
                <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1A7A4A" }}>{srcBDef?.label}</th>
                <th style={{ padding: "7px 12px", textAlign: "center", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1A3C2E44" }}>Corrélation r</th>
                <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1A3C2E44" }}>Intensité</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row, i) => {
                const r = row.r;
                const pos = r > 0;
                const abs = Math.abs(r);
                const strong = abs >= 0.4;
                const barW = Math.round(abs * 100);
                const color = strong ? (pos ? "#1A7A4A" : "#C0352A") : (pos ? "#1A7A4A88" : "#C0352A88");
                return (
                  <tr key={i} style={{ borderBottom: "0.5px solid #1A3C2E06" }}>
                    <td style={{ padding: "7px 0", color: "#1A3C2E", fontSize: 11 }}>{row.dimA}</td>
                    <td style={{ padding: "7px 12px", color: "#1A3C2E77", fontSize: 11 }}>{row.dimB}</td>
                    <td style={{ padding: "7px 12px", textAlign: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: strong ? 700 : 500, color }}>
                        {pos ? "▲" : "▼"} {r > 0 ? "+" : ""}{r.toFixed(2)}
                      </span>
                    </td>
                    <td style={{ padding: "7px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 60, height: 4, background: "#1A3C2E08", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ width: `${barW}%`, height: "100%", background: color, borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 9, color: "#1A3C2E44" }}>
                          {abs >= 0.7 ? "Très forte" : abs >= 0.4 ? "Forte" : abs >= 0.2 ? "Modérée" : "Faible"}
                          {row.n != null && <span style={{ marginLeft: 6, color: row.n < 10 ? "#C0352A88" : "#1A3C2E33" }}>n={row.n}{row.n < 10 ? " ⚠" : ""}</span>}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ── Analyseur de pages concurrentes ──────────────────────────
function CompetitorPageAnalyzer({ competitors, audit, claudeKey }) {
  const [selected, setSelected] = useState(null);  // nom du concurrent sélectionné
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("idle"); // "idle" | "loading" | "done" | "error"
  const [result, setResult] = useState(null);

  // Pré-remplir l'URL quand on sélectionne un concurrent
  const handleSelect = (name) => {
    setSelected(name);
    setResult(null);
    setStatus("idle");
    // Chercher le domaine dans les URL sources du concurrent
    const comp = competitors.find(c => c.name === name);
    const guessDomain = comp?.domain || comp?.website ||
      Object.entries(audit.compStats[name]?.urls || {})
        .sort((a,b) => b[1]-a[1])[0]?.[0] || "";
    setUrl(guessDomain ? `https://${guessDomain.replace(/^https?:\/\//, "")}` : "");
  };

  const analyze = async () => {
    if (!url || !claudeKey || !selected) return;
    setStatus("loading"); setResult(null);
    const compStats = audit.compStats[selected] || {};
    const prompt = `Tu es expert GEO (Generative Engine Optimization). Analyse cette page concurrente et produis un rapport structuré.

CONCURRENT : ${selected}
URL analysée : ${url}
Données de présence LLM :
- Mentions (tops LLM) : ${compStats.mentions || 0}
- Évocations (corps texte) : ${compStats.evocations || 0}
- Citations (sources) : ${compStats.citations || 0}
- Position moy. : ${compStats.positions?.length ? (compStats.positions.reduce((a,b)=>a+b,0)/compStats.positions.length).toFixed(1) : "—"}

En imaginant que tu analyses la page ${url}, produis exactement 4 sections :

## POURQUOI LES LLM LES CITENT
[2-3 raisons concrètes basées sur leur présence mesurée : autorité, structure, format des contenus]

## FORCES DE LEUR CONTENU GEO
[3-4 points forts que tu inféres de leurs performances LLM : exhaustivité, format, données, maillage]

## LACUNES ET ANGLES À EXPLOITER
[3-4 angles non couverts ou faiblement couverts qu'Altaroc pourrait exploiter pour dépasser ce concurrent]

## ACTIONS PRIORITAIRES
[3 actions concrètes avec format : "Créer/Optimiser/Publier [X] pour [objectif GEO]"]

Commence DIRECTEMENT par ## POURQUOI LES LLM LES CITENT. Sois précis et actionnable.`;

    try {
      const res = await fetch("/api/claude-geo", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Claude-Key": claudeKey },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
      });
      const raw = await res.text();
      if (raw.trimStart().startsWith("<")) throw new Error("Proxy claude-geo introuvable");
      const data = JSON.parse(raw);
      if (!res.ok) throw new Error(data.error?.message || `Erreur ${res.status}`);
      const text = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n").trim();
      const sections = text.split(/^## /m).filter(Boolean).map(s => {
        const nl = s.indexOf("\n");
        return { title: s.slice(0, nl).trim(), body: s.slice(nl+1).trim() };
      });
      setResult(sections);
      setStatus("done");
    } catch(e) {
      setResult([{ title: "Erreur", body: e.message }]);
      setStatus("error");
    }
  };

  const compNames = Object.keys(audit.compStats || {}).filter(k => (audit.compStats[k].mentions||0) + (audit.compStats[k].evocations||0) > 0).slice(0, 10);
  if (!compNames.length) return (
    <div style={{ fontSize: 11, color: "#1A3C2E44", fontStyle: "italic", paddingTop: 8 }}>
      Interrogez des questions pour détecter des concurrents.
    </div>
  );

  const SECTION_COLORS = {
    "POURQUOI LES LLM LES CITENT": "#1A3C2E",
    "FORCES DE LEUR CONTENU GEO":  "#1A7A4A",
    "LACUNES ET ANGLES":            "#C97820",
    "ACTIONS PRIORITAIRES":         "#1A3C2E",
  };
  const getSectionColor = (title) => {
    const key = Object.keys(SECTION_COLORS).find(k => title.includes(k));
    return SECTION_COLORS[key] || "#1A3C2E77";
  };

  return (
    <div style={{ paddingTop: 16, borderTop: "0.5px solid #1A3C2E0C", marginTop: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "#1A3C2E44", marginBottom: 10 }}>Analyser un concurrent</div>

      {/* Sélecteur concurrent */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {compNames.map(name => (
          <button key={name} onClick={() => handleSelect(name)} style={{
            padding: "4px 11px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "0.5px solid #1A3C2E22",
            background: selected === name ? "#1A3C2E" : "transparent",
            color: selected === name ? "#F0EBE0" : "#1A3C2E77",
            fontWeight: selected === name ? 500 : 400,
          }}>{name}</button>
        ))}
      </div>

      {/* URL + lancer */}
      {selected && (
        <div className="audit-comp-analyzer-input">
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder={`https://${selected.toLowerCase().replace(/\s+/g,"-")}.com`}
            style={{ flex: 1, fontSize: 11, padding: "5px 10px", border: "0.5px solid #1A3C2E18", borderRadius: 6, outline: "none", color: "#1A3C2E", background: "#fff" }}
          />
          <button onClick={analyze} disabled={!url || !claudeKey || status === "loading"}
            style={{ padding: "5px 14px", background: (!url||!claudeKey||status==="loading") ? "transparent" : "#1A3C2E", color: (!url||!claudeKey||status==="loading") ? "#1A3C2E44" : "#F0EBE0", border: "0.5px solid #1A3C2E22", borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: (!url||!claudeKey||status==="loading") ? "not-allowed" : "pointer" }}>
            {status === "loading" ? "Analyse…" : "Analyser"}
          </button>
        </div>
      )}

      {/* Résultats */}
      {status === "done" && result && (
        <div style={{ borderTop: "0.5px solid #1A3C2E0C", paddingTop: 14 }}>
          {result.map((s, i) => (
            <div key={i} style={{ borderLeft: `2px solid ${getSectionColor(s.title)}22`, paddingLeft: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.10em", textTransform: "uppercase", color: getSectionColor(s.title), marginBottom: 5 }}>{s.title}</div>
              <div style={{ fontSize: 12, color: "#1A3C2E", lineHeight: 1.7 }}>
                {s.body.split("\n").map((line, j) => {
                  if (!line.trim()) return <div key={j} style={{ height: 4 }} />;
                  if (line.startsWith("- ") || line.startsWith("• ")) return <div key={j} style={{ paddingLeft: 10, marginBottom: 2 }}>· {renderBold(line.slice(2))}</div>;
                  return <div key={j} style={{ marginBottom: 2 }}>{renderBold(line)}</div>;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {status === "error" && result && (
        <div style={{ fontSize: 11, color: "#C0352A", paddingTop: 8 }}>{result[0]?.body}</div>
      )}
    </div>
  );
}


// ── AuditHintPanel — hint GEO par question dans l'Audit ──────────
// Reprend le même fonctionnement que HintPanelQuestion dans GeoTab
function AuditHintPanel({ question, claudeKey, brandName }) {
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [hint, setHint]     = useState("");
  const [open, setOpen]     = useState(false);

  const run = async () => {
    if (!claudeKey || status === "loading") return;
    setStatus("loading"); setOpen(false);

    const prompt = `Tu es un expert GEO (Generative Engine Optimization). La marque "${brandName}" n'apparaît pas dans les réponses LLM à la question suivante :

"${question}"

Produis une recommandation GEO courte et directement actionnable (5-7 lignes max) :
- Identifie pourquoi la marque est absente
- Suggère 2-3 actions concrètes (type de contenu, format, structure) pour y apparaître
- Commence directement par la recommandation, sans intro

Sois précis et cite des formats concrets (liste, FAQ, comparatif, données chiffrées, etc.).`;

    try {
      const res = await fetch("/api/claude-geo", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Claude-Key": claudeKey },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 500,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const raw = await res.text();
      const data = JSON.parse(raw);
      if (!res.ok) throw new Error(data.error?.message || `Claude ${res.status}`);
      const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
      setHint(text || "Aucune recommandation générée.");
      setStatus("done");
      setOpen(true);
    } catch(e) {
      setHint(`Erreur : ${e.message}`);
      setStatus("error");
      setOpen(true);
    }
  };

  return (
    <div style={{ borderTop: "0.5px solid #1A3C2E06", marginTop: 4, paddingTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {hint ? (
          <button onClick={() => setOpen(o => !o)}
            style={{ fontSize: 10, color: "#C97820", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.02em" }}>
            <span>💡</span>
            <span>{open ? "▲ Masquer le hint" : "▼ Voir le hint"}</span>
          </button>
        ) : (
          <button onClick={run} disabled={!claudeKey || status === "loading"}
            style={{ fontSize: 10, color: claudeKey ? "#C97820" : "#1A3C2E33", background: "none", border: "none", cursor: claudeKey ? "pointer" : "not-allowed", padding: 0, display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.02em", opacity: status === "loading" ? 0.6 : 1 }}
            title={!claudeKey ? "Clé Claude manquante" : undefined}>
            <span>💡</span>
            <span>{status === "loading" ? "Génération…" : "Générer un hint GEO"}</span>
          </button>
        )}
        {hint && (
          <button onClick={run} disabled={status === "loading"}
            style={{ fontSize: 9, color: "#1A3C2E33", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            title="Regénérer">↺</button>
        )}
      </div>
      {open && hint && (
        <div style={{ marginTop: 6, padding: "8px 10px", background: "#FFFBEB", border: "0.5px solid #C9782022", borderRadius: 6, fontSize: 11, lineHeight: 1.7, color: status === "error" ? "#C0352A" : "#92400E" }}>
          {status === "error" ? hint : hint.split("\n").map((line, i) => {
            if (!line.trim()) return <div key={i} style={{ height: 4 }} />;
            if (line.startsWith("- ") || line.startsWith("• ")) return <div key={i} style={{ paddingLeft: 10, marginBottom: 2 }}>· {line.slice(2)}</div>;
            return <div key={i} style={{ marginBottom: 2 }}>{line}</div>;
          })}
        </div>
      )}
    </div>
  );
}


function FanoutAnalysis({ questions, results, brand, claudeKey, projectId = null, siteId = null }) {
  const [status, setStatus] = useState("idle");
  const [sections, setSections] = useState([]);
  const [open, setOpen] = useState(false);
  const [savedDate, setSavedDate] = useState(null);

  const brandName   = brand?.brand_name   || "";
  const brandDomain = brand?.brand_domain || "";
  const brandAliases = brand?.brand_aliases || [];

  // Recharger la dernière analyse fan-out persistée
  useEffect(() => {
    if (!projectId || !siteId) return;
    let cancelled = false;
    sbGetGeoAnalyses(projectId, siteId, "audit-fanout").then(rows => {
      if (cancelled || !rows?.length) return;
      const c = rows[0].content;
      if (c?.sections?.length) {
        setSections(c.sections);
        setStatus("done");
        setSavedDate(rows[0].created_at);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!claudeKey || !results.length) return;
    setStatus("loading"); setSections([]); setOpen(true);

    const total     = results.length;
    const withBrand = results.filter(r => r.brand_mentioned === true || r.brand_mentioned === 1).length;
    const withSrc   = results.filter(r => r.brand_in_sources).length;
    const positions = results.filter(r => r.brand_position).map(r => r.brand_position);
    const avgPos    = positions.length ? (positions.reduce((a,b)=>a+b,0)/positions.length).toFixed(1) : null;
    const presence  = total ? Math.round(withBrand/total*100) : 0;

    const qMap = {}; questions.forEach(q => { qMap[q.id] = q.question; });
    const missing = [...new Set(results.filter(r=>!(r.brand_mentioned===true||r.brand_mentioned===1)).map(r=>qMap[r.question_id]).filter(Boolean))].slice(0,8);
    const present = [...new Set(results.filter(r=>r.brand_mentioned===true||r.brand_mentioned===1).map(r=>qMap[r.question_id]).filter(Boolean))].slice(0,5);

    const compCount = {};
    results.forEach(r => (r.competitors_mentioned||[]).forEach(c=>{ if(c.name) compCount[c.name]=(compCount[c.name]||0)+1; }));
    const topComps = Object.entries(compCount).sort((a,b)=>b[1]-a[1]).slice(0,5);

    const urlCount = {};
    results.forEach(r=>(r.sources||[]).forEach(url=>{ urlCount[url]=(urlCount[url]||0)+1; }));
    const allTerms = [brandName,...brandAliases].filter(Boolean).map(t=>t.toLowerCase());
    const brandUrls2 = Object.entries(urlCount).filter(([u])=>allTerms.some(t=>u.toLowerCase().includes(t))).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const competitorUrls2 = Object.entries(urlCount).filter(([u])=>!allTerms.some(t=>u.toLowerCase().includes(t))).sort((a,b)=>b[1]-a[1]).slice(0,10);

    const provStats = {};
    results.forEach(r=>{
      const pid = (r.model||"").toLowerCase().includes("openai")||(r.model||"").toLowerCase().includes("gpt")?"OpenAI":(r.model||"").toLowerCase().includes("gemini")?"Gemini":(r.model||"").toLowerCase().includes("perplexity")||(r.model||"").toLowerCase().includes("sonar")?"Perplexity":(r.model||"").toLowerCase().includes("claude")?"Claude":"Autre";
      if(!provStats[pid]) provStats[pid]={total:0,withBrand:0};
      provStats[pid].total++;
      if(r.brand_mentioned===true||r.brand_mentioned===1) provStats[pid].withBrand++;
    });

    const prompt = `Tu es un expert GEO (Generative Engine Optimization) senior. Analyse la présence de "${brandName}" (${brandDomain||"—"}) dans les LLMs et produis des recommandations précises et actionnables.

DONNÉES DE PRÉSENCE :
- Présence totale : ${withBrand}/${total} réponses (${presence}%)
- Citée en source : ${withSrc} fois
- Position moyenne : ${avgPos ? "#"+avgPos : "non mesurée"}

PAR PROVIDER :
${Object.entries(provStats).map(([p,s])=>`- ${p}: ${s.withBrand}/${s.total} (${Math.round(s.withBrand/s.total*100)}%)`).join("\n")}

QUESTIONS AVEC PRÉSENCE (${present.length}) :
${present.map((q,i)=>`${i+1}. ${q}`).join("\n")||"Aucune"}

QUESTIONS SANS PRÉSENCE — PRIORITÉS (${missing.length}) :
${missing.map((q,i)=>`${i+1}. ${q}`).join("\n")||"Aucune"}

QUESTIONS FAVORITES — PÉRIMÈTRE STRATÉGIQUE (${(questions||[]).filter(q=>q.is_favorite).length}) :
${(questions||[]).filter(q=>q.is_favorite).map((q,i)=>`${i+1}. ${q.question}`).join("\n")||"Aucune"}
(Priorise EXPLICITEMENT les recommandations qui concernent ces questions favorites.)

TOP CONCURRENTS CITÉS :
${topComps.map(([n,c])=>`- ${n}: ${c}×`).join("\n")||"Aucun"}

URLS MARQUE EN SOURCE :
${brandUrls2.map(([u,c])=>`- ${u} (${c}×)`).join("\n")||"Aucune"}

TOP URLS CONCURRENTES :
${competitorUrls2.slice(0,8).map(([u,c])=>`- ${u} (${c}×)`).join("\n")||"Aucune"}

---

Produis exactement 4 sections dans ce format :

## ÉTAT DES LIEUX
[Diagnostic factuel en 4-5 points. Cite les chiffres exacts. Compare les providers.]

## MAILLAGE INTERNE — PAGES À RELIER
[2-4 recommandations de maillage interne sur ${brandDomain||"le site"} basées sur les thèmes des questions sans présence.]

## PAGES À CRÉER OU ADAPTER
[3-5 pages à créer/adapter. Pour chaque : H1 suggéré + angle éditorial + question cible.]

## URLS CONCURRENTES — CE QUI FONCTIONNE
[Pour 3-5 URLs concurrentes les plus citées : pourquoi les LLMs les citent et comment reproduire.]

RÈGLES : Commence DIRECTEMENT par ## ÉTAT DES LIEUX. Recommandations concrètes avec H1 suggérés. Pas de généralités.`;

    try {
      const res = await fetch("/api/claude-geo", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Claude-Key": claudeKey },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1800, messages: [{ role: "user", content: prompt }] }),
      });
      const raw = await res.text();
      if (raw.trimStart().startsWith("<")) throw new Error("Proxy claude-geo introuvable");
      const data = JSON.parse(raw);
      if (!res.ok) throw new Error(data.error?.message || `Claude ${res.status}`);
      const text = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n").trim();
      const parsed = text.split(/^## /m).filter(Boolean).map(s => {
        const idx = s.indexOf("\n");
        return { title: s.slice(0, idx).trim(), body: s.slice(idx+1).trim() };
      });
      setSections(parsed);
      setStatus("done");
      const now = new Date().toISOString();
      setSavedDate(now);
      if (projectId && siteId) {
        sbSaveGeoAnalysis({ project_id: projectId, site_id: siteId, kind: "audit-fanout", content: { sections: parsed, generated_at: now } }).catch(() => {});
      }
    } catch(e) {
      setSections([{ title: "Erreur", body: e.message }]);
      setStatus("error");
    }
  };

  const SECTION_META = {
    "ÉTAT DES LIEUX":    { icon: "◎", color: "#1A3C2E" },
    "MAILLAGE INTERNE":  { icon: "⟶", color: "#1A3C2E" },
    "PAGES À CRÉER":     { icon: "✦", color: "#C97820" },
    "URLS CONCURRENTES": { icon: "↗", color: "#1A3C2E77" },
  };
  const getMeta = (title) => {
    const key = Object.keys(SECTION_META).find(k => title.includes(k));
    return SECTION_META[key] || { icon: "·", color: "#1A3C2E77" };
  };

  if (!results.length) return null;

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: open && status === "done" ? 16 : 0 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "#1A3C2E55", marginBottom: 3 }}>Analyse GEO</div>
          <div style={{ fontSize: 13, color: "#1A3C2E", letterSpacing: "-0.005em" }}>Recommandations actionnables · {results.length} réponses</div>
          {savedDate && <div style={{ fontSize: 10, color: "#1A3C2E55", marginTop: 2 }}>Dernière analyse : {new Date(savedDate).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {status === "done" && (
            <button onClick={() => setOpen(o => !o)}
              style={{ padding: "4px 12px", border: "0.5px solid #1A3C2E18", borderRadius: 6, background: "transparent", cursor: "pointer", fontSize: 11, color: "#1A3C2E77" }}>
              {open ? "Masquer" : "Voir l'analyse"}
            </button>
          )}
          <button onClick={run} disabled={status === "loading" || !claudeKey}
            style={{ padding: "5px 14px", background: (!claudeKey || status === "loading") ? "transparent" : "#1A3C2E", color: (!claudeKey || status === "loading") ? "#1A3C2E44" : "#F0EBE0", border: "0.5px solid #1A3C2E22", borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: (!claudeKey || status === "loading") ? "not-allowed" : "pointer" }}
            title={!claudeKey ? "Clé Claude manquante" : undefined}>
            {status === "loading" ? "Analyse…" : status === "done" ? "↺ Relancer" : "Analyser"}
          </button>
        </div>
      </div>

      {open && status === "done" && sections.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 0, borderTop: "0.5px solid #1A3C2E0D", paddingTop: 16 }}>
          {sections.map((s, i) => {
            const meta = getMeta(s.title);
            if (s.title === "Erreur") return <div key={i} style={{ fontSize: 12, color: "#C0352A", padding: "10px 0" }}>{s.body}</div>;
            return (
              <div key={i} style={{ borderLeft: "2px solid #1A3C2E0D", paddingLeft: 16, paddingBottom: 16, marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: meta.color, fontWeight: 500 }}>{meta.icon}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.10em", textTransform: "uppercase", color: meta.color }}>{s.title}</span>
                </div>
                <div style={{ fontSize: 12, color: "#1A3C2E", lineHeight: 1.75 }}>
                  {s.body.split("\n").map((line, j) => {
                    if (!line.trim()) return <div key={j} style={{ height: 6 }} />;
                    if (line.startsWith("- ") || line.startsWith("• ")) return <div key={j} style={{ paddingLeft: 12, marginBottom: 3 }}>· {renderBold(line.slice(2))}</div>;
                    return <div key={j} style={{ marginBottom: 3 }}>{renderBold(line)}</div>;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  const scoreLabel = audit.presenceRate >= 70 ? "Excellente présence" : audit.presenceRate >= 50 ? "Bonne présence" : audit.presenceRate >= 30 ? "Potentiel à développer" : "Potentiel à exploiter";

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
    <div class="score-sub">Présence GEO</div>
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
    (s.positions && s.positions.length) ? (s.positions.reduce((a, b) => a + b, 0) / s.positions.length).toFixed(1) : "—",
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



// ── Analyse concurrentielle IA (forces/faiblesses) — pour l'export ──
// Appelle Claude pour qualifier chaque concurrent détecté. Best-effort.
async function generateCompetitorAnalysis(audit, brand, claudeKey) {
  if (!claudeKey || !audit.top5Competitors?.length) return null;
  const brandName = brand?.brand_name || "la marque";
  const compLines = audit.top5Competitors.map(([name, s]) => {
    const avgP = s.positions?.length ? (s.positions.reduce((a,b)=>a+b,0)/s.positions.length).toFixed(1) : "—";
    return `- ${name} : ${s.mentions} mentions, position moy. #${avgP}`;
  }).join("\n");

  const prompt = `Tu es un expert GEO. Voici les concurrents de "${brandName}" détectés dans les réponses des IA génératives :

${compLines}

Pour CHAQUE concurrent, produis une analyse courte de ses forces et de son angle (pourquoi les LLM le citent). Réponds UNIQUEMENT en JSON valide, sans markdown :
{
  "competitors": [
    { "name": "nom exact", "strengths": "2-3 forces concrètes (formats de contenu, positionnement)", "angle": "angle de différenciation pour rivaliser" }
  ]
}
Ordre identique à la liste. Réponds en français, concis.`;

  try {
    const res = await fetch("/api/claude-geo", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Claude-Key": claudeKey },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1400, messages: [{ role: "user", content: prompt }] }),
    });
    const raw = await res.text();
    if (raw.trimStart().startsWith("<")) return null;
    const data = JSON.parse(raw);
    if (!res.ok) return null;
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}"); parsed = JSON.parse(cleaned.slice(s, e + 1)); }
    return parsed?.competitors || null;
  } catch { return null; }
}

// ── Export PRÉSENTATION — restitution client structurée ──────────
// Synthèse des structures Silvera (deck pro) × audit ICE.
// Sections : Cover · Sommaire · État des lieux · Forces/Opportunités par catégorie ·
//            Sources & URLs · Concurrents (data + IA) · Roadmap ICE · Synthèse
async function exportPresentation(audit, brand, site, questions, results, roadmapData, claudeKey, categories = []) {
  const brandName = brand?.brand_name || "Marque";
  const dateStr   = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const dateFile  = new Date().toLocaleDateString("fr-FR").replace(/\//g, "-");

  const S = {
    green: "#1A3C2E", greenMid: "#2D5A42", greenLight: "#4A8C6A", greenPale: "#EAF2ED",
    cream: "#F5F0E8", creamDark: "#E8E0CE", ink: "#1C1C1C", inkMid: "#4A4A4A", inkLight: "#909090",
    white: "#FFFFFF", ok: "#2D6A4F", okBg: "#D8F3DC", warn: "#92400E", warnBg: "#FEF3C7",
    danger: "#9B2335", dangerBg: "#FCE4E8", accent: "#E8541A", accentBg: "#FCEBE3",
  };

  const scoreColor = audit.presenceRate >= 70 ? S.ok : audit.presenceRate >= 50 ? S.green : audit.presenceRate >= 30 ? S.warn : S.danger;
  const scoreLabel = audit.presenceRate >= 70 ? "Excellente présence" : audit.presenceRate >= 50 ? "Bonne présence" : audit.presenceRate >= 30 ? "Potentiel à développer" : "Potentiel à exploiter";

  // Map catégories id -> nom
  const catName = {};
  (categories || []).forEach(c => { catName[c.id] = c.name; });

  // ── Analyse concurrentielle IA (async, best-effort) ──
  const compAI = await generateCompetitorAnalysis(audit, brand, claudeKey);
  const compAIMap = {};
  (compAI || []).forEach(c => { compAIMap[(c.name || "").toLowerCase()] = c; });

  // ── Catégories : forces (marque domine) vs opportunités (faible présence) ──
  const catRows = Object.entries(audit.byQuestionCategory || {})
    .filter(([cid]) => cid !== "__none__")
    .map(([cid, s]) => {
      const rate = s.total ? Math.round((s.withBrand / s.total) * 100) : 0;
      return { name: catName[cid] || "Sans catégorie", rate, qCount: s.qCount, withBrand: s.withBrand, total: s.total };
    })
    .sort((a, b) => b.rate - a.rate);
  const catForces = catRows.filter(c => c.rate >= 50);
  const catOpportunities = catRows.filter(c => c.rate < 50);

  // ── Forces & faiblesses ──
  const forces = [];
  const faiblesses = [];
  if (audit.presenceRate >= 50) forces.push(`Présence GEO solide : ${audit.presenceRate}% des réponses LLM citent la marque.`);
  if (audit.avgMentionPos && parseFloat(audit.avgMentionPos) <= 3) forces.push(`Excellent positionnement : #${audit.avgMentionPos} en moyenne dans les tops.`);
  if (audit.withRanked > 0) forces.push(`${audit.withRanked} réponses placent la marque dans un top numéroté.`);
  if (catForces.length) forces.push(`Autorité sur ${catForces.length} catégorie${catForces.length > 1 ? "s" : ""} : ${catForces.slice(0,3).map(c=>c.name).join(", ")}.`);
  if (audit.brandOwnUrls?.length > 0) forces.push(`${audit.brandOwnUrls.length} URLs du domaine propre citées comme sources.`);

  if (audit.presenceRate < 30) faiblesses.push(`Présence GEO faible : seulement ${audit.presenceRate}% des réponses citent la marque.`);
  if (audit.missingBrandQs?.length > 0) faiblesses.push(`${audit.missingBrandQs.length} questions sans aucune mention de la marque.`);
  if (catOpportunities.length) faiblesses.push(`${catOpportunities.length} catégorie${catOpportunities.length > 1 ? "s" : ""} à conquérir : ${catOpportunities.slice(0,3).map(c=>c.name).join(", ")}.`);
  const topComp = audit.top5Competitors?.[0];
  if (topComp) faiblesses.push(`Concurrent dominant : ${topComp[0]} (${topComp[1]?.mentions || 0}× mentions).`);
  if (audit.urlsToOptimize?.length > 0) faiblesses.push(`${audit.urlsToOptimize.length} URLs à optimiser (citées sans être en source).`);
  if (!forces.length) forces.push("Données en cours de constitution — relancez des interrogations.");
  if (!faiblesses.length) faiblesses.push("Aucune faiblesse majeure sur le périmètre actuel.");

  // ── Roadmap ICE ──
  let roadmap = [];
  if (roadmapData?.roadmap?.length) {
    roadmap = roadmapData.roadmap.map(r => ({ action: r.action, category: r.category || "—", impact: r.impact || 0, confidence: r.confidence || 0, ease: r.ease || 0 }));
  } else if (audit.leads?.length) {
    roadmap = audit.leads.map(l => {
      const high = l.priority?.includes("🔴"), mid = l.priority?.includes("🟠") || l.priority?.includes("🟡");
      return { action: (l.action || l.label || "").replace(/\*\*/g, ""), category: l.label || "—", impact: high ? 9 : mid ? 6 : 4, confidence: 7, ease: high ? 5 : 6 };
    });
  }
  roadmap.sort((a, b) => (b.impact + b.confidence + b.ease) - (a.impact + a.confidence + a.ease));
  const iceColor = (s) => s >= 24 ? S.ok : s >= 18 ? S.warn : S.inkLight;

  // ── Analyse « Et maintenant ? » (générée dans Suivi GEO) : constats + opportunités ──
  const hasNextSteps = !!(roadmapData && (roadmapData.brandAnalysis || roadmapData.categoryAnalysis?.length || roadmapData.summary));
  const nsConstats = roadmapData?.summary || roadmapData?.brandAnalysis || "";
  const nsBrand = (roadmapData?.brandAnalysis && roadmapData.brandAnalysis !== nsConstats) ? roadmapData.brandAnalysis : "";
  const nsCats = Array.isArray(roadmapData?.categoryAnalysis) ? roadmapData.categoryAnalysis : [];
  const esc2 = (t) => String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // ── Favoris catégorisés (logique NextStepsAnalysis) ──
  const resultsByQ = {};
  results.forEach(r => { (resultsByQ[r.question_id] = resultsByQ[r.question_id] || []).push(r); });
  const brandPosOf = (qId) => { const rs = resultsByQ[qId] || []; const ps = rs.map(r => r.brand_mention_position || r.brand_position).filter(p => p != null && p > 0); return ps.length ? Math.min(...ps) : null; };
  const isMentioned = (qId) => (resultsByQ[qId] || []).some(r => r.brand_mentioned === true || r.brand_mentioned === 1);
  const favs = questions.filter(q => q.is_favorite);
  const BUCKET_LABELS = { defend: "À défendre", watch: "À surveiller", conquest_priority: "Conquête prioritaire", conquer: "À conquérir" };
  const bucketOf = (q) => { const pos = brandPosOf(q.id), ment = isMentioned(q.id), kw = q.keyword_id; if (ment && pos != null && pos <= 3) return "defend"; if (ment && pos != null && pos >= 4 && pos <= 10) return "watch"; if (!ment && kw) return "conquest_priority"; return "conquer"; };
  const favByBucket = { defend: [], watch: [], conquest_priority: [], conquer: [] };
  favs.forEach(q => { favByBucket[bucketOf(q)].push({ q: q.question, pos: brandPosOf(q.id) }); });

  // ── Sources par type de page (depuis urlDetails / topDomains) ──
  const topDomainsRows = Object.entries(audit.topDomains || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // ── Concurrents : data réelle + IA ──
  const compRows = (audit.top5Competitors || []).map(([name, s]) => {
    const avgP = s.positions?.length ? "#" + (s.positions.reduce((a,b)=>a+b,0)/s.positions.length).toFixed(1) : "—";
    const ai = compAIMap[name.toLowerCase()];
    return { name, mentions: s.mentions, avgP, strengths: ai?.strengths || "", angle: ai?.angle || "" };
  });

  // ── CSS ──
  const css = `
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:${S.ink}; background:${S.white}; line-height:1.5; }
    .cover { background:${S.green}; color:${S.cream}; padding:72px 64px 56px; display:flex; flex-direction:column; gap:36px; }
    .cover-tag { font-size:11px; letter-spacing:0.2em; text-transform:uppercase; opacity:0.65; }
    .cover h1 { font-family:Georgia,serif; font-size:48px; font-weight:400; letter-spacing:-0.01em; margin-top:6px; }
    .cover-sub { font-size:15px; opacity:0.85; margin-top:4px; }
    .cover-kpis { display:flex; gap:18px; flex-wrap:wrap; }
    .cover-kpi { flex:1; min-width:120px; border-left:2px solid ${S.greenLight}; padding-left:14px; }
    .cover-kpi-val { font-size:30px; font-weight:700; letter-spacing:-0.01em; }
    .cover-kpi-lbl { font-size:11px; opacity:0.7; text-transform:uppercase; letter-spacing:0.05em; margin-top:2px; }
    .cover-meta { font-size:12px; opacity:0.55; }
    .toc { padding:40px 64px; background:${S.cream}; }
    .toc-title { font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:${S.inkLight}; margin-bottom:18px; }
    .toc-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px 40px; }
    .toc-item { display:flex; gap:12px; align-items:baseline; font-size:14px; }
    .toc-num { font-family:Georgia,serif; color:${S.greenLight}; font-weight:700; min-width:24px; }
    .content { padding:48px 64px 56px; }
    .section-hd { display:flex; align-items:center; gap:14px; margin:48px 0 22px; }
    .section-hd:first-child { margin-top:0; }
    .section-num { width:34px; height:34px; border-radius:50%; background:${S.green}; color:${S.cream}; font-size:14px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
    .section-title { font-family:Georgia,serif; font-size:24px; font-weight:400; color:${S.green}; }
    .scorecard { display:flex; align-items:center; gap:22px; padding:26px; border-radius:14px; background:${S.greenPale}; margin-bottom:22px; }
    .score-big { font-size:54px; font-weight:800; letter-spacing:-0.02em; line-height:1; }
    .score-label { font-size:16px; font-weight:600; }
    .score-sub { font-size:12px; color:${S.inkMid}; margin-top:3px; }
    .kpi-row { display:flex; gap:14px; flex-wrap:wrap; }
    .kpi { flex:1; min-width:120px; padding:16px 18px; border:1px solid ${S.creamDark}; border-radius:12px; }
    .kpi-val { font-size:26px; font-weight:700; letter-spacing:-0.01em; }
    .kpi-label { font-size:10px; color:${S.inkLight}; text-transform:uppercase; letter-spacing:0.05em; margin-top:4px; }
    table { width:100%; border-collapse:collapse; margin:12px 0; font-size:13px; }
    th { text-align:left; padding:9px 12px; background:${S.green}; color:${S.cream}; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; font-weight:600; }
    th.c, td.c { text-align:center; }
    td { padding:9px 12px; border-bottom:1px solid ${S.cream}; vertical-align:top; }
    tr:nth-child(even) td { background:#FBF9F5; }
    .ice-badge { display:inline-block; min-width:30px; padding:2px 8px; border-radius:10px; font-weight:700; font-size:12px; color:${S.white}; }
    .cat-pill { display:inline-block; padding:1px 9px; border-radius:10px; font-size:11px; font-weight:600; background:${S.greenPale}; color:${S.green}; }
    .cat-pill.brand { background:${S.green}; color:${S.cream}; }
    .twocol { display:flex; gap:18px; }
    .twocol > div { flex:1; }
    .card-list { padding:18px 20px; border-radius:12px; }
    .card-list.forces { background:${S.okBg}; } .card-list.opp { background:${S.accentBg}; }
    .card-list h3 { font-size:12px; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:12px; }
    .card-list.forces h3 { color:${S.ok}; } .card-list.opp h3 { color:${S.accent}; }
    .card-list .row { display:flex; justify-content:space-between; gap:10px; font-size:13px; margin-bottom:7px; }
    .card-list .row b { font-variant-numeric:tabular-nums; }
    .fw-grid { display:flex; gap:18px; }
    .fw-col { flex:1; padding:20px 22px; border-radius:12px; }
    .fw-col.forces { background:${S.okBg}; } .fw-col.faib { background:${S.dangerBg}; }
    .fw-col h3 { font-size:13px; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:12px; }
    .fw-col.forces h3 { color:${S.ok}; } .fw-col.faib h3 { color:${S.danger}; }
    .fw-col li { font-size:13px; margin-bottom:9px; padding-left:18px; position:relative; list-style:none; }
    .fw-col.forces li:before { content:"✓"; position:absolute; left:0; color:${S.ok}; font-weight:700; }
    .fw-col.faib li:before { content:"!"; position:absolute; left:0; color:${S.danger}; font-weight:700; }
    .bucket { margin-bottom:14px; } .bucket-hd { font-size:12px; font-weight:700; margin-bottom:5px; display:flex; align-items:center; gap:7px; }
    .bucket-dot { width:8px; height:8px; border-radius:50%; } .bucket li { font-size:12px; color:${S.inkMid}; margin-bottom:3px; padding-left:16px; list-style:none; }
    .synthese { background:${S.green}; color:${S.cream}; padding:40px 64px; }
    .synthese h2 { font-family:Georgia,serif; font-size:28px; font-weight:400; margin-bottom:16px; }
    .synthese li { font-size:14px; margin-bottom:8px; list-style:none; padding-left:22px; position:relative; }
    .synthese li:before { content:"→"; position:absolute; left:0; opacity:0.6; }
    .footer { padding:22px 64px; border-top:1px solid ${S.creamDark}; font-size:11px; color:${S.inkLight}; display:flex; justify-content:space-between; }
    @media print { .section-hd { page-break-after:avoid; } table, .fw-grid, .twocol, .scorecard { page-break-inside:avoid; } }
  `;

  const TOC = [
    "État des lieux", "Forces & opportunités par sujet", "Sources & URLs citées",
    "Analyse concurrentielle",
    ...(hasNextSteps ? ["Analyse — Et maintenant ?"] : []),
    "Plan d'action priorisé — Roadmap ICE", "Synthèse",
  ];

  const cover = `<div class="cover">
    <div><div class="cover-tag">Audit GEO · Generative Engine Optimization</div>
      <h1>${brandName}</h1>
      <div class="cover-sub">${site?.label || ""}${site?.domain ? " · " + site.domain : ""}</div></div>
    <div class="cover-kpis">
      <div class="cover-kpi"><div class="cover-kpi-val" style="color:${audit.presenceRate >= 50 ? "#A8E6C0" : "#F0C8A0"}">${audit.presenceRate}%</div><div class="cover-kpi-lbl">Présence IA</div></div>
      <div class="cover-kpi"><div class="cover-kpi-val">${audit.withBrand}</div><div class="cover-kpi-lbl">Réponses avec marque</div></div>
      <div class="cover-kpi"><div class="cover-kpi-val">${(audit.brandUrls?.length || 0)}</div><div class="cover-kpi-lbl">URLs citées</div></div>
      <div class="cover-kpi"><div class="cover-kpi-val">${audit.total}</div><div class="cover-kpi-lbl">Réponses analysées</div></div>
    </div>
    <div class="cover-meta">${dateStr} · Sonate</div>
  </div>`;

  const toc = `<div class="toc"><div class="toc-title">Sommaire</div><div class="toc-grid">${
    TOC.map((t, i) => `<div class="toc-item"><span class="toc-num">0${i+1}</span><span>${t}</span></div>`).join("")
  }</div></div>`;

  // BLOC 1 — État des lieux
  const providersRows = Object.entries(audit.providerStats || {}).map(([pid, s]) => [pid, `${s.withBrand}/${s.total}`, `${pct(s.withBrand, s.total)}%`]);
  const bloc1 = `
    <div class="section-hd"><div class="section-num">1</div><div class="section-title">État des lieux</div></div>
    <div class="scorecard"><div class="score-big" style="color:${scoreColor}">${audit.presenceRate}%</div>
      <div><div class="score-label" style="color:${scoreColor}">${scoreLabel}</div>
      <div class="score-sub">${audit.withBrand} réponses sur ${audit.total} citent ${brandName}</div></div></div>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-val" style="color:${S.green}">${audit.mentionCount || 0}</div><div class="kpi-label">Mentions · #${audit.avgMentionPos || "—"} moy.</div></div>
      <div class="kpi"><div class="kpi-val" style="color:${S.warn}">${audit.evocationCount || 0}</div><div class="kpi-label">Évocations</div></div>
      <div class="kpi"><div class="kpi-val" style="color:${S.green}">${audit.citationCount || 0}</div><div class="kpi-label">Citations · #${audit.avgCitationPos || "—"} moy.</div></div>
      <div class="kpi"><div class="kpi-val" style="color:${S.green}">${Object.keys(audit.providerStats || {}).length}</div><div class="kpi-label">Providers</div></div>
    </div>
    ${providersRows.length ? `<table><thead><tr><th>Provider</th><th class="c">Présence</th><th class="c">Taux</th></tr></thead><tbody>${providersRows.map(r => `<tr><td>${r[0]}</td><td class="c">${r[1]}</td><td class="c">${r[2]}</td></tr>`).join("")}</tbody></table>` : ""}
  `;

  // BLOC 2 — Forces & opportunités par sujet
  const bloc2 = `
    <div class="section-hd"><div class="section-num">2</div><div class="section-title">Forces &amp; opportunités par sujet</div></div>
    <div class="twocol">
      <div class="card-list forces"><h3>✓ Sujets maîtrisés (≥ 50% présence)</h3>${
        catForces.length ? catForces.slice(0,8).map(c => `<div class="row"><span>${c.name}</span><b>${c.rate}% · ${c.qCount} Q</b></div>`).join("") : `<div style="font-size:12px;color:${S.inkMid}">Aucune catégorie dominée pour l'instant.</div>`
      }</div>
      <div class="card-list opp"><h3>◷ Opportunités (&lt; 50% présence)</h3>${
        catOpportunities.length ? catOpportunities.slice(0,8).map(c => `<div class="row"><span>${c.name}</span><b>${c.rate}% · ${c.qCount} Q</b></div>`).join("") : `<div style="font-size:12px;color:${S.inkMid}">Toutes les catégories sont bien couvertes.</div>`
      }</div>
    </div>
  `;

  // BLOC 3 — Sources & URLs
  const bloc3 = `
    <div class="section-hd"><div class="section-num">3</div><div class="section-title">Sources &amp; URLs citées</div></div>
    <div class="kpi-row" style="margin-bottom:14px;">
      <div class="kpi"><div class="kpi-val">${audit.brandOwnUrls?.length || 0}</div><div class="kpi-label">URLs domaine propre</div></div>
      <div class="kpi"><div class="kpi-val">${audit.brandExternalUrls?.length || 0}</div><div class="kpi-label">URLs externes (marque)</div></div>
      <div class="kpi"><div class="kpi-val">${audit.competitorUrls?.length || 0}</div><div class="kpi-label">URLs concurrentes</div></div>
      <div class="kpi"><div class="kpi-val">${audit.referenceUrls?.length || 0}</div><div class="kpi-label">URLs de référence</div></div>
    </div>
    ${topDomainsRows.length ? `<table><thead><tr><th>Domaine le plus cité</th><th class="c">Citations</th></tr></thead><tbody>${
      topDomainsRows.map(([d, c]) => `<tr><td>${d}</td><td class="c">${c}×</td></tr>`).join("")
    }</tbody></table>` : ""}
  `;

  // BLOC 4 — Concurrents
  const bloc4 = `
    <div class="section-hd"><div class="section-num">4</div><div class="section-title">Analyse concurrentielle</div></div>
    ${compRows.length ? `<table><thead><tr><th>Concurrent</th><th class="c">Mentions</th><th class="c">Pos. moy.</th><th>Forces &amp; angle (IA)</th></tr></thead><tbody>${
      compRows.map(c => `<tr><td><b>${c.name}</b></td><td class="c">${c.mentions}×</td><td class="c">${c.avgP}</td><td>${
        c.strengths ? `${c.strengths}${c.angle ? `<br><span style="color:${S.accent}">→ ${c.angle}</span>` : ""}` : `<span style="color:${S.inkLight}">—</span>`
      }</td></tr>`).join("")
    }</tbody></table>` : `<div style="font-size:13px;color:${S.inkLight};padding:12px 0;">Aucun concurrent détecté dans les réponses analysées.</div>`}
  `;

  // BLOC ANALYSE — « Et maintenant ? » (récupérée de Suivi GEO) : constats + opportunités
  const blocAnalyse = hasNextSteps ? `
    <div class="section-hd"><div class="section-num">5</div><div class="section-title">Analyse — Et maintenant&nbsp;?</div></div>
    <div style="font-size:13px;color:${S.inkMid};margin-bottom:18px;">Synthèse stratégique issue de l'analyse « Et maintenant&nbsp;? » générée dans Suivi GEO.</div>

    <div style="margin-bottom:22px;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${S.green};margin-bottom:8px;">1 · Constats sur l'état GEO</div>
      <div style="font-size:13px;line-height:1.7;color:${S.ink};">${esc2(nsConstats) || "—"}</div>
      ${nsBrand ? `<div style="font-size:13px;line-height:1.7;color:${S.inkMid};margin-top:8px;">${esc2(nsBrand)}</div>` : ""}
    </div>

    <div style="margin-bottom:8px;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${S.accent};margin-bottom:8px;">2 · Pistes non exploitées &amp; opportunités</div>
      ${nsCats.length ? `<table><thead><tr><th>Sujet</th><th>Constat</th><th>Recommandation</th></tr></thead><tbody>${
        nsCats.map(c => `<tr><td><b>${esc2(c.category)}</b></td><td>${esc2(c.synthesis)}</td><td style="color:${S.accent}">${esc2(c.recommendation)}</td></tr>`).join("")
      }</tbody></table>` : `<div style="font-size:13px;color:${S.inkMid};">Aucune piste par sujet dans l'analyse. Les opportunités par catégorie figurent en section « Forces &amp; opportunités ».</div>`}
    </div>
  ` : "";

  // BLOC 5 — Roadmap ICE
  const roadmapRows = roadmap.map(r => {
    const ice = r.impact + r.confidence + r.ease;
    const isBrand = (r.category || "").toLowerCase() === "marque";
    return `<tr><td>${r.action}</td><td><span class="cat-pill${isBrand ? " brand" : ""}">${r.category}</span></td><td class="c">${r.impact}</td><td class="c">${r.confidence}</td><td class="c">${r.ease}</td><td class="c"><span class="ice-badge" style="background:${iceColor(ice)}">${ice}</span></td></tr>`;
  }).join("");
  const bucketDots = { defend: S.ok, watch: S.warn, conquest_priority: S.accent, conquer: S.inkLight };
  const favHtml = ["defend", "watch", "conquest_priority", "conquer"].map(b => {
    const items = favByBucket[b]; if (!items.length) return "";
    return `<div class="bucket"><div class="bucket-hd"><span class="bucket-dot" style="background:${bucketDots[b]}"></span>${BUCKET_LABELS[b]} · ${items.length}</div><ul>${items.map(it => `<li>${it.q}${it.pos ? ` (#${it.pos})` : ""}</li>`).join("")}</ul></div>`;
  }).join("");
  const bloc5 = `
    <div class="section-hd"><div class="section-num">6</div><div class="section-title">3 · Plan d'action priorisé — Roadmap ICE</div></div>
    <div style="font-size:13px; color:${S.inkMid}; margin-bottom:6px;">Priorisation par matrice ICE (Impact · Confidence · Ease). Score sur 30.</div>
    ${roadmap.length ? `<table><thead><tr><th>Action</th><th>Catégorie</th><th class="c">I</th><th class="c">C</th><th class="c">E</th><th class="c">ICE</th></tr></thead><tbody>${roadmapRows}</tbody></table>` : `<div style="font-size:13px;color:${S.inkLight};padding:12px 0;">Générez l'analyse « Et maintenant ? » dans l'onglet Suivi GEO pour une roadmap ICE détaillée.</div>`}
    ${favHtml ? `<div style="margin-top:24px;"><div style="font-size:13px;font-weight:600;color:${S.green};margin-bottom:10px;">Questions favorites par priorité</div>${favHtml}</div>` : ""}
  `;

  // BLOC 6 — Synthèse
  const synthese = `<div class="synthese">
    <div class="cover-tag" style="opacity:0.6;margin-bottom:10px;">En résumé</div>
    <h2>${audit.presenceRate >= 50 ? `${brandName} a une présence IA solide.` : `${brandName} a du potentiel à exploiter.`}</h2>
    <ul>
      <li>Score de présence : <b>${audit.presenceRate}%</b> sur ${audit.total} réponses analysées.</li>
      ${catForces.length ? `<li>Autorité établie sur : ${catForces.slice(0,3).map(c=>c.name).join(", ")}.</li>` : ""}
      ${catOpportunities.length ? `<li>${catOpportunities.length} sujets à conquérir où les concurrents sont mieux placés.</li>` : ""}
      ${topComp ? `<li>Concurrent à surveiller : ${topComp[0]}.</li>` : ""}
      <li>${roadmap.length} actions priorisées dans la roadmap ICE.</li>
    </ul>
  </div>`;

  const footer = `<div class="footer"><span>Audit GEO — ${brandName}</span><span>Sonate · ${dateStr}</span></div>`;

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Audit GEO — ${brandName} — ${dateStr}</title><style>${css}</style></head>
<body>${cover}${toc}<div class="content">${bloc1}${bloc2}${bloc3}${bloc4}${blocAnalyse}${bloc5}</div>${synthese}${footer}</body></html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const el = document.createElement("a");
  el.href = URL.createObjectURL(blob);
  el.download = `presentation-geo-${brandName.toLowerCase().replace(/\s+/g, "-")}-${dateFile}.html`;
  el.click();
  URL.revokeObjectURL(el.href);
}


// ── Section MODULES OUTILS — exploite SF/GSC/GA/Bing ─────────────
// Chaque module a un switch on/off et un export CSV contextuel.
function ToolModuleCard({ title, tier, icon, available, enabled, onToggle, count, children, onExport, exportLabel = "Exporter le lot" }) {
  const tierColor = tier === 1 ? "#1A7A4A" : tier === 2 ? "#C97820" : "#1A3C2E77";
  return (
    <div style={{ border: "0.5px solid #1A3C2E12", borderRadius: 10, marginBottom: 12, background: "#fff", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: enabled && available ? "0.5px solid #1A3C2E0C" : "none" }}>
        <span style={{ fontSize: 15 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1A3C2E" }}>{title}</span>
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.05em", color: tierColor, background: `${tierColor}14`, borderRadius: 8, padding: "1px 6px" }}>TIER {tier}</span>
            {available && count != null && <span style={{ fontSize: 10, color: "#1A3C2E44" }}>{count} résultat{count > 1 ? "s" : ""}</span>}
          </div>
          {!available && <div style={{ fontSize: 10, color: "#C0352A88", marginTop: 2 }}>Données manquantes — importez la source requise dans Setup</div>}
        </div>
        {/* Switch on/off */}
        <button
          onClick={() => available && onToggle()}
          disabled={!available}
          title={available ? (enabled ? "Désactiver ce module" : "Activer ce module") : "Source non importée"}
          style={{
            width: 38, height: 22, borderRadius: 11, border: "none", flexShrink: 0,
            background: !available ? "#1A3C2E11" : enabled ? "#1A7A4A" : "#1A3C2E22",
            position: "relative", cursor: available ? "pointer" : "not-allowed", transition: "background 0.15s",
          }}>
          <span style={{ position: "absolute", top: 2, left: enabled && available ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 2px #0002" }} />
        </button>
      </div>
      {enabled && available && (
        <div style={{ padding: "12px 16px" }}>
          {children}
          {onExport && count > 0 && (
            <button onClick={onExport} className="gt-btn gt-btn--ghost" style={{ fontSize: 10, padding: "4px 12px", marginTop: 10 }}>
              ↓ {exportLabel} ({count})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Mini-tableau compact réutilisable pour les modules
function ModuleTable({ columns, rows, limit = 8 }) {
  if (!rows?.length) return <div style={{ fontSize: 11, color: "#1A3C2E44", fontStyle: "italic" }}>Aucun résultat.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 420 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #1A3C2E18" }}>
            {columns.map(c => <th key={c.key} style={{ textAlign: c.num ? "center" : "left", padding: "5px 8px", fontWeight: 600, color: "#1A3C2E77", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((r, i) => (
            <tr key={i} style={{ borderBottom: "0.5px solid #1A3C2E0A" }}>
              {columns.map(c => (
                <td key={c.key} style={{ padding: "5px 8px", textAlign: c.num ? "center" : "left", color: c.accent ? "#C97820" : "#1A3C2E", fontVariantNumeric: c.num ? "tabular-nums" : "normal", maxWidth: c.key === "url" ? 220 : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: c.key === "url" ? "nowrap" : "normal" }}>
                  {c.fmt ? c.fmt(r[c.key], r) : (typeof r[c.key] === "boolean" ? (r[c.key] ? "Oui" : "Non") : r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && <div style={{ fontSize: 10, color: "#1A3C2E44", marginTop: 6 }}>+ {rows.length - limit} autres (export complet ci-dessous)</div>}
    </div>
  );
}

function ToolModulesSection({ audit, sfRows, gscRows, gaRows, bingData, brand }) {
  // État d'activation des modules (tous off par défaut sauf Tier 1)
  const [enabled, setEnabled] = useState({
    seoGap: true, unblock: true, business: true,       // Tier 1
    citability: false, orphan: false,                   // Tier 2
    aiTraffic: false, cannibal: false, bing: false,     // Tier 3
  });
  const toggle = (k) => setEnabled(e => ({ ...e, [k]: !e[k] }));

  const brandName = (brand?.brand_name || "marque").toLowerCase().replace(/\s+/g, "-");
  const dateF = new Date().toISOString().slice(0, 10);
  const citedSet = useMemo(() => new Set((audit.brandOwnUrls || audit.brandUrls || []).map(u => urlPath(typeof u === "string" ? u : (u.url || u.address || "")))), [audit]);

  // Calculs (mémoïsés, seulement si la source existe)
  const seoGap     = useMemo(() => gscRows?.length ? computeSeoGeoGap(audit, gscRows) : [], [audit, gscRows]);
  const unblock    = useMemo(() => sfRows?.length ? computePagesToUnblock(audit, sfRows) : [], [audit, sfRows]);
  const business   = useMemo(() => gaRows?.length ? computeBusinessValue(audit, gaRows) : null, [audit, gaRows]);
  const citability = useMemo(() => sfRows?.length ? computeCitabilityScores(sfRows, citedSet) : [], [sfRows, citedSet]);
  const orphan     = useMemo(() => sfRows?.length ? computeOrphanCited(audit, sfRows) : [], [audit, sfRows]);
  const aiTraffic  = useMemo(() => gaRows?.length ? computeAITraffic(gaRows) : null, [gaRows]);
  const cannibal   = useMemo(() => gscRows?.length ? computeReverseCannibalization(gscRows) : [], [gscRows]);
  const bingGap    = useMemo(() => Object.keys(bingData || {}).length ? computeBingGap(audit, bingData) : [], [audit, bingData]);

  const exp = (cols, rows, name) => downloadCSV(buildCSV(cols, rows), `${name}-${brandName}-${dateF}.csv`);

  const hasSF   = sfRows?.length > 0;
  const hasGSC  = gscRows?.length > 0;
  const hasGA   = gaRows?.length > 0;
  const hasBing = Object.keys(bingData || {}).length > 0;

  return (
    <div>
      <div style={{ fontSize: 11, color: "#1A3C2E66", marginBottom: 14, lineHeight: 1.5 }}>
        Croisez vos imports d'outils (Screaming Frog, Search Console, Analytics, Bing) avec la présence GEO. Activez les modules pertinents · chaque lot est exportable en CSV avec ses métriques.
      </div>

      {/* ── TIER 1 ── */}
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#1A7A4A", marginBottom: 8 }}>Tier 1 · Quick wins</div>

      <ToolModuleCard title="Écart SEO ↔ GEO" tier={1} icon="🔍" available={hasGSC} enabled={enabled.seoGap} onToggle={() => toggle("seoGap")} count={seoGap.length}
        onExport={() => exp(CSV_COLUMNS.seoGap, seoGap, "ecart-seo-geo")} exportLabel="Exporter les URLs">
        <div style={{ fontSize: 11, color: "#1A3C2E88", marginBottom: 8 }}>Pages performantes sur Google mais <strong>absentes des réponses IA</strong> — le contenu existe, il faut le rendre citable.</div>
        <ModuleTable columns={[{ key: "url", label: "URL" }, { key: "clicks", label: "Clics", num: true }, { key: "impressions", label: "Impr.", num: true }, { key: "position", label: "Pos.", num: true, fmt: v => v ? "#" + v.toFixed(0) : "—" }]} rows={seoGap} />
      </ToolModuleCard>

      <ToolModuleCard title="Pages citées à débloquer" tier={1} icon="🔧" available={hasSF} enabled={enabled.unblock} onToggle={() => toggle("unblock")} count={unblock.length}
        onExport={() => exp(CSV_COLUMNS.unblock, unblock, "pages-a-debloquer")} exportLabel="Exporter les URLs">
        <div style={{ fontSize: 11, color: "#1A3C2E88", marginBottom: 8 }}>URLs <strong>citées par l'IA</strong> mais freinées techniquement (indexabilité, profondeur, contenu court).</div>
        <ModuleTable columns={[{ key: "url", label: "URL" }, { key: "citations", label: "Cit. IA", num: true }, { key: "issues", label: "Freins", accent: true }]} rows={unblock} />
      </ToolModuleCard>

      <ToolModuleCard title="Valeur business des pages (GA)" tier={1} icon="💰" available={hasGA} enabled={enabled.business} onToggle={() => toggle("business")} count={business?.highValueNotCited?.length || 0}
        onExport={() => exp(CSV_COLUMNS.business, business?.highValueNotCited || [], "pages-valeur-non-citees")} exportLabel="Exporter les URLs">
        <div style={{ fontSize: 11, color: "#1A3C2E88", marginBottom: 8 }}>Pages à <strong>forte valeur business</strong> (sessions/revenus GA) mais non citées par l'IA — priorité absolue.</div>
        <ModuleTable columns={[{ key: "url", label: "URL" }, { key: "sessions", label: "Sessions", num: true }, business?.hasRevenue ? { key: "revenue", label: "Revenus", num: true } : { key: "views", label: "Vues", num: true }]} rows={business?.highValueNotCited || []} />
      </ToolModuleCard>

      {/* ── TIER 2 ── */}
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#C97820", margin: "18px 0 8px" }}>Tier 2 · Fort impact</div>

      <ToolModuleCard title="Score de citabilité (SF)" tier={2} icon="📐" available={hasSF} enabled={enabled.citability} onToggle={() => toggle("citability")} count={citability.length}
        onExport={() => exp(CSV_COLUMNS.citability, citability, "score-citabilite")} exportLabel="Exporter le lot">
        <div style={{ fontSize: 11, color: "#1A3C2E88", marginBottom: 8 }}>Note d'extractibilité par les LLM (structure, longueur, lisibilité). Les <strong>scores faibles</strong> sont vos quick wins.</div>
        <ModuleTable columns={[{ key: "url", label: "URL" }, { key: "score", label: "Score", num: true, fmt: v => v + "/100" }, { key: "wordCount", label: "Mots", num: true }, { key: "cited", label: "Citée", num: true, fmt: v => v ? "✓" : "—" }]} rows={citability} />
      </ToolModuleCard>

      <ToolModuleCard title="Contenus orphelins citables" tier={2} icon="🔗" available={hasSF} enabled={enabled.orphan} onToggle={() => toggle("orphan")} count={orphan.length}
        onExport={() => exp(CSV_COLUMNS.orphan, orphan, "contenus-orphelins")} exportLabel="Exporter les URLs">
        <div style={{ fontSize: 11, color: "#1A3C2E88", marginBottom: 8 }}>Pages citées par l'IA mais <strong>peu maillées</strong> en interne — renforcer les liens entrants.</div>
        <ModuleTable columns={[{ key: "url", label: "URL" }, { key: "inlinks", label: "Liens entrants", num: true }, { key: "crawlDepth", label: "Profondeur", num: true }]} rows={orphan} />
      </ToolModuleCard>

      {/* ── TIER 3 ── */}
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#1A3C2E77", margin: "18px 0 8px" }}>Tier 3 · Différenciants</div>

      <ToolModuleCard title="Trafic IA entrant (GA4)" tier={3} icon="📈" available={hasGA} enabled={enabled.aiTraffic} onToggle={() => toggle("aiTraffic")} count={aiTraffic?.rows?.length || 0}
        onExport={() => exp(CSV_COLUMNS.aiTraffic, aiTraffic?.rows || [], "trafic-ia-entrant")} exportLabel="Exporter le détail">
        <div style={{ fontSize: 11, color: "#1A3C2E88", marginBottom: 8 }}>Sessions réellement référées par les moteurs IA (ChatGPT, Perplexity, Gemini…). {!aiTraffic?.detected && <em>Aucune session IA détectée dans l'export GA actuel.</em>}</div>
        {aiTraffic?.detected && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            {Object.entries(aiTraffic.byEngine).map(([eng, s]) => (
              <div key={eng} style={{ fontSize: 11, padding: "4px 10px", border: "0.5px solid #1A3C2E12", borderRadius: 8 }}>{eng} · <strong>{s}</strong></div>
            ))}
          </div>
        )}
      </ToolModuleCard>

      <ToolModuleCard title="Cannibalisation inverse (GSC)" tier={3} icon="⚠️" available={hasGSC} enabled={enabled.cannibal} onToggle={() => toggle("cannibal")} count={cannibal.length}
        onExport={() => exp(CSV_COLUMNS.cannibal, cannibal, "cannibalisation-inverse")} exportLabel="Exporter les URLs">
        <div style={{ fontSize: 11, color: "#1A3C2E88", marginBottom: 8 }}>Pages bien positionnées mais <strong>faible CTR</strong> — l'IA capte probablement le clic. GEO défensif.</div>
        <ModuleTable columns={[{ key: "url", label: "URL" }, { key: "impressions", label: "Impr.", num: true }, { key: "ctr", label: "CTR %", num: true, fmt: v => v.toFixed(1) }, { key: "position", label: "Pos.", num: true, fmt: v => "#" + v.toFixed(0) }]} rows={cannibal} />
      </ToolModuleCard>

      <ToolModuleCard title="Comparatif Bing / Copilot" tier={3} icon="🅑" available={hasBing} enabled={enabled.bing} onToggle={() => toggle("bing")} count={bingGap.length}
        onExport={() => exp(CSV_COLUMNS.bing, bingGap, "comparatif-bing")} exportLabel="Exporter le lot">
        <div style={{ fontSize: 11, color: "#1A3C2E88", marginBottom: 8 }}>Présence Bing (alimente Copilot &amp; ChatGPT Search). Un écart fort signale un problème d'indexation Bing spécifique.</div>
        <ModuleTable columns={[{ key: "topic", label: "Sujet / URL" }, { key: "bingValue", label: "Présence Bing", num: true }]} rows={bingGap} />
      </ToolModuleCard>
    </div>
  );
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
  const [selectedSite, setSelectedSite] = useState(sites?.[0]?.id || "");
  // Sync selectedSite quand le projet change
  useEffect(() => {
    setSelectedSite(sites?.[0]?.id || "");
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [aiText, setAiText]             = useState("");
  const [roadmapData, setRoadmapData]   = useState(null);
  const [exporting, setExporting]       = useState(false);
  const [showTour, setShowTour]         = useState(false);
  const [sfCorrFilter, setSfCorrFilter] = useState("all"); // "all" | "gsc" | "bing" | "fanout"
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

  const refreshData = useCallback(() => {
    if (!projectId || !site?.id) return;
    setLoading(true);
    Promise.all([sbGetBrand(projectId, site.id), sbGetQuestions(projectId, site.id), sbGetGeoResults(projectId, site.id), sbGetUrlIndex(projectId), sbGetCalendarEntriesBatch(projectId, site.id), sbGetKeywords(projectId, site.id), sbGetCategories(projectId), sbGetCompetitors(projectId, site.id)])
      .then(([b, q, r, u, cal, kws, cats, comps]) => {
        setBrand(b); setQuestions(q); setResults(r); setUrlIndex(u);
        setCalendarEntries(cal || []); setKeywords(kws || []); setCategories(cats || []);
        // Init enabled : top-5 par mentions, le reste désactivé (seulement si aucun n'a été configuré)
        const compList = comps || [];
        const hasAnyConfig = compList.some(c => c.enabled === true || c.enabled === false);
        if (!hasAnyConfig && compList.length > 5) {
          // Top-5 par meilleure position moyenne (avgPos la plus basse = mieux placé)
          const sorted = [...compList].sort((a, b) => {
            const posA = (a.avg_position != null) ? a.avg_position : 9999;
            const posB = (b.avg_position != null) ? b.avg_position : 9999;
            return posA - posB;
          });
          const top5ids = new Set(sorted.slice(0, 5).map(c => c.id));
          setCompetitors(compList.map(c => ({ ...c, enabled: top5ids.has(c.id) })));
        } else {
          setCompetitors(compList);
        }
        setLoading(false);
      });
  }, [projectId, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refreshData(); }, [projectId, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Charger l'analyse roadmap "Et maintenant ?" (générée dans Fan-outs) pour l'export présentation
  useEffect(() => {
    if (!projectId || !site?.id) return;
    let cancelled = false;
    sbGetGeoAnalyses(projectId, site.id, "roadmap").then(rows => {
      if (!cancelled && rows?.length) setRoadmapData(rows[0].content);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, site?.id]);

  // Période de suivi (jours) — défaut 30 = 1 mois coulant. 0 = tout l'historique.
  const [periodDays, setPeriodDays] = useState(30);
  const siteResultsAll = useMemo(() => results.filter(r => r.site_id === site?.id), [results, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const siteResults   = useMemo(() => {
    if (!periodDays) return siteResultsAll;
    const since = Date.now() - periodDays * 86400000;
    const filtered = siteResultsAll.filter(r => {
      const t = r.created_at ? new Date(r.created_at).getTime() : null;
      return t == null ? true : t >= since;
    });
    return filtered.length ? filtered : siteResultsAll; // repli si la période ne retient rien
  }, [siteResultsAll, periodDays]);
  const siteQuestions = useMemo(() => questions.filter(q => q.site_id === site?.id), [questions, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const siteUrls      = useMemo(() => urlIndex.filter(u => u.project_id === projectId), [urlIndex, projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const audit         = useMemo(() => computeAudit(siteQuestions, siteResults, siteUrls, brand, site, calendarEntries, keywords, competitors), [siteQuestions, siteResults, siteUrls, brand, site, calendarEntries, keywords, competitors]);
  // ── Audit recalculé sur le sous-ensemble FAVORIS (affichage parallèle) ──
  const favQuestions  = useMemo(() => siteQuestions.filter(q => q.is_favorite), [siteQuestions]);
  const favQIds       = useMemo(() => new Set(favQuestions.map(q => q.id)), [favQuestions]);
  const favResults    = useMemo(() => siteResults.filter(r => favQIds.has(r.question_id)), [siteResults, favQIds]);
  const auditFav      = useMemo(() => favQuestions.length ? computeAudit(favQuestions, favResults, siteUrls, brand, site, calendarEntries, keywords, competitors) : null, [favQuestions, favResults, siteUrls, brand, site, calendarEntries, keywords, competitors]); // eslint-disable-line react-hooks/exhaustive-deps
  const noData        = !siteResults.length;


  // Démarrer le tour automatiquement si demandé (depuis HomeTab) — après loading et noData
  useEffect(() => {
    if (autoStartTour && !loading && !noData) { setShowTour(true); onTourStarted?.(); }
  }, [autoStartTour, loading, noData]); // eslint-disable-line react-hooks/exhaustive-deps

  const AUDIT_TOUR_STEPS = [
    {
      target: "audit-score",
      icon: "📊",
      title: "Présence GEO",
      desc: "Le score de présence GEO indique le % de réponses LLM où votre marque est citée. 3 types sont mesurés : Mention (dans un top numéroté), Évocation (corps du texte) et Citation (dans les sources). Visez > 50%.",
      tip: "Un score < 30% indique un fort potentiel à exploiter — consultez le Plan d'action.",
      position: "bottom",
      onActivate: () => setMainTab("audit"),
    },
    {
      target: "audit-visibility",
      icon: "📡",
      title: "Visibilité marque",
      desc: "Détaille la présence par provider LLM (OpenAI, Gemini, Perplexity, Claude) avec leur taux respectif. La tendance 30 jours montre l'évolution avec 3 courbes distinctes (Mention, Évocation, Citation). Les questions avec et sans présence sont listées.",
      tip: "Les questions sans mentions (✗) sont vos priorités — utilisez le 💡 Hint GEO pour chacune.",
      position: "bottom",
      onActivate: () => setMainTab("audit"),
    },
    {
      target: "audit-fanout",
      icon: "✦",
      title: "Analyse Fan-out IA",
      desc: "Claude analyse vos données de présence et produit 4 recommandations actionnables : État des lieux, Maillage interne à relier, Pages à créer ou adapter, URLs concurrentes à surveiller. Relancez après chaque batch d'interrogations.",
      tip: "Cette analyse est basée sur vos données réelles — plus vous interrogez de questions, plus elle est précise.",
      position: "top",
      onActivate: () => setMainTab("audit"),
    },
    {
      target: "audit-competitors",
      icon: "⚔️",
      title: "Paysage concurrentiel",
      desc: "Tableau Marque × Mention/Évocation/Citation pour votre marque (REF) et les 5 principaux concurrents détectés dans les réponses LLM. L'analyseur de pages permet de décrypter pourquoi un concurrent est plus cité.",
      tip: "Qualifiez vos concurrents dans Suivi GEO → Concurrents pour enrichir cette section.",
      position: "top",
      onActivate: () => setMainTab("audit"),
    },
    {
      target: "audit-corr",
      icon: "🔀",
      title: "Matrice de corrélation",
      desc: "Croisez 2 sources de données (Screaming Frog, GSC, Bing, Fan-outs) pour découvrir des corrélations entre vos métriques SEO/techniques et votre présence GEO. Le coefficient r va de -1 (corrélation négative) à +1 (positive).",
      tip: "Une corrélation forte SF × Fan-outs révèle quel critère technique influence le plus votre visibilité LLM.",
      position: "top",
      onActivate: () => setMainTab("audit"),
    },
    {
      target: "audit-sources",
      icon: "🔗",
      title: "Sources & URLs",
      desc: "Top domaines cités dans les réponses LLM, liste des URLs de votre marque (domaine propre) et présences externes (slug contenant la marque). Identifiez les pages performantes à renforcer et celles à créer.",
      tip: "Les URLs 'À booster' ont des mentions dans les réponses mais pas dans les sources — optimisez leur référencement externe.",
      position: "top",
      onActivate: () => setMainTab("audit"),
    },
    {
      target: "audit-plan",
      icon: "🎯",
      title: "Plan d'action",
      desc: "Pistes prioritaires générées automatiquement depuis vos données : présence par provider, questions sans mention, URLs à optimiser. L'analyse IA détaillée de Claude fournit un rapport complet avec des recommandations sourcées.",
      tip: "Générez l'analyse IA avant d'exporter le PDF pour un rapport plus riche.",
      position: "top",
      onActivate: () => setMainTab("audit"),
    },
    {
      target: "audit-export",
      icon: "⬇",
      title: "Export PDF",
      desc: "Génère un rapport PDF complet au design Sonate : cover verte, score GEO, KPIs, concurrents, URLs, plan d'action et analyse IA. Partagez-le directement avec votre client ou équipe.",
      tip: "Le PDF reflète l'état des données au moment de la génération — exportez après chaque session d'interrogation.",
      position: "top",
      onActivate: () => setMainTab("audit"),
    },
  ];
  return (
    <div>
      {showTour && (
        <TourGuide steps={AUDIT_TOUR_STEPS} onClose={() => setShowTour(false)} />
      )}
      {/* ── Header compact : titre + onglets + actions sur une ligne ── */}
      <div className="audit-header">
        {/* Gauche : titre + onglets */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1A3C2E", letterSpacing: "-0.01em" }}>Audit GEO</div>
          <div style={{ display: "inline-flex", gap: 1, background: "#1A3C2E0C", borderRadius: 7, padding: "2px" }}>
            {[{ key: "setup", label: "Setup" }, { key: "audit", label: "Génération" }].map(t => (
              <button key={t.key} onClick={() => setMainTab(t.key)} style={{
                padding: "4px 14px", borderRadius: 5, fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer", transition: "all 0.12s",
                background: mainTab === t.key ? "#1A3C2E" : "transparent",
                color: mainTab === t.key ? "#F0EBE0" : "#1A3C2E55",
              }}>{t.label}</button>
            ))}
          </div>
        </div>
        {/* Droite : actions */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={refreshData} disabled={loading}
            style={{ fontSize: 11, color: "#1A3C2E55", background: "transparent", border: "0.5px solid #1A3C2E18", borderRadius: 6, padding: "4px 10px", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.4 : 1 }}>
            {loading ? "⏳" : "↺"}
          </button>
          <button onClick={() => setShowTour(true)} disabled={noData || loading}
            style={{ fontSize: 11, color: "#1A3C2E55", background: "transparent", border: "0.5px solid #1A3C2E18", borderRadius: 6, padding: "4px 10px", cursor: noData || loading ? "not-allowed" : "pointer", opacity: noData || loading ? 0.4 : 1 }}>
            Guide
          </button>
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
          {/* Sélecteur de site + Export — barre fine */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {(Array.isArray(sites) ? sites : []).length > 1 && (Array.isArray(sites) ? sites : []).map(s => (
                <button key={s.id} onClick={() => setSelectedSite(s.id)} style={{ padding: "3px 10px", borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: "pointer", border: `1px solid ${s.color}33`, background: selectedSite === s.id ? s.color : "transparent", color: selectedSite === s.id ? "#fff" : s.color }}>{s.label}</button>
              ))}
            </div>
            <span data-tour="audit-export" style={{ display: "inline-flex", gap: 8 }}>
              <button onClick={async () => { setExporting(true); try { await exportPresentation(audit, brand, site, siteQuestions, siteResults, roadmapData, claudeKey, categories); } catch(e) { console.error(e); } setExporting(false); }}
                disabled={noData || exporting}
                title="Présentation client : état des lieux, forces/faiblesses, roadmap ICE"
                style={{ padding: "4px 12px", background: noData ? "transparent" : "#1A3C2E", color: noData ? "#1A3C2E44" : "#F0EBE0", border: "0.5px solid #1A3C2E22", borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: noData ? "not-allowed" : "pointer" }}>
                {exporting ? "…" : "⬇ Présentation"}
              </button>
              <button onClick={() => { setExporting(true); exportPDF(audit, brand, site, aiText); setTimeout(() => setExporting(false), 1000); }}
                disabled={noData || exporting}
                title="Rapport complet détaillé"
                style={{ padding: "4px 12px", background: "transparent", color: noData ? "#1A3C2E44" : "#1A3C2E", border: "0.5px solid #1A3C2E22", borderRadius: 5, fontSize: 11, fontWeight: 500, cursor: noData ? "not-allowed" : "pointer" }}>
                {exporting ? "…" : "⬇ Rapport complet"}
              </button>
            </span>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 60, color: "#1A3C2E44", fontSize: 12 }}>Chargement des données…</div>
          ) : noData ? (
            <div style={{ textAlign: "center", padding: 60, color: "#1A3C2E44" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1A3C2E", marginBottom: 6 }}>Aucun résultat disponible</div>
              <div style={{ fontSize: 12 }}>Interrogez des questions dans l'onglet Suivi GEO pour générer des données d'audit</div>
            </div>
          ) : (<>

            {/* ══════════════════════════════════════════════════════
                BLOC 1 — SYNTHÈSE EXÉCUTIVE
                Présence GEO + KPIs clés en un coup d'œil
            ══════════════════════════════════════════════════════ */}
            {/* Sélecteur de période de suivi (défaut : 1 mois coulant) */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "#1A3C2E55" }}>Période de suivi</span>
              <select value={periodDays} onChange={e => setPeriodDays(parseInt(e.target.value, 10))}
                style={{ padding: "5px 10px", borderRadius: 7, border: "0.5px solid #1A3C2E22", fontSize: 12, background: "#fff", color: "#1A3C2E", cursor: "pointer" }}>
                <option value={7}>7 derniers jours</option>
                <option value={30}>1 mois coulant</option>
                <option value={90}>3 mois</option>
                <option value={180}>6 mois</option>
                <option value={365}>12 mois</option>
                <option value={0}>Tout l'historique</option>
              </select>
            </div>
            <div data-tour="audit-score"><GeoScoreBanner audit={audit} auditFav={auditFav} brand={brand} site={site} /></div>

            {/* ══════════════════════════════════════════════════════
                BLOC 2 — VISIBILITÉ MARQUE
                Présence par provider + tendance 30j + questions
            ══════════════════════════════════════════════════════ */}
            <div data-tour="audit-visibility" style={{ display: "contents" }}><Section title="Visibilité marque" sub="Présence dans les réponses LLM par provider et dans le temps">

              {/* Providers — ligne épurée */}
              {Object.keys(audit.providerStats).length > 0 && (
                <div className="audit-providers-row">
                  {Object.entries(audit.providerStats).map(([pid, s]) => {
                    const rate = pct(s.withBrand, s.total);
                    const color = rate >= 50 ? "#1A7A4A" : rate > 0 ? "#C97820" : "#1A3C2E33";
                    return (
                      <div key={pid} style={{ padding: "7px 14px", border: "0.5px solid #1A3C2E12", borderRadius: 8, background: "#fff", minWidth: 90 }}>
                        <div style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1A3C2E44", marginBottom: 3 }}>{pid}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1, letterSpacing: "-0.01em" }}>{rate}<span style={{ fontSize: 11, fontWeight: 400 }}>%</span></div>
                        <div style={{ fontSize: 10, color: "#1A3C2E33", marginTop: 1 }}>{s.withBrand}/{s.total}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Positions moyennes par type de présence (Mention / Évocation / Citation) */}
              {(audit.mentionCount > 0 || audit.evocationCount > 0 || audit.citationCount > 0) && (
                <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
                  {[
                    { label: "Mention",   icon: "◎", color: "#1A7A4A", pos: audit.avgMentionPos,   count: audit.mentionCount,   hint: "Position moyenne dans les tops numérotés" },
                    { label: "Évocation", icon: "⟶", color: "#C97820", pos: audit.avgEvocationPos, count: audit.evocationCount, hint: "Rang moyen d'apparition dans le corps du texte" },
                    { label: "Citation",  icon: "↗", color: "#1A3C2E", pos: audit.avgCitationPos,  count: audit.citationCount,  hint: "Rang moyen dans les sources citées" },
                  ].map(m => (
                    <div key={m.label} title={m.hint} style={{ flex: "1 1 140px", minWidth: 130, padding: "9px 14px", border: "0.5px solid #1A3C2E12", borderRadius: 8, background: "#fff" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: m.color }}>{m.icon}</span>
                        <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1A3C2E44" }}>{m.label}</span>
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: m.pos ? m.color : "#1A3C2E22", lineHeight: 1, letterSpacing: "-0.01em" }}>
                        {m.pos ? <>#{m.pos}<span style={{ fontSize: 10, fontWeight: 400, color: "#1A3C2E33" }}> moy.</span></> : "—"}
                      </div>
                      <div style={{ fontSize: 10, color: "#1A3C2E33", marginTop: 2 }}>{m.count} occurrence{m.count > 1 ? "s" : ""}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Tendance 30 jours */}
              <div className="audit-trend-wrap" style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1A3C2E44", marginBottom: 8 }}>Tendance 30 jours</div>
                <TrendChart trendDays={audit.trendDays} />
              </div>

              {/* Questions ◎ mention / ✗ favorites sans mention */}
              <div className="audit-questions-grid">
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1A7A4A", marginBottom: 8 }}>◎ Avec mention · {audit.presentBrandQs.length}</div>
                  {audit.presentBrandQs.length ? audit.presentBrandQs.map((q, i) => (
                    <div key={i} style={{ fontSize: 12, padding: "5px 0", borderBottom: "0.5px solid #1A3C2E08", display: "flex", gap: 6, alignItems: "baseline" }}>
                      <span style={{ color: "#1A7A4A", flexShrink: 0, fontSize: 10 }}>◎</span>
                      {q.isFav && <span style={{ flexShrink: 0, fontSize: 10, color: "#C97820" }}>★</span>}
                      <span style={{ flex: 1, color: "#1A3C2E", lineHeight: 1.5 }}>{q.question}</span>
                      {q.volume > 0 && <span style={{ fontSize: 10, color: "#1A3C2E33", flexShrink: 0 }}>{q.volume >= 1000 ? (q.volume/1000).toFixed(1)+"k" : q.volume}</span>}
                    </div>
                  )) : <div style={{ fontSize: 11, color: "#1A3C2E33", fontStyle: "italic" }}>Aucune mention dans un top LLM</div>}
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#C0352A", marginBottom: 8 }}>Questions sans mentions · {audit.missingBrandQs.length}</div>
                  {audit.missingBrandQs.length ? audit.missingBrandQs.map((q, i) => (
                    <div key={i} style={{ padding: "5px 0", borderBottom: "0.5px solid #1A3C2E08" }}>
                      <div style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "baseline" }}>
                        <span style={{ color: "#C0352A", flexShrink: 0, fontSize: 10 }}>✗</span>
                        {q.isFav && <span style={{ flexShrink: 0, fontSize: 10, color: "#C97820" }}>★</span>}
                        <span style={{ flex: 1, color: "#1A3C2E", lineHeight: 1.5 }}>{q.question}</span>
                        {q.volume > 0 && <span style={{ fontSize: 10, color: "#1A3C2E33", flexShrink: 0 }}>{q.volume >= 1000 ? (q.volume/1000).toFixed(1)+"k" : q.volume}</span>}
                      </div>
                      <AuditHintPanel
                        question={q.question}
                        claudeKey={claudeKey}
                        brandName={brand?.brand_name || ""}
                      />
                    </div>
                  )) : <div style={{ fontSize: 11, color: "#1A3C2E33", fontStyle: "italic" }}>Toutes les questions ont une mention !</div>}
                </div>
              </div>

              {/* Analyse Fan-out */}
              <div data-tour="audit-fanout" style={{ marginTop: 18, paddingTop: 16, borderTop: "0.5px solid #1A3C2E0C" }}>
                <FanoutAnalysis questions={siteQuestions} results={siteResults} brand={brand} claudeKey={claudeKey} projectId={projectId} siteId={site?.id} />
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
                BLOC 2bis — PERFORMANCE DES FAVORIS
                Met en avant le périmètre stratégique (questions ★)
            ══════════════════════════════════════════════════════ */}
            <div data-tour="audit-favorites" style={{ display: "contents" }}><Section title="Performance des favoris" sub="Vos questions stratégiques (★) classées par niveau de maîtrise">
              <FavoritesPerformance questions={siteQuestions} results={siteResults} projectId={projectId} siteId={site?.id} />
            </Section></div>

            {/* ══════════════════════════════════════════════════════
                BLOC 3 — ANALYSE CONCURRENTIELLE
                Concurrents + intentions + types de réponses
            ══════════════════════════════════════════════════════ */}
            <div data-tour="audit-competitors" style={{ display: "contents" }}><Section title="Paysage concurrentiel" sub="Concurrents détectés dans les réponses LLM — analysez leurs pages">

              {/* Tableau M/É/C top 5 concurrents */}
              {(() => {
                const brandName = brand?.brand_name || "Marque";
                const top5 = audit.top5Competitors?.length ? audit.top5Competitors : audit.top5Fallback || [];
                const allRows = [
                  { name: brandName, stats: { mentions: audit.withRanked||0, evocations: audit.withMentionOnly||0, citations: audit.withSourceOnly||0, positions: audit.avgMentionPos ? [parseFloat(audit.avgMentionPos)] : [] }, isRef: true },
                  ...top5.map(([name, s]) => ({ name, stats: s, isRef: false })),
                ];
                return (
                  <div className="audit-comp-table-wrap">
                    <table className="audit-comp-table">
                      <thead>
                        <tr style={{ borderBottom: "0.5px solid #1A3C2E12" }}>
                          <th style={{ padding: "7px 0", textAlign: "left", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1A3C2E44" }}>Marque</th>
                          <th style={{ padding: "7px 10px", textAlign: "center", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1A7A4A" }}>◎ Mention</th>
                          <th style={{ padding: "7px 10px", textAlign: "center", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#C97820" }}>⟶ Évocation</th>
                          <th style={{ padding: "7px 10px", textAlign: "center", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1A3C2E77" }}>↗ Citation</th>
                          <th style={{ padding: "7px 10px", textAlign: "center", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#1A3C2E44" }}>Pos.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allRows.map((row, i) => {
                          const s = row.stats;
                          const pos = (s.positions || []);
                          const avgPos = pos.length ? (pos.reduce((a, b) => a + b, 0) / pos.length).toFixed(1) : null;
                          return (
                            <tr key={i} style={{ borderBottom: "0.5px solid #1A3C2E06", background: row.isRef ? "#F0EBE018" : "transparent" }}>
                              <td style={{ padding: "8px 0" }}>
                                <span style={{ fontSize: 12, fontWeight: row.isRef ? 600 : 400, color: "#1A3C2E" }}>{row.name}</span>
                                {row.isRef && <span style={{ marginLeft: 6, fontSize: 8, background: "#1A3C2E", color: "#F0EBE0", borderRadius: 3, padding: "1px 5px", letterSpacing: "0.06em" }}>REF</span>}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "center", fontSize: 14, fontWeight: 600, color: (s.mentions||0) > 0 ? "#1A7A4A" : "#1A3C2E18" }}>{s.mentions || 0}</td>
                              <td style={{ padding: "8px 10px", textAlign: "center", fontSize: 14, fontWeight: 600, color: (s.evocations||0) > 0 ? "#C97820" : "#1A3C2E18" }}>{s.evocations || 0}</td>
                              <td style={{ padding: "8px 10px", textAlign: "center", fontSize: 14, fontWeight: 600, color: (s.citations||0) > 0 ? "#1A3C2E77" : "#1A3C2E18" }}>{s.citations || 0}</td>
                              <td style={{ padding: "8px 10px", textAlign: "center", fontSize: 12, color: "#1A3C2E44" }}>{avgPos ? `#${avgPos}` : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              {/* Analyseur de pages concurrentes */}
              <CompetitorPageAnalyzer
                competitors={competitors}
                audit={audit}
                claudeKey={claudeKey}
              />
            </Section>
            </div>{/* ══════════════════════════════════════════════════════
                BLOC 4 — ANALYSE DES SOURCES & URLS
                Top domaines + URLs marque catégorisées
            ══════════════════════════════════════════════════════ */}
            <div data-tour="audit-sources" style={{ display: "contents" }}><Section title="Sources & URLs" sub="URLs de la marque citées dans les réponses LLM">

              {/* Top domaines — graphe en barres (style Fan-out) */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: "#1A3C2E44", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Top domaines cités</div>
                <AuditBarChart
                  accent="#1A3C2E"
                  data={Object.entries(audit.topDomains).sort((a,b)=>b[1]-a[1]).slice(0,14).map(([d, cnt]) => {
                    const isComp  = audit.competitorUrls.some(u => u.domain === d);
                    const isBrand = audit.brandUrls.some(u => u.domain === d);
                    return { name: d, count: cnt, kind: isBrand ? "brand" : isComp ? "competitor" : "other" };
                  })}
                />
                {/* Légende */}
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
                  {[["#1A7A4A","Votre marque"],["#C0352A","Concurrent"],["#9AAEA4","Autre"]].map(([c,l]) => (
                    <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, color: "#1A3C2E77" }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: c }} />{l}
                    </span>
                  ))}
                </div>
              </div>

              {/* Tableau URLs marque */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: "#1A3C2E44", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>URLs de la marque citées</div>
                {audit.brandUrls.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#1A3C2E44", fontStyle: "italic" }}>Aucune URL de la marque détectée dans les sources</div>
                ) : (
                  <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 480 }}>
                    <thead>
                      <tr style={{ background: "#FAFAF8" }}>
                        {["URL", "Citations src", "Mentions rép.", "Questions liées", "Statut"].map(h => (
                          <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 10, color: "#1A3C2E44", textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {audit.brandUrls.slice(0, 20).map((u, i) => {
                        const src = u.count_as_source || 0;
                        const rep = u.count_in_answer || 0;
                        const detail = (audit.urlDetails || []).find(d => d.norm === u.norm);
                        const qCount = detail?.linkedQs?.length || 0;
                        const status = src >= 3 ? { label: "✓ Performante", color: "#1A7A4A", bg: "#F0F7F3" }
                                     : rep > 0 && src === 0 ? { label: "⚠ À sourcer", color: "#DC2626", bg: "#FEF2F2" }
                                     : src > 0 ? { label: "↑ À booster", color: "#D97706", bg: "#FFFBEB" }
                                     : { label: "— Peu citée", color: "#1A3C2E44", bg: C.bg };
                        // Afficher la version normalisée (sans https, www, slash final)
                        const displayUrl = u.norm || u.url.replace(/^https?:\/\//, "");
                        return (
                          <tr key={i} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                            <td style={{ padding: "8px 12px", maxWidth: 260, wordBreak: "break-all" }}>
                              <a href={u.url} target="_blank" rel="noreferrer" style={{ color: "#1A3C2E", fontSize: 11, textDecoration: "none" }}>{displayUrl}</a>
                            </td>
                            <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: src > 0 ? "#1A7A4A" : C.textLight }}>{src}</td>
                            <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: rep > 0 ? "#1A3C2E" : C.textLight }}>{rep}</td>
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
                  </div>
                )}
              </div>
            </Section>
            </div>

            {/* ══════════════════════════════════════════════════════
                 BLOC 4ter — ANALYSE FAN-OUT (récupérée de l'onglet Suivi GEO)
            ══════════════════════════════════════════════════════ */}
            <FanoutAnalysisRecap projectId={projectId} siteId={site?.id} />

            {/* ══════════════════════════════════════════════════════
                 BLOC 4bis — MODULES OUTILS (SF / GSC / GA / Bing)
                 Croisements actionnables + export CSV par lot
            ══════════════════════════════════════════════════════ */}
            <div data-tour="audit-tools" style={{ display: "contents" }}><Section title="Modules d'analyse outils" sub="Exploitez vos imports SF · GSC · GA · Bing — activez les modules pertinents, exportez chaque lot">
              <ToolModulesSection
                audit={audit}
                brand={brand}
                sfRows={(sfData && site) ? (sfData[site.id] || []) : []}
                gscRows={(gscData && site) ? (gscData[site.id] || []) : []}
                gaRows={(gaData && site) ? (gaData[site.id] || []) : []}
                bingData={(bingData && site) ? (bingData[site.id] || {}) : {}}
              />
            </Section></div>

            {/* ══════════════════════════════════════════════════════
                 BLOC 5 — MATRICE DE CORRÉLATION INTERACTIVE
                 Croisement 2 sources parmi SF / GSC / Bing / Fan-outs
            ══════════════════════════════════════════════════════ */}
            <div data-tour="audit-corr" style={{ display: "contents" }}><Section title="Matrice de corrélation" sub="Croisez 2 sources de données pour identifier les corrélations avec votre présence GEO">
              <CorrelationMatrix
                sfRows={(sfData && site) ? (sfData[site.id] || []) : []}
                gscRows={(gscData && site) ? (gscData[site.id] || []) : []}
                gaRows={(gaData && site) ? (gaData[site.id] || []) : []}
                bingData={(bingData && site) ? (bingData[site.id] || {}) : {}}
                results={siteResults}
                audit={audit}
                sfCorrFilter={sfCorrFilter}
                setSfCorrFilter={setSfCorrFilter}
              />
            </Section>
            </div>

            {/* ══════════════════════════════════════════════════════
                BLOC 6 — PLAN D'ACTION
                Pistes prioritaires + analyse Fan-out IA
            ══════════════════════════════════════════════════════ */}
            {/* ══════════════════════════════════════════════════════
                BLOC 6 — PLAN D'ACTION
            ══════════════════════════════════════════════════════ */}
            <div data-tour="audit-plan" style={{ display: "contents" }}><Section title="Plan d'action" sub="Recommandations prioritaires et analyse IA">

              {/* Pistes prioritaires — style épuré */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "#1A3C2E44", marginBottom: 10 }}>Pistes prioritaires</div>
                {audit.leads.map((l, i) => {
                  const accentColor = l.priority.includes("🔴") ? "#C0352A" : l.priority.includes("🟠") ? "#C97820" : l.priority.includes("🟡") ? "#C97820" : "#1A7A4A";
                  return (
                    <div key={i} style={{ paddingLeft: 12, borderLeft: `2px solid ${accentColor}22`, marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: accentColor, marginBottom: 2, letterSpacing: "0.04em" }}>{l.label}</div>
                      <div style={{ fontSize: 12, color: "#1A3C2E", lineHeight: 1.65 }}>{renderBold(l.action)}</div>
                    </div>
                  );
                })}
              </div>

              {/* Analyse IA */}
              <div style={{ paddingTop: 16, borderTop: "0.5px solid #1A3C2E0C" }}>
                <AIAnalysis audit={audit} brand={brand} site={site} questions={siteQuestions} onTextReady={setAiText} projectId={projectId} siteId={site?.id} />
              </div>
            </Section>
            </div>

          </>)}
        </div>
      )}
    </div>
  );
}