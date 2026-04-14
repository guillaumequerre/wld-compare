import { useState, useMemo, useCallback, useEffect } from "react";
import { sbGetBrand, sbGetQuestions, sbGetGeoResults, sbGetUrlIndex,
  sbSaveProject, sbDeleteProject, sbDownload } from "../lib/supabase";
// GeoConfig non requis dans GeoAuditTab — providers et marques gérés dans Fan-outs
import UploadCard from "../components/UploadCard";
import PageTypeClassifier from "../components/PageTypeClassifier";
import { newProject, parseCSV } from "../lib/helpers";
import { C, SITE_PALETTE } from "../lib/constants";

const ANTHROPIC_PROXY = "/api/anthropic";

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


// ── AuditSetupPanel compact ───────────────────────────────────────
function SetupSection({ icon, title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
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
  const lastImports = {};
  for (const row of (dbHistory || [])) {
    const key = `${row.site_id}_${row.source}`;
    if (!lastImports[key] && row.storage_path) lastImports[key] = row;
  }
  const safeProjectId = currentProjectId || (projects||[])[0]?.id || "";

  return (
    <div style={{ maxWidth: 680 }}>
      <SetupSection icon="📁" title="Projet actif">
        <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
              <select value={safeProjectId} onChange={e => setCurrentProjectId(e.target.value)}
                style={{ width: "100%", padding: "7px 28px 7px 10px", border: "1.5px solid #2563EB", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#2563EB", background: "#EFF6FF", cursor: "pointer", appearance: "none" }}>
                {(projects || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#2563EB", fontSize: 11 }}>▾</span>
            </div>
            {(projects || []).length > 1 && (
              <button onClick={() => setConfirmModal?.({ message: `Supprimer "${(projects||[]).find(p=>p.id===safeProjectId)?.name}" ?`, onConfirm: () => {
                sbDeleteProject(safeProjectId).catch(() => {});
                setProjects(prev => { const next = prev.filter(x => x.id !== safeProjectId); if (next.length) setCurrentProjectId(next[0].id); return next; });
              }})} style={{ padding: "6px 10px", border: "1px solid #FECACA", borderRadius: 7, background: "#FEF2F2", cursor: "pointer", fontSize: 11, color: "#DC2626" }}>🗑</button>
            )}
            {(projects || []).length < 20 && (
              <button onClick={() => {
                const p = newProject(`Projet ${(projects||[]).length + 1}`, [{ id: `site-${Date.now()}`, label: "Nouveau site", ...SITE_PALETTE[0] }], ownerEmail);
                setProjects(prev => [...prev, p]); setCurrentProjectId(p.id); sbSaveProject(p).catch(() => {});
              }} style={{ padding: "6px 10px", borderRadius: 7, border: "1.5px dashed #2563EB", background: "#EFF6FF", color: "#2563EB", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>+ Nouveau</button>
            )}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {(sites || []).map(site => (
              <div key={site.id} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, border: `1px solid ${site.color}44`, background: site.bg }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: site.color, flexShrink: 0 }} />
                <input value={site.label} onChange={e => setSites(prev => prev.map(s => s.id === site.id ? {...s, label: e.target.value} : s))}
                  style={{ fontSize: 12, fontWeight: 600, color: site.color, border: "none", outline: "none", background: "transparent", width: 100 }} />
                {(sites||[]).length > 1 && (
                  <button onClick={() => setConfirmModal?.({ message: `Supprimer "${site.label}" ?`, onConfirm: () => {
                    setSites(prev => prev.filter(s => s.id !== site.id));
                    [setSfData, setGscData, setGaData, setBingData].forEach(s => s?.(p => { const n={...p}; delete n[site.id]; return n; }));
                  }})} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#DC2626", padding: 0 }}>✕</button>
                )}
              </div>
            ))}
            {(sites||[]).length < 3 && (
              <button onClick={() => {
                const palette = SITE_PALETTE[(sites||[]).length] || SITE_PALETTE[0];
                const newId = `site-${Date.now()}`;
                setSites(prev => [...prev, { id: newId, label: `Site ${(prev||[]).length+1}`, ...palette }]);
                [setSfData, setGscData, setGaData, setBingData].forEach(s => s?.(p => ({...p, [newId]: []})));
              }} style={{ padding: "4px 10px", borderRadius: 20, border: "1px dashed #E2E8F0", background: "#fff", color: "#2563EB", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>+ Site</button>
            )}
          </div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, color: "#94A3B8" }}>
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: dbLoading ? "#F59E0B" : (dbHistory||[]).length > 0 ? "#059669" : "#CBD5E1", marginRight: 5 }} />
              {dbLoading ? "Chargement…" : `${(dbHistory||[]).length} imports en base`}
            </span>
            <button onClick={() => { setShowHistory(h => !h); refreshHistory?.(); }}
              style={{ fontSize: 11, color: showHistory ? "#2563EB" : "#94A3B8", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              {showHistory ? "▲ Masquer" : "📋 Historique"}
            </button>
          </div>
          {showHistory && (
            <div style={{ marginTop: 8, maxHeight: 140, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
              {(dbHistory||[]).slice(0,20).map(row => {
                const site = (sites||[]).find(s => s.id === row.site_id);
                const srcLabel = { sf:"🐸 SF", gsc:"🔍 GSC", ga:"📊 GA4", bing:"🤖 Bing" }[row.source] || row.source;
                return (
                  <div key={row.id} style={{ display: "flex", gap: 8, padding: "4px 8px", background: "#F1F5F9", borderRadius: 5, fontSize: 10, alignItems: "center" }}>
                    <span style={{ color: site?.color || "#1E293B", fontWeight: 600, minWidth: 60 }}>{site?.label || "—"}</span>
                    <span style={{ color: "#64748B" }}>{srcLabel}</span>
                    <span style={{ color: "#94A3B8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.filename}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SetupSection>

      <SetupSection icon="📥" title="Imports CSV — SF, GSC, GA4, Bing">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(sites || []).map(site => (
            <div key={site.id} style={{ flex: "1 1 200px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: site.color, marginBottom: 8 }}>{site.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  { key: "sf",   label: "Screaming Frog", icon: "🐸", data: sfData,   setter: setSfData },
                  { key: "gsc",  label: "Search Console",  icon: "🔍", data: gscData,  setter: setGscData },
                  { key: "ga",   label: "Analytics 4",     icon: "📊", data: gaData,   setter: setGaData },
                  { key: "bing", label: "Bing AI",          icon: "🤖", data: bingData, setter: setBingData },
                ].map(({ key, label, icon, data, setter }) => {
                  const n = (data||{})[site.id]?.length || 0;
                  return (
                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ flex: 1 }}>
                        <UploadCard label={label} icon={icon} hint="" color={site.color}
                          loaded={n > 0} rows={(data||{})[site.id]}
                          onData={rows => setter?.(p => ({...p, [site.id]: rows}))}
                          onClear={() => setter?.(p => ({...p, [site.id]: []}))}
                          siteId={site.id} source={key} projectId={projectId}
                          onAfterUpload={refreshHistory}
                          onLoadFromHistory={async row => { try { const t = await sbDownload(row.storage_path); setter?.(p => ({...p, [site.id]: parseCSV(t)})); } catch(e) {} }}
                        />
                      </div>
                      {lastImports[`${site.id}_${key}`]?.storage_path && !n && (
                        <button onClick={async () => { try { const t = await sbDownload(lastImports[`${site.id}_${key}`].storage_path); setter?.(p => ({...p, [site.id]: parseCSV(t)})); } catch(e) {} }}
                          style={{ padding: "4px 7px", border: `1px solid ${site.color}`, borderRadius: 6, background: site.bg, color: site.color, fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>↩</button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
                {[["SF", sfData], ["GSC", gscData], ["GA4", gaData], ["Bing", bingData]].map(([src, d]) => {
                  const n = (d||{})[site.id]?.length || 0;
                  return <span key={src} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, fontWeight: 700, background: n>0 ? site.bg : "#F1F5F9", color: n>0 ? site.color : "#94A3B8" }}>{src} {n>0?"✓":"—"}</span>;
                })}
              </div>
            </div>
          ))}
        </div>
      </SetupSection>

      <SetupSection icon="🏷️" title="Classification des pages">
        {(sites||[]).filter(site => (sfData||{})[site.id]?.length > 0).length === 0 ? (
          <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400E" }}>
            🐸 Importez Screaming Frog pour activer la classification
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(sites||[]).filter(site => (sfData||{})[site.id]?.length > 0).map(site => (
              <div key={site.id} style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: site.color, marginBottom: 8 }}>{site.label} · {(sfData||{})[site.id].length} pages</div>
                <PageTypeClassifier siteId={site.id} projectId={projectId} sfRows={(sfData||{})[site.id]} pageTypes={pageTypes} setPageTypes={setPageTypes} />
              </div>
            ))}
          </div>
        )}
      </SetupSection>

    </div>
  );
}


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

function UrlRow({ url, meta, badge, badgeColor, badgeBg, rank }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.borderLight}` }}>
      {rank && <span style={{ fontSize: 13, fontWeight: 800, color: C.textLight, minWidth: 24, flexShrink: 0 }}>#{rank}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2563EB", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none", display: "block", flex: 1 }}>{url}</a>
          <a href={url} target="_blank" rel="noreferrer" style={{ flexShrink: 0, fontSize: 10, color: C.textLight, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px", textDecoration: "none" }}>↗</a>
        </div>
        {meta && <div style={{ fontSize: 11, color: C.textLight }}>{meta}</div>}
      </div>
      {badge && <span style={{ fontSize: 10, fontWeight: 700, color: badgeColor || "#059669", background: badgeBg || "#ECFDF5", border: `1px solid ${(badgeColor || "#059669")}33`, borderRadius: 6, padding: "2px 8px", flexShrink: 0 }}>{badge}</span>}
    </div>
  );
}

function computeAudit(questions, results, urlIndex, brand, site) {
  const brandName = brand?.brand_name || "";
  const competitors = brand?.competitors || [];
  const total = results.length;
  const withBrand = results.filter(r => r.brand_mentioned).length;
  const withSources = results.filter(r => r.brand_in_sources).length;
  const positions = results.filter(r => r.brand_position).map(r => r.brand_position);
  const avgPos = positions.length ? (positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(1) : null;
  const today = new Date(); today.setHours(0,0,0,0);
  const trendDays = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const dayResults = results.filter(r => r.created_at && r.created_at.slice(0,10) === key);
    trendDays.push({ date: key, tested: dayResults.length, present: dayResults.filter(r => r.brand_mentioned).length, rate: dayResults.length ? pct(dayResults.filter(r => r.brand_mentioned).length, dayResults.length) : null });
  }
  const sortedUrls = [...urlIndex].sort((a, b) => (b.count_as_source + b.count_in_answer) - (a.count_as_source + a.count_in_answer));
  const brandUrls = sortedUrls.filter(u => [brandName, ...(brand?.brand_aliases || [])].some(t => t && u.domain?.toLowerCase().includes(t.toLowerCase())));
  const competitorUrls = sortedUrls.filter(u => competitors.some(c => c && u.domain?.toLowerCase().includes(c.toLowerCase())));
  const referenceUrls = sortedUrls.filter(u => !brandUrls.includes(u) && !competitorUrls.includes(u)).slice(0, 10);
  const topDomains = {};
  sortedUrls.forEach(u => { if (!topDomains[u.domain]) topDomains[u.domain] = 0; topDomains[u.domain] += u.count_as_source + u.count_in_answer; });
  const intentCount = {};
  results.forEach(r => { if (r.intent_type) intentCount[r.intent_type] = (intentCount[r.intent_type] || 0) + 1; });
  const typeCount = {};
  results.forEach(r => { if (r.answer_type) typeCount[r.answer_type] = (typeCount[r.answer_type] || 0) + 1; });
  const compStats = {};
  results.forEach(r => (r.competitors_mentioned || []).forEach(c => {
    if (!compStats[c.name]) compStats[c.name] = { mentions: 0, positions: [] };
    compStats[c.name].mentions++;
    if (c.position) compStats[c.name].positions.push(c.position);
  }));
  const urlsToOptimize = brandUrls.filter(u => u.count_as_source < 3).slice(0, 10);
  const urlsToRework   = brandUrls.filter(u => u.count_as_source === 0 && u.count_in_answer > 0).slice(0, 10);
  const urlsToInspire  = referenceUrls.filter(u => u.count_as_source >= 3).slice(0, 10);
  const presenceRate = pct(withBrand, total);
  const leads = [];
  if (presenceRate < 30) leads.push({ priority: "🔴 Critique", label: "Présence < 30%", action: "Créer des contenus spécifiquement optimisés pour les questions de recommandation" });
  if (avgPos && avgPos > 3) leads.push({ priority: "🟠 Important", label: `Position moyenne ${avgPos}`, action: "Améliorer le contenu pour remonter dans les fan-outs — viser le top 3" });
  if (withSources < withBrand) leads.push({ priority: "🟡 Moyen", label: "Peu cité en source", action: "Augmenter l'autorité des pages — obtenir des backlinks depuis les sources fréquemment citées" });
  if (Object.keys(compStats).length > 0) {
    const topComp = Object.entries(compStats).sort((a,b) => b[1].mentions - a[1].mentions)[0];
    leads.push({ priority: "🟠 Concurrence", label: `${topComp[0]} dominant`, action: `Analyser le contenu de ${topComp[0]} et créer des alternatives plus complètes` });
  }
  const providerStats = {};
  results.forEach(r => {
    const pid = getProviderId(r.model);
    if (!providerStats[pid]) providerStats[pid] = { total: 0, withBrand: 0 };
    providerStats[pid].total++;
    if (r.brand_mentioned) providerStats[pid].withBrand++;
  });
  const qMap = {};
  questions.forEach(q => { qMap[q.id] = q.question; });
  const missingBrandQs = [...new Set(results.filter(r => !r.brand_mentioned).map(r => qMap[r.question_id]).filter(Boolean))].slice(0, 12);
  const presentBrandQs = [...new Set(results.filter(r => r.brand_mentioned).map(r => qMap[r.question_id]).filter(Boolean))].slice(0, 8);
  return { total, withBrand, withSources, avgPos, presenceRate, trendDays, sortedUrls, brandUrls, competitorUrls, referenceUrls, topDomains, intentCount, typeCount, compStats, urlsToOptimize, urlsToRework, urlsToInspire, leads, questions: questions.length, providerStats, missingBrandQs, presentBrandQs };
}

function TrendChart({ trendDays }) {
  const W = 600, H = 80, PAD = 24, plotW = W - PAD * 2, plotH = H - 16;
  const tested = trendDays.filter(d => d.tested > 0);
  if (!tested.length) return <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucun test effectué ces 30 derniers jours</div>;
  const pts = trendDays.map((d, i) => ({ x: PAD + (i / (trendDays.length - 1)) * plotW, y: d.rate !== null ? (H - 16) - (d.rate / 100) * plotH + 8 : null, ...d }));
  const pathPts = pts.filter(p => p.y !== null);
  const pathD = pathPts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <line x1={PAD} x2={W-PAD} y1={H-8} y2={H-8} stroke={C.border} strokeWidth={1} />
      {[0, 50, 100].map(v => { const y = (H-16) - (v/100) * plotH + 8; return <g key={v}><line x1={PAD} x2={W-PAD} y1={y} y2={y} stroke={C.border} strokeWidth={0.5} strokeDasharray="3,3" /><text x={PAD-4} y={y+3} fontSize={8} fill={C.textLight} textAnchor="end">{v}%</text></g>; })}
      {pathPts.length > 1 && <path d={pathD} fill="none" stroke="#059669" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
      {pts.map((p, i) => p.y !== null && <circle key={i} cx={p.x} cy={p.y} r={3} fill={p.rate >= 50 ? "#059669" : "#DC2626"} />)}
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
      urlsToOptimize: audit.urlsToOptimize.slice(0,5).map(u=>u.url).join(", "),
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
      const res = await fetch(ANTHROPIC_PROXY, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, stream: true, messages: [{ role: "user", content: prompt }] }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder();
      let buf = "", text = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue; const raw = line.slice(6).trim(); if (raw === "[DONE]") continue;
          try { const ev = JSON.parse(raw); const delta = ev?.delta?.text || ev?.choices?.[0]?.delta?.content || ""; if (delta) { text += delta; setAnalysis(text); } } catch {}
        }
      }
      onTextReady?.(text); setStatus("done");
    } catch(e) { console.error(e); setStatus("error"); }
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
          if (line.startsWith("- ")) return <div key={i} style={{ paddingLeft: 16, marginBottom: 3 }}>• {line.slice(2)}</div>;
          if (!line.trim()) return <div key={i} style={{ height: 8 }} />;
          return <div key={i} style={{ marginBottom: 4 }}>{line}</div>;
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
    const urlCount = {}; results.forEach(r => (r.sources || []).forEach(url => { urlCount[url] = (urlCount[url]||0)+1; }));
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
              <div style={{ fontSize: 12, color: C.text, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{body}</div>
            </div>;
          })}
        </div>
      )}
      {open && status === "error" && <div style={{ marginTop: 8, fontSize: 12, color: "#DC2626", padding: "10px 14px", background: "#FEF2F2", borderRadius: 8 }}>{analysis}</div>}
    </div>
  );
}

function exportPDF(audit, brand, site, aiText) {
  const brandName = brand?.brand_name || "Marque"; const date = new Date().toLocaleDateString("fr-FR");
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Audit GEO — ${brandName}</title>
<style>body{font-family:'Segoe UI',sans-serif;max-width:900px;margin:40px auto;color:#1E293B;line-height:1.6}h1{font-size:24px;color:#7C3AED;border-bottom:3px solid #7C3AED;padding-bottom:8px}h2{font-size:17px;margin-top:28px;border-bottom:1px solid #eee;padding-bottom:4px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.stat{background:#F8FAFC;border:1px solid #E8E8ED;border-radius:8px;padding:12px;text-align:center}.stat-val{font-size:28px;font-weight:800}.stat-label{font-size:10px;color:#94A3B8;text-transform:uppercase}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:12px}th{background:#F1F5F9;padding:8px 12px;text-align:left;font-size:11px;color:#64748B;text-transform:uppercase}td{padding:8px 12px;border-bottom:1px solid #F1F5F9}.lead{padding:8px 12px;border-left:3px solid #7C3AED;background:#F5F3FF;margin:6px 0;border-radius:0 6px 6px 0}pre{white-space:pre-wrap;font-family:inherit;font-size:12px;line-height:1.7}</style></head><body>
<h1>Audit GEO — ${brandName}</h1><p style="color:#94A3B8;font-size:12px">Site : ${site?.label||"—"} · ${date}</p>
<h2>Indicateurs clés</h2><div class="stats">
<div class="stat"><div class="stat-val" style="color:${audit.presenceRate>=50?"#059669":"#DC2626"}">${audit.presenceRate}%</div><div class="stat-label">Présence</div></div>
<div class="stat"><div class="stat-val">${audit.avgPos||"—"}</div><div class="stat-label">Position moy.</div></div>
<div class="stat"><div class="stat-val" style="color:#2563EB">${audit.withSources}</div><div class="stat-label">Cité en source</div></div>
<div class="stat"><div class="stat-val" style="color:#7C3AED">${audit.total}</div><div class="stat-label">Résultats</div></div></div>
<h2>Concurrents</h2><table><tr><th>Concurrent</th><th>Mentions</th></tr>${Object.entries(audit.compStats).sort((a,b)=>b[1].mentions-a[1].mentions).map(([k,v])=>`<tr><td>${k}</td><td>${v.mentions}</td></tr>`).join("")}</table>
<h2>Pistes</h2>${audit.leads.map(l=>`<div class="lead"><strong>${l.priority}</strong><br>${l.action}</div>`).join("")}
${aiText?`<h2>Analyse IA</h2><pre>${aiText}</pre>`:""}
</body></html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" }); const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `audit-geo-${brandName.toLowerCase().replace(/\s+/g,"-")}-${date.replace(/\//g,"-")}.html`; a.click(); URL.revokeObjectURL(a.href);
}

// ── Main export ───────────────────────────────────────────────────
export default function GeoAuditTab({
  sites, projectId, project = null, corrMatrix = [], metrics = [], resultVals = [], bingData = {},
  // Props setup depuis App.jsx
  projects, currentProjectId, setCurrentProjectId, setProjects, ownerEmail,
  setSites, sfData, setSfData, gscData, setGscData, gaData, setGaData,
  setBingData, dbHistory, dbLoading, refreshHistory,
  confirmModal, setConfirmModal, pageTypes, setPageTypes,
}) {
  const [mainTab, setMainTab]           = useState("audit");
  const [selectedSite, setSelectedSite] = useState(sites[0]?.id || "");
  // Sync selectedSite quand le projet change
  useEffect(() => {
    setSelectedSite(sites[0]?.id || "");
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [aiText, setAiText]             = useState("");
  const [exporting, setExporting]       = useState(false);
  const [brand, setBrand]               = useState(null);
  const [questions, setQuestions]       = useState([]);
  const [results, setResults]           = useState([]);
  const [urlIndex, setUrlIndex]         = useState([]);
  const [loading, setLoading]           = useState(true);

  const site = sites.find(s => s.id === selectedSite) || sites[0];
  const claudeKey = decodeKey(project?.claude_geo_key_enc || "");

  useEffect(() => {
    if (!projectId || !site?.id) return;
    setLoading(true);
    Promise.all([sbGetBrand(projectId, site.id), sbGetQuestions(projectId, site.id), sbGetGeoResults(projectId, site.id), sbGetUrlIndex(projectId)])
      .then(([b, q, r, u]) => { setBrand(b); setQuestions(q); setResults(r); setUrlIndex(u); setLoading(false); });
  }, [projectId, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const siteResults   = useMemo(() => results.filter(r => r.site_id === site?.id), [results, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const siteQuestions = useMemo(() => questions.filter(q => q.site_id === site?.id), [questions, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const siteUrls      = useMemo(() => urlIndex.filter(u => u.project_id === projectId), [urlIndex, projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const audit         = useMemo(() => computeAudit(siteQuestions, siteResults, siteUrls, brand, site), [siteQuestions, siteResults, siteUrls, brand, site]); // eslint-disable-line react-hooks/exhaustive-deps
  const noData        = !siteResults.length;

  return (
    <div>
      {/* ── Header + onglets principaux ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 16 }}>📋 Audit GEO</div>
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
          key={currentProjectId}
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {sites.length > 1 && sites.map(s => (
                <button key={s.id} onClick={() => setSelectedSite(s.id)} style={{ padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `2px solid ${s.color}`, background: selectedSite === s.id ? s.color : "transparent", color: selectedSite === s.id ? "#fff" : s.color }}>{s.label}</button>
              ))}
            </div>
            <button onClick={() => { setExporting(true); exportPDF(audit, brand, site, aiText); setTimeout(() => setExporting(false), 1000); }}
              disabled={noData || exporting}
              style={{ padding: "8px 18px", background: noData ? C.bg : "#2563EB", color: noData ? C.textLight : "#fff", border: "none", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: noData ? "not-allowed" : "pointer" }}>
              {exporting ? "⏳ Export…" : "⬇ Export PDF"}
            </button>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
              <StatCard label={`Présence ${brand?.brand_name || "marque"}`} value={`${audit.presenceRate}%`} sub={`${audit.withBrand} / ${audit.total}`} color={audit.presenceRate >= 50 ? "#059669" : audit.presenceRate > 0 ? "#D97706" : "#DC2626"} bg={audit.presenceRate >= 50 ? "#ECFDF5" : audit.presenceRate > 0 ? "#FFFBEB" : "#FEF2F2"} />
              <StatCard label="Position moy." value={audit.avgPos || "—"} sub="dans les fan-outs" />
              <StatCard label="Cité en source" value={audit.withSources} color="#2563EB" />
              <StatCard label="Questions testées" value={audit.questions} sub={`${audit.total} résultats`} color="#7C3AED" />
              <StatCard label="Concurrents détectés" value={Object.keys(audit.compStats).length} color="#D97706" />
            </div>

            <Section icon="🤖" title="Présence par provider">
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
            </Section>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <Section icon="✓" title="Questions avec présence marque">
                {audit.presentBrandQs.length ? audit.presentBrandQs.map((q, i) => (
                  <div key={i} style={{ fontSize: 12, padding: "6px 0", borderBottom: `1px solid ${C.borderLight}`, display: "flex", gap: 8 }}>
                    <span style={{ color: "#059669", fontWeight: 700, flexShrink: 0 }}>✓</span><span>{q}</span>
                  </div>
                )) : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucune présence</div>}
              </Section>
              <Section icon="✗" title="Questions sans présence marque" sub="Sujets à optimiser">
                {audit.missingBrandQs.length ? audit.missingBrandQs.map((q, i) => (
                  <div key={i} style={{ fontSize: 12, padding: "6px 0", borderBottom: `1px solid ${C.borderLight}`, display: "flex", gap: 8 }}>
                    <span style={{ color: "#DC2626", fontWeight: 700, flexShrink: 0 }}>✗</span><span>{q}</span>
                  </div>
                )) : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Toutes les questions ont une présence !</div>}
              </Section>
            </div>

            <Section icon="✨" title="Analyse Fan-out IA" sub="Recommandations basées sur vos données">
              <FanoutAnalysis questions={siteQuestions} results={siteResults} brand={brand} claudeKey={claudeKey} />
            </Section>

            <Section icon="📈" title="Tendance — 30 derniers jours">
              <TrendChart trendDays={audit.trendDays} />
            </Section>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <Section icon="🎯" title="Répartition par intention">
                {Object.entries(audit.intentCount).sort((a,b)=>b[1]-a[1]).map(([k,v]) => (
                  <div key={k} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}><span style={{ fontWeight: 600 }}>{k}</span><span style={{ color: C.textLight }}>{v} ({pct(v, audit.total)}%)</span></div>
                    <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${pct(v, audit.total)}%`, background: "#7C3AED", borderRadius: 3 }} /></div>
                  </div>
                ))}
              </Section>
              <Section icon="📝" title="Types de réponses">
                {Object.entries(audit.typeCount).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v]) => (
                  <div key={k} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}><span style={{ fontWeight: 600 }}>{k}</span><span style={{ color: C.textLight }}>{v} ({pct(v, audit.total)}%)</span></div>
                    <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${pct(v, audit.total)}%`, background: "#2563EB", borderRadius: 3 }} /></div>
                  </div>
                ))}
              </Section>
            </div>

            {Object.keys(audit.compStats).length > 0 && (
              <Section icon="⚔️" title="Analyse concurrentielle">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: C.bg }}>{["Concurrent","Mentions","% des résultats","Position moy."].map(h => <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 11, color: C.textLight, textTransform: "uppercase", borderBottom: `1px solid ${C.border}` }}>{h}</th>)}</tr></thead>
                  <tbody>{Object.entries(audit.compStats).sort((a,b)=>b[1].mentions-a[1].mentions).map(([name, stats]) => (
                    <tr key={name} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>{name}</td>
                      <td style={{ padding: "8px 12px" }}>{stats.mentions}</td>
                      <td style={{ padding: "8px 12px", color: "#D97706" }}>{pct(stats.mentions, audit.total)}%</td>
                      <td style={{ padding: "8px 12px" }}>{stats.positions.length ? (stats.positions.reduce((a,b)=>a+b,0)/stats.positions.length).toFixed(1) : "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </Section>
            )}

            <Section icon="🔗" title="Top domaines cités">
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
            </Section>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
              <Section icon="⚡" title="URLs à optimiser" sub="Présentes mais peu citées">
                {audit.urlsToOptimize.length ? audit.urlsToOptimize.map((u, i) => <UrlRow key={u.id} url={u.url} rank={i+1} meta={`${u.count_as_source} src · ${u.count_in_answer} rép`} badge="À booster" badgeColor="#D97706" badgeBg="#FFFBEB" />) : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucune</div>}
              </Section>
              <Section icon="🔄" title="URLs à reprendre">
                {audit.urlsToRework.length ? audit.urlsToRework.map((u, i) => <UrlRow key={u.id} url={u.url} rank={i+1} meta={`${u.count_as_source} src · ${u.count_in_answer} rép`} badge="À refaire" badgeColor="#DC2626" badgeBg="#FEF2F2" />) : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucune</div>}
              </Section>
              <Section icon="💡" title="URLs de référence">
                {audit.urlsToInspire.length ? audit.urlsToInspire.map((u, i) => <UrlRow key={u.id} url={u.url} rank={i+1} meta={`${getDomain(u.url)} · ${u.count_as_source} cit.`} badge="Inspiration" badgeColor="#2563EB" badgeBg="#EFF6FF" />) : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucune</div>}
              </Section>
            </div>

            <Section icon="🎯" title="Pistes d'optimisation prioritaires">
              {audit.leads.map((l, i) => (
                <div key={i} style={{ padding: "10px 14px", borderLeft: "3px solid #7C3AED", background: "#F5F3FF", borderRadius: "0 8px 8px 0", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 2 }}>{l.priority} — {l.label}</div>
                  <div style={{ fontSize: 12, color: C.textMid }}>{l.action}</div>
                </div>
              ))}
            </Section>


            {/* ── Croisements données × présence GEO ── */}
            {(() => {
              const hasSF      = metrics.some(m => m.sf);
              const hasGSC     = metrics.some(m => m.gsc);
              const hasBing    = metrics.some(m => m.bing);
              const hasCorr    = corrMatrix.length > 0 && corrMatrix.some(r => r.corrs.some(c => c.value !== null));
              const geoPct     = audit.presenceRate;
              const avgPos2    = audit.avgPos;
              const withSource = audit.withSources;
              const total2     = audit.total;

              const geoCorrs = hasCorr ? corrMatrix.flatMap(row =>
                row.corrs.filter(c => c.kpi.src === "bing" && c.value !== null)
                  .map(c => ({ dim: row.dim.label, kpi: c.kpi.label, value: c.value }))
              ).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 5) : [];

              const seoCorrs = hasCorr ? corrMatrix.flatMap(row =>
                row.corrs.filter(c => c.kpi.src === "gsc" && c.value !== null)
                  .map(c => ({ dim: row.dim.label, kpi: c.kpi.label, value: c.value }))
              ).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 5) : [];

              const bingTotal  = metrics.reduce((s, m) => s + (m.bing?.geoMentions || 0), 0);
              const bingPages  = metrics.reduce((s, m) => s + (m.bing?.pageCount || 0), 0);
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

              const Lead2 = ({ priority, text, color = "#7C3AED", bg = "#F5F3FF" }) => (
                <div style={{ padding: "9px 12px", borderLeft: `3px solid ${color}`, background: bg, borderRadius: "0 8px 8px 0", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 2 }}>{priority}</div>
                  <div style={{ fontSize: 11, color: C.textMid, lineHeight: 1.5 }}>{text}</div>
                </div>
              );

              const CorrRow = ({ dim, kpi, value }) => {
                const pos = value > 0; const strong = Math.abs(value) >= 0.4;
                return (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                    <span style={{ fontSize: 11, color: C.textMid }}>{dim} × {kpi}</span>
                    <span style={{ fontSize: 12, fontWeight: strong ? 700 : 500, color: pos ? "#059669" : "#DC2626", background: pos ? "#ECFDF5" : "#FEF2F2", borderRadius: 5, padding: "1px 8px" }}>
                      {pos ? "▲" : "▼"} r={value.toFixed(2)}
                    </span>
                  </div>
                );
              };

              return (<>
                {/* 1. Technique × GEO */}
                <CrossCard icon="🕷️" title="Technique (SF) × Présence GEO"
                  sub="Comment les métriques techniques influencent la citation dans les réponses LLM">
                  <div style={{ display: "grid", gridTemplateColumns: hasSF && hasCorr ? "1fr 1fr" : "1fr", gap: 20 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>État actuel</div>
                      {hasSF ? (<>
                        {metrics.map(({ site: s, sf }) => sf && <Signal key={s.id} label={`${s.label} — Mots moy.`} value={sf.avgWords} note="par page" color={s.color} />)}
                        {metrics.map(({ site: s, sf }) => sf && <Signal key={s.id} label={`${s.label} — Inlinks uniq.`} value={sf.avgInlinksUniq} note="moy. par page" color={s.color} />)}
                        {metrics.map(({ site: s, sf }) => sf && <Signal key={s.id} label={`${s.label} — Schemas`} value={`${sf.schemaRate}%`} note="des pages" color={s.color} />)}
                        {metrics.map(({ site: s, sf }) => sf && <Signal key={s.id} label={`${s.label} — Profondeur`} value={sf.avgDepth} note="niveaux moy." color={s.color} />)}
                      </>) : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Importez un CSV Screaming Frog dans ⚙️ Setup</div>}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>
                        {geoCorrs.length ? "Corrélations SF × Citations Bing" : "Pistes d'optimisation GEO technique"}
                      </div>
                      {geoCorrs.length
                        ? geoCorrs.map((c, i) => <CorrRow key={i} {...c} />)
                        : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Interrogez plus de questions pour obtenir des corrélations</div>
                      }
                    </div>
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>Pistes d'optimisation GEO technique</div>
                    <Lead2 priority="📝 Volume de contenu" color="#2563EB" bg="#EFF6FF" text="Les LLMs favorisent les pages avec un volume substantiel. Visez 1 000–2 500 mots pour les pages à forte intention transactionnelle. Structurez avec des H2/H3 clairs pour faciliter l'extraction sémantique." />
                    <Lead2 priority="🏷️ Schema JSON-LD" color="#059669" bg="#ECFDF5" text="Les schemas Organization, FAQ et HowTo augmentent la probabilité de citation. Priorisez les pages sans schema." />
                    <Lead2 priority="🔗 Maillage interne" color="#7C3AED" bg="#F5F3FF" text="Un fort maillage interne vers les pages cibles signale leur importance aux LLMs. Créez des hubs thématiques." />
                    <Lead2 priority="📐 Profondeur URL" color="#D97706" bg="#FFFBEB" text="Les pages superficielles (profondeur > 3) sont moins souvent citées. Remontez les pages importantes dans l'arborescence." />
                  </div>
                </CrossCard>

                {/* 2. Bing AI × Fan-outs */}
                <CrossCard icon="🤖" title="Bing AI Performance × Fan-outs"
                  sub="Croisement entre les pages reconnues par Bing AI et la présence dans les LLMs">
                  {(() => {
                    const siteId = site?.id;
                    const bingRows = (bingData[siteId] || []);
                    const bingByUrl = {};
                    bingRows.forEach(r => {
                      const url = (r["url"] || r["adresse"] || r["address"] || "").trim().toLowerCase();
                      if (!url) return;
                      const cits = Number(r["citations"] || r["mentions"] || r["appearancecount"] || 0);
                      if (!bingByUrl[url]) bingByUrl[url] = { url, citations: 0 };
                      bingByUrl[url].citations += cits;
                    });
                    const bingUrlsSorted = Object.values(bingByUrl).sort((a,b) => b.citations - a.citations);
                    const fanoutUrlSet = new Set(urlIndex.filter(u=>u.project_id===projectId).map(u => (u.url || "").toLowerCase()));
                    const bingAlsoInFanout = bingUrlsSorted.filter(b => fanoutUrlSet.has(b.url));
                    const bingOnlyBing    = bingUrlsSorted.filter(b => !fanoutUrlSet.has(b.url));
                    const fanoutNotInBing = urlIndex.filter(u => u.project_id===projectId && !bingByUrl[(u.url||"").toLowerCase()]);
                    const alignScore = bingUrlsSorted.length > 0
                      ? Math.round((bingAlsoInFanout.length / Math.min(bingUrlsSorted.length, fanoutUrlSet.size + 1)) * 100) : null;
                    const scoreColor = alignScore === null ? C.textLight : alignScore >= 60 ? "#059669" : alignScore >= 30 ? "#D97706" : "#DC2626";
                    const scoreLabel = alignScore === null ? "—" : alignScore >= 60 ? "Bonne cohérence" : alignScore >= 30 ? "Cohérence partielle" : "Faible cohérence";
                    return (
                      <div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
                          {[
                            { label: "Citations Bing AI", value: bingTotal.toLocaleString(), sub: `${bingPages} pages indexées`, color: "#7C3AED" },
                            { label: "Présence Fan-outs", value: `${geoPct}%`, sub: `${audit.withBrand}/${total2}`, color: geoPct >= 50 ? "#059669" : "#DC2626" },
                            { label: "Cité en source LLM", value: withSource, sub: "URLs marque", color: "#2563EB" },
                            { label: "Alignement Bing × LLM", value: alignScore !== null ? `${alignScore}%` : "—", sub: scoreLabel, color: scoreColor },
                          ].map(k => (
                            <div key={k.label} style={{ background: C.bg, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                              <div style={{ fontSize: 10, color: C.textLight, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>{k.label}</div>
                              <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
                              <div style={{ fontSize: 10, color: C.textLight, marginTop: 2 }}>{k.sub}</div>
                            </div>
                          ))}
                        </div>
                        {hasBing ? (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>✓ Bing ET LLM ({bingAlsoInFanout.length})</div>
                              {bingAlsoInFanout.length === 0 ? <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Aucun recoupement</div>
                                : bingAlsoInFanout.slice(0, 5).map((u, i) => (
                                  <div key={i} style={{ padding: "5px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                                    <div style={{ fontSize: 11, color: "#059669", fontWeight: 600, wordBreak: "break-all" }}>{u.url.replace(/^https?:\/\/[^/]+/, "")}</div>
                                    <div style={{ fontSize: 10, color: C.textLight }}>{u.citations} cit. Bing</div>
                                  </div>
                                ))}
                            </div>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#D97706", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>⚡ Bing seulement ({bingOnlyBing.length})</div>
                              <div style={{ fontSize: 10, color: C.textLight, marginBottom: 6 }}>Reconnues Bing, absentes LLMs → priorité</div>
                              {bingOnlyBing.slice(0, 5).map((u, i) => (
                                <div key={i} style={{ padding: "5px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                                  <div style={{ fontSize: 11, color: "#D97706", fontWeight: 600, wordBreak: "break-all" }}>{u.url.replace(/^https?:\/\/[^/]+/, "")}</div>
                                  <div style={{ fontSize: 10, color: C.textLight }}>{u.citations} cit. Bing</div>
                                </div>
                              ))}
                            </div>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#2563EB", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>🔗 LLM seulement ({fanoutNotInBing.length})</div>
                              <div style={{ fontSize: 10, color: C.textLight, marginBottom: 6 }}>Citées LLMs mais non indexées Bing</div>
                              {fanoutNotInBing.slice(0, 5).map((u, i) => (
                                <div key={i} style={{ padding: "5px 0", borderBottom: `1px solid ${C.borderLight}` }}>
                                  <div style={{ fontSize: 11, color: "#2563EB", fontWeight: 600, wordBreak: "break-all" }}>{(u.url||"").replace(/^https?:\/\/[^/]+/, "")}</div>
                                  <div style={{ fontSize: 10, color: C.textLight }}>{(u.count_as_source||0)+(u.count_in_answer||0)} cit. LLM</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#92400E" }}>
                            Importez un export Bing Webmaster Tools dans ⚙️ Setup pour débloquer l'analyse croisée.
                          </div>
                        )}
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>Pistes actionnables</div>
                        {bingOnlyBing.length > 0 && <Lead2 priority={`⚡ ${bingOnlyBing.length} page${bingOnlyBing.length>1?"s":""} Bing non citées LLMs`} color="#D97706" bg="#FFFBEB" text="Renforcez leur contenu : ajoutez des listes de recommandation, répondez explicitement à des questions, insérez des données structurées FAQ." />}
                        {fanoutNotInBing.length > 0 && <Lead2 priority={`🔗 ${fanoutNotInBing.length} page${fanoutNotInBing.length>1?"s":""} LLM non indexées Bing`} color="#2563EB" bg="#EFF6FF" text="Soumettez ces URLs via Bing Webmaster Tools → IndexNow pour accélérer leur indexation." />}
                        <Lead2 priority="🌐 Autorité marque Bing" color="#7C3AED" bg="#F5F3FF" text="Ajoutez SpeakableSpecification, Organization et FAQ sur vos pages cibles. Vérifiez votre profil Bing Places." />
                        {geoPct < 50 && bingTotal > 0 && <Lead2 priority="📊 Gap Bing → LLM" color="#DC2626" bg="#FEF2F2" text={`Bing vous cite (${bingTotal} fois) mais les LLMs peu (${geoPct}%). Créez des pages comparatives ciblant les questions fan-out.`} />}
                      </div>
                    );
                  })()}
                </CrossCard>

                {/* 3. SEO × GEO */}
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
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>
                        {seoCorrs.length ? "Corrélations SF × Clics GSC" : "Interprétation SEO/GEO"}
                      </div>
                      {seoCorrs.length ? seoCorrs.map((c, i) => <CorrRow key={i} {...c} />) : hasGSC ? (
                        <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.7 }}>
                          {gscAvgPos && parseFloat(gscAvgPos) <= 10 && geoPct < 30 ? "Paradoxe SEO/GEO : bonne position organique mais faible présence GEO. Restructurez le contenu pour répondre aux questions de recommandation." :
                           gscAvgPos && parseFloat(gscAvgPos) <= 10 && geoPct >= 50 ? "Corrélation positive SEO/GEO : la forte autorité SEO se traduit en présence GEO." :
                           "Améliorer le SEO on-page renforcera également la visibilité GEO via l'autorité accrue."}
                        </div>
                      ) : <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>—</div>}
                    </div>
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 10 }}>Pistes d'optimisation GEO via SEO</div>
                    <Lead2 priority="🏆 Pages top 10 GSC → GEO" color="#2563EB" bg="#EFF6FF" text="Les pages bien positionnées sur Google ont une autorité reconnue. Optimisez-les pour le GEO : ajoutez des sections comparatives et des recommandations directes." />
                    <Lead2 priority="🎯 Intention transactionnelle" color="#059669" bg="#ECFDF5" text="Les LLMs citent préférentiellement les pages à forte intention transactionnelle. Enrichissez vos pages top GSC avec des listes de recommandations structurées." />
                    <Lead2 priority="✍️ EEAT et autorité d'auteur" color="#7C3AED" bg="#F5F3FF" text="Ajoutez des bios d'auteurs, des sources citables, des données originales et des avis d'experts sur vos pages clés." />
                    <Lead2 priority="🔄 Contenu frais" color="#D97706" bg="#FFFBEB" text="Les LLMs préfèrent les contenus récents. Mettez à jour régulièrement vos comparatifs avec des dates de révision visibles." />
                  </div>
                </CrossCard>
              </>);
            })()}
            <Section icon="✦" title="Analyse IA détaillée" sub="Interprétation contextuelle générée par Claude">
              <AIAnalysis audit={audit} brand={brand} site={site} questions={siteQuestions} onTextReady={setAiText} />
            </Section>
          </>)}
        </div>
      )}
    </div>
  );
}