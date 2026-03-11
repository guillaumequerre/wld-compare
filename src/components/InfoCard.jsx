import { useState } from "react";
import { C } from "../lib/constants";

const PAGE_INFO = {
  import: {
    icon: "📥",
    title: "Import des données",
    content: "Charge ici les exports CSV de chaque source pour chaque site. Les données sont sauvegardées automatiquement dans Supabase et rechargées à chaque session. Tu peux aussi glisser un fichier depuis l'historique vers une carte.",
  },
  overview: {
    icon: "🗺️",
    title: "Vue d'ensemble",
    content: "Agrégats site-level : indicateurs techniques SF, trafic GSC/GA4, citations Bing AI et données Semrush. Le radar compare les sites sur les dimensions clés. Filtre par mode de page (Toutes / Top SEO / Top GEO).",
  },
  matrix: {
    icon: "🔢",
    title: "Matrice de corrélation",
    content: "Coefficient de Pearson r entre chaque dimension technique (SF) et chaque KPI résultat (GSC, GA4, Bing). Hover sur une cellule pour l'interpréter. Les deltas indiquent l'écart entre le filtre actif et toutes les pages.",
  },
  pages: {
    icon: "📄",
    title: "Analyse par page",
    content: "Vue page par page des données SF, GSC et Bing. En mode 'Toutes les pages', les métriques de chaque URL sont affichées. Les filtres Top SEO et Top GEO restreignent aux pages les plus performantes.",
  },
  analyse: {
    icon: "✦",
    title: "Analyse IA",
    content: "Génère une analyse stratégique basée sur la matrice de corrélation et les KPIs. Les recommandations sont sauvegardées, taggées par site et priorisées avec un score ICE (Impact / Confiance / Effort).",
  },
  sites: {
    icon: "🏢",
    title: "Comparaison des sites",
    content: "Comparaison détaillée site par site sur toutes les dimensions SF. Identifie les forces et faiblesses relatives de chaque domaine selon le mode de page sélectionné.",
  },
  semrush: {
    icon: "📊",
    title: "Semrush · Position Tracking",
    content: "Positions organiques, trafic estimé et opportunités par page importés depuis Semrush. Inclut les corrélations entre les métriques Semrush et les KPIs GSC/GA4/Bing.",
  },
  allprojects: {
    icon: "◈",
    title: "Tous les projets",
    content: "Vue consolidée de tous tes projets : matrice et radar calculés sur l'ensemble des pages. Permet de comparer des stratégies entre projets distincts.",
  },
};

export default function InfoCard({ tabKey }) {
  const [open, setOpen] = useState(false);
  const info = PAGE_INFO[tabKey];
  if (!info) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 14px", fontSize: 12, color: C.textMid, userSelect: "none", transition: "all 0.15s" }}
      >
        <span style={{ fontSize: 14 }}>{info.icon}</span>
        <span style={{ fontWeight: 600 }}>{info.title}</span>
        <span style={{ color: C.textLight, fontSize: 11, marginLeft: 4 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 8, background: C.blueLight, border: `1px solid #BFDBFE`, borderRadius: 10, padding: "12px 16px", fontSize: 12, color: "#1E40AF", lineHeight: 1.7, maxWidth: 680 }}>
          {info.content}
        </div>
      )}
    </div>
  );
}