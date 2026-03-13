import InfoCard from "../components/InfoCard";
import { C, PAGE_TYPES } from "../lib/constants";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Legend } from "recharts";
import { StatPill, SectionHeader, Badge } from "../components/ui";
import PageModeSelector from "../components/PageModeSelector";
import SchemaBreakdown from "../components/SchemaBreakdown";
import LlmsStatus from "../components/LlmsStatus";

// ── Shared sub-components ────────────────────────────────────────

function SfRow({ label, value, baseValue, unit, lowerIsBetter, pageMode }) {
  const showD = pageMode !== "all" && baseValue !== null && baseValue !== undefined;
  const diff  = showD ? Math.round((value - baseValue) * 10) / 10 : null;
  const up    = diff > 0;
  const isGood = lowerIsBetter ? !up : up;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: `1px solid ${C.borderLight}`, gap: 6 }}>
      <span style={{ fontSize: 11, color: C.textLight, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{value}{unit}</span>
        {showD && diff !== 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: isGood ? "#16A34A" : "#DC2626" }}>
            {up ? "▲" : "▼"}{up ? "+" : ""}{diff}{unit}
          </span>
        )}
      </div>
    </div>
  );
}

function SfMetrics({ sf, sfBase, pageMode }) {
  if (!sf) return <div style={{ color: C.textLight, fontSize: 12 }}>Aucun CSV SF chargé</div>;
  const rows = [
    ["Title moy.",       sf.avgTitleLen,      sfBase?.avgTitleLen,      "car.", false],
    ["Meta moy.",        sf.avgMetaLen,        sfBase?.avgMetaLen,        "car.", false],
    ["H1 moy.",          sf.avgH1Len,          sfBase?.avgH1Len,          "car.", false],
    ["Mots moy.",        sf.avgWords,          sfBase?.avgWords,          "",     false],
    ["Poids pages",      sf.avgPageSizeKB,     sfBase?.avgPageSizeKB,     "KB",   true],
    ["Poids img.",       sf.avgImgSizeKB,      sfBase?.avgImgSizeKB,      "KB",   true],
    ["Inlinks uniq.",    sf.avgInlinksUniq,    sfBase?.avgInlinksUniq,    "",     false],
    ["Outlinks uniq.",   sf.avgOutlinksUniq,   sfBase?.avgOutlinksUniq,   "",     false],
    ["Liens ext. uniq.", sf.avgExtLinksUniq,   sfBase?.avgExtLinksUniq,   "",     false],
    ["Profondeur",       sf.avgDepth,          sfBase?.avgDepth,          "",     true],
    ["Flesch",           sf.avgFlesch,         sfBase?.avgFlesch,         "",     false],
    ["Tableaux",         sf.tableRate,         sfBase?.tableRate,         "%",    false],
    ["Schemas",          sf.schemaRate,        sfBase?.schemaRate,        "%",    false],
    ["Indexables",       sf.indexableRate,     sfBase?.indexableRate,     "%",    false],
    ["Erreurs",          sf.errorRate,         sfBase?.errorRate,         "%",    true],
    ["Redirects",        sf.redirectRate,      sfBase?.redirectRate,      "%",    true],
  ];
  return (
    <div>
      {rows.map(([label, value, base, unit, lower]) => (
        <SfRow key={label} label={label} value={value} baseValue={base} unit={unit} lowerIsBetter={lower} pageMode={pageMode} />
      ))}
    </div>
  );
}

function PageTypeBadges({ siteId, pageTypes, templateFilter, setTemplateFilter }) {
  const dist = pageTypes?.[siteId]
    ? PAGE_TYPES.map(t => ({ ...t, count: Object.values(pageTypes[siteId]).filter(v => v === t.key).length })).filter(t => t.count > 0)
    : [];
  if (!dist.length) return <div style={{ fontSize: 11, color: C.textLight, fontStyle: "italic" }}>Pas encore classifié</div>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {dist.sort((a, b) => b.count - a.count).map(t => {
        const active = !templateFilter?.length || templateFilter.includes(t.key);
        return (
          <div key={t.key} onClick={() => setTemplateFilter?.(prev => {
            const cur = prev || [];
            return cur.includes(t.key) ? cur.filter(k => k !== t.key) : [...cur, t.key];
          })} style={{
            display: "flex", alignItems: "center", gap: 4, padding: "3px 9px",
            borderRadius: 20, cursor: setTemplateFilter ? "pointer" : "default",
            background: active ? t.bg : C.bg,
            border: `1px solid ${active ? t.color + "55" : C.border}`,
            opacity: active ? 1 : 0.4, transition: "all 0.15s",
          }}>
            <span style={{ fontSize: 10 }}>{t.icon}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: active ? t.color : C.textLight }}>{t.label}</span>
            <span style={{ fontSize: 10, color: active ? t.color : C.textLight, opacity: 0.7 }}>{t.count}</span>
          </div>
        );
      })}
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}

// ── Layout 1 site ────────────────────────────────────────────────

function Layout1({ metrics, sites, pageTypes, templateFilter, setTemplateFilter, pageMode, radarSites, setRadarSites, radarData }) {
  const { site, sf, sfBase, gsc, ga, bing } = metrics[0];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Hero header */}
      <div style={{ background: site.bg, border: `1.5px solid ${site.color}33`, borderRadius: 14, padding: "20px 24px", display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 14, height: 14, borderRadius: "50%", background: site.color }} />
        <div style={{ fontWeight: 800, fontSize: 20, color: site.color }}>{site.label}</div>
        {sf && <Badge color={site.color} bg={site.bg}>{sf.totalPages} pages</Badge>}
        <div style={{ marginLeft: "auto" }}>
          <PageTypeBadges siteId={site.id} pageTypes={pageTypes} templateFilter={templateFilter} setTemplateFilter={setTemplateFilter} />
        </div>
      </div>

      {/* 3-col body: SF metrics | SF extras + sources | Radar */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, alignItems: "start" }}>

        {/* SF metrics */}
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 20px" }}>
          <Section label="🕷️ Screaming Frog">
            <SfMetrics sf={sf} sfBase={sfBase} pageMode={pageMode} />
          </Section>
        </div>

        {/* Schema + LLMS + Sources */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {sf && Object.keys(sf.schemaTypes || {}).length > 0 && (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 20px" }}>
              <Section label="🏷️ Types de Schema">
                <SchemaBreakdown schemaTypes={sf.schemaTypes} color={site.color} />
              </Section>
            </div>
          )}
          {sf && (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 20px" }}>
              <LlmsStatus sf={sf} />
            </div>
          )}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
            <Section label="🔍 GSC">
              {gsc ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <StatPill label="Clics" value={gsc.clicks.toLocaleString()} color={C.blue} />
                  <StatPill label="Impressions" value={gsc.impressions.toLocaleString()} />
                  <StatPill label="CTR" value={`${gsc.ctr}%`} color={C.green} />
                  <StatPill label="Position" value={gsc.position} color={C.amber} />
                </div>
              ) : <div style={{ fontSize: 12, color: C.textLight }}>—</div>}
            </Section>
            <Section label="📊 GA4">
              {ga ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <StatPill label="Sessions" value={ga.sessions.toLocaleString()} color={C.blue} />
                  <StatPill label="Vues" value={ga.views.toLocaleString()} />
                </div>
              ) : <div style={{ fontSize: 12, color: C.textLight }}>—</div>}
            </Section>
            <Section label="🤖 Bing AI">
              {bing ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <StatPill label="Citations" value={bing.geoMentions.toLocaleString()} color={C.purple} />
                  <StatPill label="Pages citées" value={bing.pageCount} color={C.teal} />
                </div>
              ) : <div style={{ fontSize: 12, color: C.textLight }}>—</div>}
            </Section>
          </div>
        </div>

        {/* Radar */}
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 20px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textMid, marginBottom: 4 }}>Profil SF — radar</div>
          <div style={{ fontSize: 11, color: C.textLight, marginBottom: 12 }}>Scores normalisés 0–100</div>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData}>
              <PolarGrid stroke={C.border} />
              <PolarAngleAxis dataKey="dim" tick={{ fill: C.textLight, fontSize: 10 }} />
              <Radar name={site.label} dataKey={site.id} stroke={site.color} fill={site.color} fillOpacity={0.1} strokeWidth={2} dot={{ r: 3 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── Layout 2 sites ───────────────────────────────────────────────

function SiteColumn({ site, sf, sfBase, gsc, ga, bing, pageTypes, templateFilter, setTemplateFilter, pageMode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ background: site.bg, border: `1.5px solid ${site.color}33`, borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: site.color }} />
        <div style={{ fontWeight: 700, fontSize: 16, color: site.color }}>{site.label}</div>
        {sf && <Badge color={site.color} bg={site.bg}>{sf.totalPages} pages</Badge>}
      </div>

      {/* Page types */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
        <PageTypeBadges siteId={site.id} pageTypes={pageTypes} templateFilter={templateFilter} setTemplateFilter={setTemplateFilter} />
      </div>

      {/* SF metrics — 2-col grid inside */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
        <Section label="🕷️ Screaming Frog">
          <SfMetrics sf={sf} sfBase={sfBase} pageMode={pageMode} />
        </Section>
      </div>

      {/* Schema + LLMS */}
      {sf && Object.keys(sf.schemaTypes || {}).length > 0 && (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
          <Section label="🏷️ Types de Schema">
            <SchemaBreakdown schemaTypes={sf.schemaTypes} color={site.color} />
          </Section>
        </div>
      )}
      {sf && (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
          <LlmsStatus sf={sf} />
        </div>
      )}

      {/* Sources */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        <Section label="🔍 GSC">
          {gsc ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <StatPill label="Clics" value={gsc.clicks.toLocaleString()} color={C.blue} />
              <StatPill label="Impressions" value={gsc.impressions.toLocaleString()} />
              <StatPill label="CTR" value={`${gsc.ctr}%`} color={C.green} />
              <StatPill label="Position" value={gsc.position} color={C.amber} />
            </div>
          ) : <div style={{ fontSize: 12, color: C.textLight }}>—</div>}
        </Section>
        <Section label="📊 GA4">
          {ga ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <StatPill label="Sessions" value={ga.sessions.toLocaleString()} color={C.blue} />
              <StatPill label="Vues" value={ga.views.toLocaleString()} />
            </div>
          ) : <div style={{ fontSize: 12, color: C.textLight }}>—</div>}
        </Section>
        <Section label="🤖 Bing AI">
          {bing ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <StatPill label="Citations" value={bing.geoMentions.toLocaleString()} color={C.purple} />
              <StatPill label="Pages citées" value={bing.pageCount} color={C.teal} />
            </div>
          ) : <div style={{ fontSize: 12, color: C.textLight }}>—</div>}
        </Section>
      </div>
    </div>
  );
}

function Layout2({ metrics, sites, pageTypes, templateFilter, setTemplateFilter, pageMode, radarSites, setRadarSites, radarData }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* 2 columns */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {metrics.map(({ site, sf, sfBase, gsc, ga, bing }) => (
          <SiteColumn key={site.id} site={site} sf={sf} sfBase={sfBase} gsc={gsc} ga={ga} bing={bing}
            pageTypes={pageTypes} templateFilter={templateFilter} setTemplateFilter={setTemplateFilter} pageMode={pageMode} />
        ))}
      </div>

      {/* Radar full width */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textMid }}>Profil technique SF — radar</div>
          <div style={{ display: "flex", gap: 8 }}>
            {sites.map(s => {
              const active = radarSites.includes(s.id);
              return (
                <button key={s.id} onClick={() => setRadarSites(prev =>
                  prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id]
                )} style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: `2px solid ${s.color}`,
                  background: active ? s.color : "transparent",
                  color: active ? "#fff" : s.color,
                  transition: "all 0.15s",
                }}>{s.label}</button>
              );
            })}
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.textLight, marginBottom: 16 }}>Scores normalisés 0–100</div>
        <ResponsiveContainer width="100%" height={300}>
          <RadarChart data={radarData}>
            <PolarGrid stroke={C.border} />
            <PolarAngleAxis dataKey="dim" tick={{ fill: C.textLight, fontSize: 11 }} />
            {sites.filter(s => radarSites.includes(s.id)).map(s => (
              <Radar key={s.id} name={s.label} dataKey={s.id} stroke={s.color} fill={s.color} fillOpacity={0.08} strokeWidth={2} dot={{ r: 3 }} />
            ))}
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Layout 3 sites (original) ─────────────────────────────────────

function Layout3({ metrics, sites, pageTypes, templateFilter, setTemplateFilter, pageMode, radarSites, setRadarSites, radarData }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0 20px", marginBottom: 28 }}>

        {metrics.map(({ site, sf }) => (
          <div key={site.id} style={{ background: site.bg, padding: "16px 20px", borderRadius: "14px 14px 0 0", border: `1px solid ${C.border}`, borderBottom: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: site.color }}>{site.label}</div>
            {sf && <Badge color={site.color} bg={site.bg}>{sf.totalPages} pages</Badge>}
          </div>
        ))}

        {sites.map(({ id: siteId }) => (
          <div key={siteId} style={{ background: C.white, border: `1px solid ${C.border}`, borderTop: "none", borderBottom: "none", padding: "10px 20px" }}>
            <PageTypeBadges siteId={siteId} pageTypes={pageTypes} templateFilter={templateFilter} setTemplateFilter={setTemplateFilter} />
          </div>
        ))}

        {metrics.map(({ site, sf, sfBase }) => (
          <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderTop: "none", borderBottom: "none", padding: "16px 20px" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 10 }}>🕷️ Screaming Frog</div>
            <SfMetrics sf={sf} sfBase={sfBase} pageMode={pageMode} />
          </div>
        ))}

        {metrics.map(({ site, sf }) => (
          <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderTop: "none", borderBottom: "none", padding: "0 20px 16px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            {sf && Object.keys(sf.schemaTypes || {}).length > 0 && (
              <>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>🏷️ Types de Schema</div>
                <SchemaBreakdown schemaTypes={sf.schemaTypes} color={site.color} />
              </>
            )}
            {sf && <LlmsStatus sf={sf} />}
          </div>
        ))}

        {metrics.map(({ site, gsc }) => (
          <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderTop: "none", borderBottom: "none", padding: "16px 20px" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>🔍 GSC</div>
            {gsc ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <StatPill label="Clics" value={gsc.clicks.toLocaleString()} color={C.blue} />
                <StatPill label="Impressions" value={gsc.impressions.toLocaleString()} />
                <StatPill label="CTR" value={`${gsc.ctr}%`} color={C.green} />
                <StatPill label="Position" value={gsc.position} color={C.amber} />
              </div>
            ) : <div style={{ fontSize: 12, color: C.textLight }}>—</div>}
          </div>
        ))}

        {metrics.map(({ site, ga }) => (
          <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderTop: "none", borderBottom: "none", padding: "16px 20px" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>📊 GA4</div>
            {ga ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <StatPill label="Sessions" value={ga.sessions.toLocaleString()} color={C.blue} />
                <StatPill label="Vues" value={ga.views.toLocaleString()} />
              </div>
            ) : <div style={{ fontSize: 12, color: C.textLight }}>—</div>}
          </div>
        ))}

        {metrics.map(({ site, bing }) => (
          <div key={site.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 14px 14px", padding: "16px 20px" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: C.textLight, marginBottom: 8 }}>🤖 Bing AI</div>
            {bing ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <StatPill label="Citations" value={bing.geoMentions.toLocaleString()} color={C.purple} />
                <StatPill label="Pages citées" value={bing.pageCount} color={C.teal} />
              </div>
            ) : <div style={{ fontSize: 12, color: C.textLight }}>—</div>}
          </div>
        ))}
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textMid }}>Profil technique SF — radar</div>
          <div style={{ display: "flex", gap: 8 }}>
            {sites.map(s => {
              const active = radarSites.includes(s.id);
              return (
                <button key={s.id} onClick={() => setRadarSites(prev =>
                  prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id]
                )} style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: `2px solid ${s.color}`,
                  background: active ? s.color : "transparent",
                  color: active ? "#fff" : s.color,
                  transition: "all 0.15s",
                }}>{s.label}</button>
              );
            })}
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.textLight, marginBottom: 16 }}>Scores normalisés 0–100</div>
        <ResponsiveContainer width="100%" height={300}>
          <RadarChart data={radarData}>
            <PolarGrid stroke={C.border} />
            <PolarAngleAxis dataKey="dim" tick={{ fill: C.textLight, fontSize: 11 }} />
            {sites.filter(s => radarSites.includes(s.id)).map(s => (
              <Radar key={s.id} name={s.label} dataKey={s.id} stroke={s.color} fill={s.color} fillOpacity={0.08} strokeWidth={2} dot={{ r: 3 }} />
            ))}
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────

export default function OverviewTab({ sites, pageMode, setPageMode, radarSites, setRadarSites, metrics, radarData, pageTypes, templateFilter, setTemplateFilter }) {
  const n = sites.length;
  const sharedProps = { metrics, sites, pageTypes, templateFilter, setTemplateFilter, pageMode, radarSites, setRadarSites, radarData };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 12 }}>
        <SectionHeader title="Vue d'ensemble" sub={n === 1 ? "Analyse complète du site" : `Comparaison de ${n} sites`} />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <InfoCard tabKey="overview" />
          <PageModeSelector value={pageMode} onChange={setPageMode} pageTypes={pageTypes} sites={sites} templateFilter={templateFilter} setTemplateFilter={setTemplateFilter} />
        </div>
      </div>

      {n === 1 && <Layout1 {...sharedProps} />}
      {n === 2 && <Layout2 {...sharedProps} />}
      {n >= 3 && <Layout3 {...sharedProps} />}
    </div>
  );
}