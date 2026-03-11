import { C } from "../lib/constants.js";
import { safeNum, toUrlPath } from "../lib/helpers.js";
import { SectionHeader, Badge } from "../components/ui.jsx";

export default function PagesTab({ sites, sfData, gscData, bingData, pageMode, setPageMode }) {
  return (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
      <SectionHeader title="Analyse par pages" sub="Scoring et filtrage des pages selon leur présence GEO et SEO" />
      <PageModeSelector value={pageMode} onChange={setPageMode} />
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
      {sites.map(site => {
        const sfRows   = sfData[site.id];
        const bingRows = bingData[site.id];
        const gscRows  = gscData[site.id] || [];
        const filtered = filterByMode(sfRows, pageMode, bingRows, gscRows);
        const html     = filtered.filter(r => {
          const ct = (r["type de contenu"] || r["content type"] || "").toLowerCase();
          const sc = safeNum(r["code http"] || r["status code"] || 200);
          const isHtml = ct.includes("html") || (ct === "" && (r["title 1"] || r["h1-1"] || "").trim() !== "");
          return isHtml && sc < 400;
        });

        // GEO pages: SF rows whose URL matches a Bing citation (path-based)
        const geoPages = sfRows.filter(r => {
          const p = toUrlPath(r["adresse"] || r["url"] || "");
          return bingRows.some(b => toUrlPath(b["page"] || b["url"] || "") === p && safeNum(b["citations"] || 0) >= 1);
        });

        // SEO pages: cross-reference with GSC file (path-based), sorted by clicks
        const gscWithClics = gscRows
          .filter(r => safeNum(r["clics"] || r["clicks"] || 0) > 0)
          .sort((a, b) => safeNum(b["clics"] || b["clicks"]) - safeNum(a["clics"] || a["clicks"]));
        const gscPathMap = {};
        gscWithClics.forEach(r => {
          const p = toUrlPath(r["pages les plus populaires"] || r["page"] || r["adresse"] || r["url"] || "");
          if (!p) return;
          const existing = gscPathMap[p];
          const clicks = safeNum(r["clics"] || r["clicks"] || 0);
          const existingClicks = existing ? safeNum(existing["clics"] || existing["clicks"] || 0) : -1;
          if (!existing || clicks > existingClicks) gscPathMap[p] = r;
        });
        const seoPages = sfRows
          .map(r => ({ r, gscR: gscPathMap[toUrlPath(r["adresse"] || r["url"] || "")] }))
          .filter(({ gscR }) => gscR)
          .sort((a, b) => safeNum(b.gscR["clics"] || b.gscR["clicks"]) - safeNum(a.gscR["clics"] || a.gscR["clicks"]));

        return (
          <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
            <div style={{ background: site.bg, padding: "14px 20px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: site.color }}>{site.label}</div>
            </div>
            <div style={{ padding: 20 }}>
              {/* Page counts */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
                {[
                  ["📄 Total HTML", sfRows.filter(r => { const ct = (r["type de contenu"]||r["content type"]||"").toLowerCase(); const sc = safeNum(r["code http"]||r["status code"]||200); return (ct.includes("html") || (ct === "" && (r["title 1"]||r["h1-1"]||"").trim() !== "")) && sc < 400; }).length, C.text],
                  ["🤖 Pages GEO", geoPages.length, C.purple],
                  ["🔍 Pages SEO", seoPages.length, C.blue],
                ].map(([label, count, color]) => (
                  <div key={label} style={{ background: C.bg, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: C.textLight, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color }}>{count}</div>
                  </div>
                ))}
              </div>

              {/* Mode info */}
              <div style={{ marginBottom: 16, padding: "10px 14px", background: pageMode === "geo" ? C.purpleLight : pageMode === "seo" ? C.blueLight : C.bg, borderRadius: 8, fontSize: 12, color: pageMode === "geo" ? C.purple : pageMode === "seo" ? C.blue : C.textMid }}>
                {pageMode === "all"  && `Analyse sur ${html.length} pages HTML`}
                {pageMode === "geo"  && `${html.length} pages présentes dans Bing AI`}
                {pageMode === "seo"  && `${html.length} pages top 30% clics GSC`}
              </div>

              {/* Top pages by mode */}
              {pageMode !== "all" && (
                <div>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 10 }}>
                    Top pages {pageMode === "geo" ? "citées Bing" : "clics GSC"}
                  </div>
                  {pageMode === "geo" && (() => {
                    const bingPathMap = {};
                    bingRows.forEach(b => { const p = toUrlPath(b["page"] || b["url"] || ""); if (p) bingPathMap[p] = b; });
                    return html
                      .map(r => { const p = toUrlPath(r["adresse"] || r["url"] || ""); return { r, bingR: bingPathMap[p], citations: safeNum(bingPathMap[p]?.["citations"] || 0) }; })
                      .sort((a, b) => b.citations - a.citations)
                      .slice(0, 8)
                      .map(({ r, citations }, i) => {
                        const url = r["adresse"] || r["url"] || "";
                        const label = url.replace(/https?:\/\/[^/]+/, "").slice(0, 50) || url.slice(0, 50);
                        return (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${C.borderLight}`, gap: 8 }}>
                            <div style={{ fontSize: 11, color: C.textMid, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={url}>{label || url}</div>
                            <Badge color={C.purple} bg={C.purpleLight}>{citations} cit.</Badge>
                          </div>
                        );
                      });
                  })()}
                  {pageMode === "seo" && seoPages.slice(0, 8).map(({ r, gscR }, i) => {
                    const url = r["adresse"] || r["url"] || "";
                    const score = safeNum(gscR["clics"] || gscR["clicks"] || 0);
                    const label = url.replace(/https?:\/\/[^/]+/, "").slice(0, 50) || url.slice(0, 50);
                    return (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${C.borderLight}`, gap: 8 }}>
                        <div style={{ fontSize: 11, color: C.textMid, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={url}>{label || url}</div>
                        <Badge color={C.blue} bg={C.blueLight}>{score} clics</Badge>
                      </div>
                    );
                  })}
                  {pageMode === "seo" && seoPages.length === 0 && (
                    <div style={{ fontSize: 12, color: C.textLight, padding: "10px 0" }}>Aucune page GSC chargée pour ce site</div>
                  )}
                </div>
              )}

              {html.length === 0 && sfRows.length === 0 && (
                <div style={{ fontSize: 12, color: C.textLight, textAlign: "center", padding: 20 }}>Chargez un CSV SF dans l'onglet Import</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
)}