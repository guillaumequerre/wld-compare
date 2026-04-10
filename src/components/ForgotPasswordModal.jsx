// components/ForgotPasswordModal.jsx
// Modale "Mot de passe oublié" — affiche un formulaire email,
// puis un message de confirmation.
// Usage dans LoginPage :
//   import ForgotPasswordModal from "./ForgotPasswordModal";
//   <ForgotPasswordModal onClose={() => setShowForgot(false)} />
//
// Dans la page de login, ajouter un lien :
//   <button onClick={() => setShowForgot(true)}>Mot de passe oublié ?</button>
//   {showForgot && <ForgotPasswordModal onClose={() => setShowForgot(false)} />}

import { useState } from "react";
import { authForgotPassword } from "../lib/auth";

export default function ForgotPasswordModal({ onClose }) {
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
    // Overlay
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#fff", borderRadius: 16, padding: "36px 40px",
        width: "100%", maxWidth: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
        position: "relative",
      }}>
        {/* Close */}
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 16, right: 16,
            background: "none", border: "none", fontSize: 20,
            cursor: "pointer", color: "#94A3B8", lineHeight: 1,
          }}
        >✕</button>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>
            🔑 Mot de passe oublié
          </div>
          <div style={{ fontSize: 13, color: "#64748B", lineHeight: 1.5 }}>
            Entrez votre adresse email. Si un compte existe, vous recevrez un lien de réinitialisation.
          </div>
        </div>

        {status === "sent" ? (
          // ── Message de confirmation ──
          <div style={{
            background: "#ECFDF5", border: "1px solid #BBF7D0",
            borderRadius: 12, padding: "20px 24px", textAlign: "center",
          }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📧</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#065F46", marginBottom: 6 }}>
              Email envoyé !
            </div>
            <div style={{ fontSize: 13, color: "#047857", lineHeight: 1.6 }}>
              Si <strong>{email}</strong> correspond à un compte, vous recevrez un lien dans quelques instants.
              Vérifiez aussi vos spams.
            </div>
            <button
              onClick={onClose}
              style={{
                marginTop: 20, padding: "10px 24px",
                background: "#059669", color: "#fff",
                border: "none", borderRadius: 8,
                fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}
            >
              Fermer
            </button>
          </div>
        ) : (
          // ── Formulaire ──
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                Adresse email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="votre@email.com"
                autoFocus
                required
                style={{
                  width: "100%", padding: "11px 14px",
                  border: "1.5px solid #E2E8F0", borderRadius: 8,
                  fontSize: 14, color: "#0F172A", boxSizing: "border-box",
                  outline: "none",
                  transition: "border-color 0.15s",
                }}
                onFocus={e => e.target.style.borderColor = "#6366F1"}
                onBlur={e => e.target.style.borderColor = "#E2E8F0"}
              />
            </div>

            {(status === "error" || error) && (
              <div style={{
                background: "#FEF2F2", border: "1px solid #FECACA",
                borderRadius: 8, padding: "10px 14px",
                fontSize: 13, color: "#DC2626", marginBottom: 16,
              }}>
                {error || "Une erreur est survenue."}
              </div>
            )}

            <button
              type="submit"
              disabled={status === "loading" || !email.trim()}
              style={{
                width: "100%", padding: "12px",
                background: status === "loading" ? "#E2E8F0" : "#6366F1",
                color: status === "loading" ? "#94A3B8" : "#fff",
                border: "none", borderRadius: 8,
                fontSize: 14, fontWeight: 700, cursor: status === "loading" ? "not-allowed" : "pointer",
                transition: "background 0.15s",
              }}
            >
              {status === "loading" ? "⏳ Envoi en cours…" : "Envoyer le lien de réinitialisation"}
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                width: "100%", marginTop: 10, padding: "10px",
                background: "transparent", color: "#64748B",
                border: "1px solid #E2E8F0", borderRadius: 8,
                fontSize: 13, cursor: "pointer",
              }}
            >
              Annuler
            </button>
          </form>
        )}
      </div>
    </div>
  );
}