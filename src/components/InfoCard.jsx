import { useState } from "react";
import { C } from "../lib/constants";

const PAGE_INFO = {
  import: {
    objectif: "Centraliser tous les exports CSV de tes outils SEO et GEO pour chaque site du projet. Sans données importées, aucun calcul ni comparaison n'est possible.",
    fonctionnement: "Glisse-dépose ou sélectionne un fichier CSV pour chaque outil (Screaming Frog, GSC, GA4, Bing, Semrush) et chaque site. Les fichiers sont uploadés dans Supabase et rechargés automatiquement à chaque session. L'historique des imports est accessible via le bouton dédié.",
  },
  overview: {
    objectif: "Obtenir une vue agrégée et comparative de tous les sites du projet sur l'ensemble des métriques clés : technique SF, trafic organique, visibilité GEO et positionnement Semrush.",
    fonctionnement: "Les indicateurs sont calculés site par site à partir des fichiers importés. Le radar synthétise les 6 dimensions SF en un seul graphique. Le sélecteur de mode (Toutes / Top SEO / Top GEO) filtre les pages prises en compte dans les calculs.",
  },
  matrix: {
    objectif: "Identifier quelles dimensions techniques (SF) sont statistiquement liées aux performances SEO et GEO. C'est le cœur analytique du dashboard : trouver les leviers actionnables.",
    fonctionnement: "Chaque cellule contient le coefficient de Pearson r entre une dimension SF (ligne) et un KPI résultat (colonne), calculé page par page sur les URLs présentes dans les deux sources. Survole une cellule pour l'interpréter. En mode filtre actif, le delta indique l'écart par rapport à toutes les pages.",
  },
  pages: {
    objectif: "Explorer les données à l'échelle de l'URL pour identifier les pages sur- ou sous-performantes et comprendre leur profil technique.",
    fonctionnement: "En mode 'Toutes les pages', un tableau complet liste chaque URL avec ses métriques SF, clics GSC et citations Bing — triable et filtrable. En mode Top SEO ou Top GEO, la vue bascule sur les top pages par site selon la source sélectionnée.",
  },
  analyse: {
    objectif: "Générer des insights stratégiques et des recommandations actionnables à partir des corrélations et des KPIs, puis suivre leur mise en œuvre dans le temps.",
    fonctionnement: "Claude Sonnet analyse la matrice de corrélation et les données de chaque site pour produire des insights SEO/GEO et une roadmap par horizon temporel. Chaque action est parsée en recommandation individuelle, scorée ICE, taggée par site et sauvegardée en base. Les recommandations persistent d'une session à l'autre et peuvent être cochées une fois réalisées.",
  },
  sites: {
    objectif: "Comparer les sites entre eux outil par outil pour repérer les forces et faiblesses relatives de chaque domaine sur chaque dimension.",
    fonctionnement: "Les cartes sont organisées par outil (SF, GSC, GA4, Bing AI). Pour chaque outil, tous les sites sont affichés côte à côte avec leurs métriques clés. Le sélecteur de mode filtre les pages incluses dans le calcul.",
  },
  semrush: {
    objectif: "Analyser la visibilité organique issue du Position Tracking Semrush : mots-clés positionnés, trafic estimé et opportunités page par page, puis croiser ces données avec les KPIs du dashboard.",
    fonctionnement: "Importe un export CSV Semrush Position Tracking dans l'onglet Import. Les pages sont agrégées avec leurs métriques (Top 3, Top 10, opportunités pos. 11-20, trafic estimé). La matrice de corrélation Semrush montre les liens entre ces métriques et les KPIs GSC/GA4/Bing.",
  },
  allprojects: {
    objectif: "Comparer plusieurs projets entre eux en visualisant leurs matrices et radars sur un même écran, pour identifier des patterns stratégiques cross-projets.",
    fonctionnement: "Chaque projet chargé en base apparaît avec sa propre matrice de corrélation agrégée et son radar SF. Les projets sans données importées sont affichés vides. La navigation entre projets se fait depuis ce même onglet.",
  },
  evolution: {
    objectif: "Suivre l'évolution des métriques dans le temps toutes sources confondues (SF, GSC, GA4, Bing, Semrush) et corréler les changements observés avec les actions réalisées sur le site.",
    fonctionnement: "Après chaque import, clique sur '📌 Sauvegarder' pour créer un snapshot. Les valeurs GSC/GA4/Semrush sont normalisées par jour (÷ durée de la période) pour être comparables. Les jalons marquent les actions clés sur la courbe. Le tableau delta compare le dernier snapshot au précédent pour chaque source.",
  },
};

export default function InfoCard({ tabKey }) {
  const [open, setOpen] = useState(false);
  const info = PAGE_INFO[tabKey];
  if (!info) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", background: "transparent", border: "none", padding: 0, fontSize: 12, color: C.textLight, userSelect: "none" }}
      >
        <span style={{ fontSize: 13 }}>ⓘ</span>
        <span style={{ textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>À quoi sert cette page ?</span>
        <span style={{ fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ marginTop: 10, background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px", maxWidth: 680, lineHeight: 1.7 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.9, color: C.blue, marginBottom: 5 }}>Objectif</div>
            <div style={{ fontSize: 13, color: C.textMid }}>{info.objectif}</div>
          </div>
          <div style={{ borderTop: `1px solid ${C.borderLight}`, paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.9, color: C.blue, marginBottom: 5 }}>Fonctionnement</div>
            <div style={{ fontSize: 13, color: C.textMid }}>{info.fonctionnement}</div>
          </div>
        </div>
      )}
    </div>
  );
}