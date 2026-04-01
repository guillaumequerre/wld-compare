import { useState } from "react";
import { C } from "../lib/constants";
import { authLogin, authSignup, isSuperAdmin } from "../lib/auth";

// ── Login / Signup form ──────────────────────────────────────────
function LoginForm({ onLogin }) {
  const [mode, setMode]         = useState("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (mode === "signup" && password !== confirm) { setError("Les mots de passe ne correspondent pas"); return; }
    if (password.length < 8) { setError("Le mot de passe doit contenir au moins 8 caractères"); return; }
    setLoading(true);
    try {
      if (mode === "login") {
        const user = await authLogin(email.trim(), password, remember);
        onLogin(user);
      } else {
        const user = await authSignup(email.trim(), password);
        if (user) { onLogin(user); }
        else { setSuccess("Compte créé ! Vérifiez votre email puis connectez-vous."); setMode("login"); setPassword(""); setConfirm(""); }
      }
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const isLogin = mode === "login";

  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "28px 32px" }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 6 }}>
        {isLogin ? "Connexion" : "Créer un compte"}
      </div>
      <div style={{ fontSize: 12, color: C.textLight, marginBottom: 20 }}>
        Accédez à votre espace GEO Intelligence
      </div>

      <div style={{ display: "flex", background: C.bg, borderRadius: 10, padding: 3, marginBottom: 20, gap: 3 }}>
        {[{key:"login",label:"Se connecter"},{key:"signup",label:"Créer un compte"}].map(m => (
          <button key={m.key} onClick={() => { setMode(m.key); setError(""); setSuccess(""); }}
            style={{ flex: 1, padding: "7px", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
              background: mode === m.key ? "#fff" : "transparent",
              color: mode === m.key ? "#7C3AED" : C.textLight,
              boxShadow: mode === m.key ? "0 1px 4px rgba(0,0,0,0.08)" : "none" }}>
            {m.label}
          </button>
        ))}
      </div>

      {error && <div style={{ background: "#FEF2F2", border: "1px solid #DC262633", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#DC2626", marginBottom: 14 }}>{error}</div>}
      {success && <div style={{ background: "#ECFDF5", border: "1px solid #05966633", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#059669", marginBottom: 14 }}>{success}</div>}

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
          placeholder="adresse@email.com"
          style={{ padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 9, fontSize: 13, color: C.text }} />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
          placeholder="Mot de passe (8 caractères min.)"
          style={{ padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 9, fontSize: 13, color: C.text }} />
        {!isLogin && (
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
            placeholder="Confirmer le mot de passe"
            style={{ padding: "9px 12px", border: `1px solid ${confirm && confirm !== password ? "#DC2626" : C.border}`, borderRadius: 9, fontSize: 13, color: C.text }} />
        )}
        {isLogin && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textLight, cursor: "pointer" }}>
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            Se souvenir de moi
          </label>
        )}
        <button type="submit" disabled={loading || !email || !password || (!isLogin && !confirm)}
          style={{ padding: "10px", background: loading ? C.bg : "#7C3AED", color: loading ? C.textLight : "#fff",
            border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", marginTop: 4 }}>
          {loading ? (isLogin ? "Connexion…" : "Création…") : (isLogin ? "Se connecter" : "Créer mon compte")}
        </button>
      </form>
    </div>
  );
}

// ── Benefits (non connecté) ───────────────────────────────────────
function BenefitsColumn() {
  const benefits = [
    {
      icon: "📡",
      title: "Monitoring GEO en temps réel",
      points: ["Présence marque dans OpenAI, Gemini, Perplexity et Claude", "Historique 30 jours et tendances de présence", "Analyse par provider et par question"],
      color: "#7C3AED",
    },
    {
      icon: "📋",
      title: "Audits GEO prêts à livrer",
      points: ["Analyse concurrentielle des sources citées", "URLs à optimiser et pages à créer", "Recommandations actionnables priorisées ICE"],
      color: "#2563EB",
    },
    {
      icon: "🔬",
      title: "Analyse SEO × GEO",
      points: ["Corrélations techniques SF × citations LLM", "Croisement Bing AI × présence Fan-outs", "Roadmaps par site avec quick wins"],
      color: "#059669",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", textTransform: "uppercase", letterSpacing: 2, marginBottom: 10 }}>CorrelDash GEO</div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: C.text, margin: "0 0 8px", lineHeight: 1.2 }}>
          Pilotez votre visibilité<br />dans les moteurs d'IA
        </h1>
      </div>
      {benefits.map(b => (
        <div key={b.title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: b.color + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
            {b.icon}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 6 }}>{b.title}</div>
            <ul style={{ margin: 0, padding: "0 0 0 14px", display: "flex", flexDirection: "column", gap: 3 }}>
              {b.points.map((p, i) => (
                <li key={i} style={{ fontSize: 12, color: C.textMid, lineHeight: 1.5 }}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Setup steps (connecté) ────────────────────────────────────────
function SetupSteps({ onGoSetup, onGoFanout, onGoAudit }) {
  const steps = [
    {
      num: 1,
      icon: "📁",
      title: "Importer les données externes",
      desc: "Importez vos exports SF, GSC, GA4, Bing Webmaster et Semrush dans ⚙️ Setup.",
      action: "Setup →",
      onClick: onGoSetup,
    },
    {
      num: 2,
      icon: "🔑",
      title: "Clé API Claude",
      desc: "Pour les Hints GEO. Renseignez-la dans Fan-outs > Gestion des Providers.",
      link: { label: "platform.claude.com", url: "https://platform.claude.com/settings/keys" },
      action: "Fan-outs →",
      onClick: onGoFanout,
    },
    {
      num: 3,
      icon: "🤖",
      title: "Clés API LLM",
      desc: "Au moins un provider pour interroger les LLMs.",
      providers: [
        { name: "OpenAI", url: "https://platform.openai.com/api-keys" },
        { name: "Perplexity", url: "https://www.perplexity.ai/settings/api" },
        { name: "Gemini", url: "https://aistudio.google.com/app/apikey" },
      ],
      action: "Fan-outs →",
      onClick: onGoFanout,
    },
    {
      num: 4,
      icon: "🚀",
      title: "Lancer les Fan-outs",
      desc: "Ajoutez vos mots-clés, générez les questions et lancez les interrogations LLM.",
      action: "Fan-outs →",
      onClick: onGoFanout,
    },
    {
      num: 5,
      icon: "📋",
      title: "Audit GEO",
      desc: "Générez votre audit complet avec recommandations actionnables.",
      action: "Audit →",
      onClick: onGoAudit,
    },
  ];

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>🎯 Setup complet</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map(s => (
          <div key={s.num} style={{ background: C.white, borderRadius: 10, padding: "11px 14px", border: `1px solid ${C.border}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: C.bg, border: `1px solid ${C.border}`, color: C.textMid, fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{s.num}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 2 }}>{s.icon} {s.title}</div>
              <div style={{ fontSize: 11, color: C.textLight, lineHeight: 1.5 }}>{s.desc}</div>
              {s.link && (
                <a href={s.link.url} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 11, color: "#7C3AED", fontWeight: 600, display: "inline-block", marginTop: 3 }}>
                  🔗 {s.link.label}
                </a>
              )}
              {s.providers && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 }}>
                  {s.providers.map(p => (
                    <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 10, fontWeight: 600, color: C.textMid, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, padding: "2px 7px", textDecoration: "none" }}>
                      {p.name} ↗
                    </a>
                  ))}
                </div>
              )}
            </div>
            {s.action && s.onClick && (
              <button onClick={s.onClick}
                style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED", background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 6, padding: "3px 9px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                {s.action}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Projects list ─────────────────────────────────────────────────
function ProjectsList({ user, projects, currentProjectId, dbLoading, onSelectProject, onCreateProject, onLogout }) {
  const isAdmin = isSuperAdmin(user);
  const lastProject = projects.find(p => p.id === currentProjectId) || projects[0];
  const displayName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "";

  return (
    <div>
      {/* User header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${C.border}` }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>
            👋 Bonjour{displayName ? `, ${displayName}` : ""} !
          </div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>
            {user?.email}
            {isAdmin && <span style={{ marginLeft: 6, fontSize: 9, background: "#F5F3FF", color: "#7C3AED", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>SUPER ADMIN</span>}
          </div>
        </div>
        <button onClick={onLogout}
          style={{ fontSize: 11, color: C.textLight, background: "none", border: `1px solid ${C.border}`, borderRadius: 7, padding: "4px 10px", cursor: "pointer" }}>
          Déconnexion
        </button>
      </div>

      {/* Projects */}
      {dbLoading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 0", color: C.textLight, fontSize: 12 }}>
          <span style={{ display: "inline-block", animation: "spin 1s linear infinite", fontSize: 16 }}>⟳</span>
          Projets en chargement…
        </div>
      ) : lastProject ? (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>Reprendre</div>
          <button onClick={() => onSelectProject(lastProject.id)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "#F5F3FF", border: "2px solid #7C3AED33", borderRadius: 10, cursor: "pointer", textAlign: "left", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#7C3AED" }}>{lastProject.name}</div>
              <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>
                {lastProject.sites?.length} site{lastProject.sites?.length !== 1 ? "s" : ""}
                {lastProject.updated_at && ` · modifié ${new Date(lastProject.updated_at).toLocaleDateString("fr-FR")}`}
              </div>
            </div>
            <span style={{ fontSize: 18, color: "#7C3AED" }}>→</span>
          </button>
          {projects.length > 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 140, overflowY: "auto", marginBottom: 10 }}>
              {projects.filter(p => p.id !== lastProject.id).map(p => (
                <button key={p.id} onClick={() => onSelectProject(p.id)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", textAlign: "left" }}>
                  <span style={{ fontSize: 12, color: C.text }}>{p.name}</span>
                  <span style={{ fontSize: 10, color: C.textLight }}>→</span>
                </button>
              ))}
            </div>
          )}
          {projects.length < 20 && (
            <button onClick={onCreateProject}
              style={{ width: "100%", padding: "7px", border: `2px dashed ${C.border}`, borderRadius: 9, background: "transparent", color: C.textLight, fontSize: 12, cursor: "pointer" }}>
              + Nouveau projet
            </button>
          )}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div style={{ fontSize: 12, color: C.textLight, marginBottom: 12 }}>Aucun projet</div>
          <button onClick={onCreateProject}
            style={{ padding: "9px 20px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            + Créer mon premier projet
          </button>
        </div>
      )}
    </div>
  );
}

// ── HomeTab ───────────────────────────────────────────────────────
export default function HomeTab({ user, projects, currentProjectId, dbLoading, onLogin, onLogout, onSelectProject, onCreateProject, onGoSetup, onGoFanout, onGoAudit }) {
  return (
    <div style={{ maxWidth: 1060, margin: "0 auto", padding: "40px 24px" }}>

      {/* 2-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "flex-start" }}>

        {/* Left: benefits → setup steps */}
        <div>
          {!user ? (
            <BenefitsColumn />
          ) : (
            <SetupSteps onGoSetup={onGoSetup} onGoFanout={onGoFanout} onGoAudit={onGoAudit} />
          )}
        </div>

        {/* Right: login form OR connected widget */}
        <div>
          {!user ? (
            <LoginForm onLogin={onLogin} />
          ) : (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "24px 28px" }}>
              <ProjectsList
                user={user}
                projects={projects}
                currentProjectId={currentProjectId}
                dbLoading={dbLoading}
                onSelectProject={onSelectProject}
                onCreateProject={onCreateProject}
                onLogout={onLogout}
              />
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", paddingTop: 32, marginTop: 48, borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 11, color: C.textLight }}>
          CorrelDash · GEO Intelligence Platform · par <a href="mailto:guillaume@deux.io" style={{ color: "#7C3AED" }}>deux.io</a>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}