import { useState, useEffect } from "react";
import { C, PAGE_TYPES } from "../lib/constants";
import { sbSavePageTypes, sbGetPageTypes, sbDeletePageTypes } from "../lib/supabase";

const TYPE_KEYS = PAGE_TYPES.map(t => t.key);

// ── Signal detection ─────────────────────────────────────────────

// Find a column by multiple possible name fragments
function findCol(row, fragments) {
  const key = Object.keys(row).find(k =>
    fragments.some(f => k.toLowerCase().includes(f.toLowerCase()))
  );
  return key ? (row[key] || "").trim() : "";
}

// Detect which signals are available in the SF rows
export function detectSignals(sfRows) {
  if (!sfRows?.length) return { jsonLd: false, breadcrumb: false, bodyClass: false, mainContent: false };
  const keys = Object.keys(sfRows[0]).map(k => k.toLowerCase());
  return {
    jsonLd:      keys.some(k => k.includes("json_ld")      || k.includes("json-ld")     || k.includes("ld+json")),
    breadcrumb:  keys.some(k => k.includes("breadcrumb")   || k.includes("fil d'ariane") || k.includes("fil ariane") || k.includes("miette")),
    bodyClass:   keys.some(k => k.includes("body_class")   || k.includes("body class")  || k.includes("classe body") || k.includes("body/@class")),
    mainContent: keys.some(k => k.includes("custom extraction") || k.includes("extraction personnalisée") || k.includes("main_content") || k.includes("custom_extract")),
  };
}

// Extract signals from a single SF row
function extractSignals(row) {
  return {
    jsonLd:      findCol(row, ["json_ld", "json-ld", "ld+json", "schema"]).slice(0, 800),
    breadcrumb:  findCol(row, ["breadcrumb", "fil d'ariane", "fil ariane", "miette"]).slice(0, 200),
    bodyClass:   findCol(row, ["body_class", "body class", "classe body", "body/@class"]).slice(0, 200),
    mainContent: findCol(row, ["custom extraction", "extraction personnalisée", "main_content", "custom_extract"]).slice(0, 500),
  };
}

// Try to classify deterministically from JSON-LD @type — avoids API call for clear cases
const JSONLD_TYPE_MAP = {
  "article":         "article",
  "newsarticle":     "article",
  "blogposting":     "article",
  "techarticle":     "article",
  "product":         "fiche",
  "itempage":        "fiche",
  "productgroup":    "fiche",
  "collectionpage":  "categorie",
  "categorypage":    "categorie",
  "searchresultspage": "categorie",
  "contactpage":     "contact",
  "aboutpage":       "about",
  "webpage":         null,  // too generic, send to Claude
  "website":         "home",
};

function tryJsonLdClassify(jsonLdRaw) {
  if (!jsonLdRaw) return null;
  // Extract all @type values (could be array or nested)
  const types = [...jsonLdRaw.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map(m => m[1].toLowerCase());
  for (const t of types) {
    const mapped = JSONLD_TYPE_MAP[t];
    if (mapped !== undefined) return mapped; // null = ambiguous, keep for Claude
  }
  return null;
}

function tryBodyClassClassify(bodyClass) {
  if (!bodyClass) return null;
  const c = bodyClass.toLowerCase();
  if (c.includes("single-post") || c.includes("post-type-post") || c.includes("blog-post") || c.includes("article")) return "article";
  if (c.includes("single-product") || c.includes("product-page") || c.includes("woocommerce-page") && c.includes("product")) return "fiche";
  if (c.includes("category") || c.includes("archive") || c.includes("tax-") || c.includes("listing")) return "categorie";
  if (c.includes("home") || c.includes("front-page") || c.includes("page-home")) return "home";
  if (c.includes("contact")) return "contact";
  if (c.includes("about") || c.includes("a-propos")) return "about";
  return null;
}

function tryBreadcrumbClassify(breadcrumb) {
  if (!breadcrumb) return null;
  const b = breadcrumb.toLowerCase();
  if (b.includes("blog") || b.includes("article") || b.includes("news") || b.includes("actualit")) return "article";
  if (b.includes("produit") || b.includes("product") || b.includes("shop") || b.includes("boutique")) return "fiche";
  if (b.includes("catégorie") || b.includes("category") || b.includes("collection")) return "categorie";
  if (b.includes("contact")) return "contact";
  if (b.includes("à propos") || b.includes("about") || b.includes("équipe")) return "about";
  return null;
}

// Try all deterministic rules — returns type or null
function tryDeterministicClassify(url, signals) {
  const path = url.toLowerCase().replace(/https?:\/\/[^/]+/, "");

  // Home page
  if (path === "/" || path === "" || path === "/index" || path === "/accueil") return "home";

  // JSON-LD (highest confidence)
  const fromJsonLd = tryJsonLdClassify(signals.jsonLd);
  if (fromJsonLd) return fromJsonLd;

  // Body class
  const fromBody = tryBodyClassClassify(signals.bodyClass);
  if (fromBody) return fromBody;

  // Breadcrumb
  const fromBreadcrumb = tryBreadcrumbClassify(signals.breadcrumb);
  if (fromBreadcrumb) return fromBreadcrumb;

  // URL patterns (last resort, lower confidence)
  if (/\/(blog|article|news|actu|guide|tuto|post)\//.test(path)) return "article";
  if (/\/(categorie|category|collection|tag|archive|listing)\//.test(path)) return "categorie";
  if (/\/(produit|product|shop|boutique|fiche)\//.test(path)) return "fiche";
  if (/\/(contact|devis|quote|rdv)/.test(path)) return "contact";
  if (/\/(about|a-propos|equipe|team|cgv|cgu|mentions|privacy|legal)/.test(path)) return "about";

  return null; // needs Claude
}

// Build prompt only for pages that couldn't be classified deterministically
function buildClassifyPrompt(pages) {
  const typeList = PAGE_TYPES.map(t => `"${t.key}" — ${t.label}`).join("\n");
  const pagesStr = pages.map((p, i) => {
    const lines = [`[${i}] URL: ${p.url}`, `Title: ${p.title}`, `H1: ${p.h1}`];
    if (p.signals.breadcrumb)  lines.push(`Breadcrumb: ${p.signals.breadcrumb}`);
    if (p.signals.bodyClass)   lines.push(`Body class: ${p.signals.bodyClass}`);
    if (p.signals.mainContent) lines.push(`Contenu main: ${p.signals.mainContent}`);
    return lines.join("\n");
  }).join("\n\n");

  return `Tu es un expert SEO. Classe chaque page dans UN seul type parmi cette liste :
${typeList}

Règles :
- "article" = contenu éditorial long (blog, guide, news, tutoriel)
- "landing" = page de conversion, présentation service/offre, pas un article
- "categorie" = listing de produits, d'articles ou d'entités (archive, pagination)
- "home" = page d'accueil (URL = "/" ou "/index")
- "fiche" = fiche produit e-commerce individuelle
- "contact" = formulaire de contact, coordonnées, devis
- "about" = équipe, histoire, mentions légales, CGU, politique de confidentialité
- "comparatif" = tableau comparatif, VS, benchmark
- "autre" = si vraiment aucun des types ci-dessus ne convient

Réponds UNIQUEMENT avec un JSON strict, tableau d'objets, rien d'autre :
[{"i":0,"type":"landing"},{"i":1,"type":"article"},...]

Pages à classifier :
${pagesStr}`;
}

// ── Component ────────────────────────────────────────────────────
export default function PageTypeClassifier({ siteId, projectId, sfRows, pageTypes, setPageTypes }) {
  const [status, setStatus]     = useState("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0, deterministic: 0 });
  const [error, setError]       = useState(null);

  const signals = sfRows?.length ? detectSignals(sfRows) : {};
  const hasAnySignal = Object.values(signals).some(Boolean);
  const BATCH = 20;

  // Load existing classifications from DB on mount
  useEffect(() => {
    if (!projectId || !siteId) return;
    sbGetPageTypes(projectId, siteId).then(rows => {
      if (rows.length) {
        const map = {};
        rows.forEach(r => { map[r.url] = r.page_type; });
        setPageTypes(prev => ({ ...prev, [siteId]: map }));
      }
    });
  }, [projectId, siteId, setPageTypes]);

  const classify = async () => {
    setStatus("loading");
    setError(null);

    const html = sfRows.filter(r => {
      const ct = (r["type de contenu"] || r["content type"] || r["type"] || "").toLowerCase();
      const sc = parseInt(r["code http"] || r["status code"] || 200);
      return (ct.includes("html") || ct === "") && sc < 400;
    });

    const allPages = html.map(r => ({
      url:     (r["adresse"] || r["address"] || r["url"] || "").trim(),
      title:   (r["title 1"] || r["title"] || "").slice(0, 80),
      h1:      (r["h1-1"] || r["h1"] || "").slice(0, 80),
      signals: extractSignals(r),
    })).filter(p => p.url);

    setProgress({ done: 0, total: allPages.length, deterministic: 0 });

    const results = {};
    const dbRows  = [];

    // Pass 1 — deterministic classification (free, instant)
    const needsAI = [];
    let deterministicCount = 0;

    allPages.forEach(p => {
      const type = tryDeterministicClassify(p.url, p.signals);
      if (type) {
        results[p.url] = type;
        dbRows.push({ project_id: projectId, site_id: siteId, url: p.url, page_type: type, confidence: "auto" });
        deterministicCount++;
      } else {
        needsAI.push(p);
      }
    });

    setProgress({ done: deterministicCount, total: allPages.length, deterministic: deterministicCount });

    // Pass 2 — Claude for remaining pages
    try {
      for (let i = 0; i < needsAI.length; i += BATCH) {
        const batch = needsAI.slice(i, i + BATCH);
        const prompt = buildClassifyPrompt(batch);

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (!res.ok) throw new Error(`API error ${res.status}`);
        const data = await res.json();
        const text = data.content?.find(b => b.type === "text")?.text || "[]";

        let parsed = [];
        try {
          parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
        } catch {
          console.warn("Parse error on batch", i, text.slice(0, 200));
        }

        parsed.forEach(({ i: idx, type }) => {
          const page = batch[idx];
          if (!page) return;
          const validType = TYPE_KEYS.includes(type) ? type : "autre";
          results[page.url] = validType;
          dbRows.push({ project_id: projectId, site_id: siteId, url: page.url, page_type: validType, confidence: "auto" });
        });

        setProgress({ done: deterministicCount + Math.min(i + BATCH, needsAI.length), total: allPages.length, deterministic: deterministicCount });
        if (i + BATCH < needsAI.length) await new Promise(r => setTimeout(r, 300));
      }

      await sbSavePageTypes(dbRows);
      setPageTypes(prev => ({ ...prev, [siteId]: results }));
      setStatus("done");

    } catch (e) {
      setError(e.message);
      setStatus("error");
    }
  };

  const reset = async () => {
    await sbDeletePageTypes(projectId, siteId);
    setPageTypes(prev => ({ ...prev, [siteId]: {} }));
    setStatus("idle");
    setProgress({ done: 0, total: 0, deterministic: 0 });
  };

  const typeCount = pageTypes[siteId] ? Object.keys(pageTypes[siteId]).length : 0;
  const typeDist  = pageTypes[siteId]
    ? PAGE_TYPES.map(t => ({ ...t, count: Object.values(pageTypes[siteId]).filter(v => v === t.key).length })).filter(t => t.count > 0)
    : [];

  const pct = progress.total ? Math.round(progress.done / progress.total * 100) : 0;

  // Signal badges to display
  const signalBadges = [
    { key: "jsonLd",      label: "JSON-LD",    active: signals.jsonLd,      tip: "Meilleur signal — @type détecté directement" },
    { key: "breadcrumb",  label: "Breadcrumb", active: signals.breadcrumb,  tip: "Chemin de navigation" },
    { key: "bodyClass",   label: "Body class", active: signals.bodyClass,   tip: "Classes CSS du <body>" },
    { key: "mainContent", label: "<main>",     active: signals.mainContent, tip: "Contenu textuel du <main>" },
  ];

  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>🏷️ Classification des templates</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>
            {hasAnySignal
              ? "Signaux SF détectés — classification déterministe + Claude pour les cas ambigus"
              : "Aucun signal custom — classification par URL + Title + H1 uniquement"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {typeCount > 0 && (
            <button onClick={reset} style={{ padding: "5px 12px", border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, color: C.textLight, fontSize: 11, cursor: "pointer" }}>
              Réinitialiser
            </button>
          )}
          <button
            onClick={classify}
            disabled={status === "loading" || !sfRows?.length}
            style={{
              padding: "6px 14px", border: "none", borderRadius: 7,
              cursor: status === "loading" ? "wait" : "pointer",
              background: status === "loading" ? C.bg : C.blue,
              color: status === "loading" ? C.textLight : "#fff",
              fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {status === "loading" ? (
              <>
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", border: "2px solid #94A3B8", borderTopColor: C.blue, animation: "spin 0.7s linear infinite" }} />
                {progress.done}/{progress.total} pages…
              </>
            ) : typeCount > 0 ? "Reclassifier" : "Classifier avec Claude"}
          </button>
        </div>
      </div>

      {/* Signal availability */}
      <div style={{ display: "flex", gap: 5, marginBottom: 10, flexWrap: "wrap" }}>
        {signalBadges.map(b => (
          <span key={b.key} title={b.tip} style={{
            fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
            background: b.active ? "#ECFDF5" : C.bg,
            color: b.active ? "#059669" : "#94A3B8",
            border: `1px solid ${b.active ? "#6EE7B7" : C.border}`,
          }}>
            {b.active ? "✓" : "·"} {b.label}
          </span>
        ))}
      </div>

      {/* Progress */}
      {status === "loading" && (
        <>
          <div style={{ height: 4, background: C.bg, borderRadius: 2, marginBottom: 6, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: C.blue, borderRadius: 2, transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: 10, color: C.textLight, marginBottom: 8 }}>
            {progress.deterministic > 0 && <span style={{ color: "#059669" }}>{progress.deterministic} classifiés sans IA · </span>}
            {progress.done - progress.deterministic > 0 && <span>{progress.done - progress.deterministic} via Claude · </span>}
            {progress.total - progress.done > 0 && <span>{progress.total - progress.done} restants…</span>}
          </div>
        </>
      )}

      {status === "done" && progress.deterministic > 0 && (
        <div style={{ fontSize: 10, color: C.textLight, marginBottom: 8 }}>
          <span style={{ color: "#059669" }}>{progress.deterministic}</span> classifiés par règles ·{" "}
          <span style={{ color: C.blue }}>{progress.total - progress.deterministic}</span> via Claude
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div style={{ fontSize: 11, color: C.red, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 7, padding: "6px 10px", marginBottom: 10 }}>
          ⚠️ {error}
        </div>
      )}

      {/* Distribution */}
      {typeDist.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {typeDist.sort((a, b) => b.count - a.count).map(t => (
            <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 4, background: t.bg, border: `1px solid ${t.color}33`, borderRadius: 20, padding: "3px 10px" }}>
              <span style={{ fontSize: 11 }}>{t.icon}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: t.color }}>{t.label}</span>
              <span style={{ fontSize: 11, color: t.color, opacity: 0.7 }}>{t.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* SF config hint when no signals */}
      {!hasAnySignal && status === "idle" && typeCount === 0 && (
        <div style={{ marginTop: 10, fontSize: 11, color: C.textLight, background: C.bg, borderRadius: 7, padding: "10px 12px", borderLeft: `3px solid ${C.border}` }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>💡 Ajouter des extracts dans Screaming Frog pour une meilleure précision</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {[
              ["JSON-LD (recommandé)", "XPath", "//script[@type='application/ld+json']", "Inner HTML", "Identifie Article, Product, FAQPage…"],
              ["Breadcrumb", "XPath", "//nav[contains(@class,'bread') or contains(@aria-label,'bread')]//text()", "Text", "Chemin de navigation"],
              ["Body class", "XPath", "//body/@class", "Text", "Classes CSS du template CMS"],
            ].map(([name, type, selector, extractType, tip]) => (
              <div key={name} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px" }}>
                <div style={{ fontWeight: 600, color: C.text, fontSize: 11 }}>{name}</div>
                <div style={{ fontFamily: "monospace", fontSize: 10, color: C.blue, marginTop: 2 }}>{selector}</div>
                <div style={{ fontSize: 10, color: C.textLight }}>Type : {extractType} · {tip}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}