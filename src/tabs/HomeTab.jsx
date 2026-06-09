import { useState, useEffect } from "react";
import { C } from "../lib/constants";
import { authLogin, authSignup, authForgotPassword, isSuperAdmin } from "../lib/auth";
import TutorialModal from "./TutorialModal";

const PURPLE = "#1A3C2E";
const PURPLE_LIGHT = "#EAF0EC";
const PURPLE_BORDER = "#B2CCBC";

// ── Forgot Password Modal ─────────────────────────────────────────
function ForgotPasswordModal({ onClose }) {
  const [email, setEmail]   = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | sent | error
  const [error, setError]   = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");
    setError("");
    try {
      await authForgotPassword(email.trim());
      setStatus("sent");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.40)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div style={{
        background: "#fff", borderRadius: 16, padding: "32px 36px",
        width: "100%", maxWidth: 420,
        boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
        position: "relative",
      }}>
        {/* Close */}
        <button onClick={onClose} style={{
          position: "absolute", top: 14, right: 14,
          background: "none", border: "none", fontSize: 18,
          cursor: "pointer", color: "#94A3B8", lineHeight: 1,
        }}>✕</button>

        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 6 }}>🔑 Mot de passe oublié</div>
        <div style={{ fontSize: 12, color: C.textLight, lineHeight: 1.6, marginBottom: 22 }}>
          Entrez votre email. Si un compte existe, vous recevrez un lien de réinitialisation.
        </div>

        {status === "sent" ? (
          <div style={{ background: "#ECFDF5", border: "1px solid #BBF7D0", borderRadius: 10, padding: "20px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📧</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#065F46", marginBottom: 6 }}>Email envoyé !</div>
            <div style={{ fontSize: 12, color: "#047857", lineHeight: 1.6, marginBottom: 16 }}>
              Si <strong>{email}</strong> correspond à un compte, vous recevrez le lien sous peu. Vérifiez vos spams.
            </div>
            <button onClick={onClose} style={{
              padding: "9px 22px", background: "#059669", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}>Fermer</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="votre@email.com" autoFocus required
              style={{
                padding: "10px 14px", border: `1.5px solid ${C.border}`,
                borderRadius: 9, fontSize: 13, color: C.text, outline: "none",
              }}
              onFocus={e => e.target.style.borderColor = PURPLE}
              onBlur={e => e.target.style.borderColor = C.border}
            />
            {error && (
              <div style={{ background: "#FEF2F2", border: "1px solid #DC262633", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#DC2626" }}>
                {error}
              </div>
            )}
            <button type="submit" disabled={status === "loading" || !email.trim()}
              style={{
                padding: "10px", background: status === "loading" ? C.bg : PURPLE,
                color: status === "loading" ? C.textLight : "#fff",
                border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700,
                cursor: status === "loading" ? "not-allowed" : "pointer",
                boxShadow: status === "loading" ? "none" : `0 2px 8px ${PURPLE}44`,
              }}>
              {status === "loading" ? "⏳ Envoi…" : "Envoyer le lien de réinitialisation"}
            </button>
            <button type="button" onClick={onClose}
              style={{
                padding: "9px", background: "transparent", color: C.textLight,
                border: `1px solid ${C.border}`, borderRadius: 9, fontSize: 12, cursor: "pointer",
              }}>
              Annuler
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Login / Signup form ──────────────────────────────────────────
function LoginForm({ onLogin }) {
  const [mode, setMode]           = useState("login");
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [remember, setRemember]   = useState(true);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [success, setSuccess]     = useState("");
  const [showForgot, setShowForgot] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (mode === "signup" && password !== confirm) { setError("Les mots de passe ne correspondent pas"); return; }
    if (password.length < 8) { setError("Minimum 8 caractères"); return; }
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
    <>
      {/* Modale mot de passe oublié */}
      {showForgot && <ForgotPasswordModal onClose={() => setShowForgot(false)} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Tab toggle */}
        <div style={{ display: "flex", background: C.bg, borderRadius: 10, padding: 3, gap: 3 }}>
          {[{key:"login",label:"Se connecter"},{key:"signup",label:"Créer un compte"}].map(m => (
            <button key={m.key} onClick={() => { setMode(m.key); setError(""); setSuccess(""); }}
              style={{
                flex: 1, padding: "8px", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: mode === m.key ? "#fff" : "transparent",
                color: mode === m.key ? PURPLE : C.textLight,
                boxShadow: mode === m.key ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.15s",
              }}>
              {m.label}
            </button>
          ))}
        </div>

        {error   && <div style={{ background: "#FEF2F2", border: "1px solid #DC262633", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#DC2626" }}>{error}</div>}
        {success && <div style={{ background: "#ECFDF5", border: "1px solid #05966633", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#059669" }}>{success}</div>}

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            placeholder="adresse@email.com"
            style={{ padding: "10px 14px", border: `1.5px solid ${C.border}`, borderRadius: 9, fontSize: 13, color: C.text, outline: "none" }} />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
            placeholder="Mot de passe (8 caractères min.)"
            style={{ padding: "10px 14px", border: `1.5px solid ${C.border}`, borderRadius: 9, fontSize: 13, color: C.text }} />
          {!isLogin && (
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
              placeholder="Confirmer le mot de passe"
              style={{ padding: "10px 14px", border: `1.5px solid ${confirm && confirm !== password ? "#DC2626" : C.border}`, borderRadius: 9, fontSize: 13, color: C.text }} />
          )}
          {isLogin && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textLight, cursor: "pointer" }}>
                <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
                Se souvenir de moi
              </label>
              {/* ── Lien "Mot de passe oublié" ── */}
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 11, color: PURPLE, fontWeight: 600,
                  textDecoration: "underline", padding: 0,
                }}
              >
                Mot de passe oublié ?
              </button>
            </div>
          )}
          <button type="submit" disabled={loading || !email || !password || (!isLogin && !confirm)}
            style={{
              padding: "11px", background: loading ? C.bg : PURPLE, color: loading ? C.textLight : "#fff",
              border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer", marginTop: 4,
              boxShadow: loading ? "none" : `0 2px 8px ${PURPLE}44`,
              transition: "all 0.2s",
            }}>
            {loading ? (isLogin ? "Connexion…" : "Création…") : (isLogin ? "Se connecter →" : "Créer mon compte →")}
          </button>
        </form>
      </div>
    </>
  );
}

// ── Benefits list ─────────────────────────────────────────────────
function BenefitsList() {
  const items = [
    { icon: "📡", title: "Monitoring GEO en temps réel", color: PURPLE,
      points: ["Présence marque dans OpenAI, Gemini, Perplexity, Claude", "Historique 30 jours et tendances", "Analyse par provider et par question"] },
    { icon: "📋", title: "Audits GEO prêts à livrer", color: "#2563EB",
      points: ["Analyse concurrentielle des sources citées", "URLs à optimiser et pages à créer", "Recommandations actionnables priorisées"] },
    { icon: "🔬", title: "Analyse SEO × GEO", color: "#059669",
      points: ["Corrélations SF × citations LLM", "Croisement Bing AI × Fan-outs", "Roadmaps avec quick wins par site"] },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {items.map(b => (
        <div key={b.title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: b.color + "15", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
            {b.icon}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 5 }}>{b.title}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {b.points.map((p, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textMid, display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <span style={{ color: b.color, marginTop: 1, flexShrink: 0 }}>·</span>
                  <span style={{ lineHeight: 1.4 }}>{p}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Setup steps ───────────────────────────────────────────────────
function SetupStepsList({ onGoSetup, onGoFanout, onGoAudit }) {
  const steps = [
    { num: 1, icon: "📁", title: "Importer les données", desc: "SF, GSC, GA4, Bing Webmaster, Semrush dans Setup.", action: "Setup →", onClick: onGoSetup },
    { num: 2, icon: "🔑", title: "Clé API Claude", desc: "Pour les Hints GEO.", link: { label: "platform.claude.com", url: "https://platform.claude.com/settings/keys" }, action: "Fan-outs →", onClick: onGoFanout },
    { num: 3, icon: "🤖", title: "Clés API LLM", desc: "Au moins un provider :",
      providers: [
        { name: "OpenAI", url: "https://platform.openai.com/api-keys" },
        { name: "Perplexity", url: "https://www.perplexity.ai/settings/api" },
        { name: "Gemini", url: "https://aistudio.google.com/app/apikey" },
      ], action: "Fan-outs →", onClick: onGoFanout },
    { num: 4, icon: "🚀", title: "Lancer les Fan-outs", desc: "Ajoutez vos mots-clés, générez et interrogez les LLMs.", action: "Fan-outs →", onClick: onGoFanout },
    { num: 5, icon: "📋", title: "Audit GEO", desc: "Rapport complet avec recommandations actionnables.", action: "Audit →", onClick: onGoAudit },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {steps.map(s => (
        <div key={s.num} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ width: 24, height: 24, borderRadius: "50%", background: PURPLE_LIGHT, border: `1px solid ${PURPLE_BORDER}`, color: PURPLE, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
            {s.num}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 2 }}>{s.icon} {s.title}</div>
            <div style={{ fontSize: 11, color: C.textLight, lineHeight: 1.5 }}>{s.desc}</div>
            {s.link && (
              <a href={s.link.url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: PURPLE, fontWeight: 600, display: "inline-block", marginTop: 2 }}>
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
              style={{ fontSize: 10, fontWeight: 700, color: PURPLE, background: PURPLE_LIGHT, border: `1px solid ${PURPLE_BORDER}`, borderRadius: 6, padding: "3px 9px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
              {s.action}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Projects list ─────────────────────────────────────────────────
function ProjectsList({ user, projects, currentProjectId, dbLoading, onSelectProject, onCreateProject, onDeleteProject, onLogout }) {
  const isAdmin = isSuperAdmin(user);
  const lastProject = projects.find(p => p.id === currentProjectId) || projects[0];
  const displayName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* User header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>
            👋 Bonjour{displayName ? `, ${displayName}` : ""} !
          </div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>
            {user?.email}
            {isAdmin && <span style={{ marginLeft: 6, fontSize: 9, background: PURPLE_LIGHT, color: PURPLE, borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>SUPER ADMIN</span>}
          </div>
        </div>
        <button onClick={onLogout}
          style={{ fontSize: 11, color: C.textLight, background: "none", border: `1px solid ${C.border}`, borderRadius: 7, padding: "4px 10px", cursor: "pointer" }}>
          Déconnexion
        </button>
      </div>

      <div style={{ height: 1, background: C.border }} />

      {/* Projects content */}
      {dbLoading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.textLight, fontSize: 12, padding: "8px 0" }}>
          <span style={{ display: "inline-block", animation: "spin 1s linear infinite", fontSize: 16 }}>⟳</span>
          Projets en chargement…
        </div>
      ) : lastProject ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7 }}>Reprendre</div>
          <div style={{ display: "flex", alignItems: "stretch", gap: 5 }}>
            <button onClick={() => onSelectProject(lastProject.id)}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: PURPLE_LIGHT, border: `2px solid ${PURPLE}33`, borderRadius: 10, cursor: "pointer", textAlign: "left" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: PURPLE }}>{lastProject.name}</div>
                <div style={{ fontSize: 11, color: C.textLight, marginTop: 2 }}>
                  {lastProject.sites?.length || 0} site{lastProject.sites?.length !== 1 ? "s" : ""}
                  {lastProject.updated_at && ` · modifié ${new Date(lastProject.updated_at).toLocaleDateString("fr-FR")}`}
                </div>
              </div>
              <span style={{ fontSize: 18, color: PURPLE }}>→</span>
            </button>
            {onDeleteProject && (
              <button onClick={() => onDeleteProject(lastProject.id)} title="Supprimer ce projet"
                style={{ flexShrink: 0, width: 40, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 10, cursor: "pointer", color: C.textLight, fontSize: 15 }}>
                🗑
              </button>
            )}
          </div>
          {projects.length > 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 260, overflowY: "auto" }}>
              {projects.filter(p => p.id !== lastProject.id).map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <button onClick={() => onSelectProject(p.id)}
                    style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontSize: 12, color: C.text }}>{p.name}</span>
                    <span style={{ fontSize: 10, color: C.textLight }}>→</span>
                  </button>
                  {onDeleteProject && (
                    <button onClick={() => onDeleteProject(p.id)} title="Supprimer ce projet"
                      style={{ flexShrink: 0, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", color: C.textLight, fontSize: 13 }}>
                      🗑
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <button onClick={onCreateProject}
            style={{ padding: "8px", border: `2px dashed ${C.border}`, borderRadius: 9, background: "transparent", color: C.textLight, fontSize: 12, cursor: "pointer" }}>
            + Nouveau projet
          </button>
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "12px 0" }}>
          <div style={{ fontSize: 12, color: C.textLight, marginBottom: 12 }}>Aucun projet disponible</div>
          <button onClick={onCreateProject}
            style={{ padding: "9px 20px", background: PURPLE, color: "#fff", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            + Créer mon premier projet
          </button>
        </div>
      )}
    </div>
  );
}

// ── HomeTab ───────────────────────────────────────────────────────
export default function HomeTab({ user, projects, currentProjectId, dbLoading, onLogin, onLogout, onSelectProject, onCreateProject, onDeleteProject, onGoSetup, onGoFanout, onGoAudit }) {
  const [visible, setVisible]         = useState(true);
  const [showTutorial, setShowTutorial] = useState(false);
  const [displayUser, setDisplayUser] = useState(user);

  // Smooth transition when user logs in/out
  useEffect(() => {
    if (user === displayUser) return;
    setVisible(false);
    const t = setTimeout(() => {
      setDisplayUser(user);
      setVisible(true);
    }, 280);
    return () => clearTimeout(t);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const isConnected = !!displayUser;

  const cardStyle = {
    background: C.white,
    border: `1px solid ${C.border}`,
    borderRadius: 16,
    padding: "28px 32px",
    height: "100%",
    boxSizing: "border-box",
    boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
  };

  const transitionStyle = {
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(10px)",
    transition: "opacity 0.28s ease, transform 0.28s ease",
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 24px" }}>

      {/* Header — only shown when not connected */}
      {!isConnected && (
        <div style={{ textAlign: "center", marginBottom: 40, ...transitionStyle }}>
          {/* Logo Sonate */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, background: "#1A3C2E", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#F0EBE0", fontSize: 22, fontWeight: 900, fontStyle: "italic", lineHeight: 1 }}>S</span>
            </div>
            <span style={{ fontSize: 24, fontWeight: 900, color: "#1A3C2E", letterSpacing: -0.5 }}>Dashboard GEO <span style={{ fontStyle: "italic" }}>par Sonate</span></span>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 400, color: "#1A3C2E", margin: "0 0 6px", letterSpacing: 0.5 }}>
            Votre croissance est clé
          </h1>
          <div style={{ fontSize: 13, color: C.textLight }}>Plateforme GEO Intelligence</div>
        </div>
      )}

      {/* Connected header */}
      {isConnected && (
        <div style={{ marginBottom: 32, ...transitionStyle, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, background: "#1A3C2E", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ color: "#F0EBE0", fontSize: 17, fontWeight: 900, fontStyle: "italic" }}>S</span>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#1A3C2E", letterSpacing: 1, textTransform: "uppercase", marginBottom: 1 }}>Dashboard GEO par Sonate</div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0 }}>Tableau de bord</h1>
          </div>
        </div>
      )}

      {/* 2-column grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 28,
        alignItems: "stretch",
        ...transitionStyle,
      }}>
        {/* LEFT */}
        <div style={cardStyle}>
          {!isConnected ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 20 }}>Ce que vous obtenez</div>
              <BenefitsList />
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>Mes projets</div>
              <div style={{ fontSize: 11, color: C.textLight, marginBottom: 20 }}>Sélectionnez un projet ou créez-en un nouveau</div>
              <ProjectsList
                user={displayUser}
                projects={projects}
                currentProjectId={currentProjectId}
                dbLoading={dbLoading}
                onSelectProject={onSelectProject}
                onCreateProject={onCreateProject}
                onDeleteProject={onDeleteProject}
                onLogout={onLogout}
              />
            </>
          )}
        </div>

        {/* RIGHT */}
        <div style={cardStyle}>
          {!isConnected ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>Accéder à la plateforme</div>
              <div style={{ fontSize: 11, color: C.textLight, marginBottom: 20 }}>Connectez-vous ou créez un compte</div>
              <LoginForm onLogin={(u) => onLogin(u)} />
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>🎯 Setup complet</div>
              <div style={{ fontSize: 11, color: C.textLight, marginBottom: 20 }}>Suivez ces étapes pour configurer votre projet</div>
              <SetupStepsList onGoSetup={onGoSetup} onGoFanout={onGoFanout} onGoAudit={onGoAudit} />
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", paddingTop: 28, marginTop: 36, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 11, color: C.textLight }}>
          Dashboard GEO par Sonate · par <a href="mailto:guillaume@deux.io" style={{ color: PURPLE }}>deux.io</a>
        </div>
        <button
          onClick={() => setShowTutorial(true)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 20,
            border: `1.5px solid ${PURPLE}`, background: PURPLE_LIGHT,
            color: PURPLE, fontSize: 12, fontWeight: 700, cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = PURPLE; e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={e => { e.currentTarget.style.background = PURPLE_LIGHT; e.currentTarget.style.color = PURPLE; }}
        >
          🎓 Guide de démarrage
        </button>
      </div>

      {/* Tutorial modal */}
      {showTutorial && (
        <TutorialModal
          onClose={() => setShowTutorial(false)}
          onNavigate={(tab) => {
            setShowTutorial(false);
            if (tab === "import" && onGoSetup) onGoSetup();
            else if (tab === "geo" && onGoFanout) onGoFanout();
            else if (tab === "geo_audit" && onGoAudit) onGoAudit();
          }}
        />
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}