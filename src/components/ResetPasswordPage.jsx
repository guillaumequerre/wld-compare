// pages/ResetPasswordPage.jsx  (ou src/ResetPasswordPage.jsx selon votre structure)
// Page de réinitialisation du mot de passe.
// Supabase redirige vers cette URL avec le token dans le hash :
//   /reset-password#access_token=xxx&type=recovery
//
// À brancher dans votre router :
//   <Route path="/reset-password" element={<ResetPasswordPage />} />
// ou si vous n'avez pas de router, à afficher conditionnellement :
//   if (window.location.pathname === "/reset-password") return <ResetPasswordPage />;

import { useState, useEffect } from "react";
import { authResetPassword } from "../lib/auth";

export default function ResetPasswordPage() {
  const [token, setToken]         = useState("");
  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [status, setStatus]       = useState("idle"); // idle | loading | success | error | invalid
  const [error, setError]         = useState("");
  const [showPwd, setShowPwd]     = useState(false);

  // Extraire le token du hash de l'URL
  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const t = params.get("access_token");
    const type = params.get("type");
    if (t && type === "recovery") {
      setToken(t);
    } else {
      setStatus("invalid");
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Le mot de passe doit faire au moins 8 caractères."); return; }
    if (password !== confirm) { setError("Les mots de passe ne correspondent pas."); return; }

    setStatus("loading");
    try {
      await authResetPassword(token, password);
      setStatus("success");
      // Nettoyer le hash de l'URL
      window.history.replaceState(null, "", window.location.pathname);
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  };

  const strength = (pwd) => {
    if (!pwd) return { score: 0, label: "", color: "#E2E8F0" };
    let s = 0;
    if (pwd.length >= 8) s++;
    if (pwd.length >= 12) s++;
    if (/[A-Z]/.test(pwd)) s++;
    if (/[0-9]/.test(pwd)) s++;
    if (/[^A-Za-z0-9]/.test(pwd)) s++;
    const map = [
      { score: 0, label: "", color: "#E2E8F0" },
      { score: 1, label: "Très faible", color: "#DC2626" },
      { score: 2, label: "Faible", color: "#F59E0B" },
      { score: 3, label: "Correct", color: "#3B82F6" },
      { score: 4, label: "Fort", color: "#059669" },
      { score: 5, label: "Très fort", color: "#059669" },
    ];
    return map[Math.min(s, 5)];
  };

  const pwdStrength = strength(password);

  return (
    <div style={{
      minHeight: "100vh", background: "#F8FAFC",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div style={{
        background: "#fff", borderRadius: 20, padding: "44px 48px",
        width: "100%", maxWidth: 460, boxShadow: "0 8px 40px rgba(0,0,0,0.10)",
      }}>
        {/* Logo / titre */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🔐</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>
            Nouveau mot de passe
          </div>
          <div style={{ fontSize: 13, color: "#64748B" }}>
            Choisissez un mot de passe sécurisé pour votre compte
          </div>
        </div>

        {/* ── Token invalide / expiré ── */}
        {status === "invalid" && (
          <div style={{
            background: "#FEF2F2", border: "1px solid #FECACA",
            borderRadius: 12, padding: "20px 24px", textAlign: "center",
          }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#DC2626", marginBottom: 8 }}>
              Lien invalide ou expiré
            </div>
            <div style={{ fontSize: 13, color: "#B91C1C", lineHeight: 1.6, marginBottom: 16 }}>
              Ce lien de réinitialisation est invalide ou a expiré (valable 1h).
              Faites une nouvelle demande depuis la page de connexion.
            </div>
            <a
              href="/"
              style={{
                display: "inline-block", padding: "10px 20px",
                background: "#6366F1", color: "#fff",
                borderRadius: 8, fontSize: 13, fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Retour à la connexion
            </a>
          </div>
        )}

        {/* ── Succès ── */}
        {status === "success" && (
          <div style={{
            background: "#ECFDF5", border: "1px solid #BBF7D0",
            borderRadius: 12, padding: "24px", textAlign: "center",
          }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#065F46", marginBottom: 8 }}>
              Mot de passe mis à jour !
            </div>
            <div style={{ fontSize: 13, color: "#047857", lineHeight: 1.6, marginBottom: 20 }}>
              Votre mot de passe a été réinitialisé avec succès.
              Vous pouvez maintenant vous connecter avec vos nouveaux identifiants.
            </div>
            <a
              href="/"
              style={{
                display: "inline-block", padding: "12px 28px",
                background: "#059669", color: "#fff",
                borderRadius: 8, fontSize: 14, fontWeight: 700,
                textDecoration: "none",
              }}
            >
              Se connecter
            </a>
          </div>
        )}

        {/* ── Formulaire ── */}
        {(status === "idle" || status === "loading" || status === "error") && (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Nouveau mot de passe */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                Nouveau mot de passe
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="8 caractères minimum"
                  autoFocus
                  required
                  style={{
                    width: "100%", padding: "11px 44px 11px 14px",
                    border: "1.5px solid #E2E8F0", borderRadius: 8,
                    fontSize: 14, color: "#0F172A", boxSizing: "border-box", outline: "none",
                  }}
                  onFocus={e => e.target.style.borderColor = "#6366F1"}
                  onBlur={e => e.target.style.borderColor = "#E2E8F0"}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  style={{
                    position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 16, color: "#94A3B8",
                  }}
                >
                  {showPwd ? "🙈" : "👁️"}
                </button>
              </div>

              {/* Barre de force */}
              {password && (
                <div style={{ marginTop: 8 }}>
                  <div style={{
                    height: 4, borderRadius: 2,
                    background: "#F1F5F9", overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${(pwdStrength.score / 5) * 100}%`,
                      background: pwdStrength.color,
                      borderRadius: 2,
                      transition: "width 0.3s, background 0.3s",
                    }} />
                  </div>
                  {pwdStrength.label && (
                    <div style={{ fontSize: 11, color: pwdStrength.color, marginTop: 3, fontWeight: 600 }}>
                      {pwdStrength.label}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Confirmer */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                Confirmer le mot de passe
              </label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Répétez le mot de passe"
                required
                style={{
                  width: "100%", padding: "11px 14px",
                  border: `1.5px solid ${confirm && confirm !== password ? "#FCA5A5" : "#E2E8F0"}`,
                  borderRadius: 8, fontSize: 14, color: "#0F172A",
                  boxSizing: "border-box", outline: "none",
                }}
                onFocus={e => e.target.style.borderColor = confirm && confirm !== password ? "#FCA5A5" : "#6366F1"}
                onBlur={e => e.target.style.borderColor = confirm && confirm !== password ? "#FCA5A5" : "#E2E8F0"}
              />
              {confirm && confirm !== password && (
                <div style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>
                  Les mots de passe ne correspondent pas
                </div>
              )}
            </div>

            {/* Erreur */}
            {error && (
              <div style={{
                background: "#FEF2F2", border: "1px solid #FECACA",
                borderRadius: 8, padding: "10px 14px",
                fontSize: 13, color: "#DC2626",
              }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={status === "loading" || !password || !confirm}
              style={{
                padding: "13px",
                background: status === "loading" ? "#E2E8F0" : "#6366F1",
                color: status === "loading" ? "#94A3B8" : "#fff",
                border: "none", borderRadius: 8,
                fontSize: 14, fontWeight: 700,
                cursor: status === "loading" ? "not-allowed" : "pointer",
                marginTop: 4,
              }}
            >
              {status === "loading" ? "⏳ Mise à jour…" : "Valider le nouveau mot de passe"}
            </button>

            <a
              href="/"
              style={{
                textAlign: "center", fontSize: 13, color: "#64748B",
                textDecoration: "none", display: "block",
              }}
            >
              ← Retour à la connexion
            </a>
          </form>
        )}
      </div>
    </div>
  );
}