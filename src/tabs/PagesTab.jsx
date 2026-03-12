import InfoCard from "../components/InfoCard";
import { computePageScore, scoreLabel } from "../lib/scoring";
import ScoreTooltip from "../components/ScoreTooltip";
import { useState } from "react";
import { C, PAGE_TYPE_MAP } from "../lib/constants";
import { safeNum, toUrlPath } from "../lib/helpers";
import { filterByMode } from "../lib/parsers";
import { SectionHeader, Badge } from "../components/ui";
import PageModeSelector from "../components/PageModeSelector";

export default function PagesTab({ sites, sfData, gscData, bingData, pageMode, setPageMode, templateFilter, setTemplateFilter, pageTypes }) {
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState("desc");
  const [search, setSearch] = useState("");

  return (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
      <SectionHeader title="Analyse par pages" sub="Scoring et filtrage des pages selon leur présence GEO et SEO" />
    <InfoCard tabKey="pages" />
      <PageModeSelector value={pageMode} onChange={setPageMode} pageTypes={pageTypes} sites={sites} templateFilter={templateFilter} setTemplateFilter={setTemplateFilter} />
    </div>

    {/* ── Mode "all" : tableau par URL ── */}
    {pageMode === "all" && (() => {
      // Merge all sites' pages
      const allPages = sites.flatMap(site => {
        const sfRows  = sfData[site.id] || [];
        const gscRows = gscData[site.id] || [];
        const bingRows = bingData[site.id] || [];

        // GSC map by path
        const gscMap = {};
        gscRows.forEach(r => {
          const p = toUrlPath(r["pages les plus populaires"] || r["page"] || r["url"] || "");
          if (!p) return;
          const clicks = safeNum(r["clics"] || r["clicks"] || 0);
          if (!gscMap[p] || clicks > safeNum(gscMap[p]["clics"] || gscMap[p]["clicks"] || 0)) gscMap[p] = r;
        });

        // Bing map by path
        const bingMap = {};
        bingRows.forEach(b => {
          const p = toUrlPath(b["page"] || b["url"] || "");
          if (p) bingMap[p] = b;
        });

        const html = sfRows.filter(r => {
          const ct = (r["type de contenu"] || r["content type"] || "").toLowerCase();
          const sc = safeNum(r["code http"] || r["status code"] || 200);
          return (ct.includes("html") || (ct === "" && (r["title 1"] || r["h1-1"] || "").trim() !== "")) && sc < 400;
        });

        return html.map(r => {
          const url   = r["adresse"] || r["address"] || r["url"] || "";
          const path  = toUrlPath(url);
          const gscR  = gscMap[path];
          const bingR = bingMap[path];
          const jsons = [r["json 1"],r["json 2"],r["json 3"],r["json 4"],r["json 5"]].filter(Boolean).join(" ");
          let hasTable = false;
          for (let i = 1; i <= 18; i++) { const v = r[`présence table ${i}`]||r[`presence table ${i}`]||""; if (v && v.trim() !== "" && v.trim() !== "0") { hasTable = true; break; } }
          const pageDims = {
            avgTitleLen:    safeNum(r["longueur du title 1"] || r["title 1 length"] || 0) || (r["title 1"]||"").length,
            avgMetaLen:     safeNum(r["longueur de la meta description 1"] || r["meta description 1 length"] || 0) || (r["meta description 1"]||"").length,
            avgH1Len:       safeNum(r["longueur du h1-1"] || r["h1-1 length"] || 0) || (r["h1-1"]||r["h1"]||"").trim().length,
            avgWords:       safeNum(r["nombre de mots"] || r["word count"] || 0),
            avgPageSizeKB:  safeNum(r["taille (octets)"] || r["size"] || 0) / 1024,
            avgInlinksUniq: safeNum(r["liens entrants uniques"] || 0),
            avgFlesch:      safeNum(r["score de lisibilité de flesch"] || r["score de lisibilité"] || r["flesch reading ease"] || 0),
            tableRate:      hasTable ? 1 : 0,
            schemaRate:     jsons.length > 0 ? 1 : 0,
            avgDepth:       safeNum(r["crawl profondeur"] || r["crawl depth"] || 0),
            errorRate:      0,
            redirectRate:   0,
            avgImgSizeKB:   0,
          };
          const { score: pageScore, detail: pageDetail } = computePageScore(pageDims);
          return {
            site,
            url,
            path,
            flesch:    pageDims.avgFlesch,
            title:     r["title 1"] || r["title"] || "",
            depth:     pageDims.avgDepth,
            inlinks:   pageDims.avgInlinksUniq,
            clicks:    gscR ? safeNum(gscR["clics"] || gscR["clicks"] || 0) : 0,
            position:  gscR ? safeNum(gscR["position"] || 0) : 0,
            citations: bingR ? safeNum(bingR["citations"] || bingR["mentions"] || 0) : 0,
            score:     pageScore,
            scoreDetail: pageDetail,
          };
        });
      });

      const SORTS = [
        { key: "score",     label: "Score" },
        { key: "flesch",    label: "Flesch" },
        { key: "clicks",    label: "Clics" },
        { key: "citations", label: "Citations" },
        { key: "inlinks",   label: "Liens ent." },
        { key: "depth",     label: "Profondeur" },
      ];

      const filtered = allPages
        .filter(p => {
          if (templateFilter?.length) {
            const map = pageTypes[p.site?.id] || {};
            if (!templateFilter.includes(map[p.url])) return false;
          }
          return !search || p.url.toLowerCase().includes(search.toLowerCase()) || p.title.toLowerCase().includes(search.toLowerCase());
        })
        .sort((a, b) => sortDir === "desc" ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]);

      return (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          {/* Controls */}
          <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher une URL ou un titre…"
              style={{ flex: 1, minWidth: 200, padding: "7px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, outline: "none" }}
            />
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: C.textLight }}>Trier :</span>
              {SORTS.map(s => (
                <button key={s.key} onClick={() => { if (sortKey === s.key) { setSortDir(d => d === "desc" ? "asc" : "desc"); } else { setSortKey(s.key); setSortDir("desc"); } }}
                  style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${sortKey === s.key ? C.blue : C.border}`, background: sortKey === s.key ? C.blueLight : C.white, color: sortKey === s.key ? C.blue : C.textMid, fontSize: 11, fontWeight: sortKey === s.key ? 700 : 400, cursor: "pointer" }}>
                  {s.label}{sortKey === s.key && <span style={{ fontSize: 9, opacity: 0.7 }}>{sortDir === "desc" ? " ↓" : " ↑"}</span>}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 11, color: C.textLight }}>{filtered.length} pages</span>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto", maxHeight: 600, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{ position: "sticky", top: 0, background: C.bg, zIndex: 2 }}>
                <tr>
                  <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: `1px solid ${C.border}`, color: C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 }}>Site</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: `1px solid ${C.border}`, color: C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 }}>URL</th>
                  <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: `1px solid ${C.border}`, color: C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" }}>Catégorie</th>
                  <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: sortKey === "score" ? C.blue : C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, cursor: "pointer" }} onClick={() => { if (sortKey === "score") { setSortDir(d => d === "desc" ? "asc" : "desc"); } else { setSortKey("score"); setSortDir("desc"); } }}>Score</th>
                  <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: sortKey === "flesch" ? C.blue : C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, cursor: "pointer" }} onClick={() => { if (sortKey === "flesch") { setSortDir(d => d === "desc" ? "asc" : "desc"); } else { setSortKey("flesch"); setSortDir("desc"); } }}>Flesch</th>
                  <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: sortKey === "inlinks" ? C.blue : C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, cursor: "pointer" }} onClick={() => { if (sortKey === "inlinks") { setSortDir(d => d === "desc" ? "asc" : "desc"); } else { setSortKey("inlinks"); setSortDir("desc"); } }}>Liens ent.</th>
                  <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: sortKey === "depth" ? C.blue : C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, cursor: "pointer" }} onClick={() => { if (sortKey === "depth") { setSortDir(d => d === "desc" ? "asc" : "desc"); } else { setSortKey("depth"); setSortDir("desc"); } }}>Prof.</th>
                  <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: sortKey === "clicks" ? C.blue : C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, cursor: "pointer" }} onClick={() => { if (sortKey === "clicks") { setSortDir(d => d === "desc" ? "asc" : "desc"); } else { setSortKey("clicks"); setSortDir("desc"); } }}>Clics GSC</th>
                  <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: `1px solid ${C.border}`, color: sortKey === "citations" ? C.purple : C.textLight, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, cursor: "pointer" }} onClick={() => { if (sortKey === "citations") { setSortDir(d => d === "desc" ? "asc" : "desc"); } else { setSortKey("citations"); setSortDir("desc"); } }}>Bing cit.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: 30, textAlign: "center", color: C.textLight, fontSize: 13 }}>
                    {allPages.length === 0 ? "Chargez un CSV SF dans l'onglet Import" : "Aucune page correspondante"}
                  </td></tr>
                )}
                {filtered.map((p, i) => (
                  <tr key={p.site.id + p.url} style={{ background: i % 2 === 0 ? C.white : C.bg }}>
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.site.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 10, color: C.textLight, whiteSpace: "nowrap" }}>{p.site.label}</span>
                      </div>
                    </td>
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, maxWidth: 320 }}>
                      <div style={{ fontSize: 11, color: C.textMid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.url}>
                        {p.path || "/"}
                      </div>
                      {p.title && <div style={{ fontSize: 10, color: C.textLight, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>}
                    </td>
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, whiteSpace: "nowrap" }}>
                      {(() => {
                        const ptype = (pageTypes[p.site?.id] || {})[p.url];
                        const def = ptype ? PAGE_TYPE_MAP[ptype] : null;
                        return def ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, color: def.color, background: def.bg, border: `1px solid ${def.color}33`, borderRadius: 10, padding: "2px 8px" }}>
                            {def.icon} {def.label}
                          </span>
                        ) : <span style={{ fontSize: 10, color: C.textLight }}>—</span>;
                      })()}
                    </td>
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "center" }}>
                      {(() => { const lbl = scoreLabel(p.score); return p.score !== null ? (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <div style={{ width: 32, height: 32, borderRadius: "50%", background: lbl.bg, border: `2px solid ${lbl.color}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ fontSize: 11, fontWeight: 800, color: lbl.color }}>{p.score}</span>
                          </div>
                          <ScoreTooltip detail={p.scoreDetail} score={p.score} />
                        </div>
                      ) : <span style={{ color: C.textLight }}>—</span>; })()}
                    </td>
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                      {p.flesch > 0 ? <span style={{ fontWeight: 600, color: p.flesch >= 60 ? C.green : p.flesch >= 30 ? C.amber : C.red }}>{p.flesch}</span> : <span style={{ color: C.textLight }}>—</span>}
                    </td>
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "center", color: C.textMid, fontVariantNumeric: "tabular-nums" }}>{p.inlinks || "—"}</td>
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "center", color: C.textMid }}>{p.depth}</td>
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "center" }}>
                      {p.clicks > 0 ? <Badge color={C.blue} bg={C.blueLight}>{p.clicks}</Badge> : <span style={{ color: C.textLight }}>—</span>}
                    </td>
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.borderLight}`, textAlign: "center" }}>
                      {p.citations > 0 ? <Badge color={C.purple} bg={C.purpleLight}>{p.citations}</Badge> : <span style={{ color: C.textLight }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    })()}

    {/* ── Modes SEO / GEO : vue par site (original) ── */}
    {pageMode !== "all" && (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
        {sites.map(site => {
          const sfRows   = sfData[site.id] || [];
          const bingRows = bingData[site.id] || [];
          const gscRows  = gscData[site.id] || [];
          const filtered = filterByMode(sfRows, pageMode, bingRows, gscRows);
          const html     = filtered.filter(r => {
            const ct = (r["type de contenu"] || r["content type"] || "").toLowerCase();
            const sc = safeNum(r["code http"] || r["status code"] || 200);
            return (ct.includes("html") || (ct === "" && (r["title 1"] || r["h1-1"] || "").trim() !== "")) && sc < 400;
          });

          const geoPages = sfRows.filter(r => {
            const p = toUrlPath(r["adresse"] || r["url"] || "");
            return bingRows.some(b => toUrlPath(b["page"] || b["url"] || "") === p && safeNum(b["citations"] || 0) >= 1);
          });

          const gscWithClics = gscRows
            .filter(r => safeNum(r["clics"] || r["clicks"] || 0) > 0)
            .sort((a, b) => safeNum(b["clics"] || b["clicks"]) - safeNum(a["clics"] || a["clicks"]));
          const gscPathMap = {};
          gscWithClics.forEach(r => {
            const p = toUrlPath(r["pages les plus populaires"] || r["page"] || r["url"] || "");
            if (!p) return;
            if (!gscPathMap[p] || safeNum(r["clics"] || r["clicks"] || 0) > safeNum(gscPathMap[p]["clics"] || gscPathMap[p]["clicks"] || 0)) gscPathMap[p] = r;
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
                <div style={{ marginBottom: 16, padding: "10px 14px", background: pageMode === "geo" ? C.purpleLight : C.blueLight, borderRadius: 8, fontSize: 12, color: pageMode === "geo" ? C.purple : C.blue }}>
                  {pageMode === "geo" && `${html.length} pages présentes dans Bing AI`}
                  {pageMode === "seo" && `${html.length} pages top 30% clics GSC`}
                </div>
                <div>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 10 }}>
                    Top pages {pageMode === "geo" ? "citées Bing" : "clics GSC"}
                  </div>
                  {pageMode === "geo" && (() => {
                    const bingPathMap = {};
                    bingRows.forEach(b => { const p = toUrlPath(b["page"] || b["url"] || ""); if (p) bingPathMap[p] = b; });
                    return html
                      .map(r => { const p = toUrlPath(r["adresse"] || r["url"] || ""); return { r, citations: safeNum(bingPathMap[p]?.["citations"] || 0) }; })
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
                    const url   = r["adresse"] || r["url"] || "";
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
                {html.length === 0 && sfRows.length === 0 && (
                  <div style={{ fontSize: 12, color: C.textLight, textAlign: "center", padding: 20 }}>Chargez un CSV SF dans l'onglet Import</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
  );
}