import { useState, useEffect } from "react";
import { C } from "../lib/constants";
import { authLogin, authSignup, isSuperAdmin, sbGetProjectMembers, sbRemoveProjectMember, sbInviteMember } from "../lib/auth";

function Section({ title, children }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, background: C.bg }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{title}</div>
      </div>
      <div style={{ padding: "18px 20px" }}>{children}</div>
    </div>
  );
}

// ── Login card (when not connected) ──────────────────────────────
function LoginCard({ onLogin }) {
  const [mode, setMode]         = useState("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (mode === "signup" && password !== confirm) { setError("Mots de passe différents"); return; }
    if (password.length < 8) { setError("8 caractères minimum"); return; }
    setLoading(true);
    try {
      if (mode === "login") {
        const u = await authLogin(email.trim(), password);
        onLogin(u);
      } else {
        const u = await authSignup(email.trim(), password);
        if (u) { onLogin(u); }
        else { setSuccess("Compte créé ! Vérifiez votre email puis connectez-vous."); setMode("login"); setPassword(""); setConfirm(""); }
      }
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <Section title="🔐 Connexion / Inscription">
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {[{key:"login",label:"Connexion"},{key:"signup",label:"Créer un compte"}].map(m => (
          <button key={m.key} onClick={() => { setMode(m.key); setError(""); setSuccess(""); }}
            style={{ flex: 1, padding: "7px", border: `2px solid ${mode===m.key ? "#7C3AED" : C.border}`, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", background: mode===m.key ? "#F5F3FF" : "#fff", color: mode===m.key ? "#7C3AED" : C.textMid }}>
            {m.label}
          </button>
        ))}
      </div>
      {error && <div style={{ background: "#FEF2F2", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#DC2626", marginBottom: 12 }}>{error}</div>}
      {success && <div style={{ background: "#ECFDF5", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#059669", marginBottom: 12 }}>{success}</div>}
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360 }}>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="Email" style={{ padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13 }} />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Mot de passe (8 min.)" style={{ padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13 }} />
        {mode === "signup" && (
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required placeholder="Confirmer" style={{ padding: "8px 12px", border: `1px solid ${confirm && confirm !== password ? "#DC2626" : C.border}`, borderRadius: 8, fontSize: 13 }} />
        )}
        <button type="submit" disabled={loading} style={{ padding: "9px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          {loading ? "…" : mode === "login" ? "Se connecter" : "Créer mon compte"}
        </button>
      </form>
    </Section>
  );
}

// ── Project members manager ───────────────────────────────────────
function ProjectMembers({ project, ownerEmail, myRole = "owner" }) {
  const [members, setMembers] = useState([]);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole]   = useState("member"); // "member" | "reader"
  const [loading, setLoading]   = useState(false);
  const [saving,  setSaving]    = useState(false);
  const [error,   setError]     = useState("");
  const canManage = myRole === "owner" || myRole === "member";

  useEffect(() => {
    if (!project?.id) return;
    setLoading(true);
    sbGetProjectMembers(project.id).then(m => { setMembers(m); setLoading(false); }).catch(() => setLoading(false));
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [inviteMsg, setInviteMsg] = useState(""); // message de succès distinct de l'erreur

  const add = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) return;
    setSaving(true); setError(""); setInviteMsg("");
    const result = await sbInviteMember(project.id, email, ownerEmail, newRole);
    if (result.ok) {
      setMembers(prev => {
        const exists = prev.findIndex(m => m.user_email === email);
        const entry = { user_email: email, role: newRole };
        if (exists >= 0) { const n = [...prev]; n[exists] = entry; return n; }
        return [...prev, entry];
      });
      setNewEmail(""); setNewRole("member");
      if (result.invited) {
        setInviteMsg(`✉️ Invitation envoyée à ${email} — l'utilisateur recevra un email pour créer son compte.`);
      } else {
        setInviteMsg(`✓ ${email} a été ajouté au projet.`);
      }
    } else {
      setError(result.error || "Erreur lors de l'invitation");
    }
    setSaving(false);
  };

  const remove = async (email) => {
    await sbRemoveProjectMember(project.id, email);
    setMembers(prev => prev.filter(m => m.user_email !== email));
  };

  const roleBadge = (role) => {
    if (role === "reader") return { label: "👁 Lecture", color: "#D97706", bg: "#FFFBEB" };
    return { label: "✏️ Membre", color: "#7C3AED", bg: "#F5F3FF" };
  };

  if (!project) return <div style={{ fontSize: 12, color: C.textLight }}>Sélectionnez un projet</div>;

  return (
    <div>
      {/* Owner */}
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>Propriétaire</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#F0FDF4", borderRadius: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: "#059669", fontWeight: 600 }}>{project.owner_email || ownerEmail || "—"}</span>
        <span style={{ fontSize: 10, background: "#ECFDF5", color: "#059669", borderRadius: 4, padding: "1px 6px" }}>propriétaire</span>
      </div>

      {/* Members list */}
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>Accès ({members.length})</div>
      {loading ? <div style={{ fontSize: 12, color: C.textLight }}>Chargement…</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {members.length === 0 && <div style={{ fontSize: 12, color: C.textLight, fontStyle: "italic" }}>Aucun accès invité</div>}
          {members.map(m => {
            const badge = roleBadge(m.role);
            return (
              <div key={m.user_email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: C.bg, borderRadius: 8, border: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 12, color: C.text, flex: 1 }}>{m.user_email}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: badge.color, background: badge.bg, borderRadius: 5, padding: "2px 8px" }}>{badge.label}</span>
                {canManage && (
                  <button onClick={() => remove(m.user_email)} style={{ fontSize: 11, color: "#DC2626", background: "none", border: "none", cursor: "pointer", padding: "0 4px" }}>✕</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Invite — visible only to owners/members */}
      {canManage && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>Inviter un utilisateur</div>
          {error && <div style={{ fontSize: 12, color: "#DC2626", marginBottom: 8 }}>{error}</div>}
          {inviteMsg && <div style={{ fontSize: 12, color: "#059669", background: "#ECFDF5", border: "1px solid #BBF7D0", borderRadius: 7, padding: "8px 12px", marginBottom: 8 }}>{inviteMsg}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && add()}
              placeholder="email@exemple.com"
              style={{ flex: "1 1 200px", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} />
            <select value={newRole} onChange={e => setNewRole(e.target.value)}
              style={{ padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
              <option value="member">✏️ Membre — accès complet</option>
              <option value="reader">👁 Lecture seule — Fan-outs & Audit uniquement</option>
            </select>
            <button onClick={add} disabled={saving || !newEmail.includes("@")}
              style={{ padding: "8px 20px", background: saving ? C.bg : "#7C3AED", color: saving ? C.textLight : "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: !newEmail.includes("@") ? 0.5 : 1 }}>
              {saving ? "…" : "Inviter"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 6 }}>
            <strong>Membre</strong> : accès complet (Setup, Fan-outs, Audit). <strong>Lecture seule</strong> : Fan-outs et Audit GEO uniquement, aucun appel LLM.
            Si l'adresse n'a pas de compte, un email d'invitation sera envoyé automatiquement.
          </div>
        </>
      )}
      {!canManage && (
        <div style={{ fontSize: 12, color: C.textLight, fontStyle: "italic" }}>Vous avez un accès lecture seule sur ce projet.</div>
      )}
    </div>
  );
}

// ── ManageTab ─────────────────────────────────────────────────────
function AccountForm({ user, onLogout, isAdmin }) {
  const [name, setName] = useState(user?.user_metadata?.display_name || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const saveName = async () => {
    setSaving(true);
    try {
      const { getToken } = await import("../lib/auth");
      const token = getToken();
      await fetch("/api/auth?action=update_name", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ display_name: name.trim() }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch(e) { console.warn(e); }
    setSaving(false);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{user.email}</div>
          <div style={{ fontSize: 11, color: C.textLight, marginTop: 3 }}>
            Connecté
            {isAdmin && <span style={{ marginLeft: 8, fontSize: 10, background: "#F5F3FF", color: "#7C3AED", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>SUPER ADMIN</span>}
          </div>
        </div>
        <button onClick={onLogout} style={{ padding: "7px 16px", border: `1px solid ${C.border}`, borderRadius: 8, background: "#fff", color: "#DC2626", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          Déconnexion
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.textLight, marginBottom: 5 }}>Prénom / nom affiché</div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex : Guillaume"
            style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, color: C.text, boxSizing: "border-box" }} />
        </div>
        <button onClick={saveName} disabled={saving}
          style={{ marginTop: 20, padding: "8px 16px", background: saved ? "#059669" : "#7C3AED", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
          {saved ? "✓ Enregistré" : saving ? "…" : "Enregistrer"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: C.textLight, marginTop: 6 }}>Affiché sur l'accueil : "Bonjour, {name || "…"} !"</div>
    </div>
  );
}

export default function ManageTab({ user, projects, currentProjectId, setCurrentProjectId, onLogin, onLogout, myRole = "owner" }) {
  const [selectedProjectId, setSelectedProjectId] = useState(currentProjectId);
  const selectedProject = projects.find(p => p.id === selectedProjectId) || projects[0];
  const isAdmin = user && isSuperAdmin(user);

  if (!user) return (
    <div style={{ maxWidth: 480, margin: "0 auto", paddingTop: 40 }}>
      <LoginCard onLogin={onLogin} />
    </div>
  );

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 4 }}>👤 Compte & projets</div>
        <div style={{ fontSize: 12, color: C.textLight }}>Gérez votre compte et les accès à vos projets</div>
      </div>

      {/* Account info */}
      <Section title="Votre compte">
        <AccountForm user={user} onLogout={onLogout} isAdmin={isAdmin} />
      </Section>

      {/* Project access */}
      <Section title="Accès aux projets">
        {/* Project selector */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textLight, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>Projet</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {projects.map(p => (
              <button key={p.id} onClick={() => { setSelectedProjectId(p.id); setCurrentProjectId(p.id); }}
                style={{ padding: "6px 14px", border: `2px solid ${p.id === selectedProjectId ? "#7C3AED" : C.border}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", background: p.id === selectedProjectId ? "#F5F3FF" : "#fff", color: p.id === selectedProjectId ? "#7C3AED" : C.text }}>
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <ProjectMembers project={selectedProject} ownerEmail={user.email} myRole={myRole} />
      </Section>

      {/* Superadmin info */}
      {isAdmin && (
        <Section title="⚡ Super admin">
          <div style={{ fontSize: 12, color: C.textLight }}>
            Vous avez accès à tous les projets de la plateforme.
            Les super admins sont définis dans la configuration serveur.
          </div>
        </Section>
      )}
    </div>
  );
}