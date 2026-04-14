// components/TutorialModal.jsx
// Guide interactif pour nouveaux utilisateurs — 2 parcours
// Usage dans HomeTab :
//   import TutorialModal from "../components/TutorialModal";
//   {showTutorial && <TutorialModal onClose={() => setShowTutorial(false)} onNavigate={(tab) => { onGoSetup(); ... }} />}

import { useState } from "react";

const GREEN      = "#1A3C2E";
const GREEN_LITE = "#EAF0EC";
const GREEN_MED  = "#B2CCBC";
const CREAM      = "#F7F4EF";

// ── Données des parcours ──────────────────────────────────────────

const TRACKS = [
  {
    id: "audit",
    icon: "📋",
    label: "Audit GEO",
    tagline: "Importer vos données et générer un rapport",
    color: GREEN,
    steps: [
      {
        num: 1,
        title: "Créez votre projet",
        icon: "📁",
        desc: "Dans l'onglet ⚙️ Setup, cliquez sur \"+ Nouveau projet\" et donnez-lui un nom.",
        detail: "Un projet regroupe tous vos sites, imports et données. Vous pourrez en créer plusieurs.",
        action: "Aller dans Setup →",
        tab: "import",
        tip: "Nommez votre projet par client ou domaine (ex : \"Acme - SEO 2025\")",
      },
      {
        num: 2,
        title: "Ajoutez vos sites",
        icon: "🌐",
        desc: "Dans Setup → section Sites, ajoutez les domaines à analyser.",
        detail: "Chaque site peut recevoir ses propres imports (Screaming Frog, GSC, GA4…).",
        action: null,
        tip: "Commencez avec 1 seul site pour votre première prise en main",
      },
      {
        num: 3,
        title: "Importez vos données",
        icon: "📥",
        desc: "Glissez vos exports CSV : Screaming Frog, Google Search Console, GA4, Bing Webmaster.",
        detail: "Au minimum, importez un export Screaming Frog (.csv) pour obtenir un audit. Les autres sources enrichissent l'analyse.",
        action: null,
        tip: "SF : export complet en UTF-8 · GSC : export 3 mois · GA4 : export pages",
        links: [
          { label: "Screaming Frog", url: "https://www.screamingfrog.co.uk/seo-spider/" },
        ],
      },
      {
        num: 4,
        title: "Configurez les clés API",
        icon: "🔑",
        desc: "Dans Setup → section Providers, collez votre clé API Claude (et optionnellement OpenAI, Gemini…).",
        detail: "La clé Claude est indispensable pour la génération des recommandations d'audit GEO.",
        action: null,
        tip: "Clé Claude → platform.claude.com/settings/keys",
        links: [
          { label: "Obtenir une clé Claude", url: "https://platform.claude.com/settings/keys" },
        ],
      },
      {
        num: 5,
        title: "Lancez l'audit",
        icon: "🚀",
        desc: "Rendez-vous dans l'onglet 📋 Audit GEO et cliquez sur \"Générer l'audit\".",
        detail: "L'IA analyse vos données et produit un rapport avec chiffres clés, recommandations priorisées et opportunités GEO.",
        action: "Voir Audit GEO →",
        tab: "geo_audit",
        tip: "L'audit prend 30–60 secondes selon le volume de données",
      },
    ],
  },
  {
    id: "fanout",
    icon: "🔍",
    label: "Fan-outs",
    tagline: "Surveiller votre marque dans les IA",
    color: "#059669",
    steps: [
      {
        num: 1,
        title: "Configurez la marque",
        icon: "🏷️",
        desc: "Dans ⚙️ Setup → section Marque, renseignez le nom de votre marque, son domaine et vos concurrents.",
        detail: "Ces informations permettent à l'outil de détecter automatiquement la présence de votre marque dans les réponses des IA.",
        action: "Aller dans Setup →",
        tab: "import",
        tip: "Ajoutez aussi vos alias (ex : \"Acme\" + \"Acme.fr\" + \"Acme Technologies\")",
      },
      {
        num: 2,
        title: "Ajoutez des mots-clés",
        icon: "🔑",
        desc: "Dans 🔍 Fan-outs → onglet Mots-clés, saisissez vos mots-clés cibles (un par ligne) et cliquez Ajouter.",
        detail: "Les mots-clés sont la base de l'analyse. Choisissez des requêtes sur lesquelles vous souhaitez apparaître dans ChatGPT, Gemini ou Perplexity.",
        action: "Aller dans Fan-outs →",
        tab: "geo",
        tip: "Commencez par 5–10 mots-clés stratégiques, vous pourrez en ajouter ensuite",
      },
      {
        num: 3,
        title: "Générez les questions",
        icon: "💬",
        desc: "Cliquez sur \"💬 Générer toutes les questions\". L'IA crée automatiquement des questions pertinentes pour chaque mot-clé.",
        detail: "5 questions par mot-clé sont générées selon des axes prédéfinis (meilleur, recommandé, avis…). Vous pouvez modifier ces axes.",
        action: null,
        tip: "Nécessite une clé OpenAI configurée dans Setup → Providers",
      },
      {
        num: 4,
        title: "Interrogez les IA",
        icon: "🤖",
        desc: "Dans l'onglet Questions, cliquez sur \"▶ Lancer tout\" pour interroger tous les providers configurés.",
        detail: "Chaque question est envoyée à OpenAI, Gemini, Perplexity et/ou Claude. La réponse est analysée pour détecter votre marque.",
        action: "Voir les questions →",
        tab: "geo",
        tip: "Activez au moins 2 providers pour comparer les résultats entre IA",
      },
      {
        num: 5,
        title: "Analysez les résultats",
        icon: "📊",
        desc: "Consultez le tableau de bord : % de présence, position moyenne, questions où vous ressortez.",
        detail: "Utilisez les filtres \"📍 Positionnée\" et \"📉 Positionnée précédemment\" pour identifier vos opportunités. Générez un export PDF ou CSV.",
        action: null,
        tip: "Cliquez 💡 Générer un Hint sur chaque question pour obtenir des recommandations d'optimisation",
      },
    ],
  },
];

// ── Composant principal ───────────────────────────────────────────

export default function TutorialModal({ onClose, onNavigate }) {
  const [track, setTrack] = useState(null);   // null = choix du parcours
  const [step, setStep]   = useState(0);

  const currentTrack = track ? TRACKS.find(t => t.id === track) : null;
  const currentStep  = currentTrack ? currentTrack.steps[step] : null;
  const totalSteps   = currentTrack?.steps.length || 0;
  const isLast       = step === totalSteps - 1;

  const reset = () => { setTrack(null); setStep(0); };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
        backdropFilter: "blur(2px)",
      }}
    >
      <div style={{
        background: "#fff",
        borderRadius: 20,
        width: "100%", maxWidth: 560,
        boxShadow: "0 24px 80px rgba(0,0,0,0.2)",
        overflow: "hidden",
        position: "relative",
      }}>

        {/* ── Header ── */}
        <div style={{
          background: GREEN, padding: "20px 28px 18px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {track && (
              <button onClick={reset} style={{ background: "none", border: "none", cursor: "pointer", color: "#F0EBE0", fontSize: 18, lineHeight: 1, opacity: 0.7, padding: "0 4px 0 0" }}>←</button>
            )}
            <div style={{ width: 32, height: 32, background: "#F0EBE0", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: GREEN, fontSize: 16, fontWeight: 900, fontStyle: "italic" }}>S</span>
            </div>
            <div>
              <div style={{ color: "#F0EBE0", fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.7 }}>
                {track ? `${currentTrack.icon} ${currentTrack.label}` : "Dashboard GEO par Sonate"}
              </div>
              <div style={{ color: "#fff", fontSize: 15, fontWeight: 700 }}>
                {track ? `Étape ${step + 1} sur ${totalSteps}` : "Guide de démarrage"}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#fff", fontSize: 22, opacity: 0.7, lineHeight: 1 }}>✕</button>
        </div>

        {/* ── Barre de progression (si parcours actif) ── */}
        {track && (
          <div style={{ height: 3, background: GREEN_LITE }}>
            <div style={{
              height: "100%",
              width: `${((step + 1) / totalSteps) * 100}%`,
              background: currentTrack.color,
              transition: "width 0.4s ease",
            }} />
          </div>
        )}

        {/* ── Contenu ── */}
        <div style={{ padding: "28px 28px 24px" }}>

          {/* Choix du parcours */}
          {!track && (
            <div>
              <p style={{ fontSize: 14, color: "#64748B", marginBottom: 24, lineHeight: 1.6 }}>
                Choisissez votre parcours selon votre objectif du moment. Vous pouvez y revenir à tout moment.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {TRACKS.map(t => (
                  <button key={t.id} onClick={() => { setTrack(t.id); setStep(0); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 16,
                      padding: "18px 20px",
                      border: `2px solid ${GREEN_MED}`,
                      borderRadius: 14, background: CREAM,
                      cursor: "pointer", textAlign: "left",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = t.color; e.currentTarget.style.background = GREEN_LITE; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = GREEN_MED; e.currentTarget.style.background = CREAM; }}
                  >
                    <div style={{
                      width: 52, height: 52, flexShrink: 0,
                      background: t.color + "18",
                      borderRadius: 12,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 26,
                    }}>{t.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 3 }}>{t.label}</div>
                      <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.5 }}>{t.tagline}</div>
                      <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                        {t.steps.map((s, i) => (
                          <span key={i} style={{ fontSize: 10, background: t.color + "18", color: t.color, borderRadius: 10, padding: "1px 7px", fontWeight: 600 }}>
                            {s.num}. {s.title}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span style={{ color: GREEN_MED, fontSize: 20 }}>→</span>
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 20, padding: "12px 16px", background: GREEN_LITE, borderRadius: 10, fontSize: 12, color: GREEN, display: "flex", gap: 8 }}>
                <span>💡</span>
                <span>Nouveau sur l'outil ? Commencez par <strong>Fan-outs</strong> pour un résultat rapide, ou par <strong>Audit GEO</strong> si vous avez déjà des exports Screaming Frog.</span>
              </div>
            </div>
          )}

          {/* Étape du parcours */}
          {track && currentStep && (
            <div>
              {/* Icône + titre */}
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 20 }}>
                <div style={{
                  width: 56, height: 56, flexShrink: 0,
                  background: currentTrack.color + "18",
                  borderRadius: 14,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 28,
                }}>{currentStep.icon}</div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: currentTrack.color, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>
                    Étape {currentStep.num}
                  </div>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0F172A", margin: 0, lineHeight: 1.2 }}>
                    {currentStep.title}
                  </h2>
                </div>
              </div>

              {/* Description */}
              <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.7, marginBottom: 12 }}>
                {currentStep.desc}
              </p>
              <p style={{ fontSize: 13, color: "#64748B", lineHeight: 1.6, marginBottom: 16 }}>
                {currentStep.detail}
              </p>

              {/* Tip */}
              <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#92400E", display: "flex", gap: 8, marginBottom: currentStep.links?.length ? 12 : 0 }}>
                <span style={{ flexShrink: 0 }}>💡</span>
                <span>{currentStep.tip}</span>
              </div>

              {/* Liens externes */}
              {currentStep.links?.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  {currentStep.links.map((l, i) => (
                    <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, fontWeight: 600, color: currentTrack.color, background: currentTrack.color + "12", border: `1px solid ${currentTrack.color}44`, borderRadius: 8, padding: "4px 10px", textDecoration: "none" }}>
                      🔗 {l.label} ↗
                    </a>
                  ))}
                </div>
              )}

              {/* Pastilles étapes */}
              <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 24, marginBottom: 4 }}>
                {currentTrack.steps.map((_, i) => (
                  <button key={i} onClick={() => setStep(i)}
                    style={{
                      width: i === step ? 24 : 8, height: 8,
                      borderRadius: 4, border: "none",
                      background: i === step ? currentTrack.color : i < step ? currentTrack.color + "55" : "#E2E8F0",
                      cursor: "pointer", transition: "all 0.2s",
                      padding: 0,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer navigation ── */}
        {track && (
          <div style={{
            padding: "16px 28px 20px",
            borderTop: "1px solid #F1F5F9",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            {/* Bouton précédent */}
            <button
              onClick={() => setStep(s => s - 1)}
              disabled={step === 0}
              style={{
                padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600,
                border: "1px solid #E2E8F0", background: "transparent",
                color: step === 0 ? "#CBD5E1" : "#64748B",
                cursor: step === 0 ? "not-allowed" : "pointer",
              }}
            >← Précédent</button>

            {/* Bouton navigation vers l'onglet */}
            {currentStep?.action && onNavigate && (
              <button
                onClick={() => { onNavigate(currentStep.tab); onClose(); }}
                style={{
                  flex: 1, padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600,
                  border: `1px solid ${currentTrack.color}44`,
                  background: currentTrack.color + "12",
                  color: currentTrack.color, cursor: "pointer",
                }}
              >
                {currentStep.action}
              </button>
            )}

            {/* Bouton suivant / terminer */}
            <button
              onClick={() => {
                if (isLast) { onClose(); }
                else setStep(s => s + 1);
              }}
              style={{
                padding: "9px 20px", borderRadius: 9, fontSize: 13, fontWeight: 700,
                border: "none",
                background: isLast ? "#059669" : currentTrack.color,
                color: "#fff", cursor: "pointer",
                marginLeft: "auto",
              }}
            >
              {isLast ? "✓ Terminer" : "Suivant →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}