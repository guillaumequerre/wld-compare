import { useState, useEffect, useMemo, Fragment } from "react";
import { authAdminListUsers } from "../lib/auth";
import { sbGetActivitySummary, sbGetActivityByProject } from "../lib/supabase";

const C = {
  green: "#1A3C2E", greenLight: "#EAF0EC", cream: "#F0EBE0",
  border: "#E3E0D8", text: "#2B2B2B", textLight: "#8A8A82", blue: "#2563EB",
};

// minutes → "2h 05m" / "45m" / "—"
function fmtDuration(min) {
  const m = Number(min) || 0;
  if (m <= 0) return "—";
  const h = Math.floor(m / 60), r = m % 60;
  if (h === 0) return `${r}m`;
  return `${h}h ${String(r).padStart(2, "0")}m`;
}

function fmtDate(iso) {
  if (!iso) return "Jamais";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function relativeDays(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 30) return `il y a ${days}j`;
  const months = Math.floor(days / 30);
  return `il y a ${months} mois`;
}

export default function ConnectionsTab({ projects = [] }) {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [authUsers, setAuthUsers]   = useState([]);   // [{email, last_sign_in_at, created_at}]
  const [summary, setSummary]       = useState([]);   // [{user_email, last_usage, m7..mall}]
  const [byProject, setByProject]   = useState([]);   // [{user_email, project_id, m30, mall}]
  const [expanded, setExpanded]     = useState(null); // email déplié
  const [period, setPeriod]         = useState("m30"); // période sélectionnée

  const PERIODS = [
    { key: "m7",   label: "7 derniers jours"  },
    { key: "m30",  label: "30 derniers jours" },
    { key: "m90",  label: "3 derniers mois"   },
    { key: "m180", label: "6 derniers mois"   },
    { key: "m365", label: "12 derniers mois"  },
    { key: "mall", label: "Tout l'historique" },
  ];
  const periodLabel = PERIODS.find(p => p.key === period)?.label || "période";

  const projName = useMemo(() => {
    const map = {};
    (projects || []).forEach(p => { map[p.id] = p.name || p.id; });
    return map;
  }, [projects]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError("");
      try {
        const [u, s, bp] = await Promise.all([
          authAdminListUsers(),
          sbGetActivitySummary(),
          sbGetActivityByProject(),
        ]);
        if (!alive) return;
        setAuthUsers(Array.isArray(u) ? u : []);
        setSummary(Array.isArray(s) ? s : []);
        setByProject(Array.isArray(bp) ? bp : []);
        if ((!u || !u.length) && (!s || !s.length)) {
          setError("Aucune donnée disponible. Vérifiez que la migration user_activity a été exécutée.");
        }
      } catch (e) {
        if (alive) setError("Erreur de chargement : " + (e.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Fusion par email : auth (dernière connexion) + activité (usage)
  const rows = useMemo(() => {
    const byEmail = {};
    authUsers.forEach(u => {
      const e = (u.email || "").toLowerCase();
      if (!e) return;
      byEmail[e] = { email: e, last_sign_in_at: u.last_sign_in_at, created_at: u.created_at, last_usage: null, m7: 0, m30: 0, m90: 0, m180: 0, m365: 0, mall: 0 };
    });
    summary.forEach(s => {
      const e = (s.user_email || "").toLowerCase();
      if (!e) return;
      if (!byEmail[e]) byEmail[e] = { email: e, last_sign_in_at: null, created_at: null };
      Object.assign(byEmail[e], {
        last_usage: s.last_usage,
        m7: Number(s.m7) || 0, m30: Number(s.m30) || 0, m90: Number(s.m90) || 0,
        m180: Number(s.m180) || 0, m365: Number(s.m365) || 0, mall: Number(s.mall) || 0,
      });
    });
    return Object.values(byEmail).sort((a, b) => {
      const ta = a.last_usage ? new Date(a.last_usage).getTime() : (a.last_sign_in_at ? new Date(a.last_sign_in_at).getTime() : 0);
      const tb = b.last_usage ? new Date(b.last_usage).getTime() : (b.last_sign_in_at ? new Date(b.last_sign_in_at).getTime() : 0);
      return tb - ta;
    });
  }, [authUsers, summary]);

  const projectsFor = (email) =>
    byProject
      .filter(p => (p.user_email || "").toLowerCase() === email)
      .sort((a, b) => (Number(b.mall) || 0) - (Number(a.mall) || 0));

  const th = { textAlign: "left", padding: "9px 10px", fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `2px solid ${C.border}`, whiteSpace: "nowrap" };
  const td = { padding: "9px 10px", fontSize: 13, color: C.text, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "8px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: C.green, margin: 0 }}>🔐 Suivi des connexions</h2>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.green, background: C.greenLight, padding: "2px 9px", borderRadius: 999 }}>Super admin</span>
      </div>
      <p style={{ fontSize: 12, color: C.textLight, marginTop: 0, marginBottom: 16 }}>
        Le temps d'usage est estimé à partir de l'activité réelle (battement toutes les 60 s tant que l'onglet est actif), comptabilisé depuis la mise en place du suivi.
      </p>

      {loading && <div style={{ padding: 30, textAlign: "center", color: C.textLight }}>Chargement…</div>}
      {!loading && error && <div style={{ padding: 14, background: "#FEF2F2", color: "#B91C1C", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      {!loading && !error && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.green }}>Période suivie :</label>
            <select
              value={period}
              onChange={e => setPeriod(e.target.value)}
              style={{ fontSize: 13, padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 8, background: "#fff", color: C.text, cursor: "pointer" }}>
              {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <span style={{ fontSize: 11, color: C.textLight }}>— temps passé sur l'outil sur la période choisie</span>
          </div>

          <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 12, background: "#fff" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={th}>Utilisateur</th>
                  <th style={th}>Dernière connexion</th>
                  <th style={th}>Dernier usage</th>
                  <th style={{ ...th, textAlign: "right" }}>Temps passé ({periodLabel})</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={4} style={{ ...td, textAlign: "center", color: C.textLight }}>Aucun utilisateur.</td></tr>
                )}
                {rows.map(r => {
                  const projRows = projectsFor(r.email);
                  const isOpen = expanded === r.email;
                  return (
                    <Fragment key={r.email}>
                      <tr style={{ cursor: projRows.length ? "pointer" : "default" }}
                          onClick={() => projRows.length && setExpanded(isOpen ? null : r.email)}>
                        <td style={{ ...td, fontWeight: 600 }}>
                          {projRows.length > 0 && <span style={{ color: C.textLight, marginRight: 6, fontSize: 10 }}>{isOpen ? "▼" : "▶"}</span>}
                          {r.email}
                        </td>
                        <td style={td}>
                          {fmtDate(r.last_sign_in_at)}
                          {r.last_sign_in_at && <span style={{ color: C.textLight, fontSize: 11, marginLeft: 6 }}>({relativeDays(r.last_sign_in_at)})</span>}
                        </td>
                        <td style={td}>
                          {r.last_usage ? fmtDate(r.last_usage) : "—"}
                          {r.last_usage && <span style={{ color: C.textLight, fontSize: 11, marginLeft: 6 }}>({relativeDays(r.last_usage)})</span>}
                        </td>
                        <td style={{ ...tdNum, fontWeight: 700 }}>{fmtDuration(r[period])}</td>
                      </tr>
                      {isOpen && projRows.map(p => (
                        <tr key={r.email + "|" + p.project_id} style={{ background: C.greenLight }}>
                          <td style={{ ...td, paddingLeft: 30, fontSize: 12, color: C.textLight }}>↳ {projName[p.project_id] || p.project_id}</td>
                          <td style={td}></td>
                          <td style={td}></td>
                          <td style={{ ...tdNum, fontSize: 12, fontWeight: 600 }}>{fmtDuration(p[period])}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}