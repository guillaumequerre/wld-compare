import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./geo-tab.css";
import TourGuide from "./TourGuide";
import PresenceCalendar from "../components/PresenceCalendar";
import {
  sbGetBrand,
  sbSaveKeywords, sbGetKeywords, sbUpdateKeywordStatus, sbDeleteKeyword, sbUpdateKeywordVolume,
  sbSaveQuestions, sbGetQuestions, sbUpdateQuestion, sbDeleteQuestion,
  sbSaveGeoResult, sbGetGeoResults, sbSaveHint, sbGetHints, sbSetKeywordTags,
  sbGetSchedule, sbSaveSchedule, sbUpdateSchedule, sbTriggerScheduler,
  sbSaveProjectSettings,
  sbGetCategories, sbSaveCategory, sbDeleteCategory,
  sbSetQuestionCategory,
  sbBulkSetKeywordCategory, sbBulkSetQuestionCategory,
  sbGetUrlIndex, sbUpdateUrlMeta, sbIncrementUrlCounts,
  sbAddCalendarEntry, sbGetCalendarEntriesBatch,
  sbDownload, sbSaveProject, sbDeleteProject,
  sbGetCompetitors, sbSaveCompetitor, sbUpdateCompetitor, sbDeleteCompetitor,
} from "../lib/supabase";
import { ProviderConfigPanel, BrandConfigPanel } from "../components/GeoConfig";
import UploadCard from "../components/UploadCard";
import { newProject, parseCSV, parseSemrushCSV } from "../lib/helpers";
import { parseSemrush } from "../lib/parsers";
import { C, SITE_PALETTE } from "../lib/constants";
// Note: sbSaveGeoAxes is called via onSaveAxes prop from App.jsx



const DEFAULT_AXES = [
  "Meilleur / top / recommandé",
  "Pistes et approches pour utiliser / bénéficier du mot-clé",
  "Avis / fiable / fiabilité",
  "Pour atteindre un objectif lié au mot-clé",
  "Pour résoudre une problématique liée au mot-clé",
];

// ── API Key helpers — base64 obfuscation (Supabase already protected by auth) ──
// Fallback: if stored value looks like an AES blob (not a valid sk- key after decode),
// the user must re-enter the key once to migrate to the new format.
function decodeKey(enc) {
  if (!enc) return "";
  try {
    const k = decodeURIComponent(escape(atob(enc)));
    return k; // may or may not start with sk- — UI will validate
  } catch {
    return ""; // AES blob or corrupted — user must re-enter
  }
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
}

// Retire les query strings et fragments des URLs pour l'affichage
function stripQuery(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch { return url; }
}

// Convertit le markdown basique (gras, italique, listes) en éléments React
function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split("\n");
  return lines.map((line, li) => {
    // Transformer **bold** et *italic* dans chaque ligne
    const parts = [];
    let remaining = line;
    let key = 0;
    while (remaining.length > 0) {
      const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/s);
      const italicMatch = remaining.match(/^(.*?)\*(.+?)\*/s);
      // Choisir le match le plus proche
      const useBold = boldMatch && (!italicMatch || boldMatch[1].length <= italicMatch[1].length);
      if (useBold) {
        if (boldMatch[1]) parts.push(<span key={key++}>{boldMatch[1]}</span>);
        parts.push(<strong key={key++}>{boldMatch[2]}</strong>);
        remaining = remaining.slice(boldMatch[0].length);
      } else if (italicMatch) {
        if (italicMatch[1]) parts.push(<span key={key++}>{italicMatch[1]}</span>);
        parts.push(<em key={key++}>{italicMatch[2]}</em>);
        remaining = remaining.slice(italicMatch[0].length);
      } else {
        parts.push(<span key={key++}>{remaining}</span>);
        remaining = "";
      }
    }
    // Détecter les lignes de liste (- xxx ou * xxx ou ## titre)
    const trimmed = line.trimStart();
    const isHeading = trimmed.startsWith("## ") || trimmed.startsWith("### ");
    const isList = /^[-*•]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed);
    if (isHeading) {
      return <div key={li} style={{ fontWeight: 700, fontSize: 13, marginTop: 8, marginBottom: 2 }}>{parts}</div>;
    }
    if (isList) {
      return <div key={li} style={{ paddingLeft: 12, marginBottom: 2, display: "flex", gap: 6 }}><span style={{ flexShrink: 0 }}>•</span><span>{parts}</span></div>;
    }
    if (!line.trim()) return <div key={li} style={{ height: 6 }} />;
    return <div key={li} style={{ marginBottom: 2 }}>{parts}</div>;
  });
}

// ── renderMarkdownHighlighted — surligne marque (vert) et concurrents ──
// eslint-disable-next-line no-unused-vars
function renderMarkdownHighlighted(text, brandTerms = [], competitorMap = {}) {
  if (!text) return null;
  const hasHighlights = brandTerms.length > 0 || Object.keys(competitorMap).length > 0;
  if (!hasHighlights) return renderMarkdown(text);
  function highlightLine(line) {
    if (!line) return [line];
    const allTerms = [
      ...brandTerms.map(t => ({ term: t, type: "brand" })),
      ...Object.keys(competitorMap).map(t => ({ term: t, type: "competitor" })),
    ].filter(t => t.term).sort((a, b) => b.term.length - a.term.length);
    if (!allTerms.length) return [line];
    const pattern = allTerms.map(t => t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const re = new RegExp(`(${pattern})`, "gi");
    const parts = line.split(re);
    return parts.map((part, i) => {
      const lower = part.toLowerCase();
      if (brandTerms.some(t => t.toLowerCase() === lower))
        return <mark key={i} style={{ background: "#DCFCE7", color: "#166534", borderRadius: 3, padding: "0 2px", fontWeight: 600 }}>{part}</mark>;
      if (competitorMap[lower]) {
        const cat = competitorMap[lower];
        const bg = cat.category === "direct" ? "#FEE2E2" : cat.category === "geo" ? "#FEF3C7" : "#F3F4F6";
        const color = cat.category === "direct" ? "#991B1B" : cat.category === "geo" ? "#92400E" : "#374151";
        return <mark key={i} style={{ background: bg, color, borderRadius: 3, padding: "0 2px", fontWeight: 500 }}>{part}</mark>;
      }
      return part;
    });
  }
  const lines = text.split("\n");
  return lines.map((line, li) => {
    const highlighted = highlightLine(line);
    const trimmed = line.trimStart();
    const isHeading = trimmed.startsWith("## ") || trimmed.startsWith("### ");
    const isList = /^[-*•]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed);
    if (isHeading) return <div key={li} style={{ fontWeight: 700, fontSize: 13, marginTop: 8, marginBottom: 2 }}>{highlighted}</div>;
    if (isList) return <div key={li} style={{ paddingLeft: 12, marginBottom: 2, display: "flex", gap: 6 }}><span style={{ flexShrink: 0 }}>•</span><span>{highlighted}</span></div>;
    if (!line.trim()) return <div key={li} style={{ height: 6 }} />;
    return <div key={li} style={{ marginBottom: 2 }}>{highlighted}</div>;
  });
}

// ── Export CSV helpers ────────────────────────────────────────────

function csvCell(val) {
  if (val === null || val === undefined) return "";
  const s = String(val).replace(/\r?\n/g, " ").replace(/"/g, '""');
  return /[,;"\n]/.test(s) ? `"${s}"` : s;
}

function toCSV(rows) {
  return "\uFEFF" + rows.map(r => r.map(csvCell).join(";")).join("\r\n");
}

function downloadText(content, filename, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtDateExport(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function getProviderLabel(model) {
  const m = (model || "").toLowerCase();
  if (m.includes("openai") || m.includes("gpt"))       return "OpenAI";
  if (m.includes("gemini"))                             return "Gemini";
  if (m.includes("perplexity") || m.includes("sonar")) return "Perplexity";
  if (m.includes("claude"))                             return "Claude";
  return model || "Inconnu";
}

// questionScope : "brand" (marque présente) | "favorites" (favoris) | "all" (toutes)
function exportFanoutCSV({ questions, results, brandName, brandAliases = [], keywords = [], projectName = "export", selectedProviders = [], questionScope = "brand" }) {
  const byQ = {};
  results.forEach(r => {
    if (!byQ[r.question_id]) byQ[r.question_id] = [];
    byQ[r.question_id].push(r);
  });
  const kwMap = {};
  keywords.forEach(k => { kwMap[k.id] = k.keyword; });
  const allBrandTerms = [brandName, ...brandAliases].filter(Boolean).map(t => t.toLowerCase());

  const header = [
    "Question",
    "Favori",
    "Mot-clé",
    "Provider",
    "Modèle",
    "Marque présente",
    "Position marque",
    "Marque dans sources",
    "Concurrents cités",
    "Réponse (500 car.)",
    "Sources citées",
    "Date interrogation",
    "Tokens (in+out)",
  ];

  const rows = [header];

  // Filtrer les questions selon le scope
  const scopedQuestions = questions.filter(q => {
    if (questionScope === "favorites") return !!q.is_favorite;
    if (questionScope === "brand") {
      const qRes = byQ[q.id] || [];
      return qRes.some(r => r.brand_mentioned === true || r.brand_mentioned === 1);
    }
    return true; // "all"
  });

  scopedQuestions.forEach(q => {
    const qResults = (byQ[q.id] || []).filter(r =>
      selectedProviders.length === 0 || selectedProviders.includes(getProviderId(r.model))
    );

    if (qResults.length === 0) {
      // Question sans résultat — ligne vide pour tracer la question
      rows.push([q.question, q.is_favorite ? "⭐" : "", kwMap[q.keyword_id] || "", "", "", "Non", "", "", "", "", "", "", ""]);
      return;
    }

    qResults.forEach(r => {
      const sources = r.sources || [];
      const brandSources = sources.filter(u => allBrandTerms.some(t => u.toLowerCase().includes(t)));
      const isBrand = r.brand_mentioned === true || r.brand_mentioned === 1;
      const comps = (r.competitors_mentioned || [])
        .map(c => c.position ? `${c.name} (#${c.position})` : c.name)
        .join(", ");
      rows.push([
        q.question,
        q.is_favorite ? "⭐" : "",
        kwMap[q.keyword_id] || "",
        getProviderLabel(r.model),
        r.model || "",
        isBrand ? "✓ Oui" : "Non",
        r.brand_position ? `#${r.brand_position}` : "",
        brandSources.length > 0 ? brandSources.join(" | ") : "Non",
        comps || "—",
        (r.answer || "").slice(0, 500),
        sources.join(" | "),
        fmtDateExport(r.created_at),
        String((r.input_tokens || 0) + (r.output_tokens || 0)),
      ]);
    });
  });

  if (rows.length === 1) {
    alert("Aucun résultat à exporter pour la sélection actuelle.");
    return 0;
  }

  const scopeLabel = questionScope === "brand" ? "marque" : questionScope === "favorites" ? "favoris" : "toutes";
  const slug    = projectName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadText(toCSV(rows), `fanout_${slug}_${scopeLabel}_${dateStr}.csv`);
  return rows.length - 1;
}

// ── PDF export helpers ────────────────────────────────────────────

// questionScope : "brand" | "favorites" | "all"
function buildFanoutPDF({ questions, results, hintsMap = {}, brandName, brandAliases = [], keywords = [], projectName = "export", latestResultByQ = {}, lostByQ = {}, selectedProviders = [], questionScope = "brand" }) {
  const byQ = {};
  results.forEach(r => {
    if (!byQ[r.question_id]) byQ[r.question_id] = [];
    byQ[r.question_id].push(r);
  });
  const kwMap = {};
  keywords.forEach(k => { kwMap[k.id] = k.keyword; });

  // Filtrer par providers si sélection
  const filterByProvider = (rs) => {
    if (selectedProviders.length === 0) return rs;
    return rs.filter(r => selectedProviders.includes(getProviderId(r.model)));
  };

  // Catégoriser chaque question
  const presentQs  = []; // marque présente dans le dernier résultat
  const lostQs     = []; // marque déjà présente mais absente maintenant
  const absentQs   = []; // marque jamais présente

  // Filtrer les questions selon le scope
  const scopedQuestions = questions.filter(q => {
    if (questionScope === "favorites") return !!q.is_favorite;
    if (questionScope === "brand") {
      const qRes = byQ[q.id] || [];
      return qRes.some(r => r.brand_mentioned === true || r.brand_mentioned === 1);
    }
    return true; // "all"
  });

  scopedQuestions.forEach(q => {
    const allRes = filterByProvider(byQ[q.id] || []);
    const latest = latestResultByQ[q.id];
    const latestFiltered = latest && (selectedProviders.length === 0 || selectedProviders.includes(getProviderId(latest.model))) ? latest : [...allRes].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0];
    const isPresent = latestFiltered && (latestFiltered.brand_mentioned === true || latestFiltered.brand_mentioned === 1);
    const isLost = lostByQ[q.id] && !isPresent;

    if (isPresent) presentQs.push({ q, latest: latestFiltered, allRes });
    else if (isLost) lostQs.push({ q, latest: latestFiltered, allRes });
    else absentQs.push({ q, latest: latestFiltered, allRes });
  });

  // Métriques
  const totalRes    = filterByProvider(results).length;
  const withBrand   = filterByProvider(results).filter(r => r.brand_mentioned === true || r.brand_mentioned === 1).length;
  const withSources = filterByProvider(results).filter(r => r.brand_in_sources).length;
  const positions   = filterByProvider(results).filter(r => r.brand_position).map(r => r.brand_position);
  const avgPos      = positions.length ? (positions.reduce((a,b)=>a+b,0)/positions.length).toFixed(1) : null;
  const presence    = totalRes ? Math.round(withBrand/totalRes*100) : 0;
  const dateStr     = new Date().toLocaleDateString("fr-FR", { day:"2-digit", month:"long", year:"numeric" });

  // Top concurrents
  const compCount = {};
  filterByProvider(results).forEach(r => {
    const seen = new Set();
    (r.competitors_mentioned||[]).forEach(c => { if(c.name && !seen.has(c.name)) { seen.add(c.name); compCount[c.name]=(compCount[c.name]||0)+1; } });
  });
  const topComps = Object.entries(compCount).sort((a,b)=>b[1]-a[1]).slice(0,5);

  // ── HTML du PDF ──────────────────────────────────────────────────
  const esc = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const badge = (color, bg, text) =>
    `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:${bg};color:${color};border:1px solid ${color}44">${esc(text)}</span>`;

  const sectionTitle = (emoji, text, color = "#1E293B") =>
    `<div style="margin:28px 0 14px;padding:10px 16px;background:${color}08;border-left:4px solid ${color};border-radius:0 8px 8px 0;">
      <span style="font-size:16px;font-weight:800;color:${color}">${emoji} ${esc(text)}</span>
    </div>`;

  const questionBlock = ({ q, latest, allRes }, showHint = true, showDate = false) => {
    const kw = kwMap[q.keyword_id] || "";
    const hint = hintsMap[q.id]?.text || "";
    const hintDate = hintsMap[q.id]?.date || "";
    const comps = (latest?.competitors_mentioned || []).map(c => c.name).join(", ");
    const sources = (latest?.sources || []).slice(0, 3);
    const dateLabel = latest?.created_at ? new Date(latest.created_at).toLocaleDateString("fr-FR", {day:"2-digit",month:"short",year:"numeric"}) : "";

    return `<div style="margin-bottom:14px;padding:14px 18px;border:1px solid #E2E8F0;border-radius:10px;break-inside:avoid;page-break-inside:avoid;">
      <div style="font-size:13px;font-weight:700;color:#0F172A;margin-bottom:8px;line-height:1.4">${esc(q.question)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:${(comps||sources.length||hint) ? "10px":"0"}">
        ${kw ? badge("#6366F1","#EEF2FF",`🔑 ${kw}`) : ""}
        ${latest?.brand_position ? badge("#059669","#ECFDF5",`Position #${latest.brand_position}`) : ""}
        ${latest?.brand_in_sources ? badge("#2563EB","#EFF6FF","🔗 Dans les sources") : ""}
        ${showDate && dateLabel ? badge("#64748B","#F8FAFC",`Dernière parution : ${dateLabel}`) : ""}
      </div>
      ${comps ? `<div style="font-size:11px;color:#64748B;margin-bottom:6px">Concurrents cités : <strong>${esc(comps)}</strong></div>` : ""}
      ${sources.length ? `<div style="font-size:10px;color:#94A3B8">${sources.map(u=>{ const clean=stripQuery(u); return `<a href="${esc(u)}" style="color:#6366F1">${esc(clean.length>60?clean.slice(0,60)+"…":clean)}</a>`; }).join("  ·  ")}</div>` : ""}
      ${showHint && hint ? `<div style="margin-top:10px;padding:10px 12px;background:#FFFBEB;border:1px solid #FCD34D;border-radius:7px;">
        <div style="font-size:10px;font-weight:700;color:#B45309;margin-bottom:4px">💡 HINT GEO${hintDate ? " · "+new Date(hintDate).toLocaleDateString("fr-FR",{day:"2-digit",month:"short"}) : ""}</div>
        <div style="font-size:11px;color:#92400E;line-height:1.6;white-space:pre-wrap">${esc(hint.slice(0,400))}${hint.length>400?"…":""}</div>
      </div>` : ""}
    </div>`;
  };

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Fan-outs GEO — ${esc(projectName)} — ${dateStr}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0F172A; background: #fff; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
    }
  </style>
</head>
<body style="padding:32px 40px;max-width:900px;margin:0 auto">

  <!-- Bouton imprimer -->
  <div class="no-print" style="text-align:right;margin-bottom:16px">
    <button onclick="window.print()" style="padding:8px 18px;background:#6366F1;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">
      🖨️ Imprimer / Enregistrer en PDF
    </button>
  </div>

  <!-- ── En-tête ── -->
  <div style="border-bottom:3px solid #6366F1;padding-bottom:20px;margin-bottom:28px">
    <div style="font-size:11px;font-weight:700;color:#6366F1;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Rapport GEO — Fan-outs</div>
    <div style="font-size:26px;font-weight:800;color:#0F172A;margin-bottom:4px">${esc(projectName)}</div>
    <div style="font-size:13px;color:#64748B">Généré le ${dateStr}${selectedProviders.length > 0 ? " · Providers : "+selectedProviders.join(", ") : " · Tous les providers"}</div>
  </div>

  <!-- ── Chiffres clés ── -->
  ${sectionTitle("📊","Chiffres clés","#6366F1")}
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px">
    ${[
      { label:"Présence marque", value: presence+"%", sub:`${withBrand}/${totalRes} réponses`, color: presence>=50?"#059669":presence>0?"#D97706":"#DC2626" },
      { label:"Position moyenne", value: avgPos ? "#"+avgPos : "—", sub:"dans les fan-outs", color:"#6366F1" },
      { label:"Dans les sources", value: withSources, sub:"questions citées", color:"#2563EB" },
      { label:"Questions analysées", value: questions.length, sub:`${presentQs.length} positionnées`, color:"#0F172A" },
    ].map(k=>`<div style="padding:16px;border:1px solid #E2E8F0;border-radius:12px;text-align:center">
      <div style="font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.7px;margin-bottom:6px">${esc(k.label)}</div>
      <div style="font-size:28px;font-weight:800;color:${k.color};margin-bottom:3px">${esc(String(k.value))}</div>
      <div style="font-size:10px;color:#94A3B8">${esc(k.sub)}</div>
    </div>`).join("")}
  </div>

  ${topComps.length > 0 ? `<div style="padding:12px 16px;border:1px solid #E2E8F0;border-radius:10px;margin-bottom:24px">
    <div style="font-size:11px;font-weight:700;color:#64748B;margin-bottom:8px;text-transform:uppercase;letter-spacing:.7px">Top concurrents cités</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      ${topComps.map(([name,cnt])=>`<span style="padding:4px 12px;background:#FEF2F2;border:1px solid #FECACA;border-radius:20px;font-size:12px;font-weight:600;color:#DC2626">${esc(name)} <span style="opacity:.7">${cnt}×</span></span>`).join("")}
    </div>
  </div>` : ""}

  <!-- ── Questions positionnées ── -->
  ${presentQs.length > 0 ? `
  ${sectionTitle("✅",`Questions positionnées (${presentQs.length})`, "#059669")}
  ${presentQs.map(item => questionBlock(item, true, false)).join("")}
  ` : `<div style="padding:16px;background:#F8FAFC;border-radius:8px;color:#94A3B8;font-size:13px;margin-bottom:20px">Aucune question positionnée pour l'instant.</div>`}

  <!-- ── Questions déjà positionnées (perdues) ── -->
  ${lostQs.length > 0 ? `
  <div class="page-break"></div>
  ${sectionTitle("📈",`Positionnées précédemment — position perdue (${lostQs.length})`, "#D97706")}
  ${lostQs.map(item => questionBlock(item, true, true)).join("")}
  ` : ""}

  <!-- ── Questions sans présence ── -->
  ${absentQs.length > 0 ? `
  <div class="page-break"></div>
  ${sectionTitle("❌",`Marque absente (${absentQs.length})`, "#DC2626")}
  ${absentQs.map(item => questionBlock(item, true, false)).join("")}
  ` : ""}

  <!-- Pied de page -->
  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #E2E8F0;font-size:10px;color:#94A3B8;text-align:center">
    Rapport CorrelDash GEO · ${esc(projectName)} · ${dateStr}
  </div>

</body>
</html>`;

  // Ouvrir dans un nouvel onglet pour impression
  const win = window.open("", "_blank");
  if (!win) { alert("Autorisez les pop-ups pour générer le PDF"); return; }
  win.document.write(html);
  win.document.close();
  // Déclencher l'impression après chargement
  win.onload = () => { setTimeout(() => win.print(), 300); };
  return true;
}

// ── ExportFanoutBtn (avec sélection provider + CSV + PDF) ─────────

function ExportFanoutBtn({ questions, results, brandName, brandAliases = [], keywords = [], projectName = "export", hintsMap = {}, latestResultByQ = {}, lostByQ = {} }) {
  const [open, setOpen]             = useState(false);
  const [selectedProviders, setSel] = useState([]);        // [] = tous
  const [questionScope, setScope]   = useState("brand");   // "brand" | "favorites" | "all"
  const [exportStatus, setStatus]   = useState("idle");
  const [lastCount, setLastCount]   = useState(null);
  const popRef                      = useRef();

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (!popRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const byQ = {};
  results.forEach(r => {
    if (!byQ[r.question_id]) byQ[r.question_id] = [];
    byQ[r.question_id].push(r);
  });

  const presentProviders = [...new Set(results.map(r => getProviderId(r.model)).filter(Boolean))];

  // Compter les questions selon le scope courant
  const scopedCount = questions.filter(q => {
    if (questionScope === "favorites") return !!q.is_favorite;
    if (questionScope === "brand") {
      const qRes = byQ[q.id] || [];
      return qRes.some(r =>
        (r.brand_mentioned === true || r.brand_mentioned === 1) &&
        (selectedProviders.length === 0 || selectedProviders.includes(getProviderId(r.model)))
      );
    }
    return true;
  }).length;

  const toggleProvider = (pid) => {
    setSel(prev => prev.includes(pid) ? prev.filter(p => p !== pid) : [...prev, pid]);
  };

  const doCSV = () => {
    setStatus("exporting");
    setTimeout(() => {
      const n = exportFanoutCSV({ questions, results, brandName, brandAliases, keywords, projectName, selectedProviders, questionScope });
      setLastCount(n);
      setStatus(n > 0 ? "done" : "idle");
      if (n > 0) setTimeout(() => { setStatus("idle"); setLastCount(null); }, 4000);
      setOpen(false);
    }, 0);
  };

  const doPDF = () => {
    setStatus("exporting");
    setTimeout(() => {
      buildFanoutPDF({ questions, results, hintsMap, brandName, brandAliases, keywords, projectName, latestResultByQ, lostByQ, selectedProviders, questionScope });
      setStatus("idle");
      setOpen(false);
    }, 0);
  };

  const providerColors = { openai:"#059669", gemini:"#2563EB", perplexity:"#7C3AED", claude:"#D97706", other:"#64748B" };
  const providerIcons  = { openai:"🟢", gemini:"🔵", perplexity:"🟣", claude:"🟠", other:"⚪" };
  const providerLabels = { openai:"OpenAI", gemini:"Gemini", perplexity:"Perplexity", claude:"Claude", other:"Autre" };

  const SCOPES = [
    { key: "brand",     label: "✓ Marque présente",  desc: "Questions où la marque est citée",   color: "#059669", bg: "#ECFDF5" },
    { key: "favorites", label: "⭐ Favoris",           desc: "Questions marquées comme favoris",   color: "#F59E0B", bg: "#FFFBEB" },
    { key: "all",       label: "◉ Toutes",            desc: "Toutes les questions et réponses",   color: "#6366F1", bg: "#EEF2FF" },
  ];
  const currentScope = SCOPES.find(s => s.key === questionScope);

  return (
    <div ref={popRef} style={{ position: "relative", display: "inline-block" }}>
      {/* Bouton principal */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Exporter les fan-outs (CSV ou PDF)"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "6px 14px",
          border: `1.5px solid ${open ? "#6366F1" : "#059669"}`,
          borderRadius: 8,
          background: open ? "#EEF2FF" : "#ECFDF5",
          color: open ? "#6366F1" : "#059669",
          fontSize: 12, fontWeight: 700,
          cursor: "pointer",
          transition: "all 0.15s",
          whiteSpace: "nowrap", flexShrink: 0,
        }}
      >
        {exportStatus === "exporting" ? <>⏳ Export…</> :
         exportStatus === "done" && lastCount !== null ? <>{lastCount} lignes ✓</> : (
          <>
            <span style={{ fontSize: 14 }}>📤</span>
            Exporter
            {scopedCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 800, background: currentScope?.color || "#059669", color: "#fff", borderRadius: 10, padding: "1px 6px", marginLeft: 2 }}>
                {scopedCount}
              </span>
            )}
            <span style={{ fontSize: 10, opacity: 0.6 }}>{open ? "▲" : "▼"}</span>
          </>
        )}
      </button>

      {/* ── Popover ── */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 300,
          background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.14)", padding: 16, minWidth: 290,
        }}>

          {/* ── Périmètre des questions ── */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: ".7px", marginBottom: 8 }}>
              Questions à exporter
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {SCOPES.map(s => (
                <button key={s.key} onClick={() => setScope(s.key)}
                  style={{
                    padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                    border: `2px solid ${questionScope === s.key ? s.color : "#E2E8F0"}`,
                    background: questionScope === s.key ? s.bg : "transparent",
                    color: questionScope === s.key ? s.color : "#64748B",
                    cursor: "pointer", textAlign: "left",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}
                >
                  <span>{s.label}</span>
                  <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 400 }}>{s.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Providers ── */}
          {presentProviders.length > 1 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: ".7px", marginBottom: 8 }}>
                Providers à inclure
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {presentProviders.map(pid => {
                  const active = selectedProviders.includes(pid);
                  const col = providerColors[pid] || providerColors.other;
                  return (
                    <button key={pid} onClick={() => toggleProvider(pid)}
                      style={{
                        padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                        border: `2px solid ${active ? col : "#E2E8F0"}`,
                        background: active ? col+"18" : "transparent",
                        color: active ? col : "#64748B", cursor: "pointer",
                      }}
                    >
                      {providerIcons[pid]||"⚪"} {providerLabels[pid]||pid}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 5 }}>
                {selectedProviders.length === 0 ? "Tous les providers inclus" : `${selectedProviders.length} provider${selectedProviders.length>1?"s":""} sélectionné${selectedProviders.length>1?"s":""}`}
              </div>
            </div>
          )}

          {/* ── Résumé ── */}
          <div style={{ fontSize: 11, color: "#64748B", marginBottom: 14, padding: "8px 10px", background: "#F8FAFC", borderRadius: 7 }}>
            <strong style={{ color: currentScope?.color }}>{scopedCount}</strong> question{scopedCount>1?"s":""} · {currentScope?.desc?.toLowerCase()}
            <br/><span style={{ color: "#94A3B8" }}>{questions.length} questions au total · {results.length} réponses</span>
          </div>

          {/* ── Boutons d'export ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={doCSV} disabled={scopedCount === 0}
              style={{
                padding: "9px 14px", borderRadius: 8, border: "none",
                background: scopedCount === 0 ? "#F1F5F9" : "#059669",
                color: scopedCount === 0 ? "#94A3B8" : "#fff",
                fontSize: 12, fontWeight: 700, cursor: scopedCount === 0 ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              <span style={{ fontSize: 16 }}>📥</span>
              <div style={{ textAlign: "left" }}>
                <div>Exporter CSV</div>
                <div style={{ fontSize: 10, opacity: .8 }}>Questions + réponses + hints en tableau</div>
              </div>
            </button>

            <button onClick={doPDF}
              style={{
                padding: "9px 14px", borderRadius: 8, border: "none",
                background: "#6366F1", color: "#fff",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              <span style={{ fontSize: 16 }}>📄</span>
              <div style={{ textAlign: "left" }}>
                <div>Exporter PDF</div>
                <div style={{ fontSize: 10, opacity: .8 }}>Rapport mise en page · chiffres clés · hints</div>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── OpenAI call helpers ───────────────────────────────────────────


export const PROVIDERS = [
  {
    id: "openai",
    label: "OpenAI",
    icon: "🟢",
    model: "gpt-4o-mini",
    keyField: "openai_key_enc",
    keyPrefix: "sk-",
    keyPlaceholder: "sk-…",
    proxyPath: "/api/openai",
    color: "#059669",
  },
  {
    id: "gemini",
    label: "Gemini",
    icon: "🔵",
    model: "gemini-2.0-flash",   // supports Google Search grounding (real-time web)
    keyField: "gemini_key_enc",
    keyPrefix: "AIza",
    keyPlaceholder: "AIzaSy…",
    proxyPath: "/api/gemini",
    color: "#2563EB",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    icon: "🟣",
    model: "sonar",              // real-time web search + citations
    keyField: "perplexity_key_enc",
    keyPrefix: "pplx-",
    keyPlaceholder: "pplx-…",
    proxyPath: "/api/perplexity",
    color: "#7C3AED",
  },
  {
    id: "claude",
    label: "Claude",
    icon: "🟠",
    model: "claude-haiku-4-5-20251001", // knowledge-based (no web access)
    keyField: "claude_geo_key_enc",
    keyPrefix: "sk-ant-",
    keyPlaceholder: "sk-ant-…",
    proxyPath: "/api/claude-geo",
    color: "#D97706",
  },
];


function getProviderId(model) {
  const m = (model || "").toLowerCase();
  if (m.includes("openai") || m.includes("gpt")) return "openai";
  if (m.includes("gemini")) return "gemini";
  if (m.includes("perplexity") || m.includes("sonar")) return "perplexity";
  if (m.includes("claude")) return "claude";
  return "other";
}

async function callProvider(provider, apiKey, prompt) {
  if (provider.id === "openai") {
    const res = await fetch("/api/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Openai-Key": apiKey, "X-Openai-Endpoint": "responses" },
      body: JSON.stringify({
        model: provider.model,
        input: prompt,
        tools: [{ type: "web_search_preview", search_context_size: "high" }],
        max_output_tokens: 8000,
        // No JSON schema — free text response so web search annotations contain real URLs
      }),
    });
    const raw = await res.text();
    if (raw.trimStart().startsWith("<")) throw new Error("Proxy /api/openai introuvable");
    const data = JSON.parse(raw);
    if (!res.ok) throw new Error(data.error?.message || `OpenAI ${res.status}`);
    return parseOpenAIResponse(data, "responses");
  }

  if (provider.id === "gemini") {
    const res = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gemini-Key": apiKey },
      body: JSON.stringify({ model: provider.model, prompt }),
    });
    const raw = await res.text();
    if (raw.trimStart().startsWith("<")) throw new Error("Proxy /api/gemini introuvable");
    const data = JSON.parse(raw);
    if (!res.ok) throw new Error(data.error || `Gemini ${res.status}`);
    const text = data.choices?.[0]?.message?.content || "";
    const groundingSources = data._sources || []; // real URLs from Google Search
    return parseTextResponse(text, data.usage?.prompt_tokens || 0, data.usage?.completion_tokens || 0, groundingSources);
  }

  if (provider.id === "perplexity") {
    const res = await fetch("/api/perplexity", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Perplexity-Key": apiKey },
      body: JSON.stringify({ model: provider.model, prompt }),
    });
    const raw = await res.text();
    if (raw.trimStart().startsWith("<")) throw new Error("Proxy /api/perplexity introuvable");
    const data = JSON.parse(raw);
    if (!res.ok) throw new Error(data.error?.message || `Perplexity ${res.status}`);
    const text = data.choices?.[0]?.message?.content || "";
    // Perplexity returns citations separately
    const citations = data._citations || [];
    return parseTextResponse(text, data.usage?.prompt_tokens || 0, data.usage?.completion_tokens || 0, citations);
  }

  if (provider.id === "claude") {
    const res = await fetch("/api/claude-geo", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Claude-Key": apiKey },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 4000,
        system: "Tu es un expert en recommandation d'entreprises et prestataires. Réponds directement sans mentionner les limites de tes connaissances.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const raw = await res.text();
    if (raw.trimStart().startsWith("<")) throw new Error("Proxy /api/claude-geo introuvable — ajoutez claude-geo-proxy.js dans netlify/edge-functions/");
    if (!res.ok) {
      let errMsg = `Claude ${res.status}`;
      try { errMsg = JSON.parse(raw)?.error?.message || errMsg; } catch {}
      throw new Error(errMsg);
    }
    const data = JSON.parse(raw);
    const text = data.content?.[0]?.text || "";
    if (!text) throw new Error("Réponse Claude vide — vérifiez la clé API");
    return parseTextResponse(text, data.usage?.input_tokens || 0, data.usage?.output_tokens || 0);
  }

  throw new Error(`Provider inconnu: ${provider.id}`);
}


// Parse free-text response (Gemini, Perplexity, Claude) into the standard shape
function parseTextResponse(text, inTok, outTok, extraSources = []) {
  // Try to extract JSON if model returned it
  const s = text.lastIndexOf("{"); const e = text.lastIndexOf("}");
  if (s !== -1 && e > s) {
    try {
      const parsed = JSON.parse(text.substring(s, e + 1));
      if (parsed.answer) {
        parsed._input_tokens = inTok; parsed._output_tokens = outTok;
        parsed.sources = [...(parsed.sources || []), ...extraSources].filter(Boolean);
        return parsed;
      }
    } catch {}
  }
  // Fallback: treat entire text as answer, extract URLs
  const HALLUCINATION = [/exemple\d*\./i, /example\d*\./i, /site\d+\./i, /domaine\d*\./i, /placeholder/i];
  const urlRe = /https?:\/\/[^\s\])"'>]+/g;
  const foundUrls = [...text.matchAll(urlRe)].map(m => m[0]).filter(u => !HALLUCINATION.some(p => p.test(u)));
  const allSources = [...new Set([...foundUrls, ...extraSources])];
  return {
    answer: text, answer_type: "Texte libre", intent_type: "Informative",
    sources: allSources, source_types: [],
    _input_tokens: inTok, _output_tokens: outTok,
  };
}

function extractOpenAIUrls(data) {
  // Extract real URLs from annotations (url_citation type) in Responses API
  const urls = [];
  const seen = new Set();
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) {
      // annotations array contains url_citation objects
      for (const ann of part.annotations || []) {
        if (ann.type === "url_citation" && ann.url && !seen.has(ann.url)) {
          seen.add(ann.url);
          urls.push(ann.url);
        }
      }
    }
  }
  return urls;
}

function parseOpenAIResponse(data, endpoint = "responses") {
  const usage = data.usage || {};
  const inTok = usage.input_tokens || usage.prompt_tokens || 0;
  const outTok = usage.output_tokens || usage.completion_tokens || 0;

  let rawText = "";
  if (endpoint === "responses") {
    for (const item of data.output || []) {
      if (item.type !== "message") continue;
      for (const part of item.content || []) {
        if (part.type === "output_text") rawText += part.text;
      }
    }
  } else {
    rawText = data.choices?.[0]?.message?.content || "";
  }

  // Extract real URLs from annotations FIRST (before parsing JSON)
  const realUrls = extractOpenAIUrls(data);

  // Also extract URLs directly from the answer text (markdown links + plain URLs)
  const urlRe = /https?:\/\/[^\s\])"'>]+/g;
  const HALLUCINATION = [/exemple\d*\./i, /example\d*\./i, /site\d+\./i, /domaine\d*\./i, /placeholder/i, /turn\d+search/i];
  const textUrls = [...rawText.matchAll(urlRe)]
    .map(m => m[0].replace(/[.,;:)]+$/, "")) // strip trailing punctuation
    .filter(u => !HALLUCINATION.some(p => p.test(u)));

  // Merge: annotations first (most reliable), then text URLs
  const allUrls = [...new Set([...realUrls, ...textUrls])];

  // Try to parse JSON schema response
  let parsed = { answer: rawText, answer_type: "Texte libre", intent_type: "Informative", sources: [], source_types: [] };
  const s = rawText.lastIndexOf("{");
  const e = rawText.lastIndexOf("}");
  if (s !== -1 && e > s) {
    try {
      const jsonParsed = JSON.parse(rawText.substring(s, e + 1));
      if (jsonParsed.answer) {
        parsed = jsonParsed;
        // Replace turn0searchX sources with real URLs
        const fakeSources = (parsed.sources || []).filter(u => /turn\d+search/i.test(u) || !u.startsWith("http"));
        if (fakeSources.length > 0 || allUrls.length > 0) {
          parsed.sources = allUrls;
        }
      }
    } catch {}
  }

  // If answer is still the raw JSON text, extract readable answer
  if (parsed.answer && parsed.answer.startsWith("{")) {
    parsed.answer = rawText; // use raw text as answer
  }

  // Final URL dedup and hallucination filter
  parsed.sources = [...new Set(allUrls)].filter(u => !HALLUCINATION.some(p => p.test(u)));
  parsed._input_tokens = inTok;
  parsed._output_tokens = outTok;
  return parsed;
}

// ── Brand detection — 3 types de présence ───────────────────────
//
// MENTION  = marque dans un item numéroté du Top (ligne "N. Marque")
//            position = numéro du rang dans le classement
//
// EVOCATION = marque dans le corps narratif (hors items de top, hors sources)
//             position = ordre d'apparition dans le texte narratif
//
// CITATION  = domaine de la marque dans les sources/URLs citées
//             position = rang dans la liste de sources

function detectBrand(answer, sources, brandName, brandAliases = [], competitors = []) {
  const allTerms = [brandName, ...brandAliases].filter(Boolean).map(t => t.toLowerCase().trim());
  const allCompetitorNames = competitors.filter(Boolean).map(t => t.toLowerCase().trim());

  function matches(text) {
    const t = (text || "").toLowerCase();
    return allTerms.some(term => term && t.includes(term));
  }

  const lines = (answer || "").split("\n");
  // Pattern d'item de top : "1. Titre", "2) Titre", "• 3. Titre"
  const topItemRe = /^\s*(?:[•\-*]\s*)?(\d+)[.)]\s*(.+)/;

  // ── MENTION : présence dans un item numéroté ──────────────────
  let mentionPosition = null;

  for (const line of lines) {
    const m = line.match(topItemRe);
    if (m) {
      const rank = parseInt(m[1], 10);
      const itemText = m[2];
      if (matches(itemText) && mentionPosition === null) {
        mentionPosition = rank;
      }
    }
  }

  // ── EVOCATION : présence dans le corps narratif ───────────────
  let evocationPosition = null;
  let narrativeCount = 0;

  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) continue;
    if (topItemRe.test(line)) continue;
    // Ignorer les lignes de métadonnées
    if (
      stripped.startsWith("http") ||
      stripped.startsWith("[") ||
      stripped.startsWith("- Site") ||
      stripped.startsWith("- Description") ||
      stripped.startsWith("Source") ||
      stripped.match(/^\d+\.\s*https?:/)
    ) continue;

    narrativeCount++;
    if (matches(stripped) && evocationPosition === null) {
      evocationPosition = narrativeCount;
    }
  }

  // ── CITATION : domaine dans les sources ──────────────────────
  let citationPosition = null;
  const domainTerms = allTerms.map(t => t.replace(/\s+/g, ""));

  // Aussi extraire les URLs du texte de réponse
  const urlRe = /https?:\/\/[^\s\)\],"']+/g;
  const textUrls = [...(answer || "").matchAll(urlRe)].map(m => m[0].replace(/[.,;:]+$/, ""));
  const allSources = [...new Set([...(Array.isArray(sources) ? sources : []), ...textUrls])];

  for (let i = 0; i < allSources.length; i++) {
    const src = allSources[i].toLowerCase().replace("www.", "");
    if (domainTerms.some(d => d && src.includes(d)) && citationPosition === null) {
      citationPosition = i + 1;
    }
  }

  // ── Concurrents mentionnés (rétrocompat) ─────────────────────
  const answerLower = (answer || "").toLowerCase();
  const competitorsMentioned = allCompetitorNames
    .map(name => {
      let cpos = null;
      let cp = 0;
      for (const line of lines) {
        const m = line.match(topItemRe);
        if (m) {
          cp++;
          if (line.toLowerCase().includes(name)) { cpos = cp; break; }
        }
      }
      return {
        name,
        mentioned: answerLower.includes(name),
        position: cpos,
        in_sources: allSources.some(s => s.toLowerCase().replace("www.", "").includes(name.replace(/\s+/g, ""))),
      };
    })
    .filter(c => c.mentioned);

  return {
    // Nouveaux champs structurés
    mention:   { present: mentionPosition !== null,   position: mentionPosition },
    evocation: { present: evocationPosition !== null, position: evocationPosition },
    citation:  { present: citationPosition !== null,  position: citationPosition },

    // Rétrocompat — champs utilisés par le reste de l'app
    brandMentioned:       mentionPosition !== null || evocationPosition !== null,
    brandPosition:        mentionPosition,
    brandInSources:       citationPosition !== null,
    competitorsMentioned,
  };
}




// ── Small UI helpers ──────────────────────────────────────────────



function Btn({ children, onClick, disabled, color, variant = "solid", small, title, style: extraStyle }) {
  const base = {
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: small ? "4px 14px" : "7px 20px",
    fontSize: small ? 11 : 12, fontWeight: 500,
    letterSpacing: "0.02em",
    borderRadius: 20, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.35 : 1,
    transition: "opacity 0.2s, background 0.2s",
    border: "1px solid transparent",
    userSelect: "none", whiteSpace: "nowrap",
    ...(variant === "solid"
      ? { background: "#1A3C2E", color: "#F0EBE0", borderColor: "#1A3C2E" }
      : variant === "outline" || variant === "ghost"
      ? { background: "transparent", color: "#1A3C2E", borderColor: "#1A3C2E33" }
      : { background: "#F0EBE0", color: "#1A3C2E", borderColor: "#1A3C2E11" }),
    ...extraStyle,
  };
  return <button onClick={disabled ? undefined : onClick} disabled={disabled} title={title} style={base}>{children}</button>;
}

function StatusBadge({ status }) {
  const map = {
    pending:       { label: "Prêt",       color: "#1A3C2E55" },
    generating_q:  { label: "Génération…", color: "#E8541A" },
    done_q:        { label: "Généré",      color: "#1A7A4A" },
    generating_r:  { label: "LLM…",       color: "#E8541A" },
    done:          { label: "Terminé",     color: "#1A3C2E" },
    error:         { label: "Erreur",      color: "#C0352A" },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase",
      color: s.color, padding: "0 0", background: "none", border: "none",
    }}>
      {s.label}
    </span>
  );
}

// ── Stats header ──────────────────────────────────────────────────

function StatsHeader({ questions, results, brandName, qualifiedCompetitors = [] }) {
  const total = results.length;

  // ── Métriques par type de présence (nouveaux champs + rétrocompat) ──

  // MENTION = dans un top numéroté
  const mentionResults   = results.filter(r =>
    r.brand_mention_position != null || r.brand_position != null
  );
  const mentionPositions = mentionResults
    .map(r => r.brand_mention_position || r.brand_position)
    .filter(Boolean);
  const mentionCount    = mentionResults.length;
  const mentionAvgPos   = mentionPositions.length
    ? (mentionPositions.reduce((a, b) => a + b, 0) / mentionPositions.length).toFixed(1)
    : null;

  // ÉVOCATION = dans le corps narratif hors top
  const evocationResults   = results.filter(r => r.brand_evocation_position != null);
  const evocationPositions = evocationResults
    .map(r => r.brand_evocation_position)
    .filter(Boolean);
  const evocationCount   = evocationResults.length;
  const evocationAvgPos  = evocationPositions.length
    ? (evocationPositions.reduce((a, b) => a + b, 0) / evocationPositions.length).toFixed(1)
    : null;

  // CITATION = domaine dans les sources
  const citationResults   = results.filter(r =>
    r.brand_citation_position != null || r.brand_in_sources
  );
  const citationPositions = citationResults
    .map(r => r.brand_citation_position)
    .filter(Boolean);
  const citationCount   = citationResults.length;
  const citationAvgPos  = citationPositions.length
    ? (citationPositions.reduce((a, b) => a + b, 0) / citationPositions.length).toFixed(1)
    : null;


  // Top competitors
  const compCount = {};
  results.forEach(r => {
    const seen = new Set();
    (r.competitors_mentioned || []).forEach(c => {
      if (c.name && !seen.has(c.name)) {
        seen.add(c.name);
        compCount[c.name] = (compCount[c.name] || 0) + 1;
      }
    });
  });
  const topComps = Object.entries(compCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Top domains
  const domainCount = {};
  results.forEach(r => (r.sources || []).forEach(url => {
    try {
      const d = new URL(url).hostname.replace("www.", "");
      domainCount[d] = (domainCount[d] || 0) + 1;
    } catch {}
  }));
  const topDomains = Object.entries(domainCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // ── Helper : couleur selon le taux (nb / total) ───────────────
  function rateColor(count) {
    if (!total) return "";
    const pct = count / total * 100;
    return pct >= 50 ? "gt-success" : pct > 0 ? "gt-warn" : "gt-danger";
  }

  return (
    <div style={{ marginBottom: 24 }}>

      {/* ── 3 couples Présence + Position ── */}
      <div className="gt-kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 12 }}>

        {/* Mention */}
        <div className="gt-kpi-card">
          <div className="gt-kpi-label" style={{ marginBottom: 6 }}>
            Mention
            <span className="gt-caption" style={{ marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>
              dans le top
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <div className={`gt-kpi-val ${rateColor(mentionCount)}`}>
              {total ? Math.round(mentionCount / total * 100) : 0}%
            </div>
            {mentionAvgPos && (
              <div className="gt-caption" style={{ fontVariantNumeric: "tabular-nums" }}>
                pos. moy. #{mentionAvgPos}
              </div>
            )}
          </div>
          <div className="gt-kpi-sub">{mentionCount} / {total} réponses</div>
        </div>

        {/* Évocation */}
        <div className="gt-kpi-card">
          <div className="gt-kpi-label" style={{ marginBottom: 6 }}>
            Évocation
            <span className="gt-caption" style={{ marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>
              dans le texte
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <div className={`gt-kpi-val ${rateColor(evocationCount)}`}>
              {total ? Math.round(evocationCount / total * 100) : 0}%
            </div>
            {evocationAvgPos && (
              <div className="gt-caption" style={{ fontVariantNumeric: "tabular-nums" }}>
                pos. moy. #{evocationAvgPos}
              </div>
            )}
          </div>
          <div className="gt-kpi-sub">{evocationCount} / {total} réponses</div>
        </div>

        {/* Citation */}
        <div className="gt-kpi-card">
          <div className="gt-kpi-label" style={{ marginBottom: 6 }}>
            Citation
            <span className="gt-caption" style={{ marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>
              dans les sources
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <div className={`gt-kpi-val ${rateColor(citationCount)}`}>
              {total ? Math.round(citationCount / total * 100) : 0}%
            </div>
            {citationAvgPos && (
              <div className="gt-caption" style={{ fontVariantNumeric: "tabular-nums" }}>
                pos. moy. #{citationAvgPos}
              </div>
            )}
          </div>
          <div className="gt-kpi-sub">{citationCount} / {total} réponses</div>
        </div>
      </div>

      {/* ── Concurrents + Sites ── */}
      <div className="gt-kpi-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>

        {/* Concurrents */}
        <div className="gt-kpi-card">
          <div className="gt-kpi-label" style={{ marginBottom: 10 }}>Concurrents cités</div>
          {topComps.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {topComps.map(([name, cnt]) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="gt-body-sm" style={{ fontWeight: 500 }}>{name}</span>
                  <span className="gt-caption" style={{ fontVariantNumeric: "tabular-nums" }}>{cnt}×</span>
                </div>
              ))}
            </div>
          ) : (
            <span className="gt-caption" style={{ fontStyle: "italic" }}>Aucun concurrent identifié</span>
          )}
        </div>

        {/* Sites */}
        <div className="gt-kpi-card">
          <div className="gt-kpi-label" style={{ marginBottom: 10 }}>Sites les plus cités</div>
          {topDomains.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {topDomains.map(([domain, cnt]) => {
                const isBrand = brandName && domain.toLowerCase().includes(brandName.toLowerCase().replace(/\s+/g, ""));
                return (
                  <div key={domain} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="gt-body-sm" style={{
                      fontWeight: 500,
                      color: isBrand ? "#1A7A4A" : undefined,
                      background: isBrand ? "#1A7A4A11" : "transparent",
                      borderRadius: 4, padding: isBrand ? "0 4px" : 0,
                    }}>{domain}</span>
                    <span className="gt-caption" style={{ fontVariantNumeric: "tabular-nums" }}>{cnt}×</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="gt-caption" style={{ fontStyle: "italic" }}>Aucun domaine source identifié</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Competitor categories ─────────────────────────────────────────
const COMP_CATEGORIES = [
  { key: "direct",  label: "Concurrent direct",  color: "#DC2626", bg: "#FEF2F2" },
  { key: "geo",     label: "Concurrent GEO",      color: "#D97706", bg: "#FFFBEB" },
  { key: "partner", label: "Partenaire",           color: "#059669", bg: "#ECFDF5" },
  { key: "other",   label: "Autre",                color: "#64748B", bg: "#F1F5F9" },
];

function CompetitorManager({ projectId, siteId, allResults, competitors, setCompetitors }) {
  const [newName, setNewName] = useState("");
  const [newCat,  setNewCat]  = useState("direct");
  const [saving,  setSaving]  = useState(false);
  const [sortBy,  setSortBy]  = useState("mentions");

  const detectedNames = useMemo(() => {
    const mentions = {}; const display = {};
    allResults.forEach(r => {
      (r.competitors_mentioned || []).forEach(c => {
        if (!c.name) return;
        const lower = c.name.toLowerCase();
        mentions[lower] = (mentions[lower] || 0) + 1;
        if (!display[lower]) display[lower] = c.name;
      });
    });
    // Recherche rétroactive
    competitors.forEach(comp => {
      const lower = comp.name.toLowerCase();
      const re = new RegExp(comp.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      allResults.forEach(r => {
        const already = (r.competitors_mentioned || []).some(c => c.name?.toLowerCase() === lower);
        if (!already && re.test(r.answer || "")) {
          mentions[lower] = (mentions[lower] || 0) + 1;
          if (!display[lower]) display[lower] = comp.name;
        }
      });
    });
    return Object.keys(mentions).map(lower => ({
      name: display[lower] || lower, lower,
      mentions: mentions[lower] || 0,
    })).sort((a, b) => b.mentions - a.mentions);
  }, [allResults, competitors]); // eslint-disable-line react-hooks/exhaustive-deps

  const getCatDef = (cat) => COMP_CATEGORIES.find(c => c.key === cat) || COMP_CATEGORIES[3];

  const save = async () => {
    if (!newName.trim() || !projectId || !siteId) return;
    setSaving(true);
    try {
      const catDef = getCatDef(newCat);
      const saved = await sbSaveCompetitor({ project_id: projectId, site_id: siteId, name: newName.trim(), category: newCat, color: catDef.color, enabled: true });
      setCompetitors(prev => {
        const idx = prev.findIndex(c => c.name.toLowerCase() === newName.trim().toLowerCase());
        if (idx >= 0) { const n = [...prev]; n[idx] = saved; return n; }
        return [...prev, saved].sort((a, b) => a.name.localeCompare(b.name));
      });
      setNewName("");
    } catch(e) { console.error(e); }
    setSaving(false);
  };

  const updateCat = async (comp, category) => {
    const catDef = getCatDef(category);
    try {
      await sbUpdateCompetitor(comp.id, { category, color: catDef.color });
      setCompetitors(prev => prev.map(c => c.id === comp.id ? { ...c, category, color: catDef.color } : c));
    } catch(e) { console.error(e); }
  };

  const updateEnabled = async (comp, enabled) => {
    try {
      await sbUpdateCompetitor(comp.id, { enabled });
      setCompetitors(prev => prev.map(c => c.id === comp.id ? { ...c, enabled } : c));
    } catch(e) { console.error(e); }
  };

  const remove = async (id) => {
    try { await sbDeleteCompetitor(id); setCompetitors(prev => prev.filter(c => c.id !== id)); }
    catch(e) { console.error(e); }
  };

  const displayed = useMemo(() => {
    return [...competitors].sort((a, b) => {
      if (sortBy === "alpha") return a.name.localeCompare(b.name);
      if (sortBy === "cat") return (a.category||"").localeCompare(b.category||"");
      const ma = detectedNames.find(d => d.lower === a.name.toLowerCase())?.mentions || 0;
      const mb = detectedNames.find(d => d.lower === b.name.toLowerCase())?.mentions || 0;
      return mb - ma;
    });
  }, [competitors, sortBy, detectedNames]);

  return (
    <div>
      {/* Formulaire ajout */}
      <div style={{ background: "transparent", border: "none", borderBottom: "0.5px solid #1A3C2E0D", padding: "0 0 16px 0", marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#1A3C2E44", marginBottom: 10 }}>Ajouter un concurrent</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nom du concurrent…"
            onKeyDown={e => e.key === "Enter" && save()}
            style={{ flex: "1 1 180px", padding: "6px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12 }} />
          <select value={newCat} onChange={e => setNewCat(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12 }}>
            {COMP_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <button onClick={save} disabled={saving || !newName.trim()}
            style={{ padding: "6px 14px", background: newName.trim() ? "#1A3C2E" : "#F1F5F9", color: newName.trim() ? "#F0EBE0" : "#94A3B8", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: newName.trim() ? "pointer" : "default" }}>
            {saving ? "…" : "Ajouter"}
          </button>
        </div>
      </div>
      {/* Détectés non qualifiés */}
      {detectedNames.filter(d => !competitors.some(c => c.name.toLowerCase() === d.lower)).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Détectés dans les réponses — non qualifiés</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {detectedNames.filter(d => !competitors.some(c => c.name.toLowerCase() === d.lower)).slice(0, 12).map(d => (
              <button key={d.lower} onClick={() => { setNewName(d.name); }}
                style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#64748B", cursor: "pointer" }}>
                {d.name} <span style={{ color: "#94A3B8" }}>{d.mentions}×</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Liste qualifiés */}
      {competitors.length > 0 && (
        <div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: "#94A3B8" }}>{competitors.length} concurrent{competitors.length > 1 ? "s" : ""} qualifié{competitors.length > 1 ? "s" : ""}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              {[{ key: "mentions", label: "Mentions" }, { key: "alpha", label: "A→Z" }, { key: "cat", label: "Catégorie" }].map(s => (
                <button key={s.key} onClick={() => setSortBy(s.key)}
                  style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, border: `1px solid ${sortBy === s.key ? "#1A3C2E" : "#E2E8F0"}`, background: sortBy === s.key ? "#1A3C2E" : "transparent", color: sortBy === s.key ? "#F0EBE0" : "#64748B", cursor: "pointer" }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {displayed.map(comp => {
              const catDef = getCatDef(comp.category);
              const mentions = detectedNames.find(d => d.lower === comp.name.toLowerCase())?.mentions || 0;
              const enabled = comp.enabled !== false;
              return (
                <div key={comp.id} style={{ border: "none", borderBottom: "0.5px solid #1A3C2E08", borderRadius: 0, background: "transparent", padding: "9px 0", display: "flex", alignItems: "center", gap: 8, opacity: enabled ? 1 : 0.4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: catDef.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#1A3C2E", flex: 1 }}>{comp.name}</span>
                  {mentions > 0 && <span style={{ fontSize: 10, color: catDef.color, background: "#fff", border: `1px solid ${catDef.color}33`, borderRadius: 5, padding: "1px 6px", fontWeight: 600 }}>{mentions}×</span>}
                  <button onClick={() => updateEnabled(comp, !enabled)}
                    style={{ width: 32, height: 18, borderRadius: 9, border: "none", cursor: "pointer", background: enabled ? "#1A3C2E" : "#CBD5E1", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                    <span style={{ position: "absolute", top: 1, left: enabled ? 15 : 1, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
                  </button>
                  <select value={comp.category} onChange={e => updateCat(comp, e.target.value)}
                    style={{ fontSize: 10, padding: "2px 5px", border: `1px solid ${catDef.color}44`, borderRadius: 5, background: "#fff", color: catDef.color, fontWeight: 700, cursor: "pointer" }}>
                    {COMP_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <button onClick={() => remove(comp.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", fontSize: 11 }}>✕</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {competitors.length === 0 && detectedNames.length === 0 && (
        <div style={{ fontSize: 12, color: "#94A3B8", fontStyle: "italic" }}>Interrogez des questions pour détecter les concurrents cités.</div>
      )}
    </div>
  );
}

// ── Category Manager ─────────────────────────────────────────────

const CAT_COLORS = ["#2563EB","#059669","#7C3AED","#D97706","#DC2626","#0891B2","#EA580C","#64748B"];

function CategoryManager({ projectId, categories, setCategories, compact }) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(CAT_COLORS[0]);
  const [adding, setAdding] = useState(false);

  const add = async () => {
    if (!newName.trim()) return;
    try {
      const cat = await sbSaveCategory({ project_id: projectId, name: newName.trim(), color: newColor });
      setCategories(prev => [...prev, cat]);
      setNewName(""); setAdding(false);
    } catch(e) { console.error(e); }
  };

  const del = async (id) => {
    await sbDeleteCategory(id);
    setCategories(prev => prev.filter(c => c.id !== id));
  };

  if (compact) return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {categories.map(c => (
        <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: c.color + "18", color: c.color, border: `1px solid ${c.color}44` }}>
          {c.name}
          <button onClick={() => del(c.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: c.color, padding: 0, lineHeight: 1 }}>×</button>
        </span>
      ))}
      {adding ? (
        <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          {CAT_COLORS.map(col => (
            <button key={col} onClick={() => setNewColor(col)} style={{ width: 14, height: 14, borderRadius: "50%", background: col, border: `2px solid ${newColor === col ? "#000" : "transparent"}`, cursor: "pointer" }} />
          ))}
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="Nom…" style={{ padding: "2px 6px", border: "0.5px solid #1A3C2E0D", borderRadius: 6, fontSize: 11, width: 100 }} />
          <button onClick={add} style={{ padding: "2px 7px", borderRadius: 6, background: newColor, color: "#fff", border: "none", fontSize: 11, cursor: "pointer" }}>OK</button>
          <button onClick={() => setAdding(false)} style={{ padding: "2px 6px", borderRadius: 6, background: "#FAFAF8", border: "0.5px solid #1A3C2E0D", fontSize: 11, cursor: "pointer" }}>✕</button>
        </span>
      ) : (
        <button onClick={() => setAdding(true)} style={{ padding: "2px 8px", borderRadius: 12, fontSize: 11, background: "#FAFAF8", border: `1px dashed ${C.border}`, color: C.textLight, cursor: "pointer" }}>+ Catégorie</button>
      )}
    </div>
  );

  return null;
}

// ── Category selector dropdown ────────────────────────────────────

// ── Multi-tag selector ───────────────────────────────────────────
function TagSelect({ values = [], categories, onChange, placeholder = "Tags…" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const toggle = (id) => {
    const next = values.includes(id) ? values.filter(v => v !== id) : [...values, id];
    onChange(next);
  };
  const selected = categories.filter(c => values.includes(c.id));
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", minWidth: 80, padding: "3px 6px", border: "0.5px solid #1A3C2E0D", borderRadius: 7, cursor: "pointer", background: "#fff", fontSize: 11 }}>
        {selected.length === 0
          ? <span style={{ color: C.textLight }}>{placeholder}</span>
          : selected.map(c => (
            <span key={c.id} style={{ background: c.color + "22", color: c.color, border: `1px solid ${c.color}44`, borderRadius: 4, padding: "1px 5px", fontSize: 10, fontWeight: 700 }}>
              {c.name}
            </span>
          ))
        }
        <span style={{ color: C.textLight, marginLeft: 2 }}>▾</span>
      </div>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200, background: "#fff", border: "0.5px solid #1A3C2E0D", borderRadius: 9, boxShadow: "0 4px 16px rgba(0,0,0,0.1)", padding: 6, minWidth: 160 }}>
          {categories.length === 0
            ? <div style={{ fontSize: 11, color: C.textLight, padding: "4px 8px" }}>Aucune catégorie</div>
            : categories.map(c => (
              <div key={c.id} onClick={() => toggle(c.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, cursor: "pointer", background: values.includes(c.id) ? c.color + "18" : "transparent" }}>
                <div style={{ width: 14, height: 14, borderRadius: 4, border: `2px solid ${values.includes(c.id) ? c.color : C.border}`, background: values.includes(c.id) ? c.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {values.includes(c.id) && <span style={{ color: "#fff", fontSize: 9, lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{ fontSize: 11, color: c.color, fontWeight: 600 }}>{c.name}</span>
              </div>
            ))
          }
          {selected.length > 0 && (
            <div onClick={() => onChange([])}
              style={{ marginTop: 4, padding: "4px 8px", fontSize: 10, color: C.textLight, cursor: "pointer", borderTop: `1px solid ${C.border}` }}>
              ✕ Tout retirer
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CatSelect({ value, categories, onChange, placeholder = "Catégorie…" }) {
  return (
    <select value={value || ""} onChange={e => onChange(e.target.value || null)}
      style={{ padding: "4px 8px", border: "0.5px solid #1A3C2E0D", borderRadius: 6, fontSize: 11, color: C.text, background: "#fff", cursor: "pointer" }}>
      <option value="">{placeholder}</option>
      {(Array.isArray(categories) ? categories : []).filter(c => c.id && c.name).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

// ── Keywords sub-tab (v2) ─────────────────────────────────────────

function KeywordsTab({ site, projectId, apiKey, model, axes, context, categories, setCategories, onAxesChange, onQuestionsGenerated, semrushKey = "", providerKeys = {} }) {
  const [keywords, setKeywords] = useState([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [busy, setBusy]         = useState({});
  const [runningAll, setRunningAll] = useState(false);
  const [selected, setSelected]   = useState(new Set());
  const [bulkCat, setBulkCat]     = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterSearch, setFilterSearch] = useState(""); // regex/text filter on keyword
  const stopRef = useRef(false);
  const [enriching, setEnriching] = useState(false);
  const fileVolRef = useRef(null);

  useEffect(() => {
    if (!projectId || !site?.id) return;
    // Load keywords + count questions per keyword
    Promise.all([
      sbGetKeywords(projectId, site.id),
      sbGetQuestions(projectId, site.id),
    ]).then(([kws, qs]) => {
      const countByKw = {};
      qs.forEach(q => { if (q.keyword_id) countByKw[q.keyword_id] = (countByKw[q.keyword_id] || 0) + 1; });
      setKeywords(kws.map(k => ({ ...k, question_count: countByKw[k.id] || 0 })));
    });
  }, [projectId, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addKeywords = async () => {
    const lines = input.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setLoading(true);
    try {
      const rows = lines.map(keyword => ({ project_id: projectId, site_id: site.id, keyword, status: "pending" }));
      const saved = await sbSaveKeywords(rows);
      setKeywords(prev => [...saved, ...prev]);
      setInput("");
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  // Import CSV: col1=keyword, col2=category name
  const importCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const rows = parseCSV(ev.target.result).filter(r => r[0]);
      const toAdd = [];
      for (const [keyword, catName] of rows) {
        const cat = catName ? categories.find(c => c.name.toLowerCase() === catName.toLowerCase()) : null;
        toAdd.push({ project_id: projectId, site_id: site.id, keyword, status: "pending", ...(cat ? { category_id: cat.id } : {}) });
      }
      if (!toAdd.length) return;
      const saved = await sbSaveKeywords(toAdd);
      setKeywords(prev => [...saved, ...prev]);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── Volume enrichment from Semrush API ──────────────────────
  const enrichFromApi = async () => {
    if (!semrushKey || !keywords.length) return;
    setEnriching(true);
    const batch = keywords.slice(0, 100);
    try {
      const res = await fetch("/api/semrush-volume", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Semrush-Key": semrushKey },
        body: JSON.stringify({ keywords: batch.map(k => k.keyword), database: "fr" }),
      });
      const data = await res.json();
      if (data.error) { alert("Erreur Semrush : " + data.error); return; }
      const vols = data.volumes || {};
      for (const kw of batch) {
        const vol = vols[kw.keyword.toLowerCase()];
        if (vol !== undefined) {
          await sbUpdateKeywordVolume(kw.id, vol, "semrush_api");
          setKeywords(prev => prev.map(k => k.id === kw.id ? { ...k, search_volume: vol, volume_source: "semrush_api" } : k));
        }
      }
    } catch(e) { alert("Erreur : " + e.message); }
    setEnriching(false);
  };

  // ── Volume enrichment from Semrush CSV ───────────────────────
  const enrichFromCsv = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target.result;
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) return;
      const header = lines[0].split(";").map(h => h.toLowerCase().replace(/"/g, "").trim());
      const kwIdx  = header.findIndex(h => h === "keyword" || h === "mot-clé" || h.startsWith("keyword"));
      const volIdx = header.findIndex(h => h === "volume" || h.includes("volume"));
      if (kwIdx === -1 || volIdx === -1) {
        alert("Colonnes non trouvées. Le CSV doit avoir des colonnes 'Keyword' et 'Volume'.");
        return;
      }
      const volMap = {};
      for (const line of lines.slice(1)) {
        const cols = line.split(";").map(c => c.replace(/"/g, "").trim());
        const kw  = cols[kwIdx]?.toLowerCase();
        const vol = parseInt(cols[volIdx], 10);
        if (kw && !isNaN(vol)) volMap[kw] = vol;
      }
      let updated = 0;
      for (const kw of keywords) {
        const vol = volMap[kw.keyword.toLowerCase()];
        if (vol !== undefined) {
          await sbUpdateKeywordVolume(kw.id, vol, "semrush_csv");
          setKeywords(prev => prev.map(k => k.id === kw.id ? { ...k, search_volume: vol, volume_source: "semrush_csv" } : k));
          updated++;
        }
      }
      alert(`${updated} mot${updated > 1 ? "s-clés" : "-clé"} enrichi${updated > 1 ? "s" : ""} depuis le CSV.`);
      if (fileVolRef.current) fileVolRef.current.value = "";
    };
    reader.readAsText(file, "UTF-8");
  };

  const generateQuestions = async (kw, axes) => {
    // Use providerKeys.openai first (set via UI), fallback to legacy apiKey prop
    const resolvedKey = providerKeys?.openai?.dec || apiKey;
    if (!resolvedKey) return;
    setBusy(b => ({ ...b, [kw.id]: "q" }));
    await sbUpdateKeywordStatus(kw.id, "generating_q");
    setKeywords(prev => prev.map(k => k.id === kw.id ? { ...k, status: "generating_q" } : k));
    try {
      const activeAxes = (axes && axes.length ? axes : DEFAULT_AXES);
      const numQ = activeAxes.length;
      const axesWithInstructions = activeAxes.map((axe, i) => `${i+1}. [${axe}]`).join("\n");
      const prompt = `Tu es un expert GEO. Pour le mot-clé "${kw.keyword}", génère exactement ${numQ} questions de recherche — une par axe ci-dessous.

OBJECTIF : chaque question doit naturellement amener un moteur IA (ChatGPT, Gemini, Perplexity) à citer des noms de marques, d'enseignes, de sites ou d'entreprises concrètes — jamais une réponse générique ou des conseils.

TERMINOLOGIE : adapte au contexte du mot-clé :
- Commerce / retail → privilégie "magasins", "enseignes", "boutiques"
- Services / B2B → privilégie "entreprises", "prestataires", "agences"
- E-commerce / web → privilégie "sites", "plateformes", "marques"
- Mixte → utilise le terme le plus naturel pour ce secteur

RÈGLE sur les axes :
- Chaque axe définit l'angle de la question, pas son sujet
- La réponse attendue doit toujours être une liste de noms (marques, sites, entreprises)
- "Alternative / pistes" = qui propose ce produit/service — PAS quoi remplace ce produit

AXES À TRAITER :
${axesWithInstructions}

CONTRAINTES :
- Une question par axe, dans l'ordre
- Maximum 12 mots par question
- Commence par "Quelles", "Quel", "Qui", "Lesquels" de préférence
- Ton naturel, comme une vraie requête de recherche

Réponds UNIQUEMENT avec les ${numQ} questions séparées par des points-virgules (;), sans numérotation, sans texte avant ou après.`;

      // Direct fetch — plain text, no json_object format
      const res = await fetch("/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Openai-Key": resolvedKey, "X-Openai-Endpoint": "completions" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 400 }),
      });
      const text = await res.text();
      if (text.trimStart().startsWith("<")) throw new Error("Proxy /api/openai introuvable — copiez openai-proxy.js dans netlify/edge-functions/");
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Réponse non-JSON (${res.status}): ${text.slice(0,100)}`); }
      if (!res.ok) {
        const msg = data?.error?.message || data?.error || text.slice(0, 200);
        throw new Error(`OpenAI ${res.status}: ${msg}`);
      }

      const raw = (data?.choices?.[0]?.message?.content || "").trim();
      if (!raw) throw new Error(`Réponse vide. Data reçue: ${JSON.stringify(data).slice(0, 200)}`);

      const questions = raw
        .split(/[;\n]/)
        .map(s => s.replace(/^\s*\d+[.)\s]+/, "").trim())
        .filter(s => s.length > 5 && s.length < 250);

      if (!questions.length) throw new Error(`Parsing échoué. Reçu: "${raw.slice(0, 100)}"`);

      // Save — strip category_id if column not migrated yet
      const baseRow = (q) => ({ project_id: projectId, site_id: site.id, keyword_id: kw.id, question: q, is_manual: false });
      let saved;
      try {
        const qRows = questions.map(q => kw.category_id ? { ...baseRow(q), category_id: kw.category_id } : baseRow(q));
        saved = await sbSaveQuestions(qRows);
      } catch(saveErr) {
        console.warn("Retry without category_id:", saveErr.message);
        saved = await sbSaveQuestions(questions.map(baseRow));
      }
      const savedCount = Array.isArray(saved) ? saved.length : questions.length;
      console.log(`✓ ${savedCount} questions saved for "${kw.keyword}"`);

      await sbUpdateKeywordStatus(kw.id, "done_q");
      setKeywords(prev => prev.map(k => k.id === kw.id
        ? { ...k, status: "done_q", question_count: (k.question_count || 0) + savedCount }
        : k
      ));
      onQuestionsGenerated?.(false);
    } catch(e) {
      console.error("generateQuestions error:", e);
      await sbUpdateKeywordStatus(kw.id, "error");
      setKeywords(prev => prev.map(k => k.id === kw.id ? { ...k, status: "error", error_msg: e.message } : k));
    }
    setBusy(b => ({ ...b, [kw.id]: false }));
  };

  const deleteKw = async (id) => {
    await sbDeleteKeyword(id);
    setKeywords(prev => prev.filter(k => k.id !== id));
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const generateAll = async () => {
    if (!apiKey) { setKeywords(prev => prev); return; } // apiKey missing shown in UI
    const toProcess = keywords.filter(kw => kw.status === "pending" || kw.status === "error");
    if (!toProcess.length) return;
    setRunningAll(true);
    stopRef.current = false;
    for (const kw of toProcess) {
      if (stopRef.current) break;
      await generateQuestions(kw, null);
    }
    setRunningAll(false);
    onQuestionsGenerated?.(true);
  };

  const toggleSelect = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSelected(new Set());

  const applyBulkCat = async () => {
    if (!bulkCat || !selected.size) return;
    const ids = [...selected];
    await sbBulkSetKeywordCategory(ids, bulkCat || null);
    setKeywords(prev => prev.map(k => selected.has(k.id) ? { ...k, category_id: bulkCat || null } : k));
    clearSel(); setBulkCat("");
  };

  const bulkGenerate = async () => {
    const resolvedKey = providerKeys?.openai?.dec || apiKey;
    if (!selected.size || !resolvedKey) return;
    const toProcess = keywords.filter(k => selected.has(k.id));
    setRunningAll(true);
    stopRef.current = false;
    for (const kw of toProcess) {
      if (stopRef.current) break;
      await generateQuestions(kw, null);
    }
    setRunningAll(false);
    onQuestionsGenerated?.(true);
  };

  const bulkDelete = async () => {
    if (!selected.size) return;
    const ids = [...selected];
    await Promise.all(ids.map(id => sbDeleteKeyword(id)));
    setKeywords(prev => prev.filter(k => !selected.has(k.id)));
    clearSel();
  };

  const setTagsSingle = async (kwId, tags) => {
    await sbSetKeywordTags(kwId, tags);
    setKeywords(prev => prev.map(k => k.id === kwId ? { ...k, tags: tags || [] } : k));
  };

  const filtered = useMemo(() => {
    let kws = keywords;
    if (filterCat) kws = kws.filter(k => (k.tags || (k.category_id ? [k.category_id] : [])).includes(filterCat));
    if (filterSearch.trim()) {
      try {
        const rx = new RegExp(filterSearch.trim(), "i");
        kws = kws.filter(k => rx.test(k.keyword));
      } catch {
        kws = kws.filter(k => k.keyword.toLowerCase().includes(filterSearch.trim().toLowerCase()));
      }
    }
    return kws;
  }, [keywords, filterCat, filterSearch]);


  return (
    <div>
      {/* ── Volume enrichment toolbar ── */}
      {keywords.length > 0 && (
        <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#1D4ED8" }}>🔍 Volumes de recherche</span>
          <span style={{ fontSize: 11, color: "#3B82F6" }}>
            {keywords.filter(k => k.search_volume != null).length}/{keywords.length} enrichis
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <input ref={fileVolRef} type="file" accept=".csv" style={{ display: "none" }} onChange={enrichFromCsv} />
            <button onClick={() => fileVolRef.current?.click()}
              style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", border: "1px solid #BFDBFE", borderRadius: 7, background: "#fff", color: "#2563EB", cursor: "pointer" }}>
              📄 CSV Semrush
            </button>
            <button onClick={enrichFromApi} disabled={enriching || !semrushKey}
              title={!semrushKey ? "Clé API Semrush non configurée — ajoutez-la dans ⚙️ Gestion des Providers" : "Récupérer les volumes depuis l'API Semrush (1 crédit/mot-clé)"}
              style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", border: "1px solid #BFDBFE", borderRadius: 7, background: semrushKey ? "#2563EB" : C.bg, color: semrushKey ? "#fff" : C.textLight, cursor: semrushKey ? "pointer" : "not-allowed", opacity: semrushKey ? 1 : 0.6 }}>
              {enriching ? "⏳ Enrichissement…" : "⚡ API Semrush"}
            </button>
          </div>
        </div>
      )}

      {/* Input + CSV import */}
      <div style={{ background: "#fff", border: "0.5px solid #1A3C2E0D", borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, marginBottom: 6 }}>Ajouter des mots-clés (un par ligne)</div>
            <textarea value={input} onChange={e => setInput(e.target.value)}
              placeholder={"Mot clé 1\nMot clé 2\nMot clé 3"}
              style={{ width: "100%", minHeight: 90, padding: "8px 12px", border: "0.5px solid #1A3C2E0D", borderRadius: 8, fontSize: 12, color: C.text, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <Btn onClick={addKeywords} disabled={loading || !input.trim()}>{loading ? "Ajout…" : "➕ Ajouter"}</Btn>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 22 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "0.5px solid #1A3C2E0D", borderRadius: 8, fontSize: 12, fontWeight: 600, color: C.textMid, cursor: "pointer", background: C.white }}>
              📥 Importer CSV
              <input type="file" accept=".csv,.txt" onChange={importCSV} style={{ display: "none" }} />
            </label>
            <div style={{ fontSize: 10, color: C.textLight }}>Col. 1 = mot-clé<br />Col. 2 = catégorie (optionnel)</div>
          </div>
        </div>
      </div>

      {/* Categories */}
      <div style={{ background: "#fff", border: "0.5px solid #1A3C2E0D", borderRadius: 12, padding: "12px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, marginBottom: 8 }}>Catégories du projet</div>
        <CategoryManager projectId={projectId} categories={categories} setCategories={setCategories} compact />
      </div>

      {/* Bulk bar + filters */}
      {keywords.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {/* Row 1: stats + search/regex + category filter */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: C.textLight, flexShrink: 0 }}>
              {filtered.length} mot{filtered.length > 1 ? "s-clés" : "-clé"}
              {" · "}<span style={{ color: "#059669", fontWeight: 600 }}>{filtered.filter(k => k.status === "done_q" || k.status === "done").length} générés</span>
              {" · "}{filtered.reduce((s, k) => s + (k.question_count || 0), 0)} question{filtered.reduce((s, k) => s + (k.question_count || 0), 0) > 1 ? "s" : ""}
              {selected.size > 0 && <strong style={{ color: C.text }}> · {selected.size} sélectionné{selected.size > 1 ? "s" : ""}</strong>}
            </span>

            {/* Regex search */}
            <input
              value={filterSearch}
              onChange={e => { setFilterSearch(e.target.value); setSelected(new Set()); }}
              placeholder="Filtrer par regex ou texte…"
              style={{ flex: 1, minWidth: 160, padding: "4px 10px", border: `1px solid ${filterSearch ? "#7C3AED" : C.border}`, borderRadius: 7, fontSize: 11, color: C.text }}
            />
            {filterSearch && (
              <button onClick={() => setFilterSearch("")} style={{ fontSize: 11, padding: "3px 8px", border: "0.5px solid #1A3C2E0D", borderRadius: 5, background: "#fff", cursor: "pointer", color: C.textMid }}>✕</button>
            )}

            {/* Filter by category */}
            <CatSelect value={filterCat} categories={categories} onChange={v => { setFilterCat(v || ""); setSelected(new Set()); }} placeholder="Toutes catégories" />
          </div>

          {/* Row 2: select all + bulk actions */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {/* Select all filtered */}
            <input
              type="checkbox"
              checked={filtered.length > 0 && filtered.every(k => selected.has(k.id))}
              onChange={e => e.target.checked ? setSelected(new Set(filtered.map(k => k.id))) : clearSel()}
              title="Tout sélectionner / désélectionner"
              style={{ cursor: "pointer", width: 14, height: 14 }}
            />
            <span style={{ fontSize: 11, color: C.textLight }}>
              {selected.size > 0 ? `${selected.size} sélectionné${selected.size > 1 ? "s" : ""}` : "Tout sélectionner"}
            </span>

            {selected.size > 0 && (
              <>
                <div style={{ width: 1, height: 14, background: C.border, margin: "0 2px" }} />
                {/* Bulk categorize */}
                <CatSelect value={bulkCat} categories={categories} onChange={setBulkCat} placeholder="Catégorie…" />
                {bulkCat && <Btn onClick={applyBulkCat} disabled={!bulkCat} small color="#7C3AED">Appliquer</Btn>}
                {/* Bulk generate */}
                <Btn onClick={bulkGenerate} disabled={runningAll || !apiKey} small color={site.color}
                  title={!apiKey ? "Clé OpenAI manquante — ajoutez-la dans ⚙️ Gestion des Providers" : `Générer les questions pour ${selected.size} mot${selected.size > 1 ? "s-clés" : "-clé"}`}>
                  💬 Générer ({selected.size})
                </Btn>
                {/* Bulk delete */}
                <Btn onClick={bulkDelete} small color="#DC2626" variant="outline"
                  title={`Supprimer ${selected.size} mot${selected.size > 1 ? "s-clés" : "-clé"}`}>
                  🗑 Supprimer ({selected.size})
                </Btn>
              </>
            )}

            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              {runningAll && <Btn onClick={() => { stopRef.current = true; setRunningAll(false); }} color="#DC2626" variant="outline" small>⏹ Arrêter</Btn>}
            <Btn onClick={generateAll} disabled={runningAll || (!apiKey && !providerKeys?.openai?.dec)} color={site.color} small
              title={(!apiKey && !providerKeys?.openai?.dec) ? "Clé OpenAI manquante — ajoutez-la dans ⚙️ Gestion des Providers (en haut de page)" : undefined}>
              {runningAll ? "⏳ Génération en cours…" : "💬 Générer toutes les questions"}
            </Btn>
          </div>
          </div>
        </div>
      )}

      {/* Keywords list */}
      {filtered.length === 0 ? (
        keywords.length === 0 ? (
          <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: "20px 24px", marginTop: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E", marginBottom: 10 }}>⚠️ Aucun mot-clé ajouté</div>
            <div style={{ fontSize: 12, color: "#78350F", lineHeight: 1.6, marginBottom: 14 }}>Ajoutez vos mots-clés ci-dessus, puis configurez :</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ background: "#fff", border: "2px solid #F59E0B", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>⚙️</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#92400E" }}>Gestion des Providers</div>
                  <div style={{ fontSize: 11, color: "#B45309" }}>Ajoutez vos clés API dans <strong>⚙️ Gestion des Providers</strong> en haut de l'onglet</div>
                </div>
              </div>
              <div style={{ background: "#fff", border: "2px solid #F59E0B", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>🏷️</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#92400E" }}>Setup de la marque</div>
                  <div style={{ fontSize: 11, color: "#B45309" }}>Renseignez votre marque et vos concurrents dans la <strong>carte du site</strong> ci-dessus</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: 40, color: C.textLight, fontSize: 12 }}>
            Aucun mot-clé dans cette catégorie
          </div>
        )
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map(kw => {
            const isSel = selected.has(kw.id);
            return (
              <div key={kw.id} className={`gt-item${isSel ? " gt-item--selected" : ""}`} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="checkbox" checked={isSel} onChange={() => toggleSelect(kw.id)} style={{ cursor: "pointer", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{kw.keyword}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 3, alignItems: "center", flexWrap: "wrap" }}>
                    <StatusBadge status={kw.status} />
                    {kw.search_volume > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#2563EB", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "1px 8px" }}
                        title={`Volume de recherche mensuel${kw.volume_source ? " (" + kw.volume_source + ")" : ""}`}>
                        🔍 {kw.search_volume >= 1000 ? (kw.search_volume / 1000).toFixed(1) + "k" : kw.search_volume}
                      </span>
                    )}
                    {kw.error_msg && (
                      <span style={{ fontSize: 10, color: "#DC2626", fontStyle: "italic", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={kw.error_msg}>
                        {kw.error_msg}
                      </span>
                    )}
                    {kw.question_count > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid #059669", borderRadius: 10, padding: "1px 8px" }}>
                        {kw.question_count} question{kw.question_count > 1 ? "s" : ""}
                      </span>
                    )}
                    {(kw.tags || (kw.category_id ? [kw.category_id] : [])).map(tagId => {
                      const tagCat = categories.find(c => c.id === tagId);
                      return tagCat ? (
                        <span key={tagId} style={{ fontSize: 10, fontWeight: 700, color: tagCat.color, background: tagCat.color + "18", border: `1px solid ${tagCat.color}44`, borderRadius: 10, padding: "1px 7px" }}>{tagCat.name}</span>
                      ) : null;
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                  <TagSelect values={kw.tags || (kw.category_id ? [kw.category_id] : [])} categories={categories} onChange={tags => setTagsSingle(kw.id, tags)} />
                  <button onClick={() => generateQuestions(kw, null)} disabled={!!busy[kw.id] || (!apiKey && !providerKeys?.openai?.dec)}
                    style={{ padding: "4px 12px", border: "0.5px solid #1A3C2E22", borderRadius: 20, background: "transparent", color: "#1A3C2E", fontSize: 11, fontWeight: 500, cursor: (!!busy[kw.id] || (!apiKey && !providerKeys?.openai?.dec)) ? "not-allowed" : "pointer", opacity: (!!busy[kw.id] || (!apiKey && !providerKeys?.openai?.dec)) ? 0.35 : 1, letterSpacing: "0.01em", transition: "opacity 0.2s" }}
                    title={(!apiKey && !providerKeys?.openai?.dec) ? "Clé OpenAI manquante" : undefined}>
                    {busy[kw.id] === "q" ? "…" : kw.status === "done_q" ? "↺" : "▶"}
                  </button>
                  <button onClick={() => deleteKw(kw.id)} style={{ padding: "3px 8px", border: "none", background: "transparent", color: "#1A3C2E22", fontSize: 12, cursor: "pointer", transition: "color 0.15s" }}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 30-day presence calendar ─────────────────────────────────────


function isBrandPresent(r) {
  return !!r && (r.brand_mentioned === true || r.brand_mentioned === 1);
}




// history: [{ test_date: "YYYY-MM-DD", brand_mentioned: bool }]
// results: current geo_results for this provider (for today's optimistic update)

// ── HintPanelQuestion — one hint per question ────────────────────
function HintPanelQuestion({ questionId, question, sources, brandName, brandAliases, brandDomain, claudeKey, hasBrand, projectId, siteId, savedHint, savedHintDate = null, onHintSaved, initialOpen = false }) {
  const [open, setOpen]     = useState(false); // always start closed
  const [status, setStatus] = useState(savedHint ? "done" : "idle");
  const [hint, setHint]     = useState(savedHint || "");
  const hasHint = !!hint;

  const run = async () => {
    if (!claudeKey) return;
    setStatus("loading");
    const bDomain = brandDomain || brandName;
    const sourcesText = (Array.isArray(sources) ? sources : []).length > 0
      ? "Pages dans la réponse :\n" + sources.slice(0, 6).map((u, i) => `[${i+1}] ${u}`).join("\n")
      : "Aucune source listée.";
    const brandContext = hasBrand
      ? `La marque est présente. Analyse comment RENFORCER cette présence sur ${bDomain}.`
      : `Si une page de ${bDomain} est pertinente → comment l'optimiser. Sinon → quel contenu créer.`;
    const prompt = [
      `Tu es un expert GEO. Un moteur d'IA a répondu à cette question sans mentionner "${brandName}" :`,
      `"${question}"`,
      "",
      sourcesText,
      "",
      "REGLES STRICTES :",
      "- Commence directement par la recommandation, sans introduction",
      "- 5 à 7 lignes max, ton direct et actionnable",
      "",
      brandContext,
    ].join("\n");

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
      const text = (data.content || [])
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("\n")
        .trim();
      const cleaned = text
        .replace(/^(Je vais|En effectuant|Je recherche|Voici|Permettez)[^\n]*/gim, "")
        .replace(/^\s*\n/gm, "")
        .trim();
      const finalHint = cleaned || "Aucune recommandation générée.";
      setHint(finalHint);
      setStatus("done");
      setOpen(true);
      onHintSaved?.(finalHint);
      if (questionId && projectId && siteId) {
        sbSaveHint(questionId, siteId, projectId, finalHint).catch(e =>
          console.warn("[Hint] save failed:", e.message)
        );
      }
    } catch(e) {
      setHint(`Erreur : ${e.message}`);
      setStatus("error");
      setOpen(true);
    }
  };

  return (
    <div style={{ borderRadius: 0, overflow: "hidden", border: "none", borderTop: "0.5px solid #1A3C2E08" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", background: "transparent", cursor: "pointer" }}
        onClick={() => hasHint ? setOpen(o => !o) : (!status.includes("loading") && run())}>
        <span style={{ fontSize: 14 }}>💡</span>
        {status === "loading" ? (
          <span style={{ fontSize: 11, color: "#D97706" }}>⏳ Génération du hint…</span>
        ) : hasHint ? (
          <>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#D97706", flex: 1 }}>
              {open ? "▲ Masquer le Hint" : "▼ Voir le Hint"}
            </span>
            {savedHintDate && (
              <span style={{ fontSize: 10, color: "#B45309" }}>
                {new Date(savedHintDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setStatus("idle"); setHint(""); setOpen(false); setTimeout(run, 0); }}
              style={{ fontSize: 10, color: C.textLight, background: "none", border: "none", cursor: "pointer" }}>
              ↺
            </button>
          </>
        ) : (
          <span style={{ fontSize: 11, fontWeight: 700, color: "#D97706" }}>✨ Générer un Hint</span>
        )}
      </div>
      {open && hint && (
        <div style={{ padding: "10px 0 4px 0", background: "transparent" }}>
          {(savedHintDate || status === "done") && (
            <div style={{ fontSize: 10, color: "#B45309", marginBottom: 6 }}>
              🕐 {savedHintDate ? new Date(savedHintDate).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : new Date().toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
          <div style={{ fontSize: 11, lineHeight: 1.7, color: status === "error" ? "#DC2626" : "#92400E" }}>
            {status === "error" ? hint : renderMarkdown(hint)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ProviderRow — calendar + info + accordion + run button ────────

function ProviderRow({ provider, results, brandName, brandAliases, brandDomain = "", hasKey, isRunning, onRun, questionId, newCalEntry = null, question = "", claudeKey = "", projectId = null, siteId = null, savedHint = "", brandTerms = [], competitorMap = {}, lastCalDate = null, isReadOnly = false }) {
  const [open, setOpen] = useState(false);
  const p = provider;

  const result = [...(results || [])].sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0))[0] || null;
  const sources = result?.sources || [];
  const comps   = result?.competitors_mentioned || [];

  const displayDate = result?.created_at || lastCalDate || null;

  return (
    <div>
      {/* ── Ligne provider ── */}
      <div className="gt-provider-row">

        {/* Nom */}
        <span className="gt-provider-name">{p.label}</span>

        {/* Calendrier de présence 30j */}
        <PresenceCalendar questionId={questionId} providers={[provider]} newEntry={newCalEntry} />

        {/* Présence — 3 types ─────────────────────────────────── */}
        {result?.mention?.present && (
          <span className="gt-provider-status gt-success" title={`Mention dans le Top — position #${result.mention.position}`}>
            Top #{result.mention.position}
          </span>
        )}
        {result?.citation?.present && (
          <span className="gt-provider-status gt-dimmed" title={`Cité en source — position #${result.citation.position}`}>
            src #{result.citation.position}
          </span>
        )}
        {!result?.mention?.present && result?.evocation?.present && (
          <span className="gt-provider-status gt-warn" title={`Évocation dans le texte — position #${result.evocation.position}`}>
            évoc.
          </span>
        )}

        {/* Bouton voir réponse */}
        {result && (
          <button className="gt-provider-toggle" onClick={() => setOpen(o => !o)}>
            {open ? "▲" : "Réponse ▾"}
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Date et tokens — méta discrète */}
        {displayDate && (
          <span className="gt-mono">
            {new Date(displayDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
          </span>
        )}
        {result && (
          <span className="gt-mono">{(result.input_tokens||0)+(result.output_tokens||0)} tok</span>
        )}

        {/* Bouton run */}
        {hasKey && !isReadOnly && (
          <button
            className="gt-provider-run"
            onClick={onRun}
            disabled={isRunning || !hasKey}
            title={`Interroger ${p.label}`}
          >
            {isRunning ? "·" : "▶"}
          </button>
        )}
      </div>

      {/* ── Accordéon réponse ── */}
      {open && result && (
        <div className="gt-provider-answer">
          <div className="gt-body" style={{ lineHeight: 1.7, wordBreak: "break-word" }}>
            {renderMarkdown(result.answer || "")}
          </div>
          {sources.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="gt-label" style={{ marginBottom: 6 }}>Sources</div>
              {sources.map((url, i) => {
                const ib = [brandName, ...(brandAliases||[])].some(t => url.toLowerCase().includes((t||"").toLowerCase()));
                return (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 5, marginBottom: 4, minWidth: 0 }}>
                    <span className="gt-caption" style={{ minWidth: 18, flexShrink: 0, paddingTop: 1 }}>[{i+1}]</span>
                    <a href={url} target="_blank" rel="noreferrer"
                      style={{ fontSize: 11, color: ib ? "#1A7A4A" : "#1A3C2E88", wordBreak: "break-all", flex: 1, minWidth: 0 }}>
                      {stripQuery(url)}
                    </a>
                    {ib && <span className="gt-badge gt-badge--success">marque</span>}
                  </div>
                );
              })}
            </div>
          )}
          {comps.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="gt-label" style={{ marginBottom: 6 }}>Concurrents</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {comps.map(c => (
                  <span key={c.name} className="gt-badge gt-badge--warn">
                    {c.name}{c.position ? ` #${c.position}` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}




// ── GeoAnalysis — AI analysis of fan-out presence ─────────────────

function GeoAnalysis({ questions, results, brand, claudeKey }) {
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [analysis, setAnalysis] = useState("");
  const [open, setOpen] = useState(false);

  const brandName   = brand?.brand_name || "";
  const brandDomain = brand?.brand_domain || "";
  const brandAliases = brand?.brand_aliases || [];

  const run = async () => {
    if (!claudeKey || !results.length) return;
    setStatus("loading");
    setAnalysis("");
    setOpen(true);

    // ── Aggregate data ─────────────────────────────────
    const total = results.length;
    const withBrand = results.filter(r => r.brand_mentioned === true || r.brand_mentioned === 1).length;
    const withSources = results.filter(r => r.brand_in_sources).length;
    const positions = results.filter(r => r.brand_position).map(r => r.brand_position);
    const avgPos = positions.length ? (positions.reduce((a,b)=>a+b,0)/positions.length).toFixed(1) : null;

    // Top URLs cited overall
    const urlCount = {};
    results.forEach(r => (r.sources || []).forEach(url => {
      urlCount[url] = (urlCount[url] || 0) + 1;
    }));
    const topUrls = Object.entries(urlCount).sort((a,b)=>b[1]-a[1]).slice(0, 15);

    // Brand URLs cited
    const allBrandTerms = [brandDomain, brandName, ...brandAliases].filter(Boolean).map(t => t.toLowerCase());
    const brandUrls = topUrls.filter(([url]) => allBrandTerms.some(t => url.toLowerCase().includes(t)));
    const competitorUrls = topUrls.filter(([url]) => !allBrandTerms.some(t => url.toLowerCase().includes(t)));

    // Top competitors
    const compCount = {};
    results.forEach(r => (r.competitors_mentioned || []).forEach(c => {
      compCount[c.name] = (compCount[c.name] || 0) + 1;
    }));
    const topComps = Object.entries(compCount).sort((a,b)=>b[1]-a[1]).slice(0,8);

    // Questions without brand
    const qMap = {};
    questions.forEach(q => { qMap[q.id] = q.question; });
    const missingBrandQs = results
      .filter(r => !(r.brand_mentioned === true || r.brand_mentioned === 1))
      .map(r => qMap[r.question_id])
      .filter(Boolean);
    const uniqueMissing = [...new Set(missingBrandQs)].slice(0, 10);

    // Questions with brand
    const hasBrandQs = results
      .filter(r => r.brand_mentioned === true || r.brand_mentioned === 1)
      .map(r => qMap[r.question_id])
      .filter(Boolean);
    const uniquePresent = [...new Set(hasBrandQs)].slice(0, 8);

    // Per-provider stats
    const providerStats = {};
    results.forEach(r => {
      const pid = getProviderId(r.model);
      if (!providerStats[pid]) providerStats[pid] = { total: 0, withBrand: 0 };
      providerStats[pid].total++;
      if (r.brand_mentioned === true || r.brand_mentioned === 1) providerStats[pid].withBrand++;
    });

    const prompt = `Tu es un expert en GEO (Generative Engine Optimization).

Voici les données de présence de la marque "${brandName}" (domaine : ${brandDomain || "non renseigné"}) dans les réponses des moteurs d'IA :

## MÉTRIQUES GLOBALES
- Présence marque : ${withBrand}/${total} réponses (${total ? Math.round(withBrand/total*100) : 0}%)
- Citée en source : ${withSources} réponses
- Position moyenne : ${avgPos ? `#${avgPos}` : "non mesurée"}

## PAR PROVIDER
${Object.entries(providerStats).map(([pid, s]) => `- ${pid} : ${s.withBrand}/${s.total} (${Math.round(s.withBrand/s.total*100)}%)`).join("\n")}

## QUESTIONS OÙ LA MARQUE EST PRÉSENTE (${uniquePresent.length})
${uniquePresent.map((q,i) => `${i+1}. ${q}`).join("\n")}

## QUESTIONS OÙ LA MARQUE EST ABSENTE (${uniqueMissing.length} sur ${[...new Set(missingBrandQs)].length})
${uniqueMissing.map((q,i) => `${i+1}. ${q}`).join("\n")}

## TOP CONCURRENTS CITÉS
${topComps.map(([n,c]) => `- ${n} : ${c}×`).join("\n") || "Aucun"}

## URLS MARQUE CITÉES EN SOURCE
${brandUrls.map(([u,c]) => `- ${u} (${c}×)`).join("\n") || "Aucune URL marque détectée"}

## TOP URLS CONCURRENTES CITÉES EN SOURCE  
${competitorUrls.slice(0,10).map(([u,c]) => `- ${u} (${c}×)`).join("\n") || "Aucune"}

---

Produis une analyse GEO structurée en 3 sections EXACTEMENT dans ce format :

## 🔍 ÉTAT DES LIEUX
[Forces et faiblesses concrètes — 4-6 points, basés sur les chiffres]

## 📈 RECOMMANDATIONS — PAGES CITÉES PAR LES IA
[3-5 recommandations actionnables basées sur les URLs concurrentes les plus citées — qu'est-ce que ces pages ont que nos pages n'ont pas ?]

## 🏠 RECOMMANDATIONS — OPTIMISATION DES PAGES MARQUE
[3-5 recommandations pour améliorer les pages de ${brandDomain || "la marque"} déjà citées, ou créer les pages manquantes pour les questions sans présence]

RÈGLES :
- Commence directement par ## 🔍 ÉTAT DES LIEUX, aucune introduction
- Chiffres précis, recommandations concrètes
- Pas de formules de politesse`;

    try {
      const res = await fetch("/api/claude-geo", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Claude-Key": claudeKey },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1200,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const raw = await res.text();
      if (raw.trimStart().startsWith("<")) throw new Error("Proxy claude-geo introuvable");
      const data = JSON.parse(raw);
      if (!res.ok) throw new Error(data.error?.message || `Claude ${res.status}`);
      const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
      setAnalysis(text || "Aucune analyse générée.");
      setStatus("done");
    } catch(e) {
      setAnalysis(`Erreur : ${e.message}`);
      setStatus("error");
    }
  };

  // Parse sections for pretty rendering
  const sections = analysis ? analysis.split(/(?=## )/).filter(Boolean) : [];

  const sectionColors = {
    "ÉTAT": { bg: "#EFF6FF", border: "#BFDBFE", title: "#1D4ED8" },
    "RECOMMANDATIONS — PAGES": { bg: "#F0FDF4", border: "#BBF7D0", title: "#15803D" },
    "RECOMMANDATIONS — OPTIMISATION": { bg: "#FFFBEB", border: "#FDE68A", title: "#B45309" },
  };

  const getColor = (text) => {
    const key = Object.keys(sectionColors).find(k => text.includes(k));
    return sectionColors[key] || { bg: C.bg, border: C.border, title: C.text };
  };

  if (!results.length) return null;

  return (
    <div style={{ background: "#fff", border: "0.5px solid #1A3C2E0D", borderRadius: 14, padding: "18px 24px", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>🔬 Analyse des présences Fan-out</div>
          <div style={{ fontSize: 11, color: C.textLight }}>Forces, faiblesses et recommandations IA basées sur {results.length} réponses</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {status === "done" && (
            <button onClick={() => setOpen(o => !o)}
              style={{ fontSize: 11, padding: "4px 10px", border: "0.5px solid #1A3C2E0D", borderRadius: 7, background: "#FAFAF8", cursor: "pointer", color: C.textMid }}>
              {open ? "▲ Masquer" : "▼ Voir l'analyse"}
            </button>
          )}
          <button onClick={run} disabled={status === "loading" || !claudeKey}
            title={!claudeKey ? "Clé Claude manquante — ajoutez-la dans ⚙️ Gestion des Providers (en haut de page)" : undefined}
            style={{ fontSize: 12, fontWeight: 700, padding: "6px 14px", border: "none", borderRadius: 8, cursor: status === "loading" || !claudeKey ? "not-allowed" : "pointer",
              background: !claudeKey ? C.bg : status === "loading" ? "#E5E7EB" : "#7C3AED",
              color: !claudeKey ? C.textLight : status === "loading" ? C.textLight : "#fff" }}>
            {status === "loading" ? "⏳ Analyse en cours…" : status === "done" ? "↺ Relancer" : "✨ Analyser"}
          </button>
        </div>
      </div>

      {!claudeKey && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#D97706", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 7, padding: "6px 10px" }}>
          ⚠️ Clé Claude requise — configurez-la dans le setup
        </div>
      )}

      {open && status === "done" && sections.length > 0 && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {sections.map((section, i) => {
            const lines = section.trim().split("\n");
            const title = lines[0].replace(/^## /, "");
            const body = lines.slice(1).join("\n").trim();
            const col = getColor(title);
            return (
              <div key={i} style={{ background: col.bg, border: `1px solid ${col.border}`, borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: col.title, marginBottom: 8 }}>{title}</div>
                <div style={{ fontSize: 12, color: C.text, lineHeight: 1.7 }}>{renderMarkdown(body)}</div>
              </div>
            );
          })}
        </div>
      )}

      {open && status === "error" && (
        <div style={{ marginTop: 12, fontSize: 12, color: "#DC2626", padding: "10px 14px", background: "#FEF2F2", borderRadius: 8 }}>{analysis}</div>
      )}
    </div>
  );
}

// ── Questions sub-tab (v2) ────────────────────────────────────────

function QuestionsTab({ site, projectId, apiKey, model, brand, categories, setCategories, allResults, onResultSaved, activeProviders = ["openai"], providerKeys = {}, runMode = "parallel", keywordsOrder = [], refreshTrigger = 0, competitors = [], setCompetitors = null, onSaveKey = null, isReadOnly = false }) {
  const [questions, setQuestions]   = useState([]);
  const [results, setResults]       = useState(allResults || []);
  // Sort: favorites first, then by keyword order, then by creation date
  const sortedQuestions = useMemo(() => {
    const kwIndexMap = {};
    keywordsOrder.forEach((id, i) => { kwIndexMap[id] = i; });
    return [...questions].sort((a, b) => {
      // 1. Favorites first
      if (a.is_favorite && !b.is_favorite) return -1;
      if (!a.is_favorite && b.is_favorite) return 1;
      // 2. Keyword order (undefined → end)
      const ia = kwIndexMap[a.keyword_id] ?? 9999;
      const ib = kwIndexMap[b.keyword_id] ?? 9999;
      if (ia !== ib) return ia - ib;
      // 3. Creation date within same keyword
      return new Date(a.created_at) - new Date(b.created_at);
    });
  }, [questions, keywordsOrder]); // eslint-disable-line react-hooks/exhaustive-deps
  const [manualQ, setManualQ]       = useState("");
  const [csvImporting, setCsvImporting] = useState(false);
  const csvInputRef = useRef(null);
  const [editingQ, setEditingQ]     = useState(null); // { id, text } — question being edited
  const [hintsMap, setHintsMap]     = useState({}); // { questionId: hint_text }
  // Filters — persisted per project+site in localStorage
  const filtersKey = `geo_filters_${projectId}_${site?.id}`;
  const loadFilters = () => {
    try { return JSON.parse(localStorage.getItem(filtersKey) || "{}"); } catch { return {}; }
  };
  const savedF = loadFilters();
  const [filterFav,        setFilterFavRaw]        = useState(savedF.filterFav        || false);
  const [filterPositioned, setFilterPositionedRaw] = useState(savedF.filterPositioned || false);
  const [filterLost,       setFilterLostRaw]       = useState(savedF.filterLost       || false);
  const [filterCat,        setFilterCatRaw]        = useState(savedF.filterCat        || "");
  const [filterKeyword,    setFilterKeywordRaw]    = useState(savedF.filterKeyword    || "");
  const [filterSearch,     setFilterSearchRaw]     = useState(savedF.filterSearch     || "");
  const [filterProviders,  setFilterProvidersRaw]  = useState(savedF.filterProviders  || []);

  // Wrap setters to also persist to localStorage
  const persistFilters = (patch) => {
    try {
      const current = loadFilters();
      localStorage.setItem(filtersKey, JSON.stringify({ ...current, ...patch }));
    } catch {}
  };
  const setFilterFav        = (v) => { setFilterFavRaw(v);        persistFilters({ filterFav: v }); };
  const setFilterPositioned = (v) => { setFilterPositionedRaw(v); persistFilters({ filterPositioned: v }); };
  const setFilterLost       = (v) => { setFilterLostRaw(v);       persistFilters({ filterLost: v }); };
  const setFilterCat        = (v) => { setFilterCatRaw(v);        persistFilters({ filterCat: v }); };
  const setFilterKeyword    = (v) => { setFilterKeywordRaw(v);    persistFilters({ filterKeyword: v }); };
  const setFilterSearch     = (v) => { setFilterSearchRaw(v);     persistFilters({ filterSearch: v }); };
  const setFilterProviders  = (v) => { setFilterProvidersRaw(v);  persistFilters({ filterProviders: v }); };
  const [running, setRunning]       = useState({});
  const [runAll, setRunAll]         = useState(false);
  const stopAllRef = useRef(false);
  // Refs so callbacks always read current values without stale closure issues
  const activeProvidersRef = useRef(activeProviders);
  const providerKeysRef    = useRef(providerKeys);
  // Keep refs in sync with props on every render (not just via useEffect)
  activeProvidersRef.current = activeProviders;
  providerKeysRef.current    = providerKeys;
  const [selected, setSelected]     = useState(new Set());
  const [bulkCat, setBulkCat]       = useState("");
  const [keywords, setKeywords]     = useState([]);
  const [newCalEntries, setNewCalEntries] = useState({}); // { `${q.id}|${p.id}` → last newEntry for PresenceCalendar }
  const [calendarEntries, setCalendarEntries] = useState([]); // entrées de la table geo_presence_calendar

  // Load all data on mount and when project/site/refreshTrigger changes
  useEffect(() => {
    if (!projectId || !site?.id) return;
    // Load in parallel
    Promise.all([
      sbGetGeoResults(projectId, site.id),
      sbGetQuestions(projectId, site.id),
      sbGetHints(projectId, site.id),
      sbGetKeywords(projectId, site.id),
      sbGetCalendarEntriesBatch(projectId, site.id),
    ]).then(([results, questions, hints, keywords, calEntries]) => {
      setResults(results.length ? results : (allResults || []));
      setQuestions(questions);
      const map = {};
      hints.forEach(r => { map[r.question_id] = { text: r.hint_text, date: r.updated_at }; });
      setHintsMap(map);
      setKeywords(keywords);
      setCalendarEntries(calEntries || []);
      console.log("[GeoTab] calendarEntries chargées:", (Array.isArray(calEntries) ? calEntries : []).length, "entrées — vertes:", (Array.isArray(calEntries) ? calEntries : []).filter(e => e.brand_present === true || e.brand_present === 1).length);
    }).catch(e => console.warn("[QuestionsTab] load error:", e));
  }, [projectId, site?.id, refreshTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const resultsByQ = useMemo(() => {
    const m = {};
    results.forEach(r => { if (!m[r.question_id]) m[r.question_id] = []; m[r.question_id].push(r); });
    return m;
  }, [results]);

  const saveEdit = async () => {
    if (!editingQ?.text?.trim()) return;
    const newText = editingQ.text.trim();
    const qId = editingQ.id;
    // Optimistic update immediately
    setQuestions(prev => prev.map(q => q.id === qId ? { ...q, question: newText } : q));
    setEditingQ(null);
    // Persist to Supabase
    const ok = await sbUpdateQuestion(qId, { question: newText });
    if (!ok) {
      // Revert on failure
      console.error("saveEdit failed — reverting");
      setQuestions(prev => prev.map(q => q.id === qId ? { ...q, question: editingQ.text } : q));
    }
  };

  const addManual = async () => {
    const q = manualQ.trim();
    if (!q) return;
    const saved = await sbSaveQuestions([{ project_id: projectId, site_id: site.id, question: q, is_manual: true }]);
    setQuestions(prev => [...saved, ...prev]);
    setManualQ("");
  };

  const importCsvQuestions = async (file) => {
    if (!file) return;
    setCsvImporting(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

      // Détecter si CSV avec header ou liste brute (une question par ligne)
      let questions = [];
      const firstLine = lines[0] || "";
      const sep = firstLine.includes(";") ? ";" : ",";
      const headers = firstLine.split(sep).map(h => h.replace(/^["']|["']$/g, "").trim().toLowerCase());
      const qColIdx = headers.findIndex(h => h === "question" || h === "questions" || h === "query" || h === "requête");

      if (qColIdx >= 0) {
        // CSV avec header — on prend la colonne question
        questions = lines.slice(1)
          .map(l => l.split(sep)[qColIdx]?.replace(/^["']|["']$/g, "").trim())
          .filter(Boolean);
      } else {
        // Pas de header détecté — une question par ligne
        questions = lines.map(l => l.replace(/^["']|["']$/g, "").trim()).filter(Boolean);
      }

      // Dédoublonner et filtrer les questions déjà existantes
      const existing = new Set(questions.map(q => q.question.trim().toLowerCase()));
      const toAdd = [...new Set(questions)]
        .filter(q => q.length > 5 && !existing.has(q.toLowerCase()))
        .map(q => ({ project_id: projectId, site_id: site.id, question: q, is_manual: true }));

      if (toAdd.length === 0) {
        alert("Aucune nouvelle question à importer (doublons ou fichier vide).");
        return;
      }

      // Sauvegarder par batch de 50
      const batchSize = 50;
      const allSaved = [];
      for (let i = 0; i < toAdd.length; i += batchSize) {
        const batch = toAdd.slice(i, i + batchSize);
        const saved = await sbSaveQuestions(batch);
        allSaved.push(...(saved || []));
      }

      setQuestions(prev => [...allSaved, ...prev]);
      alert(`✓ ${allSaved.length} question${allSaved.length > 1 ? "s" : ""} importée${allSaved.length > 1 ? "s" : ""} sur ${toAdd.length} détectée${toAdd.length > 1 ? "s" : ""}.`);
    } catch(e) {
      console.error("CSV import error:", e);
      alert("Erreur lors de l'import : " + e.message);
    } finally {
      setCsvImporting(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  const toggleFav = async (qId, cur) => {
    await sbUpdateQuestion(qId, { is_favorite: !cur });
    setQuestions(prev => prev.map(q => q.id === qId ? { ...q, is_favorite: !cur } : q));
  };

  const deleteQ = async (qId) => {
    await sbDeleteQuestion(qId);
    setQuestions(prev => prev.filter(q => q.id !== qId));
    setSelected(prev => { const n = new Set(prev); n.delete(qId); return n; });
  };

  const setCatSingle = async (qId, catId) => {
    await sbSetQuestionCategory(qId, catId || null);
    setQuestions(prev => prev.map(q => q.id === qId ? { ...q, category_id: catId || null } : q));
  };

  const applyBulkCat = async () => {
    if (!selected.size) return;
    const ids = [...selected];
    await sbBulkSetQuestionCategory(ids, bulkCat || null);
    setQuestions(prev => prev.map(q => selected.has(q.id) ? { ...q, category_id: bulkCat || null } : q));
    setSelected(new Set()); setBulkCat("");
  };



  // Run a single provider on a single question
  const runProvider = useCallback(async (q, provider) => {
    const pk = providerKeysRef.current[provider.id];
    if (!pk?.dec) { console.warn("No key for provider", provider.id); return; }
    setRunning(r => ({ ...r, [`${q.id}-${provider.id}`]: true }));
    const { brand_name = "", brand_aliases = [], competitors = [], context = "" } = brand || {};
    const baseContext = context ? `Contexte : "${context}"\n` : "";
    const question = `Question : ${q.question}`;
    const promptForClaude = `${baseContext}Tu es un expert en recommandation d'entreprises et prestataires. Réponds à la question suivante en te basant sur tes connaissances pour donner une liste de vrais acteurs, entreprises ou prestataires du marché.
RÈGLE : Ne dis jamais que tu n'as pas accès au web ou aux avis récents. Donne directement des recommandations concrètes avec les vrais noms d'entreprises que tu connais.
Réponds en texte libre structuré. Liste les acteurs avec une courte description de chacun.
${question}`;
    const promptForGemini = `${baseContext}Tu as accès à Google Search en temps réel. Utilise-le pour trouver les meilleurs acteurs, entreprises et prestataires actuels.
Réponds avec une liste de vrais acteurs du marché, leurs sites web et leurs caractéristiques principales.
Sois direct et factuel. Cite les sources que tu as consultées.
${question}`;
    const promptForWeb = [baseContext, "Tu es un assistant IA avec accès au web. Réponds directement et complètement à la question.", "RÈGLE ABSOLUE : Ne pose jamais de question de clarification. Donne directement une liste de recommandations concrètes.", "Pour chaque acteur recommandé : donne le nom, le site web, et une description courte.", "Sois factuel, précis, et cite tes sources.", question].filter(Boolean).join("\n");
    const prompt = provider.id === "claude" ? promptForClaude : provider.id === "gemini" ? promptForGemini : promptForWeb;
    try {
      const parsed = await callProvider(provider, pk.dec, prompt);
      const detectedBrand = detectBrand(parsed.answer, parsed.sources, brand_name, brand_aliases, competitors);
      const { brandMentioned, brandPosition, brandInSources, competitorsMentioned } = detectedBrand;
      const domain_counts = {};
      (parsed.sources || []).forEach(url => {
        if (!domain_counts[url]) domain_counts[url] = { as_source: 0, in_answer: 0, domain: extractDomain(url) };
        domain_counts[url].as_source++;
      });
      await Promise.all(Object.entries(domain_counts).map(([url, counts]) => sbIncrementUrlCounts(projectId, url, counts)));
      const now = new Date().toISOString();
      const record = {
        question_id: q.id, project_id: projectId, site_id: site.id,
        model: `${provider.label} (${provider.model})`,
        answer: parsed.answer, answer_type: parsed.answer_type, intent_type: parsed.intent_type,
        sources: parsed.sources, source_types: parsed.source_types,
        brand_mentioned: brandMentioned, brand_position: brandPosition,
        brand_in_sources: brandInSources, competitors_mentioned: competitorsMentioned,
        // Nouveaux champs de présence détaillés
        brand_mention_position:   detectedBrand.mention?.position   || null,
        brand_evocation_position: detectedBrand.evocation?.position || null,
        brand_citation_position:  detectedBrand.citation?.position  || null,
        input_tokens: parsed._input_tokens, output_tokens: parsed._output_tokens,
        created_at: now,
      };
      // Optimistic local update — immediately update the card
      const pid = getProviderId(record.model);
      const optimisticResult = { ...record, id: `tmp-${pid}-${q.id}`, provider_id: pid };
      setResults(prev => {
        const existing = prev.findIndex(r => r.question_id === q.id && getProviderId(r.model) === pid);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = { ...updated[existing], ...optimisticResult };
          return updated;
        }
        return [optimisticResult, ...prev];
      });

      // Persist to Supabase in background — update with real id when done
      sbSaveGeoResult(record).then(saved => {
        const real = Array.isArray(saved) ? saved[0] : saved;
        if (real?.id) {
          setResults(prev => prev.map(r =>
            r.id === optimisticResult.id ? { ...r, ...real } : r
          ));
        }
      }).catch(e => console.error("sbSaveGeoResult error:", e));

      // Add to calendar (optimistic + persist)
      setNewCalEntries(prev => ({ ...prev, [`${q.id}|${provider.id}`]: { provider_id: provider.id, brand_present: brandMentioned } }));
      // Persist to DB (best effort)
      sbAddCalendarEntry(q.id, provider.id, brandMentioned).catch(() => {});

      // Update cached answers on question
      const cachePatch = { has_result: true, last_answer: parsed.answer, last_model: record.model, last_date: now };
      if (brandMentioned) Object.assign(cachePatch, { best_answer: parsed.answer, best_model: record.model, best_date: now });
      sbUpdateQuestion(q.id, cachePatch).catch(() => {});
      setQuestions(prev => prev.map(qq => qq.id === q.id ? { ...qq, ...cachePatch } : qq));
      // Notify parent for global stats (non-blocking)
      onResultSaved?.();
    } catch(e) { console.error(`runProvider ${provider.id} error:`, e); }
    setRunning(r => ({ ...r, [`${q.id}-${provider.id}`]: false }));
  }, [brand, projectId, site?.id, providerKeys, onResultSaved]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per question: latest result (most recent by created_at)
  const latestResultByQ = useMemo(() => {
    const out = {};
    Object.entries(resultsByQ).forEach(([qId, results]) => {
      if (!results.length) return;
      const sorted = [...results].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      out[qId] = sorted[0];
    });
    return out;
  }, [resultsByQ]);

  // Per question: était positionnée dans les 30 derniers jours (carré vert calendrier)
  // mais absente du dernier résultat → "Positionnée précédemment"
  const lostByQ = useMemo(() => {
    const out = {};

    // Cutoff en string YYYY-MM-DD pour comparer directement avec test_date (évite les bugs timezone)
    const cutoffStr = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Grouper les entrées calendar par question_id
    const calByQ = {};
    calendarEntries.forEach(e => {
      if (!e.question_id) return;
      if (!calByQ[e.question_id]) calByQ[e.question_id] = [];
      calByQ[e.question_id].push(e);
    });

    // Parcourir toutes les questions qui ont des entrées calendar OU des résultats
    const allQIds = new Set([...Object.keys(resultsByQ), ...Object.keys(calByQ)]);

    allQIds.forEach(qId => {
      // Condition 1 : marque absente du dernier résultat connu
      const latest = latestResultByQ[qId];
      const latestAbsent = !latest || !(latest.brand_mentioned === true || latest.brand_mentioned === 1);
      if (!latestAbsent) return; // encore positionnée → pas "perdue"

      // Condition 2 : au moins un carré vert dans les 30 derniers jours
      // test_date est une string "YYYY-MM-DD" — comparaison string directe, pas de Date()
      const entries = calByQ[qId] || [];
      const hadGreenIn30d = entries.some(e => {
        const dateStr = e.test_date || (e.created_at || "").slice(0, 10);
        return dateStr >= cutoffStr && (e.brand_present === true || e.brand_present === 1);
      });

      if (hadGreenIn30d) out[qId] = true;
    });

    return out;
  }, [calendarEntries, resultsByQ, latestResultByQ]);

  const filtered = useMemo(() => sortedQuestions.filter(q => {
    // Filtres cumulatifs (ET)
    if (filterFav && !q.is_favorite) return false;
    if (filterCat && q.category_id !== filterCat) return false;
    if (filterKeyword && q.keyword_id !== filterKeyword) return false;
    if (filterSearch) {
      try {
        const rx = new RegExp(filterSearch, 'i');
        if (!rx.test(q.question)) return false;
      } catch { if (!q.question.toLowerCase().includes(filterSearch.toLowerCase())) return false; }
    }
    if (filterProviders.length > 0) {
      const qRes = resultsByQ[q.id] || [];
      if (!qRes.some(r => filterProviders.includes(getProviderId(r.model)))) return false;
    }
    // Positionné ET/OU Positionné précédemment — condition OU non-exclusif si les deux sont actifs
    if (filterPositioned || filterLost) {
      const latest = latestResultByQ[q.id];
      const isPositioned = !!(latest && (latest.brand_mentioned === true || latest.brand_mentioned === 1));
      const isLost = !!lostByQ[q.id];
      // OU non-exclusif : la question doit matcher au moins un des filtres actifs
      const matchPositioned = filterPositioned && isPositioned;
      const matchLost = filterLost && isLost;
      if (!matchPositioned && !matchLost) return false;
    }
    return true;
  }), [questions, filterFav, filterCat, filterKeyword, filterSearch, filterProviders, filterPositioned, filterLost, resultsByQ, latestResultByQ, lostByQ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Returns providers that still need to be called for a question today
  const getProvidersToRun = (q, force = false) => {
    const currentKeys = providerKeysRef.current;
    const currentActive = activeProvidersRef.current;
    const configuredProviders = PROVIDERS.filter(p => currentActive.includes(p.id) && currentKeys[p.id]?.dec);
    if (force) return configuredProviders; // always run all when forced (individual ▶ button)
    const today = new Date().toISOString().slice(0, 10);
    const qResults = resultsByQ[q.id] || [];
    return configuredProviders.filter(p => {
      // Skip if already generated today for this provider
      const alreadyToday = qResults.some(r =>
        getProviderId(r.model) === p.id &&
        r.created_at && r.created_at.slice(0, 10) === today
      );
      return !alreadyToday;
    });
  };

  const runAllQuestions = async () => {
    const toRun = filtered
      .map(q => ({ q, providers: getProvidersToRun(q, false) }))
      .filter(({ providers }) => providers.length > 0);
    if (!toRun.length) return;
    stopAllRef.current = false;
    setRunAll(true);
    for (const { q, providers } of toRun) {
      if (stopAllRef.current) break;
      setRunning(r => ({ ...r, [q.id]: true }));
      await Promise.all(providers.map(p => runProvider(q, p)));
      setRunning(r => ({ ...r, [q.id]: false }));
    }
    setRunAll(false);
  };

  const { brand_name = "", brand_aliases = [] } = brand || {};

  // Results for filtered questions, filtered by provider selection
  const filteredResults = useMemo(() => {
    const qIds = new Set(filtered.map(q => q.id));
    return results.filter(r => {
      if (!qIds.has(r.question_id)) return false;
      if (filterProviders.length > 0 && !filterProviders.includes(getProviderId(r.model))) return false;
      return true;
    });
  }, [filtered, results, filterProviders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Count questions to generate for "Lancer tout" indicator
  const toRunCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const configuredProviders = PROVIDERS.filter(p =>
      activeProviders.includes(p.id) && providerKeys[p.id]?.dec
    );
    if (!configuredProviders.length) return 0;
    return filtered.filter(q => {
      const qResults = resultsByQ[q.id] || [];
      // Count questions that have at least one provider not yet done today
      return configuredProviders.some(p =>
        !qResults.some(r =>
          getProviderId(r.model) === p.id &&
          r.created_at && r.created_at.slice(0, 10) === today
        )
      );
    }).length;
  }, [filtered, resultsByQ, activeProviders, providerKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {/* ── GEO Analysis ── */}
      <GeoAnalysis
        questions={questions}
        results={results}
        brand={brand}
        claudeKey={providerKeysRef.current["claude"]?.dec || ""}
      />

      {/* ── Stats header (filtered) ── */}
      <StatsHeader questions={filtered} results={filteredResults} brandName={brand_name} qualifiedCompetitors={competitors.filter(c => c.enabled !== false)} />

      {/* ══════════════════════════════════════════════════════
           ZONE AJOUT + FILTRES + ACTIONS
           Layout : 3 lignes séparées par des dividers 0.5px
           ══════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 20 }}>

        {/* ── Ligne 1 : Ajout de questions ── */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>

          {/* Saisie manuelle */}
          <input
            value={manualQ}
            onChange={e => setManualQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addManual()}
            placeholder="Ajouter une question…"
            className="gt-input"
            style={{ flex: "1 1 260px", minWidth: 200 }}
          />
          <button
            onClick={addManual}
            disabled={!manualQ.trim()}
            className="gt-btn"
            style={{ opacity: !manualQ.trim() ? 0.35 : 1 }}>
            + Ajouter
          </button>

          {/* Séparateur vertical */}
          <div style={{ width: "0.5px", height: 20, background: "#1A3C2E18", flexShrink: 0 }} />

          {/* Import CSV */}
          <input ref={csvInputRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={e => importCsvQuestions(e.target.files?.[0])} />
          <button
            onClick={() => csvInputRef.current?.click()}
            disabled={csvImporting}
            className="gt-btn gt-btn--ghost"
            style={{ opacity: csvImporting ? 0.4 : 1 }}>
            {csvImporting ? "Import…" : "↑ CSV"}
          </button>

          {/* Séparateur vertical */}
          <div style={{ width: "0.5px", height: 20, background: "#1A3C2E18", flexShrink: 0 }} />

          {/* Catégories — inline compact (comme KeywordsTab) */}
          <CategoryManager
            projectId={projectId}
            categories={categories}
            setCategories={setCategories}
            compact
          />
        </div>

        {/* ── Ligne 2 : Filtres ── */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", paddingBottom: 10, borderBottom: "0.5px solid #1A3C2E08", marginBottom: 10 }}>

          {/* Recherche */}
          <input
            value={filterSearch}
            onChange={e => setFilterSearch(e.target.value)}
            placeholder="Rechercher…"
            className="gt-input"
            style={{ width: 160 }}
          />

          {/* Catégorie */}
          <CatSelect value={filterCat} categories={categories} onChange={v => setFilterCat(v || "")} placeholder="Catégorie" />

          {/* Mot-clé */}
          <select value={filterKeyword} onChange={e => setFilterKeyword(e.target.value)} className="gt-select">
            <option value="">Tous les mots-clés</option>
            {keywords.map(k => <option key={k.id} value={k.id}>{k.keyword}</option>)}
          </select>

          {/* Divider */}
          <div style={{ width: "0.5px", height: 16, background: "#1A3C2E12", flexShrink: 0 }} />

          {/* Pills de présence */}
          <button className={`gt-filter-pill${filterFav ? " gt-filter-pill--active" : ""}`} onClick={() => setFilterFav(f => !f)} title="Questions favorites">⭐ Favoris</button>
          <button className={`gt-filter-pill${filterPositioned ? " gt-filter-pill--active" : ""}`} onClick={() => setFilterPositioned(f => !f)} title="Marque présente dans le dernier résultat">Positionnée</button>
          <button className={`gt-filter-pill${filterLost ? " gt-filter-pill--active" : ""}`} onClick={() => setFilterLost(f => !f)} title="Positionnée dans les 30j, absente du dernier résultat">Perdue</button>

          {/* Reset — apparaît seulement si filtre actif */}
          {(filterSearch || filterCat || filterKeyword || filterFav || filterPositioned || filterLost || filterProviders.length > 0) && (
            <button
              onClick={() => { setFilterSearch(""); setFilterCat(""); setFilterKeyword(""); setFilterFav(false); setFilterPositioned(false); setFilterLost(false); setFilterProviders([]); }}
              className="gt-btn-icon"
              title="Effacer tous les filtres"
              style={{ fontSize: 12, color: "#1A3C2E44" }}>
              ✕
            </button>
          )}

          {/* Compteur */}
          <span className="gt-caption" style={{ marginLeft: 4 }}>
            {filtered.length} question{filtered.length > 1 ? "s" : ""}
          </span>
        </div>

        {/* ── Ligne 3 : Providers + sélection + export + lancement ── */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>

          {/* Providers — pills */}
          {PROVIDERS.map(p => {
            const active = filterProviders.includes(p.id);
            const hasKey = !!providerKeys[p.id]?.dec;
            return (
              <button key={p.id}
                onClick={() => hasKey && setFilterProviders(prev => active ? prev.filter(id => id !== p.id) : [...prev, p.id])}
                className={`gt-filter-pill${active && hasKey ? " gt-filter-pill--active" : ""}`}
                style={{ opacity: hasKey ? 1 : 0.3, cursor: hasKey ? "pointer" : "not-allowed" }}
                title={!hasKey ? `Clé ${p.label} manquante` : p.label}>
                {p.label}
              </button>
            );
          })}

          {/* Divider */}
          <div style={{ width: "0.5px", height: 16, background: "#1A3C2E12", flexShrink: 0 }} />

          {/* Sélection */}
          <button
            onClick={() => setSelected(new Set(filtered.map(q => q.id)))}
            className="gt-btn-icon"
            title="Tout sélectionner"
            style={{ fontSize: 11, color: "#1A3C2E55", padding: "3px 8px" }}>
            Tout
          </button>
          {selected.size > 0 && (
            <>
              <button onClick={() => setSelected(new Set())} className="gt-btn-icon" style={{ fontSize: 11, color: "#1A3C2E55", padding: "3px 8px" }}>Aucun</button>
              <span className="gt-caption" style={{ color: "#1A3C2E77" }}>{selected.size} sél.</span>
              <CatSelect value={bulkCat} categories={categories} onChange={setBulkCat} placeholder="Catégoriser…" />
              {bulkCat && (
                <button onClick={applyBulkCat} className="gt-btn" style={{ padding: "3px 12px" }}>Appliquer</button>
              )}
            </>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Rafraîchir */}
          <button
            onClick={() => sbGetQuestions(projectId, site.id).then(setQuestions)}
            className="gt-btn-icon"
            title="Rafraîchir"
            style={{ fontSize: 13 }}>
            ↺
          </button>

          {/* Export */}
          <ExportFanoutBtn
            questions={filtered}
            results={results}
            brandName={brand?.brand_name || ""}
            brandAliases={brand?.brand_aliases || []}
            keywords={keywords}
            projectName={site?.name || "export"}
            hintsMap={hintsMap}
            latestResultByQ={latestResultByQ}
            lostByQ={lostByQ}
          />

          {/* Lancer tout */}
          {!isReadOnly && (
            <>
              <button
                onClick={runAllQuestions}
                disabled={runAll || toRunCount === 0}
                className={`gt-btn ${toRunCount > 0 ? "gt-btn--solid" : "gt-btn--ghost"}`}
                title={toRunCount === 0 ? "Tout interrogé aujourd'hui" : `Interroger ${toRunCount} question${toRunCount > 1 ? "s" : ""} sans réponse`}>
                {runAll ? "…" : toRunCount > 0 ? `▶ Lancer (${toRunCount})` : "✓ Généré"}
              </button>
              {runAll && (
                <button onClick={() => { stopAllRef.current = true; setRunAll(false); }} className="gt-btn gt-btn--ghost" style={{ borderColor: "#C0352A33", color: "#C0352A" }}>⏹</button>
              )}
            </>
          )}
        </div>
      </div>

            {/* Questions list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: C.textLight, fontSize: 12 }}>
          {questions.length === 0 ? "Aucune question — générez-en depuis les mots-clés ou ajoutez-en manuellement" : "Aucune question ne correspond aux filtres"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(q => {
            const qResults = resultsByQ[q.id] || [];
            const hasBrand = qResults.some(r => r.brand_mentioned === true || r.brand_mentioned === 1);
            const isRunning = running[q.id];
            const isSel = selected.has(q.id);
            const cat = categories.find(c => c.id === q.category_id);
            const kwTag = keywords.find(k => k.id === q.keyword_id);
            return (
              <div key={q.id} className={`gt-item${isSel ? " gt-item--selected" : ""}`} style={{
              borderLeft: `2px solid ${hasBrand ? "#1A7A4A" : q.is_favorite ? "#C97820" : "#1A3C2E11"}`,
              paddingLeft: 12,
              borderRadius: 0,
            }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <input type="checkbox" checked={isSel} onChange={() => { setSelected(prev => { const n = new Set(prev); n.has(q.id) ? n.delete(q.id) : n.add(q.id); return n; }); }} style={{ cursor: "pointer", flexShrink: 0, marginTop: 2 }} />
                  <button onClick={() => toggleFav(q.id, q.is_favorite)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, flexShrink: 0, opacity: q.is_favorite ? 0.9 : 0.2, transition: "opacity 0.2s" }}>⭐</button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Question text — edit mode or display */}
                    {editingQ?.id === q.id ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                        <input
                          autoFocus
                          value={editingQ.text}
                          onChange={e => setEditingQ(prev => ({ ...prev, text: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingQ(null); }}
                          style={{ flex: 1, padding: "5px 10px", border: `1px solid #2563EB`, borderRadius: 7, fontSize: 13, fontWeight: 600, color: C.text }}
                        />
                        <button onClick={saveEdit} style={{ padding: "4px 10px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✓</button>
                        <button onClick={() => setEditingQ(null)} style={{ padding: "4px 8px", background: "#FAFAF8", color: C.textLight, border: "0.5px solid #1A3C2E0D", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>✕</button>
                      </div>
                    ) : (
                      <div className="gt-item-text">{q.question}</div>
                    )}
                    <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                      {kwTag && <span style={{ fontSize: 10, color: C.textLight, background: "#FAFAF8", border: "0.5px solid #1A3C2E0D", borderRadius: 10, padding: "1px 7px" }}>🔑 {kwTag.keyword}</span>}
                      {kwTag?.search_volume > 0 && (
                        <span style={{ fontSize: 10, color: "#1A3C2E44", fontWeight: 400 }}
                          title="Volume de recherche mensuel">
                          {kwTag.search_volume >= 1000 ? (kwTag.search_volume / 1000).toFixed(1) + "k" : kwTag.search_volume} rech/mois
                        </span>
                      )}
                      {cat && <span style={{ fontSize: 10, fontWeight: 500, color: cat.color, background: "transparent", border: `0.5px solid ${cat.color}44`, borderRadius: 20, padding: "2px 9px" }}>{cat.name}</span>}
                      {q.is_manual && <span style={{ fontSize: 10, color: "#1A3C2E33", fontWeight: 400, fontStyle: "italic" }}>manuel</span>}
                      {hasBrand && <span style={{ fontSize: 10, color: "#1A7A4A", fontWeight: 500, letterSpacing: "0.01em" }}>✓ {brand_name}</span>}
                      {qResults.length > 0 && <span style={{ fontSize: 10, color: "#1A3C2E33" }}>{qResults.length} réponse{qResults.length > 1 ? "s" : ""}</span>}
                    </div>
                    {/* Per-provider 30-day calendar */}

                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                    <CatSelect value={q.category_id} categories={categories} onChange={v => setCatSingle(q.id, v)} />
                    <button onClick={() => setEditingQ(editingQ?.id === q.id ? null : { id: q.id, text: q.question })}
                      style={{ padding: "3px 8px", border: "0.5px solid #1A3C2E18", borderRadius: 20, background: "transparent", color: "#1A3C2E55", fontSize: 12, cursor: "pointer", fontWeight: 400 }}
                      title="Modifier">✎</button>
                    <button
                      onClick={() => { const toRun = getProvidersToRun(q, true); if (!toRun.length) return; toRun.forEach(p => runProvider(q, p)); }}
                      disabled={isRunning}
                      title="Lancer tous les providers"
                      style={{ padding: "4px 16px", border: "0.5px solid #1A3C2E33", borderRadius: 20, background: "transparent", color: "#1A3C2E", fontSize: 11, fontWeight: 500, cursor: isRunning ? "wait" : "pointer", opacity: isRunning ? 0.35 : 1, letterSpacing: "0.02em", transition: "opacity 0.2s" }}>
                      {isRunning ? "…" : "▶"}
                    </button>
                    <button onClick={() => deleteQ(q.id)} style={{ padding: "3px 8px", border: "none", background: "transparent", color: "#1A3C2E22", fontSize: 12, cursor: "pointer", transition: "color 0.15s" }}>✕</button>
                  </div>
                </div>
                {/* One row per provider — calendar + info + accordion + run */}
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column" }}>
                  {PROVIDERS.map(p => {
                    const pResults = qResults.filter(r => getProviderId(r.model) === p.id);
                    const hasKey = !!providerKeys[p.id]?.dec;
                    if (!hasKey && !pResults.length) return null;
                    return (
                      <ProviderRow
                        key={p.id}
                        provider={p}
                        results={pResults}
                        allProviderResults={qResults}
                        brandName={brand_name}
                        brandAliases={brand_aliases}
                        hasKey={hasKey}
                        isRunning={!!running[`${q.id}-${p.id}`]}
                        onRun={() => runProvider(q, p)}
                        questionId={q.id}
                        newCalEntry={newCalEntries[`${q.id}|${p.id}`] || null}
                        question={q.question}
                        brandDomain={brand?.brand_domain || ""}
                        claudeKey={providerKeysRef.current["claude"]?.dec || ""}
                        projectId={projectId}
                        siteId={site?.id}
                        savedHint={hintsMap[q.id]?.text || ""}
                        savedHintDate={hintsMap[q.id]?.date || null}
                      />
                    );
                  })}
                </div>
                {/* ── Hint at question level ── */}
                {(() => {
                  const claudeKey = providerKeysRef.current["claude"]?.dec || "";
                  // hintsMap[q.id] est toujours { text, date } ou undefined
                  const savedH     = hintsMap[q.id]?.text || "";
                  const savedHDate = hintsMap[q.id]?.date || null;
                  const anyResult = qResults.length > 0;
                  if (!anyResult) return null;
                  // Get sources from latest result across all providers
                  const latestResult = [...qResults].sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0))[0];
                  const hasBrandQ = isBrandPresent(latestResult);
                  return (
                    <div style={{ marginTop: 8 }}>
                      {savedH ? (
                        /* Hint exists — show toggle */
                        <HintPanelQuestion
                          questionId={q.id}
                          question={q.question}
                          sources={latestResult?.sources || []}
                          brandName={brand_name}
                          brandAliases={brand_aliases}
                          brandDomain={brand?.brand_domain || ""}
                          claudeKey={claudeKey}
                          hasBrand={hasBrandQ}
                          projectId={projectId}
                          siteId={site?.id}
                          savedHint={savedH}
                          savedHintDate={savedHDate}
                          onHintSaved={(text) => setHintsMap(prev => ({ ...prev, [q.id]: { text, date: new Date().toISOString() } }))}
                          initialOpen={false}
                        />
                      ) : claudeKey ? (
                        /* No hint — show generate button */
                        <HintPanelQuestion
                          questionId={q.id}
                          question={q.question}
                          sources={latestResult?.sources || []}
                          brandName={brand_name}
                          brandAliases={brand_aliases}
                          brandDomain={brand?.brand_domain || ""}
                          claudeKey={claudeKey}
                          hasBrand={hasBrandQ}
                          projectId={projectId}
                          siteId={site?.id}
                          savedHint=""
                          savedHintDate={null}
                          onHintSaved={(text) => setHintsMap(prev => ({ ...prev, [q.id]: { text, date: new Date().toISOString() } }))}
                          initialOpen={false}
                        />
                      ) : (
                        <div style={{ fontSize: 10, color: C.textLight, fontStyle: "italic", marginTop: 4 }}>
                          💡 Clé Claude manquante pour générer un hint
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── URL Index sub-tab ─────────────────────────────────────────────


function UrlsTab({ projectId, categories, brand, allResults }) {
  const [urls, setUrls]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const [crawling, setCrawling]         = useState({});
  const [analyzingPage, setAnalyzingPage] = useState({});
  const [pageAnalysis, setPageAnalysis]   = useState({});
  const [filterType, setFilterType] = useState("all"); // all | brand | competitor | other
  const [filterTpl, setFilterTpl]   = useState("");
  const [sortBy, setSortBy]         = useState("citations"); // citations | domain | alpha
  const [search, setSearch]         = useState("");
  const [view, setView]             = useState("urls"); // urls | domains
  const [openCrawl, setOpenCrawl]   = useState(null);

  const brandName    = brand?.brand_name || "";
  const brandAliases = brand?.brand_aliases || [];
  const competitors  = brand?.competitors  || [];

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError(false);
    sbGetUrlIndex(projectId)
      .then(data => { setUrls(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setUrls([]); setLoading(false); setError(true); });
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Classify a URL
  const classifyUrl = (u) => {
    const d = (u.domain || "").toLowerCase();
    const allBrand = [brandName, ...brandAliases].filter(Boolean).map(t => t.toLowerCase());
    const knownComps = competitors.filter(Boolean).map(t => t.toLowerCase());

    if (allBrand.some(t => d.includes(t))) return "brand";

    // Identified competitors from results
    const compNames = new Set();
    allResults.forEach(r => (r.competitors_mentioned || []).forEach(c => { if (c.name) compNames.add(c.name.toLowerCase()); }));
    const identifiedComps = [...compNames];

    if (knownComps.some(t => d.includes(t))) return "competitor_known";
    if (identifiedComps.some(t => d.includes(t) || t.includes(d.split(".")[0]))) return "competitor_identified";
    return "other";
  };
  // Map detailed class to display class
  const mapCls = (c) => c.startsWith("competitor") ? "competitor" : c;

  const classColors = {
    brand:      { color: "#059669", bg: "#ECFDF5", border: "#059669", label: `✓ ${brandName || "Marque"}`,     filterKey: "brand" },
    competitor: { color: "#DC2626", bg: "#FEF2F2", border: "#DC2626", label: "⚔️ Concurrents",                filterKey: "competitor" },
    other:      { color: "#64748B", bg: "#F8FAFC", border: "#E2E8F0", label: "🔗 Autre source",               filterKey: "other" },
  };

  const TEMPLATE_TYPES = ["article","landing","fiche","FAQ","comparatif","forum","media","institutionnel","autre"];

  const filtered = useMemo(() => urls.filter(u => {
    if (search && !u.url?.toLowerCase().includes(search.toLowerCase()) && !u.domain?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterTpl && u.template_type !== filterTpl) return false;
    if (filterType !== "all") {
      const cls = classifyUrl(u);
      if (filterType === "brand" && cls !== "brand") return false;
      if (filterType === "competitor" && !cls.startsWith("competitor")) return false;
      if (filterType === "other" && cls !== "other") return false;
    }
    return true;
  }).sort((a, b) => {
    if (sortBy === "citations") return (b.count_as_source + b.count_in_answer) - (a.count_as_source + a.count_in_answer);
    if (sortBy === "domain") return (a.domain || "").localeCompare(b.domain || "");
    if (sortBy === "alpha") return (a.url || "").localeCompare(b.url || "");
    return 0;
  }), [urls, search, filterTpl, filterType, sortBy, brandName, brandAliases, competitors, allResults]); // eslint-disable-line react-hooks/exhaustive-deps

  // Domain aggregation
  const domains = useMemo(() => {
    const m = {};
    urls.forEach(u => {
      if (!u.domain) return;
      if (!m[u.domain]) m[u.domain] = { domain: u.domain, count_as_source: 0, count_in_answer: 0, urls: [] };
      m[u.domain].count_as_source += u.count_as_source || 0;
      m[u.domain].count_in_answer += u.count_in_answer || 0;
      m[u.domain].urls.push(u);
    });
    return Object.values(m).sort((a, b) => (b.count_as_source + b.count_in_answer) - (a.count_as_source + a.count_in_answer));
  }, [urls]);

  // Counts per class
  const classCounts = useMemo(() => {
    const c = { brand: 0, competitor: 0, other: 0 };
    urls.forEach(u => { const cls = mapCls(classifyUrl(u)); if (c[cls] !== undefined) c[cls]++; });
    return c;
  }, [urls, brandName, brandAliases, competitors, allResults]); // eslint-disable-line react-hooks/exhaustive-deps

  const setThemeCat = async (id, catId) => {
    await sbUpdateUrlMeta(id, { theme_category_id: catId || null });
    setUrls(prev => prev.map(u => u.id === id ? { ...u, theme_category_id: catId || null } : u));
  };

  const setTemplate = async (id, tpl) => {
    await sbUpdateUrlMeta(id, { template_type: tpl || null });
    setUrls(prev => prev.map(u => u.id === id ? { ...u, template_type: tpl || null } : u));
  };

  const launchCrawl = async (urlEntry) => {
    setCrawling(c => ({ ...c, [urlEntry.id]: true }));
    await sbUpdateUrlMeta(urlEntry.id, { crawl_status: "pending" });
    setUrls(prev => prev.map(u => u.id === urlEntry.id ? { ...u, crawl_status: "pending" } : u));
    try {
      const res = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlEntry.url }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Crawl failed");
      const sections = data.sections || [];
      await sbUpdateUrlMeta(urlEntry.id, { crawl_status: "done", crawl_sections: sections, crawl_at: new Date().toISOString() });
      setUrls(prev => prev.map(u => u.id === urlEntry.id ? { ...u, crawl_status: "done", crawl_sections: sections } : u));
      setOpenCrawl(urlEntry.id);
    } catch(e) {
      await sbUpdateUrlMeta(urlEntry.id, { crawl_status: "error" });
      setUrls(prev => prev.map(u => u.id === urlEntry.id ? { ...u, crawl_status: "error" } : u));
      console.error("Crawl échoué:", e.message);
    }
    setCrawling(c => ({ ...c, [urlEntry.id]: false }));
  };

  if (loading) return (
    <div style={{ textAlign: "center", padding: 40, color: C.textLight, fontSize: 12 }}>
      Chargement des sources citées…
    </div>
  );

  if (error || (!loading && urls.length === 0)) return (
    <div style={{ textAlign: "center", padding: 60, color: C.textLight }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>
        {error ? "Table non disponible" : "Aucune source indexée"}
      </div>
      <div style={{ fontSize: 12 }}>
        {error
          ? "Exécutez migration-geo-v2.sql dans Supabase, puis interrogez des questions."
          : "Interrogez des questions pour voir apparaître les URLs citées."}
      </div>
    </div>
  );


  const analyzePageContent = async (urlEntry) => {
    const claudeKey = (function() {
      try {
        const s = sessionStorage.getItem("correl_session") || localStorage.getItem("correl_session");
        const sess = s ? JSON.parse(s) : null;
        return sess?.__claude_key || "";
      } catch { return ""; }
    })();
    setAnalyzingPage(prev => ({ ...prev, [urlEntry.id]: true }));
    try {
      const sections = (urlEntry.crawl_sections || []).slice(0, 20);
      const pageContent = sections.map(s => `[${s.type || "section"}] ${(s.text || s.title || s.content || "").slice(0, 300)}`).join("\n").slice(0, 3000);
      const prompt = [
        `Tu es expert GEO. Analyse cette page : ${urlEntry.url}`,
        "",
        pageContent ? `CONTENU :${("\n" + pageContent)}` : "(page non crawlée — analyse à partir de l'URL uniquement)",
        "",
        "Réponds UNIQUEMENT avec ce JSON (sans markdown) :",
        JSON.stringify({summary:"2 phrases",geo_signals:["signal"],opportunities:["action"],content_type:"type",seo_score:7}),
      ].join("\n");
      const res = await fetch("/api/claude-geo", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Claude-Key": claudeKey },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 600, messages: [{ role: "user", content: prompt }] }),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`Claude ${res.status}`);
      const data = JSON.parse(raw);
      const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
      const analysis = JSON.parse(text.replace(/```json|```/g, "").trim());
      setPageAnalysis(prev => ({ ...prev, [urlEntry.id]: analysis }));
    } catch(e) {
      setPageAnalysis(prev => ({ ...prev, [urlEntry.id]: { error: e.message } }));
    }
    setAnalyzingPage(prev => ({ ...prev, [urlEntry.id]: false }));
  };

  return (
    <div>
      {/* ── Legend strip ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {Object.entries(classColors).map(([cls, meta]) => {
          const fk = meta.filterKey;
          const active = filterType === fk;
          const count = classCounts[cls] ?? 0;
          return (
            <button key={cls} onClick={() => setFilterType(active ? "all" : fk)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
                borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer",
                border: `2px solid ${active ? meta.color : meta.border}`,
                background: active ? meta.color : meta.bg,
                color: active ? "#fff" : meta.color,
                transition: "all 0.15s",
              }}>
              {meta.label}
              <span style={{ opacity: 0.75, fontWeight: 500 }}>({count})</span>
            </button>
          );
        })}
        {/* "Tout" reset */}
        {filterType !== "all" && (
          <button onClick={() => setFilterType("all")}
            style={{ padding: "6px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "0.5px solid #1A3C2E0D", background: "#FAFAF8", color: C.textMid }}>
            ✕ Tout afficher
          </button>
        )}
      </div>

      {/* ── Filters + view toggle ── */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher…"
          style={{ padding: "6px 10px", border: "0.5px solid #1A3C2E0D", borderRadius: 8, fontSize: 12, color: C.text, width: 220 }} />
        <select value={filterTpl} onChange={e => setFilterTpl(e.target.value)}
          style={{ padding: "5px 8px", border: "0.5px solid #1A3C2E0D", borderRadius: 6, fontSize: 11, color: C.text }}>
          <option value="">Tous templates</option>
          {TEMPLATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ padding: "5px 8px", border: "0.5px solid #1A3C2E0D", borderRadius: 6, fontSize: 11, color: C.text }}>
          <option value="citations">Trier : + citées</option>
          <option value="domain">Trier : domaine</option>
          <option value="alpha">Trier : URL A→Z</option>
        </select>
        <span style={{ fontSize: 11, color: C.textLight }}>{filtered.length} URL{filtered.length > 1 ? "s" : ""} · {domains.length} domaine{domains.length > 1 ? "s" : ""}</span>

        {/* View toggle */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 3, background: "#FAFAF8", borderRadius: 8, padding: 3 }}>
          {[{ key: "urls", label: "🔗 URLs" }, { key: "domains", label: "🌐 Domaines" }].map(v => (
            <button key={v.key} onClick={() => setView(v.key)} style={{
              padding: "4px 14px", borderRadius: 6, fontSize: 12, fontWeight: view === v.key ? 700 : 400,
              border: "none", cursor: "pointer",
              background: view === v.key ? C.white : "transparent",
              color: view === v.key ? C.text : C.textLight,
              boxShadow: view === v.key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}>{v.label}</button>
          ))}
        </div>
      </div>

      {/* ── URLs view ── */}
      {view === "urls" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {filtered.map(u => {
            const cls  = mapCls(classifyUrl(u));
            const meta = classColors[cls];
            const isOpen = openCrawl === u.id;
            const hasSections = u.crawl_sections?.length > 0;
            const cat = categories.find(c => c.id === u.theme_category_id);
            return (
              <div key={u.id} style={{ background: meta.bg, border: `1.5px solid ${meta.border}33`, borderLeft: `4px solid ${meta.color}`, borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", flexWrap: "wrap" }}>
                  {/* Counts */}
                  <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, background: `${meta.color}22`, color: meta.color, borderRadius: 5, padding: "2px 7px" }} title="Source">📎 {u.count_as_source}</span>
  
                  </div>
                  {/* Class badge */}
                  <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}44`, borderRadius: 10, padding: "1px 8px", flexShrink: 0 }}>
                    {meta.label}
                  </span>
                  {/* URL */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontSize: 12, color: meta.color, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stripQuery(u.url)}</span>
                      <a href={u.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                        style={{ flexShrink: 0, fontSize: 10, color: C.textLight, border: "0.5px solid #1A3C2E0D", borderRadius: 4, padding: "1px 5px", textDecoration: "none" }}>↗</a>
                    </div>
                    <div style={{ fontSize: 10, color: C.textLight }}>{u.domain}</div>
                  </div>
                  {/* Selectors */}
                  <div style={{ display: "flex", gap: 5, flexShrink: 0, flexWrap: "wrap" }}>
                    {cat && <span style={{ fontSize: 10, fontWeight: 700, color: cat.color, background: cat.color+"18", borderRadius: 10, padding: "1px 7px" }}>{cat.name}</span>}
                    <CatSelect value={u.theme_category_id} categories={categories} onChange={v => setThemeCat(u.id, v)} placeholder="Thème…" />
                    <select value={u.template_type || ""} onChange={e => setTemplate(u.id, e.target.value || null)}
                      style={{ padding: "3px 6px", border: "0.5px solid #1A3C2E0D", borderRadius: 6, fontSize: 10, color: u.template_type ? C.text : C.textLight }}>
                      <option value="">Template…</option>
                      {TEMPLATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {/* Crawl button */}
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {hasSections && (
                      <button onClick={() => setOpenCrawl(isOpen ? null : u.id)}
                        style={{ padding: "3px 8px", border: "0.5px solid #1A3C2E0D", borderRadius: 6, fontSize: 10, cursor: "pointer", background: isOpen ? C.bg : C.white, color: C.textMid }}>
                        {isOpen ? "▲" : "▼"} Sections
                      </button>
                    )}
                    <button onClick={() => launchCrawl(u)} disabled={crawling[u.id]}
                      title={u.crawl_status === "done" ? "Recrawler la page" : "Analyser le contenu de la page"}
                      style={{ padding: "3px 8px", border: `1px solid ${meta.color}`, borderRadius: 6, fontSize: 10, cursor: crawling[u.id] ? "wait" : "pointer", background: meta.bg, color: meta.color, fontWeight: 600 }}>
                      {crawling[u.id] ? "⏳" : u.crawl_status === "done" ? "🔄" : "🕷️"}
                    </button>
                    {u.crawl_status === "done" && (
                      <button onClick={() => analyzePageContent(u)} disabled={!!analyzingPage[u.id]}
                        title="Lire la page et identifier les particularités (structure, contenu GEO, opportunités)"
                        style={{ padding: "3px 8px", border: "1px solid #7C3AED", borderRadius: 6, fontSize: 10, cursor: analyzingPage[u.id] ? "wait" : "pointer", background: "#F5F3FF", color: "#7C3AED", fontWeight: 600 }}>
                        {analyzingPage[u.id] ? "⏳" : "✦ Analyser"}
                      </button>
                    )}
                  </div>
                </div>
                {/* Crawl sections */}
                {isOpen && hasSections && (
                  <div style={{ borderTop: `1px solid ${meta.border}33`, background: "#FAFAF8", padding: "10px 14px" }}>
                    <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "#1A3C2E55", marginBottom: 8 }}>Sections · {u.crawl_sections.length}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 7 }}>
                      {u.crawl_sections.map((sec, i) => (
                        <div key={i} style={{ background: "#fff", border: `1px solid ${sec.used_in_llm ? "#059669" : C.border}`, borderRadius: 7, padding: "8px 10px", borderLeft: `3px solid ${sec.used_in_llm ? "#059669" : C.border}` }}>
                          <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 3 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: "#7C3AED", background: "#F5F3FF", borderRadius: 4, padding: "1px 5px" }}>{sec.type}</span>
                            {sec.used_in_llm && <span style={{ fontSize: 9, color: "#059669", fontWeight: 600 }}>✓ LLM</span>}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 2 }}>{sec.title}</div>
                          <div style={{ fontSize: 10, color: C.textLight, lineHeight: 1.4 }}>{sec.summary}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              {/* GEO page analysis results */}
              {pageAnalysis[u.id] && (
                <div style={{ borderTop: "1px solid #E9D5FF", background: "#F5F3FF", padding: "10px 14px" }}>
                  {pageAnalysis[u.id].error ? (
                    <div style={{ fontSize: 11, color: "#DC2626" }}>Erreur : {pageAnalysis[u.id].error}</div>
                  ) : (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.7 }}>✦ Analyse GEO</div>
                      <div style={{ fontSize: 11, color: "#5B21B6", marginBottom: 8, lineHeight: 1.5 }}>{pageAnalysis[u.id].summary}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#059669", marginBottom: 4 }}>✓ Signaux GEO</div>
                          {(pageAnalysis[u.id].geo_signals || []).map((s, i) => <div key={i} style={{ fontSize: 11, color: "#065F46", marginBottom: 2 }}>• {s}</div>)}
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#D97706", marginBottom: 4 }}>→ Opportunités</div>
                          {(pageAnalysis[u.id].opportunities || []).map((o, i) => <div key={i} style={{ fontSize: 11, color: "#92400E", marginBottom: 2 }}>• {o}</div>)}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* ── Domains view ── */}
      {view === "domains" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {domains.map((d, i) => {
            const cls  = mapCls(classifyUrl({ domain: d.domain }));
            const meta = classColors[cls];
            const total = d.count_as_source + d.count_in_answer;
            const maxTotal = domains[0] ? domains[0].count_as_source + domains[0].count_in_answer : 1;
            return (
              <div key={d.domain} style={{ background: meta.bg, border: `1.5px solid ${meta.border}33`, borderLeft: `4px solid ${meta.color}`, borderRadius: 10, padding: "10px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: C.textLight, minWidth: 28 }}>#{i+1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>{d.domain}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}44`, borderRadius: 10, padding: "1px 7px" }}>{meta.label}</span>
                      <span style={{ fontSize: 10, color: C.textLight }}>{d.urls.length} URL{d.urls.length > 1 ? "s" : ""}</span>
                    </div>
                    {/* Bar */}
                    <div style={{ height: 5, background: `${meta.color}22`, borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
                      <div style={{ height: "100%", width: `${(total / maxTotal) * 100}%`, background: meta.color, borderRadius: 3, transition: "width 0.4s" }} />
                    </div>
                    <div style={{ display: "flex", gap: 10, fontSize: 11, color: C.textLight }}>
                      <span>📎 {d.count_as_source} source{d.count_as_source > 1 ? "s" : ""}</span>

                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main GeoTab ───────────────────────────────────────────────────

// ── AutomationTab ────────────────────────────────────────────────
function AutomationTab({ projectId, site, user, providerKeys }) {
  const [schedule, setSchedule]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState(null);
  const [error, setError]         = useState("");

  const [active, setActive]       = useState(true);
  const [frequency, setFrequency] = useState("weekly");
  const [providers, setProviders] = useState(["openai"]);
  const [maxQ, setMaxQ]           = useState(10);

  const FREQUENCIES = [
    { key: "daily",    label: "Quotidien",    desc: "Chaque jour" },
    { key: "weekly",   label: "Hebdomadaire", desc: "Chaque semaine" },
    { key: "biweekly", label: "Bi-mensuel",   desc: "Toutes les 2 semaines" },
    { key: "monthly",  label: "Mensuel",      desc: "Chaque mois" },
  ];

  useEffect(() => {
    if (!projectId || !site?.id) return;
    setLoading(true);
    sbGetSchedule(projectId, site.id).then(s => {
      if (s) {
        setSchedule(s);
        setActive(s.active);
        setFrequency(s.frequency);
        setProviders(s.providers || ["openai"]);
        setMaxQ(s.max_questions || 10);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [projectId, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableProviders = PROVIDERS.filter(p => !!providerKeys[p.id]?.dec);

  const save = async () => {
    if (!providers.length) { setError("Sélectionnez au moins un provider."); return; }
    setSaving(true); setError("");
    try {
      const s = await sbSaveSchedule({
        project_id: projectId, site_id: site.id,
        owner_email: user?.email || "",
        frequency, providers, active, max_questions: maxQ,
      });
      setSchedule(s);
    } catch(e) { setError(e.message); }
    setSaving(false);
  };

  const toggleActive = async () => {
    if (!schedule) return;
    const next = !active;
    setActive(next);
    await sbUpdateSchedule(schedule.id, { active: next });
    setSchedule(prev => ({ ...prev, active: next }));
  };

  const trigger = async () => {
    setTriggering(true); setTriggerResult(null); setError("");
    try {
      const res = await sbTriggerScheduler();
      setTriggerResult(res);
    } catch(e) { setError(e.message); }
    setTriggering(false);
  };

  const toggleProvider = (id) => {
    setProviders(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

  if (loading) return (
    <div style={{ padding: 32, textAlign: "center", color: "#1A3C2E55", fontSize: 13 }}>Chargement…</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, maxWidth: 680 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <div className="gt-label" style={{ marginBottom: 4 }}>Automatisation</div>
          <div className="gt-heading" style={{ marginBottom: 4 }}>Interrogation automatique</div>
          <div className="gt-body-sm">Questions ⭐ favoris — sans connexion à l'app</div>
        </div>
        {schedule && (
          <button
            onClick={toggleActive}
            className={`gt-btn ${active ? "gt-btn--ghost" : "gt-btn--solid"}`}
            style={{ marginTop: 4 }}>
            {active ? "Désactiver" : "Activer"}
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: "#FEF2F2", border: "0.5px solid #C0352A22", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#C0352A", marginBottom: 16 }}>{error}</div>
      )}

      {/* Status si schedule existe */}
      {schedule && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 28 }}>
          {[
            { label: "Prochain run", value: fmtDate(schedule.next_run) },
            { label: "Dernier run",  value: fmtDate(schedule.last_run) },
            { label: "Questions",    value: schedule.last_run_count || 0 },
          ].map(k => (
            <div key={k.label} className="gt-kpi-card">
              <div className="gt-kpi-label" style={{ marginBottom: 6 }}>{k.label}</div>
              <div className="gt-body" style={{ fontWeight: 500 }}>{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Fréquence ── */}
      <div style={{ marginBottom: 24 }}>
        <div className="gt-label" style={{ marginBottom: 12 }}>Fréquence</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {FREQUENCIES.map(f => {
            const active = frequency === f.key;
            return (
              <button key={f.key} onClick={() => setFrequency(f.key)}
                style={{
                  padding: "14px 10px", textAlign: "center", cursor: "pointer",
                  border: active ? "1px solid #1A3C2E" : "0.5px solid #1A3C2E18",
                  borderRadius: 8,
                  background: active ? "#1A3C2E" : "transparent",
                  transition: "all 0.15s",
                }}>
                <div className={`gt-body ${active ? "" : "gt-dimmed"}`} style={{ fontWeight: 500, fontSize: 12, color: active ? "#F0EBE0" : undefined, marginBottom: 3 }}>{f.label}</div>
                <div style={{ fontSize: 10, color: active ? "#F0EBE077" : "#1A3C2E33" }}>{f.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Providers ── */}
      <div style={{ marginBottom: 24 }}>
        <div className="gt-label" style={{ marginBottom: 12 }}>
          Providers à interroger
          {availableProviders.length === 0 && (
            <span style={{ marginLeft: 8, fontSize: 10, color: "#C0352A", textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>
              — aucune clé configurée
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PROVIDERS.map(p => {
            const hasKey = !!providerKeys[p.id]?.dec;
            const sel = providers.includes(p.id);
            return (
              <button key={p.id} onClick={() => hasKey && toggleProvider(p.id)}
                title={!hasKey ? `Clé ${p.label} manquante` : undefined}
                className={`gt-filter-pill${sel && hasKey ? " gt-filter-pill--active" : ""}`}
                style={{ opacity: hasKey ? 1 : 0.3, cursor: hasKey ? "pointer" : "not-allowed" }}>
                {p.label}{!hasKey ? " ·" : sel ? " ✓" : ""}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Nb max questions ── */}
      <div style={{ marginBottom: 28 }}>
        <div className="gt-label" style={{ marginBottom: 12 }}>Nb max de questions par run</div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <input type="range" min={1} max={50} value={maxQ} onChange={e => setMaxQ(+e.target.value)}
            style={{ flex: 1, accentColor: "#1A3C2E", height: 2 }} />
          <span className="gt-kpi-val" style={{ fontSize: 20, minWidth: 28, textAlign: "right" }}>{maxQ}</span>
        </div>
        <div className="gt-caption" style={{ marginTop: 6 }}>
          ~{maxQ} × {providers.length} provider{providers.length > 1 ? "s" : ""} = {maxQ * providers.length} appels API par run
        </div>
      </div>

      {/* ── Bouton save ── */}
      <button onClick={save} disabled={saving || !providers.length}
        className={`gt-btn gt-btn--solid`}
        style={{ width: "100%", justifyContent: "center", padding: "11px 0", fontSize: 12, borderRadius: 8, opacity: (saving || !providers.length) ? 0.4 : 1 }}>
        {saving ? "Sauvegarde…" : schedule ? "Mettre à jour" : "Activer l'automatisation"}
      </button>

      {/* ── Test manuel ── */}
      {schedule && (
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: "0.5px solid #1A3C2E08" }}>
          <div className="gt-label" style={{ marginBottom: 8 }}>Test manuel</div>
          <div className="gt-caption" style={{ marginBottom: 12 }}>
            Déclenche immédiatement l'automatisation pour vérifier le fonctionnement.
          </div>
          <button onClick={trigger} disabled={triggering}
            className="gt-btn"
            style={{ opacity: triggering ? 0.4 : 1 }}>
            {triggering ? "En cours…" : "▶ Lancer maintenant"}
          </button>
          {triggerResult && (
            <div style={{ marginTop: 10, fontSize: 11, color: "#1A7A4A", padding: "8px 12px", background: "transparent", border: "0.5px solid #1A7A4A22", borderRadius: 6 }}>
              ✓ {triggerResult.processed || 0} schedule(s) — {triggerResult.results?.[0]?.questions_processed || 0} question(s) traitée(s)
            </div>
          )}
        </div>
      )}
    </div>
  );
}



// ── BrandConfigAccordion — wrapper qui ferme la card après save ───
function BrandConfigAccordion({ sites, projectId }) {
  const [openId, setOpenId] = useState(null);
  const [keys, setKeys] = useState({});

  if (!sites?.length) {
    return <div style={{ fontSize: 12, color: "#94A3B8", fontStyle: "italic" }}>Ajoutez un site pour configurer sa marque.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {sites.map(site => {
        const isOpen = openId === site.id;
        const cardKey = keys[site.id] || site.id;
        return (
          <div key={site.id} style={{ border: `1px solid ${site.color}33`, borderRadius: 10, overflow: "hidden" }}>
            {/* Header accordéon */}
            <div onClick={() => setOpenId(isOpen ? null : site.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: isOpen ? site.bg : "#F8FAFC", cursor: "pointer", borderBottom: isOpen ? `1px solid ${site.color}22` : "none" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: site.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: site.color, flex: 1 }}>{site.label}</span>
              <span style={{ fontSize: 11, color: "#94A3B8" }}>{isOpen ? "▲" : "▼"}</span>
            </div>
            {/* Contenu BrandConfigPanel */}
            {isOpen && (
              <div
                ref={el => {
                  if (!el) return;
                  // Intercepter le clic sur le bouton "Sauvegarder" de BrandConfigPanel
                  const handler = (e) => {
                    const btn = e.target.closest("button");
                    if (!btn) return;
                    const label = btn.textContent?.trim().toLowerCase();
                    if (label.includes("sauvegarder") || label.includes("save") || label.includes("enregistrer")) {
                      // Fermer l'accordéon après un court délai (laisse le save se terminer)
                      setTimeout(() => {
                        setOpenId(null);
                        // Reset la key pour forcer remount la prochaine fois
                        setKeys(prev => ({ ...prev, [site.id]: `${site.id}-${Date.now()}` }));
                      }, 300);
                    }
                    // Bouton Annuler → fermer immédiatement
                    if (label.includes("annuler") || label.includes("cancel")) {
                      setOpenId(null);
                    }
                  };
                  el.addEventListener("click", handler);
                  return () => el.removeEventListener("click", handler);
                }}
                style={{ padding: "12px 14px", background: "#fff" }}>
                <BrandConfigPanel key={cardKey} site={site} projectId={projectId} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ── FanoutSetupPanel — vue props-only, zéro état local projet ──────
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

function FanoutSetupPanel({
  projects, currentProjectId, setCurrentProjectId, setProjects, ownerEmail,
  sites, setSites, smData, setSmData,
  sfData, setSfData, gscData, setGscData, gaData, setGaData, bingData, setBingData,
  dbHistory, dbLoading, refreshHistory, confirmModal, setConfirmModal,
  project, projectId, onSaveProviderKeys,
  axes, onSaveAxes, onAxesChange,
  onSemrushVolumes,
}) {
  const [showHistory, setShowHistory] = useState(false);

  // Tout normalisé ici — jamais de .map() sur une valeur non-array
  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeSites    = Array.isArray(sites)    ? sites    : [];
  const safeHistory  = Array.isArray(dbHistory)? dbHistory: [];
  const safeAxes     = Array.isArray(axes)     ? axes     : DEFAULT_AXES;

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
                style={{ width: "100%", padding: "7px 28px 7px 10px", border: `1.5px solid ${C.blue}`, borderRadius: 8, fontSize: 13, fontWeight: 600, color: C.blue, background: C.blueLight, cursor: "pointer", appearance: "none" }}>
                {safeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: C.blue, fontSize: 11 }}>▾</span>
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
              }} style={{ padding: "6px 10px", borderRadius: 7, border: `1.5px dashed ${C.blue}`, background: C.blueLight, color: C.blue, cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>+ Nouveau</button>
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
                    setSmData(p => { const n = {...p}; delete n[site.id]; return n; });
                  }})} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#DC2626", padding: 0 }}>✕</button>
                )}
              </div>
            ))}
            {safeSites.length < 3 && (
              <button onClick={() => {
                const palette = SITE_PALETTE[safeSites.length] || SITE_PALETTE[0];
                const newId = `site-${Date.now()}`;
                setSites(prev => [...(Array.isArray(prev) ? prev : []), { id: newId, label: `Site ${safeSites.length + 1}`, ...palette }]);
                setSmData(p => ({...p, [newId]: []}));
              }} style={{ padding: "4px 10px", borderRadius: 20, border: `1px dashed ${C.border}`, background: "#fff", color: C.blue, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>+ Site</button>
            )}
          </div>

          {/* Historique */}
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, color: C.textLight }}>
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: dbLoading ? "#F59E0B" : safeHistory.length > 0 ? "#059669" : "#CBD5E1", marginRight: 5 }} />
              {dbLoading ? "Chargement…" : `${safeHistory.length} imports en base`}
            </span>
            <button onClick={() => { setShowHistory(h => !h); refreshHistory?.(); }}
              style={{ fontSize: 11, color: showHistory ? C.blue : C.textLight, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              {showHistory ? "▲ Masquer" : "📋 Historique"}
            </button>
          </div>
          {showHistory && (
            <div style={{ marginTop: 8, maxHeight: 140, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
              {safeHistory.slice(0, 20).map(row => {
                const site = safeSites.find(s => s.id === row.site_id);
                const lbl = { sf:"🐸 SF", gsc:"🔍 GSC", ga:"📊 GA4", bing:"🤖 Bing", sm:"📈 SM" }[row.source] || row.source;
                return (
                  <div key={row.id} style={{ display: "flex", gap: 8, padding: "4px 8px", background: "#FAFAF8", borderRadius: 5, fontSize: 10, alignItems: "center" }}>
                    <span style={{ color: site?.color || C.text, fontWeight: 600, minWidth: 60 }}>{site?.label || "—"}</span>
                    <span style={{ color: C.textMid }}>{lbl}</span>
                    <span style={{ color: C.textLight, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.filename}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SetupSection>

      {/* ── Import Semrush ── */}
      <SetupSection icon="📈" title="Import Semrush — volumes de recherche">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {safeSites.map(site => (
            <div key={site.id} style={{ flex: "1 1 200px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: site.color, marginBottom: 8 }}>{site.label}</div>
              <UploadCard label="Semrush" icon="📈" hint="Organic pages export" color={site.color}
                loaded={(smData||{})[site.id]?.length > 0} rows={(smData||{})[site.id]}
                onData={(_, rawText) => { const rows = parseSemrush(parseSemrushCSV(rawText)); setSmData(p => ({...p, [site.id]: rows})); }}
                onClear={() => setSmData(p => ({...p, [site.id]: []}))}
                rawMode siteId={site.id} source="sm" projectId={projectId}
                onAfterUpload={refreshHistory}
                onLoadFromHistory={async row => { try { const t = await sbDownload(row.storage_path); const rows = parseSemrush(parseSemrushCSV(t)); setSmData(p => ({...p, [site.id]: rows})); } catch(e) {} }}
              />
              {(smData||{})[site.id]?.length > 0 && <div style={{ marginTop: 4, fontSize: 10, color: site.color, fontWeight: 600 }}>✓ {(smData||{})[site.id].length} pages</div>}
              {lastImports[`${site.id}_sm`]?.storage_path && !(smData||{})[site.id]?.length && (
                <button onClick={async () => { try { const t = await sbDownload(lastImports[`${site.id}_sm`].storage_path); const rows = parseSemrush(parseSemrushCSV(t)); setSmData(p => ({...p, [site.id]: rows})); } catch(e) {} }}
                  style={{ marginTop: 4, width: "100%", padding: "3px 0", border: `1px solid ${site.color}`, borderRadius: 6, background: site.bg, color: site.color, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>↩ Dernier</button>
              )}
            </div>
          ))}
        </div>
      </SetupSection>

      {/* ── Clés API providers ── */}
      <SetupSection icon="🔑" title="Clés API — providers IA">
        <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px" }}>
          <ProviderConfigPanel project={project} projectId={projectId} sites={safeSites} onSaveProviderKeys={onSaveProviderKeys} />
        </div>
      </SetupSection>

      {/* ── Axes de génération ── */}
      <SetupSection icon="🎯" title="Axes de génération des questions">
        <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "#64748B", marginBottom: 10 }}>
            Chaque mot-clé génère une question par axe. Adaptez les angles à votre secteur.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {safeAxes.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#94A3B8", minWidth: 18, flexShrink: 0 }}>{i + 1}.</span>
                <input value={a} onChange={e => { const u = [...safeAxes]; u[i] = e.target.value; onAxesChange?.(u); }}
                  style={{ flex: 1, padding: "5px 9px", border: "1px solid #E2E8F0", borderRadius: 7, fontSize: 12, color: "#1E293B" }} />
                <button onClick={() => onAxesChange?.(safeAxes.filter((_, j) => j !== i))}
                  style={{ fontSize: 11, color: "#94A3B8", background: "none", border: "none", cursor: "pointer", padding: "0 4px", flexShrink: 0 }}>✕</button>
              </div>
            ))}
            <button onClick={() => onAxesChange?.([...safeAxes, ""])}
              style={{ fontSize: 11, color: "#2563EB", background: "none", border: "1px dashed #E2E8F0", borderRadius: 7, padding: "5px 12px", cursor: "pointer", textAlign: "left", marginTop: 2 }}>
              + Ajouter un axe
            </button>
          </div>
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
            <button onClick={async () => { if (onSaveAxes) await onSaveAxes(safeAxes); }}
              style={{ padding: "6px 16px", background: "#1A3C2E", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              💾 Sauvegarder les axes
            </button>
          </div>
        </div>
      </SetupSection>

      {/* ── Configuration marques ── */}
      <SetupSection icon="🏷️" title="Configuration des marques">
        <BrandConfigAccordion sites={safeSites} projectId={projectId} />
      </SetupSection>

    </div>
  );
}


export default function GeoTab({ sites, projectId, project, geoAxes, onSaveAxes, onSaveProviderKeys, user,
  // Props setup (nouvelles — passées depuis App.jsx)
  projects, currentProjectId, setCurrentProjectId, setProjects, ownerEmail,
  setSites, smData, setSmData,
  sfData, setSfData, gscData, setGscData, gaData, setGaData, bingData, setBingData,
  dbHistory, dbLoading, refreshHistory, confirmModal, setConfirmModal,
  isReadOnly = false,
  autoStartTour = false,
  onTourStarted = null,
}) {
  const [mainTab, setMainTab]       = useState("analyse"); // "setup" | "analyse"
  const [subTab, setSubTab]         = useState("keywords"); // keywords | questions | urls
  const [questionsKey, setQuestionsKey] = useState(0); // incremented to force QuestionsTab reload
  const [selectedSite, setSelectedSite] = useState(sites[0]?.id || "");
  // Démarrer le tour automatiquement si demandé
  useEffect(() => {
    if (autoStartTour) { setMainTab("analyse"); setShowTour(true); onTourStarted?.(); }
  }, [autoStartTour]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync selectedSite quand le projet change
  useEffect(() => {
    setSelectedSite(sites[0]?.id || "");
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Parse persisted settings from project
  const projectSettings = (() => {
    try { return project?.settings_json ? JSON.parse(project.settings_json) : {}; } catch { return {}; }
  })();

  const [model] = useState(projectSettings.model || "gpt-4o-mini"); // kept for variation generation (OpenAI completions endpoint)
  const [brand, setBrand]           = useState(null);
  const [runMode] = useState(projectSettings.runMode || "parallel"); // parallel | sequential
  const [semrushKeyDec, setSemrushKeyDec] = useState(() => decodeKey(project?.semrush_key_enc || ""));
  // Sync semrush key when project changes
  useEffect(() => {
    const dec = decodeKey(project?.semrush_key_enc || "");
    if (dec) setSemrushKeyDec(dec);
  }, [project?.id, project?.semrush_key_enc]); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeProviders, setActiveProviders] = useState(() => {
    // 1. Load from saved settings
    if (projectSettings.activeProviders?.length) return projectSettings.activeProviders;
    // 2. Fallback: all providers that have keys configured
    if (project) {
      const withKeys = PROVIDERS.filter(p => project[p.keyField]).map(p => p.id);
      if (withKeys.length) return withKeys;
    }
    return ["openai"];
  });
  // Provider key state: { id → { enc, dec, input, status } }
  const [providerKeys, setProviderKeys] = useState(() => {
    // Initialize synchronously from project prop so keys are available immediately
    const init = {};
    if (project) {
      PROVIDERS.forEach(p => {
        const enc = project[p.keyField] || "";
        if (enc) {
          const dec = decodeKey(enc);
          if (dec) init[p.id] = { enc, dec, input: "", status: "ok" };
        }
      });
    }
    return init;
  });
  const [apiKeyEnc, setApiKeyEnc]   = useState(project?.openai_key_enc || ""); // legacy for variation gen

  // Auto-save UI settings when they change
  useEffect(() => {
    if (!projectId) return;
    const timer = setTimeout(() => {
      const settings = { runMode, activeProviders, model };
      sbSaveProjectSettings(projectId, settings).catch(() => {});
    }, 800); // debounce 800ms
    return () => clearTimeout(timer);
  }, [runMode, activeProviders, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync all provider keys when project prop updates
  useEffect(() => {
    if (!project) return;
    const updates = {};
    PROVIDERS.forEach(p => {
      const enc = project[p.keyField] || "";
      if (enc) {
        const dec = decodeKey(enc);
        updates[p.id] = { enc, dec, input: "", status: dec ? "ok" : "error" };
      }
    });
    if (Object.keys(updates).length) setProviderKeys(prev => ({ ...prev, ...updates }));
    // Sync legacy openai key for variation generation
    if (project?.openai_key_enc && project.openai_key_enc !== apiKeyEnc) {
      setApiKeyEnc(project.openai_key_enc);
    }
  }, [project?.id, project?.openai_key_enc, project?.gemini_key_enc, project?.perplexity_key_enc, project?.claude_geo_key_enc, project?.semrush_key_enc]); // eslint-disable-line react-hooks/exhaustive-deps
  const [apiKeyDec, setApiKeyDec]   = useState("");           // decrypted, only in memory

  // Sync activeProviders : ajouter automatiquement tout provider dont la clé est configurée
  // (s'exécute quand les clés changent — ne retire jamais un provider, ajoute seulement)
  useEffect(() => {
    if (!project) return;
    const withKeys = PROVIDERS.filter(p => project[p.keyField]).map(p => p.id);
    if (!withKeys.length) return;
    setActiveProviders(prev => {
      const missing = withKeys.filter(id => !prev.includes(id));
      if (!missing.length) return prev; // rien à ajouter
      return [...prev, ...missing];
    });
  }, [project?.openai_key_enc, project?.gemini_key_enc, project?.perplexity_key_enc, project?.claude_geo_key_enc]); // eslint-disable-line react-hooks/exhaustive-deps
  const [allResults, setAllResults] = useState([]);
  const [keywords, setKeywords]     = useState([]); // lifted from KeywordsTab for cross-tab ordering
  const [categories, setCategories] = useState([]);
  const [axes, setAxes]             = useState(Array.isArray(geoAxes) ? geoAxes : DEFAULT_AXES);
  const [competitors, setCompetitors] = useState([]);
  const [showTour, setShowTour]       = useState(false);

  const site = (Array.isArray(sites) ? sites : []).find(s => s.id === selectedSite) || (Array.isArray(sites) ? sites : [])[0];

  // Sync axes when project changes
  useEffect(() => {
    setAxes(Array.isArray(geoAxes) ? geoAxes : DEFAULT_AXES);
  }, [geoAxes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load categories (project-wide, once)
  useEffect(() => {
    if (!projectId) return;
    sbGetCategories(projectId).then(setCategories);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load brand + results when project or site changes
  useEffect(() => {
    if (!projectId || !site?.id) return;
    sbGetBrand(projectId, site.id).then(b => { setBrand(b); });
    sbGetGeoResults(projectId, site.id).then(r => { setAllResults(r); }); // keep previous data while loading
    sbGetKeywords(projectId, site.id).then(kws => { setKeywords(kws || []); });
    sbGetCompetitors(projectId, site.id).then(c => { setCompetitors(c || []); });
  }, [projectId, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Decode key when enc changes
  useEffect(() => {
    if (!apiKeyEnc) return;
    const k = decodeKey(apiKeyEnc);
    setApiKeyDec(k);
  }, [apiKeyEnc]); // eslint-disable-line react-hooks/exhaustive-deps


  const GEO_TOUR_STEPS = [
    {
      target: "subnav", icon: "🧭", title: "Navigation Fan-outs",
      desc: "5 onglets structurent l'analyse : Mots-clés, Questions, Concurrents, Automatisation et Sources.",
      tip: "Commencez par les Mots-clés.", position: "bottom",
      onActivate: () => { setMainTab("analyse"); setSubTab("keywords"); },
    },
    {
      target: "keywords-section", icon: "🔑", title: "Mots-clés",
      desc: "Saisissez vos requêtes cibles (une par ligne) ou importez un CSV. Générez les questions avec OpenAI.",
      tip: "Commencez par 5–10 mots-clés stratégiques.", position: "bottom",
      onActivate: () => { setMainTab("analyse"); setSubTab("keywords"); },
    },
    {
      target: "stats-header", icon: "📊", title: "Tableau de bord de présence",
      desc: "% de présence marque, position moyenne, concurrents détectés. Se met à jour après chaque interrogation.",
      tip: "Filtrez par provider pour analyser les tendances.", position: "bottom",
      onActivate: () => { setMainTab("analyse"); setSubTab("questions"); },
    },
    {
      target: "run-all", icon: "▶", title: "Lancer les interrogations",
      desc: "Interroge uniquement les questions sans réponse aujourd'hui. ↺ force le rechargement total.",
      tip: "L'historique est consultable dans l'Audit GEO.", position: "top",
      onActivate: () => { setMainTab("analyse"); setSubTab("questions"); },
    },
  ];

  return (
    <div style={{ fontFamily: "inherit" }}>

      {showTour && <TourGuide steps={GEO_TOUR_STEPS} onClose={() => setShowTour(false)} />}

      {/* ── Header ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#1A3C2E", opacity: 0.5, marginBottom: 4 }}>Fan-outs GEO</div>
            <div style={{ fontSize: 22, fontWeight: 500, color: "#1A3C2E" }}>Visibilité générative</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!isReadOnly && (
              <button onClick={() => { setMainTab("analyse"); setShowTour(true); }}
                style={{ fontSize: 11, fontWeight: 500, color: "#1A3C2E", background: "#F0EBE0", border: "1px solid #1A3C2E22", borderRadius: 20, padding: "5px 14px", cursor: "pointer" }}>
                Guide
              </button>
            )}
            {isReadOnly && (
              <span style={{ fontSize: 11, fontWeight: 500, color: "#D97706", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 20, padding: "4px 12px" }}>
                Lecture seule
              </span>
            )}
          </div>
        </div>

        {/* Nav principale */}
        {!isReadOnly && (
          <div style={{ display: "flex", borderBottom: "1px solid #1A3C2E22" }}>
            {[{ key: "analyse", label: "Analyse" }, { key: "setup", label: "Configuration" }].map(t => {
              const isActive = t.key === "setup" ? mainTab === "setup" : mainTab !== "setup";
              return (
                <button key={t.key}
                  onClick={() => setMainTab(t.key === "analyse" ? "analyse" : "setup")}
                  style={{
                    padding: "8px 20px", fontSize: 13, fontWeight: isActive ? 500 : 400,
                    color: isActive ? "#1A3C2E" : "#1A3C2E66",
                    background: "none", border: "none",
                    borderBottom: isActive ? "1.5px solid #1A3C2E" : "1.5px solid transparent",
                    marginBottom: -1, cursor: "pointer", transition: "all 0.15s",
                  }}>
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Configuration ── */}
      {mainTab === "setup" && (
        <FanoutSetupPanel
          projects={projects}
          currentProjectId={currentProjectId}
          setCurrentProjectId={setCurrentProjectId}
          setProjects={setProjects}
          ownerEmail={ownerEmail}
          sites={sites}
          setSites={setSites}
          smData={smData}
          setSmData={setSmData}
          sfData={sfData}
          setSfData={setSfData}
          gscData={gscData}
          setGscData={setGscData}
          gaData={gaData}
          setGaData={setGaData}
          bingData={bingData}
          setBingData={setBingData}
          dbHistory={dbHistory}
          dbLoading={dbLoading}
          refreshHistory={refreshHistory}
          confirmModal={confirmModal}
          setConfirmModal={setConfirmModal}
          project={project}
          projectId={projectId}
          onSaveProviderKeys={(keyPatch) => {
            setProjects?.(prev => prev.map(p => p.id === projectId ? { ...p, ...keyPatch } : p));
            onSaveProviderKeys?.(keyPatch);
          }}
          axes={axes}
          onSaveAxes={onSaveAxes}
          onAxesChange={(a) => setAxes(a)}
          onSemrushVolumes={async (siteId, parsedRows) => {
            const volMap = {};
            parsedRows.forEach(row => {
              const kw  = (row.keyword || row.Keyword || "").toLowerCase().trim();
              const vol = parseInt(row.volume || row.Volume || row["Search Volume"] || 0, 10);
              if (kw && !isNaN(vol)) volMap[kw] = vol;
            });
            if (!Object.keys(volMap).length) return;
            try {
              const kws = await sbGetKeywords(projectId, siteId);
              for (const kw of kws) {
                const vol = volMap[kw.keyword.toLowerCase().trim()];
                if (vol !== undefined && vol !== kw.search_volume)
                  await sbUpdateKeywordVolume(kw.id, vol, "semrush_csv").catch(() => {});
              }
              setQuestionsKey(k => k + 1);
            } catch(e) { console.warn("onSemrushVolumes error:", e); }
          }}
        />
      )}

      {/* ── Analyse ── */}
      {mainTab !== "setup" && (<div>

        {/* Site switcher */}
        {(Array.isArray(sites) ? sites : []).length > 1 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
            {(Array.isArray(sites) ? sites : []).map(s => (
              <button key={s.id} onClick={() => setSelectedSite(s.id)} style={{
                padding: "5px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer",
                border: "none", borderRadius: 20,
                background: selectedSite === s.id ? "#1A3C2E" : "#F0EBE0",
                color: selectedSite === s.id ? "#F0EBE0" : "#1A3C2E99",
                transition: "all 0.15s",
              }}>{s.label}</button>
            ))}
          </div>
        )}

        {/* Sous-nav */}
        <div data-tour="subnav" style={{ display: "flex", gap: 4, marginBottom: 24, flexWrap: "wrap" }}>
          {[
            { key: "keywords",    label: "Mots-clés" },
            { key: "questions",   label: "Questions" },
            { key: "competitors", label: "Concurrents" },
            { key: "automation",  label: "Automatisation" },
            { key: "urls",        label: "Sources" },
          ].map(t => {
            const active = subTab === t.key;
            return (
              <button key={t.key} onClick={() => setSubTab(t.key)} style={{
                padding: "6px 16px", fontSize: 12, fontWeight: active ? 500 : 400,
                color: active ? "#1A3C2E" : "#1A3C2E66",
                background: active ? "#F0EBE0" : "transparent",
                border: active ? "1px solid #1A3C2E33" : "1px solid transparent",
                borderRadius: 20, cursor: "pointer", transition: "all 0.15s",
              }}>{t.label}</button>
            );
          })}
        </div>

        {/* ── Mots-clés ── */}
        {subTab === "keywords" && (
          <div data-tour="keywords-section"><KeywordsTab
            site={site} projectId={projectId} apiKey={apiKeyDec} model={model}
            axes={axes} context={brand?.context || ""} categories={categories}
            setCategories={setCategories} onAxesChange={(a) => setAxes(a)}
            semrushKey={semrushKeyDec} providerKeys={providerKeys}
            onQuestionsGenerated={() => setQuestionsKey(k => k + 1)}
          /></div>
        )}

        {/* ── Questions ── */}
        <div style={{ display: subTab === "questions" ? "block" : "none" }}>
          <QuestionsTab
            site={site} projectId={projectId} apiKey={apiKeyDec} model={model}
            brand={brand} categories={categories} setCategories={setCategories}
            allResults={allResults.filter(r => r.site_id === site?.id)}
            onResultSaved={() => sbGetGeoResults(projectId, site.id).then(setAllResults)}
            activeProviders={activeProviders} providerKeys={providerKeys}
            runMode={runMode} keywordsOrder={keywords.map(k => k.id)}
            refreshTrigger={questionsKey}
            competitors={competitors} setCompetitors={setCompetitors}
            isReadOnly={isReadOnly}
            onSaveKey={(keyPatch) => {
              setProviderKeys(prev => {
                const next = { ...prev };
                PROVIDERS.forEach(p => {
                  if (keyPatch[p.keyField]) {
                    const dec = decodeKey(keyPatch[p.keyField]);
                    next[p.id] = { enc: keyPatch[p.keyField], dec, input: "", status: dec ? "ok" : "error" };
                  }
                });
                return next;
              });
              setProjects?.(prev => prev.map(proj => proj.id === projectId ? { ...proj, ...keyPatch } : proj));
              onSaveProviderKeys?.(keyPatch);
            }}
          />
        </div>

        {/* ── Concurrents ── */}
        {subTab === "competitors" && (
          <div style={{ background: "#fff", border: "1px solid #1A3C2E11", borderRadius: 14, padding: "20px 24px" }}>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#1A3C2E55", marginBottom: 4 }}>Paysage concurrentiel</div>
            <div style={{ fontSize: 16, fontWeight: 500, color: "#1A3C2E", marginBottom: 4 }}>Concurrents</div>
            <div style={{ fontSize: 12, color: "#1A3C2E77", marginBottom: 20 }}>
              Qualifiez les marques détectées dans les réponses LLM. Elles apparaissent dans les analyses et sont mises en valeur dans les réponses.
            </div>
            <CompetitorManager
              projectId={projectId} siteId={site?.id}
              allResults={allResults.filter(r => r.site_id === site?.id)}
              competitors={competitors} setCompetitors={setCompetitors}
            />
          </div>
        )}

        {/* ── Automatisation ── */}
        {subTab === "automation" && (
          <AutomationTab projectId={projectId} site={site} user={user} providerKeys={providerKeys} />
        )}

        {/* ── Sources ── */}
        {subTab === "urls" && (
          <UrlsTab projectId={projectId} categories={categories} brand={brand}
            allResults={allResults.filter(r => r.site_id === site?.id)}
            qualifiedCompetitors={competitors} />
        )}

      </div>)}
    </div>
  );
}