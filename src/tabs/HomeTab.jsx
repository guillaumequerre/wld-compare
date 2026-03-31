import { useState } from "react";
import { C } from "../lib/constants";
import { authLogin, authSignup, isSuperAdmin } from "../lib/auth";

// ── Feature card ──────────────────────────────────────────────────
function FeatureCard({ icon, title, description, color }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "24px 28px", borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: 28, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: C.textLight, lineHeight: 1.7 }}>{description}</div>
    </div>
  );
}

// ── Login / Signup form ──────────────────────────────────────────
function LoginForm({ onLogin }) {
  const [mode, setMode]         = useState("login"); // "login" | "signup"
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
    if (mode === "signup" && password !== confirm) {
      setError("Les mots de passe ne correspondent pas"); return;
    }
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères"); return;
    }
    setLoading(true);
    try {
      if (mode === "login") {
        const user = await authLogin(email.trim(), password, remember);
        onLogin(user);
      } else {
        const user = await authSignup(email.trim(), password);
        if (user) {
          onLogin(user);
        } else {
          setSuccess("Compte créé ! Vérifiez votre email pour confirmer votre compte, puis connectez-vous.");
          setMode("login"); setPassword(""); setConfirm("");
        }
      }
    } catch(err) {
      setError(err.message);
    } finally { setLoading(false); }
  };

  const isLogin = mode === "login";

  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "28px 32px", maxWidth: 400 }}>
      {/* Mode toggle */}
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

      {error && (
        <div style={{ background: "#FEF2F2", border: "1px solid #DC262633", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#DC2626", marginBottom: 14 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: "#ECFDF5", border: "1px solid #05966633", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#059669", marginBottom: 14 }}>
          {success}
        </div>
      )}

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
            border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer", marginTop: 4 }}>
          {loading ? (isLogin ? "Connexion…" : "Création…") : (isLogin ? "Se connecter" : "Créer mon compte")}
        </button>
      </form>
    </div>
  );
}

// ── Connected widget ──────────────────────────────────────────────
function ConnectedWidget({ user, projects, currentProjectId, onSelectProject, onCreateProject, onLogout }) {
  const lastProject = projects.find(p => p.id === currentProjectId) || projects[0];
  const isAdmin = isSuperAdmin(user);

  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "28px 32px", maxWidth: 480 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>
            👋 Bonjour{user?.email ? `, ${user.email.split("@")[0]}` : ""} !
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

      {lastProject ? (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>Reprendre</div>
          <button onClick={() => onSelectProject(lastProject.id)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "#F5F3FF", border: "2px solid #7C3AED33", borderRadius: 10, cursor: "pointer", textAlign: "left" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#7C3AED" }}>{lastProject.name}</div>
              <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>
                {lastProject.sites?.length} site{lastProject.sites?.length > 1 ? "s" : ""}
                {lastProject.updated_at && ` · modifié ${new Date(lastProject.updated_at).toLocaleDateString("fr-FR")}`}
              </div>
            </div>
            <span style={{ fontSize: 18, color: "#7C3AED" }}>→</span>
          </button>

          {projects.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>Autres projets</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
                {projects.filter(p => p.id !== lastProject.id).map(p => (
                  <button key={p.id} onClick={() => onSelectProject(p.id)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{p.name}</span>
                    <span style={{ fontSize: 10, color: C.textLight }}>→</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {projects.length < 20 && (
            <button onClick={onCreateProject}
              style={{ marginTop: 12, width: "100%", padding: "8px", border: `2px dashed ${C.border}`, borderRadius: 9, background: "transparent", color: C.textLight, fontSize: 12, cursor: "pointer" }}>
              + Nouveau projet
            </button>
          )}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 12, color: C.textLight, marginBottom: 12 }}>Aucun projet disponible</div>
          <button onClick={onCreateProject}
            style={{ padding: "10px 20px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            + Créer mon premier projet
          </button>
        </div>
      )}
    </div>
  );
}

// ── HomeTab ───────────────────────────────────────────────────────
export default function HomeTab({ user, projects, currentProjectId, onLogin, onLogout, onSelectProject, onCreateProject }) {
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>

      {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>CorrelDash GEO</div>
        <h1 style={{ fontSize: 36, fontWeight: 900, color: C.text, margin: "0 0 14px", lineHeight: 1.2 }}>
          Pilotez votre visibilité<br />dans les moteurs d'IA
        </h1>
        <p style={{ fontSize: 15, color: C.textLight, maxWidth: 560, margin: "0 auto", lineHeight: 1.7 }}>
          Monitorez vos présences GEO, générez des audits prêts à livrer
          et comprenez les critères qui font la différence dans les réponses des LLM.
        </p>
      </div>

      {/* Feature cards — horizontal */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginBottom: 48 }}>
        <FeatureCard
          icon="📡"
          title="Monitoring GEO en temps réel"
          description="Suivez la présence de votre marque dans les réponses d'OpenAI, Gemini, Perplexity et Claude. Historique 30 jours, alertes de présence, analyse par provider."
          color="#7C3AED"
        />
        <FeatureCard
          icon="📋"
          title="Audits GEO prêts à livrer"
          description="Générez en un clic un rapport d'audit complet : état des lieux, analyse concurrentielle, URLs à optimiser, recommandations actionnables et plan d'action priorisé."
          color="#2563EB"
        />
        <FeatureCard
          icon="🔬"
          title="Analyse des critères GEO"
          description="Comprenez quelles pages, structures et contenus favorisent la citation par les IA. Croisement SEO × GEO, analyse des sources citées, patterns des concurrents."
          color="#059669"
        />
      </div>

      {/* Auth widget — centered */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 48 }}>
        <div style={{ width: "100%", maxWidth: 480 }}>
          {user ? (
            <ConnectedWidget
              user={user}
              projects={projects}
              currentProjectId={currentProjectId}
              onSelectProject={onSelectProject}
              onCreateProject={onCreateProject}
              onLogout={onLogout}
            />
          ) : (
            <LoginForm onLogin={onLogin} />
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", paddingTop: 24, borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 11, color: C.textLight }}>
          CorrelDash · GEO Intelligence Platform · par <a href="mailto:guillaume@deux.io" style={{ color: "#7C3AED" }}>deux.io</a>
        </div>
      </div>
    </div>
  );
}