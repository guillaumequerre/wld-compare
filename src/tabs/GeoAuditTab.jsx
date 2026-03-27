import { useState, useMemo, useCallback, useEffect } from "react";
import { C } from "../lib/constants";
import { sbGetBrand, sbGetQuestions, sbGetGeoResults, sbGetUrlIndex } from "../lib/supabase";

// ── Constants ─────────────────────────────────────────────────────

const ANTHROPIC_PROXY = "/api/anthropic";

// ── Helpers ───────────────────────────────────────────────────────

function fmt(n, unit = "") {
  if (n === null || n === undefined) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k" + unit;
  return String(Math.round(n)) + unit;
}

function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }

function getDomain(url) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
}

function dayKey(d) { return d.toISOString().slice(0, 10); }

// ── Stat card ─────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = C.text, bg = C.white }) {
  return (
    <div style={{ background: bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Section block ─────────────────────────────────────────────────

function Section({ icon, title, sub, children }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, background: C.bg }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{icon} {title}</div>
        {sub && <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ padding: "16px 24px" }}>{children}</div>
    </div>
  );
}

// ── URL row ───────────────────────────────────────────────────────

function UrlRow({ url, meta, badge, badgeColor, badgeBg, reason, rank }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.borderLight}` }}>
      {rank && <span style={{ fontSize: 13, fontWeight: 800, color: C.textLight, minWidth: 24, flexShrink: 0 }}>#{rank}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <a href={url} target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: "#2563EB", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none", display: "block", flex: 1 }}>
            {url}
          </a>
          <a href={url} target="_blank" rel="noreferrer"
            style={{ flexShrink: 0, fontSize: 10, color: C.textLight, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px", textDecoration: "none" }}>↗</a>
        </div>
        {meta && <div style={{ fontSize: 11, color: C.textLight }}>{meta}</div>}
        {reason && <div style={{ fontSize: 11, color: C.textMid, fontStyle: "italic", marginTop: 2 }}>{reason}</div>}
      </div>
      {badge && (
        <span style={{ fontSize: 10, fontWeight: 700, color: badgeColor || "#059669", background: badgeBg || "#ECFDF5", border: `1px solid ${(badgeColor || "#059669")}33`, borderRadius: 6, padding: "2px 8px", flexShrink: 0 }}>
          {badge}
        </span>
      )}
    </div>
  );
}

// ── Compute audit data from results ───────────────────────────────

function computeAudit(questions, results, urlIndex, brand, site) {
  const brandName = brand?.brand_name || "";
  const competitors = brand?.competitors || [];

  // ── Global stats ───────────────────────────────────────────────
  const total = results.length;
  const withBrand = results.filter(r => r.brand_mentioned).length;
  const withSources = results.filter(r => r.brand_in_sources).length;
  const positions = results.filter(r => r.brand_position).map(r => r.brand_position);
  const avgPos = positions.length ? (positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(1) : null;

  // ── Presence rate by question ──────────────────────────────────
  const byQuestion = {};
  results.forEach(r => {
    if (!byQuestion[r.question_id]) byQuestion[r.question_id] = [];
    byQuestion[r.question_id].push(r);
  });

  // ── Trend (last 30 days) ───────────────────────────────────────
  const today = new Date(); today.setHours(0,0,0,0);
  const trendDays = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const dayResults = results.filter(r => r.created_at && r.created_at.slice(0,10) === key);
    trendDays.push({
      date: key,
      tested: dayResults.length,
      present: dayResults.filter(r => r.brand_mentioned).length,
      rate: dayResults.length ? pct(dayResults.filter(r => r.brand_mentioned).length, dayResults.length) : null,
    });
  }

  // ── URL analysis ───────────────────────────────────────────────
  const sortedUrls = [...urlIndex].sort((a, b) =>
    (b.count_as_source + b.count_in_answer) - (a.count_as_source + a.count_in_answer)
  );

  const brandUrls = sortedUrls.filter(u =>
    [brandName, ...(brand?.brand_aliases || [])].some(t => t && u.domain?.toLowerCase().includes(t.toLowerCase()))
  );
  const competitorUrls = sortedUrls.filter(u =>
    competitors.some(c => c && u.domain?.toLowerCase().includes(c.toLowerCase()))
  );
  const referenceUrls = sortedUrls.filter(u =>
    !brandUrls.includes(u) && !competitorUrls.includes(u)
  ).slice(0, 10);

  const topDomains = {};
  sortedUrls.forEach(u => {
    if (!topDomains[u.domain]) topDomains[u.domain] = 0;
    topDomains[u.domain] += u.count_as_source + u.count_in_answer;
  });

  // ── Intent distribution ────────────────────────────────────────
  const intentCount = {};
  results.forEach(r => { if (r.intent_type) intentCount[r.intent_type] = (intentCount[r.intent_type] || 0) + 1; });

  // ── Answer types ───────────────────────────────────────────────
  const typeCount = {};
  results.forEach(r => { if (r.answer_type) typeCount[r.answer_type] = (typeCount[r.answer_type] || 0) + 1; });

  // ── Competitor presence ────────────────────────────────────────
  const compStats = {};
  results.forEach(r => (r.competitors_mentioned || []).forEach(c => {
    if (!compStats[c.name]) compStats[c.name] = { mentions: 0, positions: [] };
    compStats[c.name].mentions++;
    if (c.position) compStats[c.name].positions.push(c.position);
  }));

  // ── URLs to optimize (brand pages with low citations) ─────────
  const urlsToOptimize = brandUrls.filter(u => u.count_as_source < 3).slice(0, 10);
  const urlsToRework   = brandUrls.filter(u => u.count_as_source === 0 && u.count_in_answer > 0).slice(0, 10);
  const urlsToInspire  = referenceUrls.filter(u => u.count_as_source >= 3).slice(0, 10);

  // ── Global optimization leads ──────────────────────────────────
  const presenceRate = pct(withBrand, total);
  const leads = [];
  if (presenceRate < 30) leads.push({ priority: "🔴 Critique", label: "Présence < 30%", action: "Créer des contenus spécifiquement optimisés pour les questions de recommandation" });
  if (avgPos && avgPos > 3) leads.push({ priority: "🟠 Important", label: `Position moyenne ${avgPos}`, action: "Améliorer le contenu pour remonter dans les fan-outs — viser le top 3" });
  if (withSources < withBrand) leads.push({ priority: "🟡 Moyen", label: "Peu cité en source", action: "Augmenter l'autorité des pages — obtenir des backlinks depuis les sources fréquemment citées" });
  if (intentCount["Top"] > (total * 0.4)) leads.push({ priority: "🟢 Opportunité", label: "Forte intention Top", action: "Créer des pages de type 'meilleur X pour Y' optimisées pour les questions de classement" });
  if (Object.keys(compStats).length > 0) {
    const topComp = Object.entries(compStats).sort((a,b) => b[1].mentions - a[1].mentions)[0];
    leads.push({ priority: "🟠 Concurrence", label: `${topComp[0]} dominant`, action: `Analyser le contenu de ${topComp[0]} et créer des alternatives plus complètes` });
  }

  return {
    total, withBrand, withSources, avgPos, presenceRate,
    trendDays, sortedUrls, brandUrls, competitorUrls, referenceUrls,
    topDomains, intentCount, typeCount, compStats,
    urlsToOptimize, urlsToRework, urlsToInspire, leads,
    questions: questions.length,
  };
}

// ── Trend mini chart ──────────────────────────────────────────────

function TrendChart({ trendDays }) {
  const W = 600, H = 80, PAD = 24;
  const plotW = W - PAD * 2;
  const plotH = H - 16;
  const tested = trendDays.filter(d => d.tested > 0);
  if (!tested.length) return <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucun test effectué ces 30 derniers jours</div>;

  const pts = trendDays.map((d, i) => ({
    x: PAD + (i / (trendDays.length - 1)) * plotW,
    y: d.rate !== null ? (H - 16) - (d.rate / 100) * plotH + 8 : null,
    ...d,
  }));

  const pathPts = pts.filter(p => p.y !== null);
  const pathD = pathPts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <line x1={PAD} x2={W-PAD} y1={H-8} y2={H-8} stroke={C.border} strokeWidth={1} />
      {[0, 50, 100].map(v => {
        const y = (H-16) - (v/100) * plotH + 8;
        return <g key={v}>
          <line x1={PAD} x2={W-PAD} y1={y} y2={y} stroke={C.border} strokeWidth={0.5} strokeDasharray="3,3" />
          <text x={PAD-4} y={y+3} fontSize={8} fill={C.textLight} textAnchor="end">{v}%</text>
        </g>;
      })}
      {pathPts.length > 1 && <path d={pathD} fill="none" stroke="#059669" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
      {pts.map((p, i) => p.y !== null && (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={p.rate >= 50 ? "#059669" : "#DC2626"}
          title={`${p.date}: ${p.rate}% (${p.present}/${p.tested})`} />
      ))}
    </svg>
  );
}

// ── AI analysis block ─────────────────────────────────────────────

function AIAnalysis({ audit, brand, site, questions, results }) {
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [analysis, setAnalysis] = useState("");

  const generate = useCallback(async () => {
    setStatus("loading");
    setAnalysis("");

    const summary = {
      site: site?.label,
      brand: brand?.brand_name,
      totalQuestions: audit.questions,
      totalResults: audit.total,
      presenceRate: audit.presenceRate + "%",
      avgPosition: audit.avgPos,
      withSources: audit.withSources,
      topIntents: Object.entries(audit.intentCount).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}(${v})`).join(", "),
      topAnswerTypes: Object.entries(audit.typeCount).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}(${v})`).join(", "),
      competitors: Object.entries(audit.compStats).sort((a,b)=>b[1].mentions-a[1].mentions).slice(0,5).map(([k,v])=>`${k}(${v.mentions}x)`).join(", "),
      topCitedDomains: Object.entries(audit.topDomains).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`${k}(${v}x)`).join(", "),
      urlsToOptimize: audit.urlsToOptimize.slice(0,5).map(u=>u.url).join(", "),
      urlsToRework: audit.urlsToRework.slice(0,5).map(u=>u.url).join(", "),
      urlsToInspire: audit.urlsToInspire.slice(0,5).map(u=>u.url).join(", "),
    };

    const sampleQuestions = questions.slice(0, 10).map(q => q.question).join(" | ");

    const prompt = `Tu es un expert GEO (Generative Engine Optimization). Génère un audit GEO complet et actionnable pour le site ${summary.site} sur la marque "${summary.brand}".

Données disponibles :
${JSON.stringify(summary, null, 2)}

Exemples de questions testées : ${sampleQuestions}

Rédige un rapport structuré avec ces sections (utilise des titres markdown ##) :

## 1. Synthèse exécutive
État des lieux en 3-5 phrases clés. Score GEO global sur 10 avec justification.

## 2. Analyse de la visibilité GEO
- Taux de présence ${summary.presenceRate} : interprétation et benchmark sectoriel estimé
- Position moyenne dans les fan-outs : impact sur la visibilité
- Présence dans les sources vs dans les réponses : différence et importance
- Évolution et stabilité

## 3. Analyse concurrentielle
Pour chaque concurrent cité, analyse sa fréquence, sa position et ce qui explique probablement sa présence.

## 4. Analyse des contenus qui performent
Basé sur les types de réponses (${summary.topAnswerTypes}) et les intentions (${summary.topIntents}), quelles structures de contenus favorisent la citation ?

## 5. Urls à optimiser en priorité
Pour chaque URL listée (${summary.urlsToOptimize}), recommandations concrètes d'optimisation GEO.

## 6. Urls à reprendre complètement
Pour chaque URL (${summary.urlsToRework}), expliquer pourquoi et proposer une nouvelle structure.

## 7. Urls de référence à s'inspirer
Analyser les URLs citées (${summary.urlsToInspire}) et extraire les patterns de contenu GEO-friendly.

## 8. Plan d'action priorisé
Liste de 10 actions concrètes classées par impact/effort avec délai estimé.

## 9. KPIs à suivre
5 métriques clés avec cibles recommandées à 3 et 6 mois.

Sois très concret, évite le jargon vague. Utilise des exemples spécifiques tirés des données.`;

    try {
      const res = await fetch(ANTHROPIC_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4000,
          stream: true,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let text = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;
          try {
            const ev = JSON.parse(raw);
            const delta = ev?.delta?.text || ev?.choices?.[0]?.delta?.content || "";
            if (delta) { text += delta; setAnalysis(text); }
          } catch {}
        }
      }
      setStatus("done");
    } catch(e) {
      console.error(e);
      setStatus("error");
    }
  }, [audit, brand, site, questions, results]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === "idle") return (
    <div style={{ textAlign: "center", padding: "24px 0" }}>
      <div style={{ fontSize: 12, color: C.textLight, marginBottom: 12 }}>
        L'analyse IA utilise Claude pour interpréter vos données GEO et générer des recommandations contextualisées.
      </div>
      <button onClick={generate} style={{ padding: "10px 24px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
        ✦ Générer l'analyse IA
      </button>
    </div>
  );

  if (status === "loading" && !analysis) return (
    <div style={{ textAlign: "center", padding: 24, color: C.textLight, fontSize: 12 }}>✦ Génération en cours…</div>
  );

  return (
    <div>
      <div style={{ fontSize: 12, lineHeight: 1.8, color: C.text, whiteSpace: "pre-wrap" }}>
        {analysis.split("\n").map((line, i) => {
          if (line.startsWith("## ")) return <div key={i} style={{ fontSize: 14, fontWeight: 800, color: C.text, marginTop: 20, marginBottom: 6, borderBottom: `2px solid ${C.border}`, paddingBottom: 4 }}>{line.slice(3)}</div>;
          if (line.startsWith("- ")) return <div key={i} style={{ paddingLeft: 16, marginBottom: 3 }}>• {line.slice(2)}</div>;
          if (!line.trim()) return <div key={i} style={{ height: 8 }} />;
          return <div key={i} style={{ marginBottom: 4 }}>{line}</div>;
        })}
      </div>
      {status === "done" && (
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button onClick={generate} style={{ padding: "6px 14px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, fontSize: 11, cursor: "pointer", color: C.textMid }}>
            🔄 Regénérer
          </button>
        </div>
      )}
      {status === "error" && <div style={{ color: "#DC2626", fontSize: 11, marginTop: 8 }}>Erreur de génération — réessayez.</div>}
    </div>
  );
}

// ── PDF export ────────────────────────────────────────────────────

function exportPDF(audit, brand, site, aiText) {
  const brandName = brand?.brand_name || "Marque";
  const date = new Date().toLocaleDateString("fr-FR");

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Audit GEO — ${brandName} — ${date}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 900px; margin: 40px auto; color: #1E293B; line-height: 1.6; }
  h1 { font-size: 24px; color: #7C3AED; border-bottom: 3px solid #7C3AED; padding-bottom: 8px; }
  h2 { font-size: 17px; color: #1E293B; margin-top: 28px; border-bottom: 1px solid #E8E8ED; padding-bottom: 4px; }
  h3 { font-size: 14px; color: #64748B; margin-top: 16px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
  .stat { background: #F8FAFC; border: 1px solid #E8E8ED; border-radius: 8px; padding: 12px; text-align: center; }
  .stat-val { font-size: 28px; font-weight: 800; }
  .stat-label { font-size: 10px; color: #94A3B8; text-transform: uppercase; }
  .green { color: #059669; } .red { color: #DC2626; } .purple { color: #7C3AED; } .blue { color: #2563EB; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px; }
  th { background: #F1F5F9; padding: 8px 12px; text-align: left; font-size: 11px; color: #64748B; text-transform: uppercase; }
  td { padding: 8px 12px; border-bottom: 1px solid #F1F5F9; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; }
  .green-bg { background: #ECFDF5; color: #059669; }
  .red-bg { background: #FEF2F2; color: #DC2626; }
  .purple-bg { background: #F5F3FF; color: #7C3AED; }
  .lead { padding: 8px 12px; border-left: 3px solid #7C3AED; background: #F5F3FF; margin: 6px 0; border-radius: 0 6px 6px 0; }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 12px; line-height: 1.7; }
  @media print { body { margin: 20px; } }
</style></head><body>

<h1>Audit GEO — ${brandName}</h1>
<p style="color:#94A3B8;font-size:12px">Site : ${site?.label || "—"} · Généré le ${date}</p>

<h2>1. Indicateurs clés de présence</h2>
<div class="stats">
  <div class="stat"><div class="stat-val ${audit.presenceRate >= 50 ? "green" : audit.presenceRate > 0 ? "" : "red"}">${audit.presenceRate}%</div><div class="stat-label">Présence ${brandName}</div></div>
  <div class="stat"><div class="stat-val">${audit.avgPos || "—"}</div><div class="stat-label">Position moy. fan-out</div></div>
  <div class="stat"><div class="stat-val blue">${audit.withSources}</div><div class="stat-label">Cité en source</div></div>
  <div class="stat"><div class="stat-val purple">${audit.total}</div><div class="stat-label">Résultats analysés</div></div>
</div>

<h2>2. Répartition par intention</h2>
<table><tr><th>Intention</th><th>Occurrences</th><th>%</th></tr>
${Object.entries(audit.intentCount).sort((a,b)=>b[1]-a[1]).map(([k,v])=>
  `<tr><td>${k}</td><td>${v}</td><td>${pct(v, audit.total)}%</td></tr>`
).join("")}
</table>

<h2>3. Concurrents cités</h2>
<table><tr><th>Concurrent</th><th>Mentions</th><th>Position moy.</th></tr>
${Object.entries(audit.compStats).sort((a,b)=>b[1].mentions-a[1].mentions).map(([k,v])=>
  `<tr><td>${k}</td><td>${v.mentions}</td><td>${v.positions.length ? (v.positions.reduce((a,b)=>a+b,0)/v.positions.length).toFixed(1) : "—"}</td></tr>`
).join("")}
</table>

<h2>4. Top domaines cités</h2>
<table><tr><th>Domaine</th><th>Citations totales</th></tr>
${Object.entries(audit.topDomains).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>
  `<tr><td>${k}</td><td>${v}</td></tr>`
).join("")}
</table>

<h2>5. URLs à optimiser (présentes mais peu citées)</h2>
${audit.urlsToOptimize.length ? `<table><tr><th>URL</th><th>Citations source</th><th>Citations réponse</th></tr>
${audit.urlsToOptimize.map(u=>`<tr><td>${u.url}</td><td>${u.count_as_source}</td><td>${u.count_in_answer}</td></tr>`).join("")}
</table>` : "<p style='color:#94A3B8'>Aucune URL identifiée dans cette catégorie.</p>"}

<h2>6. URLs à reprendre complètement</h2>
${audit.urlsToRework.length ? `<table><tr><th>URL</th><th>Citations source</th><th>Citations réponse</th></tr>
${audit.urlsToRework.map(u=>`<tr><td>${u.url}</td><td>${u.count_as_source}</td><td>${u.count_in_answer}</td></tr>`).join("")}
</table>` : "<p style='color:#94A3B8'>Aucune URL identifiée dans cette catégorie.</p>"}

<h2>7. URLs de référence (à s'inspirer)</h2>
${audit.urlsToInspire.length ? `<table><tr><th>URL</th><th>Domaine</th><th>Citations</th></tr>
${audit.urlsToInspire.map(u=>`<tr><td>${u.url}</td><td>${u.domain}</td><td>${u.count_as_source}</td></tr>`).join("")}
</table>` : "<p style='color:#94A3B8'>Aucune URL identifiée dans cette catégorie.</p>"}

<h2>8. Pistes d'optimisation prioritaires</h2>
${audit.leads.map(l=>`<div class="lead"><strong>${l.priority} — ${l.label}</strong><br>${l.action}</div>`).join("")}

${aiText ? `<h2>9. Analyse IA détaillée</h2><pre>${aiText}</pre>` : ""}

</body></html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `audit-geo-${(brandName).toLowerCase().replace(/\s+/g, "-")}-${date.replace(/\//g, "-")}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Main ─────────────────────────────────────────────────────────

export default function GeoAuditTab({ sites, projectId }) {
  const [selectedSite, setSelectedSite] = useState(sites[0]?.id || "");
  const [aiText, setAiText] = useState("");
  const [exporting, setExporting] = useState(false);
  const [brand, setBrand] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [results, setResults] = useState([]);
  const [urlIndex, setUrlIndex] = useState([]);
  const [loading, setLoading] = useState(true);

  const site = sites.find(s => s.id === selectedSite) || sites[0];
  const siteBrand = brand;

  useEffect(() => {
    if (!projectId || !site?.id) return;
    setLoading(true);
    Promise.all([
      sbGetBrand(projectId, site.id),
      sbGetQuestions(projectId, site.id),
      sbGetGeoResults(projectId, site.id),
      sbGetUrlIndex(projectId),
    ]).then(([b, q, r, u]) => {
      setBrand(b);
      setQuestions(q);
      setResults(r);
      setUrlIndex(u);
      setLoading(false);
    });
  }, [projectId, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const siteResults   = useMemo(() => results.filter(r => r.site_id === site?.id), [results, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const siteQuestions = useMemo(() => questions.filter(q => q.site_id === site?.id), [questions, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const siteUrls      = useMemo(() => urlIndex.filter(u => u.project_id === projectId), [urlIndex, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const audit = useMemo(() =>
    computeAudit(siteQuestions, siteResults, siteUrls, siteBrand, site),
    [siteQuestions, siteResults, siteUrls, siteBrand, site] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const noData = !siteResults.length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 4 }}>📋 Audit GEO</div>
          <div style={{ fontSize: 12, color: C.textLight }}>Analyse exhaustive de la visibilité générative de {siteBrand?.brand_name || "votre marque"}</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {sites.length > 1 && sites.map(s => (
            <button key={s.id} onClick={() => setSelectedSite(s.id)} style={{
              padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `2px solid ${s.color}`, background: selectedSite === s.id ? s.color : "transparent",
              color: selectedSite === s.id ? "#fff" : s.color,
            }}>{s.label}</button>
          ))}
          <button
            onClick={() => { setExporting(true); exportPDF(audit, siteBrand, site, aiText); setTimeout(() => setExporting(false), 1000); }}
            disabled={noData || exporting}
            style={{ padding: "8px 18px", background: noData ? C.bg : "#2563EB", color: noData ? C.textLight : "#fff", border: "none", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: noData ? "not-allowed" : "pointer" }}>
            {exporting ? "⏳ Export…" : "⬇ Export PDF"}
          </button>
        </div>
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

        {/* KPI strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
          <StatCard label={`Présence ${siteBrand?.brand_name || "marque"}`}
            value={`${audit.presenceRate}%`}
            sub={`${audit.withBrand} / ${audit.total} résultats`}
            color={audit.presenceRate >= 50 ? "#059669" : audit.presenceRate > 0 ? "#D97706" : "#DC2626"}
            bg={audit.presenceRate >= 50 ? "#ECFDF5" : audit.presenceRate > 0 ? "#FFFBEB" : "#FEF2F2"} />
          <StatCard label="Position moy. fan-out" value={audit.avgPos || "—"} sub="dans les listes citées" />
          <StatCard label="Cité en source" value={audit.withSources} sub="résultats avec URL marque" color="#2563EB" />
          <StatCard label="Questions testées" value={audit.questions} sub={`${audit.total} résultats`} color="#7C3AED" />
          <StatCard label="Concurrents détectés" value={Object.keys(audit.compStats).length} sub="dans les réponses LLM" color="#D97706" />
        </div>

        {/* Trend */}
        <Section icon="📈" title="Tendance de présence — 30 derniers jours" sub="Taux de mention de la marque par jour de test">
          <TrendChart trendDays={audit.trendDays} />
        </Section>

        {/* Intent + answer type */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <Section icon="🎯" title="Répartition par intention">
            {Object.entries(audit.intentCount).sort((a,b)=>b[1]-a[1]).map(([k,v]) => (
              <div key={k} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: C.text }}>{k}</span>
                  <span style={{ color: C.textLight }}>{v} ({pct(v, audit.total)}%)</span>
                </div>
                <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct(v, audit.total)}%`, background: "#7C3AED", borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </Section>
          <Section icon="📝" title="Types de réponses dominants">
            {Object.entries(audit.typeCount).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v]) => (
              <div key={k} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: C.text }}>{k}</span>
                  <span style={{ color: C.textLight }}>{v} ({pct(v, audit.total)}%)</span>
                </div>
                <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct(v, audit.total)}%`, background: "#2563EB", borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </Section>
        </div>

        {/* Competitors */}
        {Object.keys(audit.compStats).length > 0 && (
          <Section icon="⚔️" title="Analyse concurrentielle" sub="Concurrents cités dans les réponses LLM">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.bg }}>
                  {["Concurrent","Mentions","% des résultats","Position moy."].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 11, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(audit.compStats).sort((a,b)=>b[1].mentions-a[1].mentions).map(([name, stats]) => (
                  <tr key={name} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                    <td style={{ padding: "8px 12px", fontWeight: 600 }}>{name}</td>
                    <td style={{ padding: "8px 12px" }}>{stats.mentions}</td>
                    <td style={{ padding: "8px 12px", color: "#D97706" }}>{pct(stats.mentions, audit.total)}%</td>
                    <td style={{ padding: "8px 12px" }}>{stats.positions.length ? (stats.positions.reduce((a,b)=>a+b,0)/stats.positions.length).toFixed(1) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Top domains */}
        <Section icon="🔗" title="Top domaines cités" sub="Sources les plus fréquentes dans les réponses LLM">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
            {Object.entries(audit.topDomains).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([d, cnt], i) => {
              const isComp = audit.competitorUrls.some(u => u.domain === d);
              const isBrand = audit.brandUrls.some(u => u.domain === d);
              return (
                <div key={d} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: C.bg, borderRadius: 8, border: `1px solid ${isBrand ? "#05966633" : isComp ? "#DC262633" : C.border}` }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 800, color: C.textLight, marginRight: 8 }}>#{i+1}</span>
                    <span style={{ fontSize: 12, color: isBrand ? "#059669" : isComp ? "#DC2626" : C.text, fontWeight: 600 }}>{d}</span>
                    {isBrand && <span style={{ fontSize: 9, marginLeft: 4, background: "#ECFDF5", color: "#059669", borderRadius: 4, padding: "1px 5px" }}>marque</span>}
                    {isComp && <span style={{ fontSize: 9, marginLeft: 4, background: "#FEF2F2", color: "#DC2626", borderRadius: 4, padding: "1px 5px" }}>concurrent</span>}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{cnt}×</span>
                </div>
              );
            })}
          </div>
        </Section>

        {/* URL lists */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
          <Section icon="⚡" title="URLs à optimiser" sub="Présentes mais peu citées">
            {audit.urlsToOptimize.length ? audit.urlsToOptimize.map((u, i) => (
              <UrlRow key={u.id} url={u.url} rank={i+1}
                meta={`${u.count_as_source} source · ${u.count_in_answer} réponse`}
                badge="À booster" badgeColor="#D97706" badgeBg="#FFFBEB" />
            )) : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucune URL dans cette catégorie</div>}
          </Section>
          <Section icon="🔄" title="URLs à reprendre" sub="Citées dans le texte mais jamais en source">
            {audit.urlsToRework.length ? audit.urlsToRework.map((u, i) => (
              <UrlRow key={u.id} url={u.url} rank={i+1}
                meta={`${u.count_as_source} source · ${u.count_in_answer} réponse`}
                badge="À refaire" badgeColor="#DC2626" badgeBg="#FEF2F2" />
            )) : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucune URL dans cette catégorie</div>}
          </Section>
          <Section icon="💡" title="URLs de référence" sub="Sources fréquentes hors marque">
            {audit.urlsToInspire.length ? audit.urlsToInspire.map((u, i) => (
              <UrlRow key={u.id} url={u.url} rank={i+1}
                meta={`${getDomain(u.url)} · ${u.count_as_source} citations`}
                badge="Inspiration" badgeColor="#2563EB" badgeBg="#EFF6FF" />
            )) : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucune URL dans cette catégorie</div>}
          </Section>
        </div>

        {/* Optimization leads */}
        <Section icon="🎯" title="Pistes d'optimisation prioritaires">
          {audit.leads.map((l, i) => (
            <div key={i} style={{ padding: "10px 14px", borderLeft: "3px solid #7C3AED", background: "#F5F3FF", borderRadius: "0 8px 8px 0", marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 2 }}>{l.priority} — {l.label}</div>
              <div style={{ fontSize: 12, color: C.textMid }}>{l.action}</div>
            </div>
          ))}
        </Section>

        {/* AI analysis */}
        <Section icon="✦" title="Analyse IA détaillée" sub="Interprétation contextuelle générée par Claude sur demande">
          <AIAnalysis audit={audit} brand={siteBrand} site={site} questions={siteQuestions} results={siteResults} />
        </Section>

      </>)}
    </div>
  );
}