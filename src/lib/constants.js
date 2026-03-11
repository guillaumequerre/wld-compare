// ── DESIGN TOKENS ───────────────────────────────────────────────
export const C = {
  bg: "#FAFAFA", white: "#FFFFFF", border: "#E8E8ED", borderLight: "#F0F0F5",
  text: "#0D0D14", textMid: "#4A4A5A", textLight: "#9090A0",
  blue: "#2563EB", blueLight: "#EFF6FF",
  green: "#059669", greenLight: "#ECFDF5",
  amber: "#D97706", amberLight: "#FFFBEB",
  red: "#DC2626", redLight: "#FEF2F2",
  purple: "#7C3AED", purpleLight: "#F5F3FF",
  teal: "#0891B2", tealLight: "#ECFEFF",
};

export const SITE_PALETTE = [
  { color: "#2563EB", bg: "#EFF6FF" },
  { color: "#059669", bg: "#ECFDF5" },
  { color: "#7C3AED", bg: "#F5F3FF" },
];

export const DEFAULT_SITES = [
  { id: "site-1", label: "wedig.fr",      color: "#2563EB", bg: "#EFF6FF" },
  { id: "site-2", label: "deux.io",       color: "#059669", bg: "#ECFDF5" },
  { id: "site-3", label: "lets-clic.com", color: "#7C3AED", bg: "#F5F3FF" },
];

export const SF_DIMS = [
  { key: "avgTitleLen",     label: "Longueur moy. title (car.)", higher: true  },
  { key: "avgMetaLen",      label: "Longueur moy. meta (car.)",  higher: true  },
  { key: "avgH1Len",        label: "Longueur moy. H1 (car.)",    higher: true  },
  { key: "avgWords",        label: "Mots moyens / page",         higher: true  },
  { key: "avgPageSizeKB",   label: "Poids pages contenu (KB)",   higher: false },
  { key: "avgImgSizeKB",    label: "Poids moyen images (KB)",    higher: false },
  { key: "avgInlinksUniq",  label: "Liens entrants uniques moy.", higher: true  },
  { key: "avgOutlinksUniq", label: "Liens sortants uniques moy.", higher: true  },
  { key: "avgExtLinksUniq", label: "Liens ext. uniques moy.",    higher: false },
  { key: "avgDepth",        label: "Profondeur crawl moy.",      higher: false },
  { key: "avgFlesch",       label: "Score Flesch moy.",          higher: true  },
  { key: "tableRate",       label: "Pages avec tableau (%)",     higher: true  },
  { key: "schemaRate",      label: "Pages avec Schema (%)",      higher: true  },
  { key: "errorRate",       label: "Taux d'erreurs (%)",         higher: false },
  { key: "redirectRate",    label: "Taux redirections (%)",      higher: false },
  { key: "totalPages",      label: "Nb pages crawlées",          higher: true  },
];

export const RES_KPIS = [
  { key: "clicks",      label: "Clics GSC",       src: "gsc"  },
  { key: "impressions", label: "Impressions GSC",  src: "gsc"  },
  { key: "ctr",         label: "CTR (%)",          src: "gsc"  },
  { key: "position",    label: "Position moy.",    src: "gsc"  },
  { key: "sessions",    label: "Sessions GA4",     src: "ga"   },
  { key: "views",       label: "Vues GA4",         src: "ga"   },
  { key: "geoMentions", label: "Citations Bing AI", src: "bing" },
];

export const PAGE_MODES = [
  { key: "all",  label: "Toutes les pages",      icon: "📄" },
  { key: "geo",  label: "Top succès GEO (Bing)", icon: "🤖" },
  { key: "seo",  label: "Top succès SEO (GSC)",  icon: "🔍" },
];

export const SCHEMA_TYPES = [
  "Article", "BlogPosting", "Product", "Offer", "FAQPage",
  "BreadcrumbList", "Organization", "LocalBusiness", "WebPage",
  "Service", "Event", "Person", "Review", "HowTo",
];

export const RADAR_DIMS = [
  { key: "totalPages",      label: "Pages",          max: 5000 },
  { key: "totalImg",        label: "Images",         max: 2000 },
  { key: "avgInlinksUniq",  label: "Inlinks uniq.",  max: 100  },
  { key: "avgOutlinksUniq", label: "Outlinks uniq.", max: 100  },
  { key: "avgExtLinksUniq", label: "Liens ext.",     max: 50   },
  { key: "indexableRate",   label: "Indexables %",   max: 100  },
  { key: "avgWords",        label: "Mots moy.",      max: 1000 },
];

export const SF_DIM_TOOLTIPS = {
  avgTitleLen:    "Longueur moyenne des balises title en caractères. Idéalement entre 30 et 65 car. pour Google.",
  avgMetaLen:     "Longueur moyenne des meta descriptions en caractères. Idéalement entre 100 et 160 car.",
  avgH1Len:       "Longueur moyenne des H1 en caractères. Un H1 présent et descriptif est essentiel pour le SEO et le GEO.",
  avgWords:       "Nombre moyen de mots par page HTML. Plus de contenu (500+ mots) favorise le positionnement et la compréhension GEO.",
  avgPageSizeKB:  "Poids moyen des pages HTML en KB. Des pages légères améliorent le Core Web Vitals et l'expérience mobile.",
  avgImgSizeKB:   "Poids moyen des images en KB. Des images lourdes ralentissent le chargement — impact direct sur le classement.",
  avgInlinks:     "Nombre moyen de liens internes pointant vers chaque page.",
  avgOutlinks:    "Nombre moyen de liens sortants par page.",
  avgInlinksUniq: "Nombre moyen de liens entrants uniques (déduplication des sources). Indicateur clé du maillage interne réel.",
  avgOutlinksUniq:"Nombre moyen de liens sortants uniques par page. Un excès peut diluer l'autorité.",
  avgExtLinksUniq:"Nombre moyen de liens sortants externes uniques. Trop de liens externes peut diluer l'autorité de la page.",
  avgDepth:       "Profondeur de crawl moyenne depuis la home. Au-delà de 4 niveaux, les pages sont moins bien indexées.",
  avgFlesch:      "Score de lisibilité Flesch (0-100). Au-dessus de 60 = texte accessible. Important pour l'engagement et la compréhension GEO.",
  tableRate:      "% de pages avec un tableau HTML. Les tableaux structurent l'information et favorisent les rich snippets et réponses AI.",
  schemaRate:     "% de pages avec un schema JSON-LD. Aide Google et les LLMs à comprendre le type et le contenu de la page.",
  errorRate:      "% de pages en erreur HTTP 4xx. Ces pages nuisent au crawl budget et à l'expérience utilisateur.",
  redirectRate:   "% d'URLs en redirection 3xx. Consomment du crawl budget et peuvent diluer le PageRank si en chaîne.",
  totalPages:     "Nombre total de pages HTML crawlées. Donne la taille du site indexable.",
};

export const KPI_TOOLTIPS = {
  "Clics GSC":         "Nombre total de clics organiques reçus depuis Google Search. Mesure directe de la performance SEO en trafic réel.",
  "Impressions GSC":   "Nombre de fois où vos pages sont apparues dans les résultats Google. Élevé avec peu de clics = problème de CTR ou de pertinence.",
  "CTR (%)":           "Taux de clic (Clics ÷ Impressions). Un CTR faible peut indiquer un title/meta peu attractif ou un mauvais positionnement.",
  "Position moy.":     "Position moyenne dans Google Search. En dessous de 10 = première page. Chaque point gagné peut multiplier le trafic.",
  "Sessions GA4":      "Nombre de sessions initiées sur le site. Reflète le volume de visites réel, toutes sources confondues.",
  "Vues GA4":          "Nombre total de pages vues (GA4 Views). Inclut les visites multiples d'une même page dans une session.",
  "Citations Bing AI": "Nombre de fois où vos pages sont citées dans les réponses générées par Bing AI (Copilot). Métrique clé du GEO.",
};