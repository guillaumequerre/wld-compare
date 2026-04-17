import InfoCard from "../components/InfoCard";
import { useState, useMemo, useEffect, useRef } from "react";
import { C, SF_DIMS } from "../lib/constants";
import { SectionHeader, Badge } from "../components/ui";
import PageModeSelector from "../components/PageModeSelector";
import { SfDimCell } from "../components/CorrCell";
import { buildUrlMaps, buildSfPageVectors, intraCorrFast, sfFanoutCorr, urlXCorr } from "../lib/correlations";
import { filterByMode } from "../lib/parsers";

const GSC_DIMS = [
  { key: "clicks",      label: "Clics GSC",        src: "gsc", higher: true  },
  { key: "impressions", label: "Impressions GSC",   src: "gsc", higher: true  },
  { key: "ctr",         label: "CTR GSC (%)",       src: "gsc", higher: true  },
  { key: "position",    label: "Position moy. GSC", src: "gsc", higher: false },
];
const GA_DIMS = [
  { key: "sessions",    label: "Sessions GA4",      src: "ga",  higher: true  },
  { key: "views",       label: "Vues GA4",          src: "ga",  higher: true  },
];
const COL_KPIS = [
  { key: "geoMentions",  label: "Bing AI",       icon: "🤖", src: "bing",   color: "#7C3AED" },
  { key: "fanoutSource", label: "Source LLM",    icon: "📎", src: "fanout", color: "#059669" },
  { key: "fanoutAnswer", label: "Réponse LLM",   icon: "💬", src: "fanout", color: "#2563EB" },
];
const ROW_GROUPS = [
  { key: "sf",  label: "Screaming Frog", icon: "🐸", color: "#7C3AED", bg: "#F5F3FF", dims: SF_DIMS  },
  { key: "gsc", label: "Search Console", icon: "🔍", color: "#2563EB", bg: "#EFF6FF", dims: GSC_DIMS },
  { key: "ga",  label: "Analytics 4",    icon: "📊", color: "#059669", bg: "#ECFDF5", dims: GA_DIMS  },
];

function normUrl(raw) {
  if (!raw) return "";
  return (raw).trim().toLowerCase()
    .replace(/^https?:\/\//i, "").replace(/^www\./i, "")
    .replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
}

function Switch({ value, onChange, label }) {
  return (
    <button onClick={() => onChange(!value)} style={{ display:"flex", alignItems:"center", gap:7, background:"transparent", border:"none", cursor:"pointer", padding:0 }}>
      <div style={{ width:34, height:18, borderRadius:9, background:value?C.blue:C.border, position:"relative", transition:"background 0.2s", flexShrink:0 }}>
        <div style={{ position:"absolute", top:2, left:value?18:2, width:14, height:14, borderRadius:"50%", background:"#fff", transition:"left 0.2s", boxShadow:"0 1px 3px rgba(0,0,0,0.2)" }} />
      </div>
      <span style={{ fontSize:12, color:C.textMid, userSelect:"none" }}>{label}</span>
    </button>
  );
}

function XCell({ value, n, tooltipEnabled }) {
  const [tip, setTip] = useState(false);
  if (value === null || value === undefined) {
    return <td style={{ padding:"6px 10px", textAlign:"center", background:"#F5F5F7", border:"1px solid #E8E8ED" }}><span style={{ fontSize:10, color:"#C0C0CC", fontWeight:500 }}>—</span></td>;
  }
  const abs = Math.abs(value), pos = value >= 0;
  const [tc,bg,bc] = abs>=0.25&&pos?["#15803D","#DCFCE7","#86EFAC"]:abs>=0.05&&pos?["#16A34A","#F0FDF4","#BBF7D0"]:abs<=0.05?["#64748B","#F1F5F9","#CBD5E1"]:abs>=0.25?["#B91C1C","#FEE2E2","#FCA5A5"]:["#DC2626","#FEF2F2","#FECACA"];
  return (
    <td onMouseEnter={()=>tooltipEnabled&&setTip(true)} onMouseLeave={()=>setTip(false)}
      style={{ padding:"6px 10px", textAlign:"center", background:bg, border:`1px solid ${bc}`, position:"relative" }}>
      <span style={{ fontSize:11, fontWeight:700, color:tc }}>{pos?"+":""}{value.toFixed(2)}</span>
      {tip&&n>0&&<div style={{ position:"absolute", bottom:"calc(100% + 4px)", left:"50%", transform:"translateX(-50%)", background:"#1C1C2E", color:"#fff", fontSize:10, padding:"4px 8px", borderRadius:6, whiteSpace:"nowrap", zIndex:50, pointerEvents:"none" }}>n = {n} pages</div>}
    </td>
  );
}

function ColHeader({ kpi, sortDir, onSort }) {
  return (
    <th onClick={onSort} style={{ padding:"10px 14px", textAlign:"center", fontSize:11, fontWeight:700, color:kpi.color, background:C.bg, borderBottom:`2px solid ${kpi.color}44`, borderRight:`1px solid ${C.border}`, cursor:"pointer", userSelect:"none", whiteSpace:"nowrap", minWidth:120 }}>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
        <span style={{ fontSize:14 }}>{kpi.icon}</span>
        <span>{kpi.label}</span>
        {sortDir&&<span style={{ fontSize:9, opacity:0.7 }}>{sortDir==="desc"?"↓":"↑"}</span>}
      </div>
    </th>
  );
}

export default function MatrixTab({
  sites, sfData, gscData={}, gaData={}, bingData={},
  smData, semrushCorrMatrix, pageMode, setPageMode,
  matrixSites, setMatrixSites, filteredCorrMatrix,
  templateFilter, setTemplateFilter, pageTypes,
  geoResults=[], geoQuestions=[], geoUrlIndex=[],
}) {
  const [sortCol, setSortCol]               = useState({ key:null, dir:null });
  const [tooltipEnabled, setTooltipEnabled] = useState(true);
  const [showIntroPopup, setShowIntroPopup] = useState(false);
  const [showFavsOnly, setShowFavsOnly]     = useState(false);
  const [openGroups, setOpenGroups]         = useState({ sf:true, gsc:true, ga:true });
  const tableWrapRef = useRef(null);
  const topBarRef    = useRef(null);

  useEffect(() => { if (!localStorage.getItem("matrix_intro_seen")) setShowIntroPopup(true); }, []);
  const dismissPopup = () => { localStorage.setItem("matrix_intro_seen","1"); setShowIntroPopup(false); };

  const syncFromTop  = () => { if (tableWrapRef.current&&topBarRef.current) tableWrapRef.current.scrollLeft=topBarRef.current.scrollLeft; };
  const syncFromMain = () => { if (tableWrapRef.current&&topBarRef.current) topBarRef.current.scrollLeft=tableWrapRef.current.scrollLeft; };

  const handleSort = (kpiKey) => setSortCol(prev => prev.key!==kpiKey?{key:kpiKey,dir:"desc"}:prev.dir==="desc"?{key:kpiKey,dir:"asc"}:{key:null,dir:null});
  const toggleGroup = (key) => setOpenGroups(g => ({...g,[key]:!g[key]}));

  const fanoutMap = useMemo(() => {
    const m={};
    geoUrlIndex.forEach(u => {
      const n=normUrl(u.url); if (!n||n==="/") return;
      if (!m[n]) m[n]={source:0,answer:0};
      m[n].source+=u.count_as_source||0;
      m[n].answer+=u.count_in_answer||0;
    });
    return m;
  }, [geoUrlIndex]);

  const crossMatrix = useMemo(() => {
    const sfRows  = matrixSites.flatMap(id=>sfData[id]||[]);
    const gscRows = matrixSites.flatMap(id=>(gscData||{})[id]||[]);
    const gaRows  = matrixSites.flatMap(id=>(gaData||{})[id]||[]);
    const bingRows= matrixSites.flatMap(id=>(bingData||{})[id]||[]);
    const urlMaps = buildUrlMaps(gscRows, gaRows, bingRows);
    const sfFiltered = filterByMode(sfRows, pageMode, bingRows, gscRows);
    const sfByTpl = templateFilter?.length
      ? sfFiltered.filter(r => { const url=(r["adresse"]||r["address"]||r["url"]||"").trim(); const type=matrixSites.reduce((f,sid)=>f||(pageTypes[sid]||{})[url]||null,null); return type&&templateFilter.includes(type); })
      : sfFiltered;
    const sfPages = buildSfPageVectors(sfByTpl);
    const rows = [];

    SF_DIMS.forEach(dim => {
      const corrs = COL_KPIS.map(kpi => {
        const res = kpi.src==="bing" ? intraCorrFast(sfPages,urlMaps,dim.key,"geoMentions") : sfFanoutCorr(sfPages,fanoutMap,dim.key,kpi.key);
        return { kpi, value:res?.value??null, n:res?.n??0 };
      });
      rows.push({ group:"sf", dim, corrs });
    });

    if (gscRows.length>0) {
      GSC_DIMS.forEach(dim => {
        const corrs = COL_KPIS.map(kpi => { const res=urlXCorr(urlMaps,fanoutMap,"gsc",dim.key,kpi.key); return {kpi,value:res?.value??null,n:res?.n??0}; });
        rows.push({ group:"gsc", dim, corrs });
      });
    }
    if (gaRows.length>0) {
      GA_DIMS.forEach(dim => {
        const corrs = COL_KPIS.map(kpi => { const res=urlXCorr(urlMaps,fanoutMap,"ga",dim.key,kpi.key); return {kpi,value:res?.value??null,n:res?.n??0}; });
        rows.push({ group:"ga", dim, corrs });
      });
    }
    return rows;
  }, [matrixSites, sfData, gscData, gaData, bingData, pageMode, templateFilter, pageTypes, fanoutMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedMatrix = useMemo(() => {
    if (!sortCol.key) return crossMatrix;
    return [...crossMatrix].sort((a,b) => {
      const va=a.corrs.find(c=>c.kpi.key===sortCol.key)?.value??null;
      const vb=b.corrs.find(c=>c.kpi.key===sortCol.key)?.value??null;
      if (va===null&&vb===null) return 0; if (va===null) return 1; if (vb===null) return -1;
      return sortCol.dir==="desc"?vb-va:va-vb;
    });
  }, [crossMatrix, sortCol]);

  const geoBysite = useMemo(() => {
    const out={};
    sites.forEach(s => {
      const sr=geoResults.filter(r=>r.site_id===s.id);
      const sq=(showFavsOnly?geoQuestions.filter(q=>q.is_favorite):geoQuestions).filter(q=>q.site_id===s.id);
      const qIds=new Set(sq.map(q=>q.id));
      const f=qIds.size?sr.filter(r=>qIds.has(r.question_id)):sr;
      const total=f.length, withBrand=f.filter(r=>r.brand_mentioned).length, withSource=f.filter(r=>r.brand_in_sources).length;
      const comp=new Set(); f.forEach(r=>(r.competitors_mentioned||[]).forEach(c=>{if(c?.name)comp.add(c.name);}));
      out[s.id]={total,withBrand,withSource,pct:total?Math.round(withBrand/total*100):null,topComp:[...comp].slice(0,3)};
    });
    return out;
  }, [sites,geoResults,geoQuestions,showFavsOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasGeo    = geoResults.length>0||geoUrlIndex.length>0;
  const hasFanout = geoUrlIndex.length>0;
  const hasSf     = matrixSites.some(id=>sfData[id]?.length>0);
  const hasGsc    = matrixSites.some(id=>(gscData||{})[id]?.length>0);
  const hasGa     = matrixSites.some(id=>(gaData||{})[id]?.length>0);
  const hasBing   = matrixSites.some(id=>(bingData||{})[id]?.length>0);
  const noData = !hasSf&&!hasGsc&&!hasGa;
  const noCols = !hasBing&&!hasFanout;

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
        <SectionHeader title="Matrice de corrélation" sub="Pearson · SF / GSC / GA (ordonnées) × Bing AI / Fan-outs (abscisses)" />
        <PageModeSelector value={pageMode} onChange={setPageMode} pageTypes={pageTypes} sites={sites} templateFilter={templateFilter} setTemplateFilter={setTemplateFilter} />
      </div>
      <InfoCard tabKey="matrix" />

      {/* Fan-out summary */}
      {hasGeo && (
        <div style={{ background:"#F5F3FF", border:"1px solid #DDD6FE", borderRadius:14, padding:"16px 20px", marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
            <div>
              <div style={{ fontSize:13, fontWeight:800, color:"#7C3AED" }}>🔍 Résultats Fan-outs</div>
              <div style={{ fontSize:11, color:"#6D28D9" }}>Présence de la marque dans les réponses LLM</div>
            </div>
            <button onClick={()=>setShowFavsOnly(f=>!f)} style={{ fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:20, cursor:"pointer", background:showFavsOnly?"#7C3AED":"#EDE9FE", color:showFavsOnly?"#fff":"#7C3AED", border:"1px solid #C4B5FD" }}>
              {showFavsOnly?"⭐ Favoris":"☆ Toutes les questions"}
            </button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:`repeat(${sites.length},1fr)`, gap:12 }}>
            {sites.map(s => {
              const g=geoBysite[s.id]||{};
              const color=g.pct===null?C.textLight:g.pct>=50?"#059669":g.pct>=20?"#D97706":"#DC2626";
              return (
                <div key={s.id} style={{ background:"#fff", borderRadius:10, padding:"14px 16px", border:`1.5px solid ${s.color}33` }}>
                  <div style={{ fontSize:11, fontWeight:700, color:s.color, marginBottom:10 }}>{s.label}</div>
                  <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
                    <div><div style={{ fontSize:22, fontWeight:800, color }}>{g.pct!==null?`${g.pct}%`:"—"}</div><div style={{ fontSize:10, color:C.textLight }}>présence ({g.withBrand}/{g.total})</div></div>
                    <div><div style={{ fontSize:22, fontWeight:800, color:"#2563EB" }}>{g.withSource??"—"}</div><div style={{ fontSize:10, color:C.textLight }}>cités en source</div></div>
                  </div>
                  {g.topComp?.length>0&&<div style={{ marginTop:10, fontSize:10, color:C.textLight }}>Concurrents : <span style={{ color:"#DC2626", fontWeight:600 }}>{g.topComp.join(", ")}</span></div>}
                  {g.pct!==null&&<div style={{ marginTop:8, height:4, background:"#EDE9FE", borderRadius:2, overflow:"hidden" }}><div style={{ height:"100%", width:`${g.pct}%`, background:color, borderRadius:2 }} /></div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Badges disponibilité */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
        {[{label:"SF",ok:hasSf,icon:"🐸",color:"#7C3AED"},{label:"GSC",ok:hasGsc,icon:"🔍",color:"#2563EB"},{label:"GA4",ok:hasGa,icon:"📊",color:"#059669"},{label:"Bing AI",ok:hasBing,icon:"🤖",color:"#7C3AED"},{label:"Fan-out",ok:hasFanout,icon:"🔗",color:"#059669"}].map(s=>(
          <span key={s.label} style={{ fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:20, background:s.ok?s.color+"15":C.bg, color:s.ok?s.color:C.textLight, border:`1px solid ${s.ok?s.color+"40":C.border}` }}>{s.icon} {s.label} {s.ok?"✓":"—"}</span>
        ))}
      </div>

      {/* Controls */}
      <div style={{ marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10, flexWrap:"wrap", gap:10 }}>
          <span style={{ fontSize:12, color:C.textLight, fontWeight:600 }}>Aide au survol</span>
          <Switch value={tooltipEnabled} onChange={setTooltipEnabled} label={tooltipEnabled?"Activée":"Désactivée"} />
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span style={{ fontSize:12, color:C.textLight, fontWeight:500 }}>Sites :</span>
          {sites.map(s => {
            const active=matrixSites.includes(s.id);
            return <button key={s.id} onClick={()=>setMatrixSites(prev=>active?prev.filter(id=>id!==s.id):[...prev,s.id])} style={{ padding:"5px 14px", border:`1.5px solid ${active?s.color:C.border}`, borderRadius:20, cursor:"pointer", fontSize:12, fontWeight:600, background:active?s.bg:C.white, color:active?s.color:C.textLight, display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ width:8, height:8, borderRadius:"50%", background:active?s.color:C.border, display:"inline-block" }} />{s.label}
            </button>;
          })}
          {matrixSites.length===0&&<span style={{ fontSize:12, color:C.red, fontStyle:"italic" }}>Aucun site sélectionné</span>}
          {matrixSites.length>0&&<span style={{ fontSize:11, color:C.purple, background:C.purpleLight, padding:"3px 10px", borderRadius:20 }}>Pearson · {matrixSites.length===1?sites.find(s=>s.id===matrixSites[0])?.label:`${matrixSites.length} sites combinés`}</span>}
        </div>
      </div>

      {/* Légende */}
      <div style={{ display:"flex", gap:12, marginBottom:20, flexWrap:"wrap" }}>
        {[["#15803D","#DCFCE7","#86EFAC","≥ 0.25","Positif fort"],["#16A34A","#F0FDF4","#BBF7D0","0.05–0.25","Positif léger"],["#64748B","#F1F5F9","#CBD5E1","-0.05–0.05","Neutre"],["#DC2626","#FEF2F2","#FECACA","-0.25–-0.05","Négatif léger"],["#B91C1C","#FEE2E2","#FCA5A5","≤ -0.25","Négatif fort"],["#C0C0CC","#F5F5F7","#E8E8ED","—","Données insuffisantes"]].map(([tc,bg,bc,label,desc])=>(
          <div key={label} style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:60, height:22, background:bg, border:`1px solid ${bc}`, borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:tc, fontWeight:700 }}>{label}</div>
            <span style={{ fontSize:12, color:C.textMid }}>{desc}</span>
          </div>
        ))}
      </div>

      {/* Messages no data */}
      {matrixSites.length===0&&<div style={{ padding:40, textAlign:"center", color:C.textLight, fontSize:13 }}>Sélectionnez au moins un site pour afficher la matrice</div>}
      {matrixSites.length>0&&noData&&<div style={{ padding:40, textAlign:"center", color:C.textLight, fontSize:13 }}><div style={{ fontSize:28, marginBottom:10 }}>🐸</div>Chargez un fichier Screaming Frog, GSC ou GA4 dans ⚙️ Setup pour afficher la matrice</div>}
      {matrixSites.length>0&&!noData&&noCols&&<div style={{ padding:40, textAlign:"center", color:C.textLight, fontSize:13 }}><div style={{ fontSize:28, marginBottom:10 }}>🤖</div>Importez des données Bing Webmaster Tools ou lancez des Fan-outs pour afficher les colonnes</div>}

      {/* Tableau principal */}
      {matrixSites.length>0&&!noData&&!noCols&&(<>
        <div ref={topBarRef} onScroll={syncFromTop} style={{ overflowX:"auto", overflowY:"hidden", marginBottom:2 }}>
          <div style={{ height:1, minWidth:600 }} />
        </div>
        <div ref={tableWrapRef} onScroll={syncFromMain} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, overflow:"auto", maxHeight:700 }}>
          <table style={{ borderCollapse:"collapse", width:"100%", minWidth:600 }}>
            <thead style={{ position:"sticky", top:0, zIndex:3 }}>
              <tr>
                <th style={{ padding:"14px 18px", textAlign:"left", fontSize:12, fontWeight:600, color:C.textMid, background:C.bg, borderBottom:`1px solid ${C.border}`, borderRight:`1px solid ${C.border}`, minWidth:220, position:"sticky", left:0, zIndex:4 }}>
                  <div style={{ fontSize:10, color:C.textLight, marginBottom:2, textTransform:"uppercase", letterSpacing:0.7 }}>Ordonnées → Abscisses</div>
                  <div style={{ fontSize:11 }}>SF / GSC / GA → Bing / Fan-out</div>
                </th>
                {COL_KPIS.map(kpi=><ColHeader key={kpi.key} kpi={kpi} sortDir={sortCol.key===kpi.key?sortCol.dir:null} onSort={()=>handleSort(kpi.key)} />)}
              </tr>
            </thead>
            <tbody>
              {ROW_GROUPS.map(group => {
                const groupRows=sortedMatrix.filter(r=>r.group===group.key);
                if (!groupRows.length) return null;
                const isOpen=openGroups[group.key];
                return [
                  <tr key={`hdr-${group.key}`}>
                    <td colSpan={COL_KPIS.length+1} style={{ padding:"6px 18px", background:group.bg, borderTop:`2px solid ${group.color}44`, borderBottom:`1px solid ${group.color}33`, cursor:"pointer", userSelect:"none" }} onClick={()=>toggleGroup(group.key)}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:14 }}>{group.icon}</span>
                        <span style={{ fontSize:12, fontWeight:800, color:group.color, textTransform:"uppercase", letterSpacing:0.8 }}>{group.label}</span>
                        <span style={{ fontSize:10, color:group.color, opacity:0.7 }}>({groupRows.length} dims)</span>
                        <span style={{ marginLeft:"auto", fontSize:11, color:group.color, transform:isOpen?"rotate(0deg)":"rotate(-90deg)", transition:"transform 0.2s", display:"inline-block" }}>▼</span>
                      </div>
                    </td>
                  </tr>,
                  isOpen&&groupRows.map(({ dim, corrs }, ri) => {
                    const rowBg=ri%2===0?C.white:"#FAFBFC";
                    return (
                      <tr key={dim.key} style={{ background:rowBg }}>
                        {dim.src ? (
                          <td style={{ padding:"8px 14px", background:rowBg, borderRight:`1px solid ${C.border}`, position:"sticky", left:0, zIndex:1, borderBottom:`1px solid ${C.borderLight}`, minWidth:220 }}>
                            <div style={{ fontSize:12, fontWeight:600, color:C.text }}>{dim.label}</div>
                            {dim.higher!==undefined&&<div style={{ fontSize:10, color:C.textLight, marginTop:1 }}>{dim.higher?"↑ plus = mieux":"↓ moins = mieux"}</div>}
                          </td>
                        ) : (
                          <SfDimCell dim={dim} rowBg={rowBg} tooltipEnabled={tooltipEnabled} />
                        )}
                        {corrs.map(({kpi,value,n})=><XCell key={kpi.key} value={value} n={n} tooltipEnabled={tooltipEnabled} />)}
                      </tr>
                    );
                  })
                ];
              })}
            </tbody>
          </table>
        </div>
      </>)}

      {/* Top corrélations */}
      <div style={{ marginTop:24, display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        {[["🟢 Top corrélations positives",(a,b)=>b.value-a.value,v=>v>=0.4,C.green,C.greenLight],["🔴 Top corrélations négatives",(a,b)=>a.value-b.value,v=>v<=-0.4,C.red,C.redLight]].map(([title,sort,filter,color,bg])=>(
          <div key={title} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:14, padding:20 }}>
            <div style={{ fontWeight:600, fontSize:14, color:C.text, marginBottom:12 }}>{title}</div>
            {crossMatrix.flatMap(({dim,corrs})=>corrs.filter(c=>c.value!==null&&filter(c.value)).map(c=>({dim,kpi:c.kpi,value:c.value}))).sort(sort).slice(0,5).map((item,i)=>(
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:`1px solid ${C.borderLight}` }}>
                <div>
                  <div style={{ fontSize:12, color:C.text }}>{item.dim.label}</div>
                  <div style={{ fontSize:11, color:C.textLight }}>→ {item.kpi.icon} {item.kpi.label}</div>
                </div>
                <Badge color={color} bg={bg}>{item.value>0?"+":""}{item.value}</Badge>
              </div>
            ))}
            {crossMatrix.flatMap(({dim,corrs})=>corrs.filter(c=>c.value!==null&&filter(c.value))).length===0&&<div style={{ fontSize:12, color:C.textLight }}>Pas encore de données suffisantes</div>}
          </div>
        ))}
      </div>

      {/* Popup intro */}
      {showIntroPopup&&(
        <div style={{ position:"fixed", inset:0, background:"rgba(15,15,30,0.55)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:18, padding:"32px 36px", maxWidth:560, width:"100%", boxShadow:"0 24px 80px rgba(0,0,0,0.25)" }}>
            <div style={{ fontSize:20, fontWeight:800, color:C.text, marginBottom:16, lineHeight:1.3 }}>Attention, vous entrez sur une page avec beaucoup de chiffres !</div>
            <p style={{ fontSize:14, color:C.textMid, lineHeight:1.65, marginBottom:18 }}>Ce tableau montre les <b style={{ color:C.text }}>corrélations entre vos données techniques SEO</b> (SF, GSC, GA4) et vos <b style={{ color:C.text }}>performances GEO</b> (Bing AI, Fan-outs LLM).</p>
            <div style={{ background:C.blueLight, border:`1px solid ${C.blue}33`, borderRadius:10, padding:"14px 16px", marginBottom:18 }}>
              <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, color:C.blue, marginBottom:8 }}>Exemple de lecture</div>
              <p style={{ fontSize:13, color:C.textMid, lineHeight:1.6, margin:0 }}>Si <b style={{ color:C.blue }}>Mots moyens / page → Citations Bing AI = +0.42</b>, les pages avec plus de mots tendent à être plus citées par Bing AI.</p>
            </div>
            <div style={{ background:"#FFFBEB", border:"1px solid #FDE68A", borderRadius:10, padding:"12px 16px", marginBottom:28 }}>
              <div style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                <span style={{ fontSize:16, flexShrink:0 }}>⚠️</span>
                <p style={{ fontSize:13, color:"#92400E", lineHeight:1.6, margin:0 }}><b>Corrélation ≠ causalité.</b> Ce tableau dit uniquement : les pages avec ce critère sont plus souvent citées en moyenne.</p>
              </div>
            </div>
            <button onClick={dismissPopup} style={{ width:"100%", padding:"12px 0", border:"none", borderRadius:10, background:C.blue, color:"#fff", fontSize:14, fontWeight:700, cursor:"pointer" }}>J'ai compris, afficher la matrice</button>
          </div>
        </div>
      )}
    </div>
  );
}