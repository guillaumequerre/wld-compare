import { C, PAGE_TYPES } from "../lib/constants";

/**
 * Barre sticky sous la nav principale.
 * Affiche les types de pages disponibles (non vide) + un filtre "Tous".
 * N'affiche rien si aucune classification n'a été faite.
 */
export default function TemplateFilterBar({ pageTypes, templateFilter, setTemplateFilter, sites }) {
  // Agrège tous les types de toutes les données de tous les sites
  const allTypes = {};
  sites.forEach(s => {
    Object.values(pageTypes[s.id] || {}).forEach(type => {
      allTypes[type] = (allTypes[type] || 0) + 1;
    });
  });

  const hasAny = Object.keys(allTypes).length > 0;
  if (!hasAny) return null;

  const total = Object.values(allTypes).reduce((s, n) => s + n, 0);

  return (
    <div style={{
      background: "#FAFBFF",
      borderBottom: `1px solid ${C.border}`,
      position: "sticky",
      top: 56,
      zIndex: 90,
    }}>
      <div style={{
        maxWidth: 1400,
        margin: "0 auto",
        padding: "0 28px",
        height: 44,
        display: "flex",
        alignItems: "center",
        gap: 6,
        overflowX: "auto",
      }}>
        <span style={{ fontSize: 11, color: C.textLight, fontWeight: 600, whiteSpace: "nowrap", marginRight: 4 }}>
          🏷️ Type :
        </span>

        {/* "Tous" button */}
        <button
          onClick={() => setTemplateFilter(null)}
          style={{
            padding: "3px 12px",
            borderRadius: 20,
            border: `1.5px solid ${templateFilter === null ? C.blue : C.border}`,
            background: templateFilter === null ? C.blueLight : C.white,
            color: templateFilter === null ? C.blue : C.textMid,
            fontSize: 11,
            fontWeight: templateFilter === null ? 700 : 400,
            cursor: "pointer",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          Tous
          <span style={{
            fontSize: 10,
            background: templateFilter === null ? C.blue : C.border,
            color: templateFilter === null ? "#fff" : C.textLight,
            borderRadius: 10,
            padding: "1px 6px",
          }}>
            {total}
          </span>
        </button>

        {/* One button per type that has pages */}
        {PAGE_TYPES.filter(t => allTypes[t.key] > 0).map(t => {
          const active = templateFilter === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTemplateFilter(active ? null : t.key)}
              style={{
                padding: "3px 12px",
                borderRadius: 20,
                border: `1.5px solid ${active ? t.color : C.border}`,
                background: active ? t.bg : C.white,
                color: active ? t.color : C.textMid,
                fontSize: 11,
                fontWeight: active ? 700 : 400,
                cursor: "pointer",
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                gap: 5,
                transition: "all 0.12s",
              }}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              <span style={{
                fontSize: 10,
                background: active ? t.color : "#E2E8F0",
                color: active ? "#fff" : C.textLight,
                borderRadius: 10,
                padding: "1px 6px",
              }}>
                {allTypes[t.key]}
              </span>
            </button>
          );
        })}

        {templateFilter && (
          <span style={{
            fontSize: 11,
            color: C.textLight,
            fontStyle: "italic",
            marginLeft: 8,
            whiteSpace: "nowrap",
          }}>
            — filtre actif sur tous les onglets
          </span>
        )}
      </div>
    </div>
  );
}