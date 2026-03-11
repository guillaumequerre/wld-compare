/**
 * GEO-readiness Score — 0 à 100
 * Pondéré par r² des corrélations SF × KPIs (matrice Tous les projets)
 * Chaque dimension est normalisée sur sa plage percentile 5/95 typique
 */

import { safeNum } from "./helpers";

// Corrélations r et direction (1=higher=better, -1=lower=better)
const DIMS = [
  { key: "avgFlesch",      r: 0.55, dir:  1 },
  { key: "avgInlinksUniq", r: 0.52, dir:  1 },
  { key: "avgWords",       r: 0.45, dir:  1 },
  { key: "schemaRate",     r: 0.38, dir:  1 },
  { key: "avgTitleLen",    r: 0.35, dir:  1 },
  { key: "avgDepth",       r: 0.35, dir: -1 },
  { key: "tableRate",      r: 0.32, dir:  1 },
  { key: "avgH1Len",       r: 0.30, dir:  1 },
  { key: "errorRate",      r: 0.30, dir: -1 },
  { key: "avgMetaLen",     r: 0.25, dir:  1 },
  { key: "avgPageSizeKB",  r: 0.22, dir: -1 },
  { key: "redirectRate",   r: 0.22, dir: -1 },
  { key: "avgImgSizeKB",   r: 0.15, dir: -1 },
];

// Plages de normalisation (min/max raisonnables)
const RANGES = {
  avgTitleLen:    [0,   65],
  avgMetaLen:     [0,  160],
  avgH1Len:       [0,   80],
  avgWords:       [0, 2000],
  avgPageSizeKB:  [50,  500],
  avgImgSizeKB:   [5,   200],
  avgInlinksUniq: [0,    50],
  avgFlesch:      [0,   100],
  tableRate:      [0,     1],
  schemaRate:     [0,     1],
  avgDepth:       [1,     6],
  errorRate:      [0,    20],
  redirectRate:   [0,    15],
};

// Poids normalisés (r² / Σr²)
const totalR2 = DIMS.reduce((s, d) => s + d.r ** 2, 0);
const WEIGHTS = Object.fromEntries(DIMS.map(d => [d.key, d.r ** 2 / totalR2]));

function normalizeDim(key, value, dir) {
  const [lo, hi] = RANGES[key] || [0, 100];
  if (hi === lo) return 0.5;
  const r = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return dir === 1 ? r : 1 - r;
}

/**
 * Score agrégé pour un site (à partir de ses métriques SF moyennes)
 * @param {object} sfMetrics — output de extractSF (avgFlesch, schemaRate, etc.)
 * @returns {{ score: number, detail: object }}
 */
export function computeSiteScore(sfMetrics) {
  if (!sfMetrics) return { score: null, detail: {} };
  let total = 0;
  const detail = {};
  for (const { key, dir } of DIMS) {
    const val = safeNum(sfMetrics[key] ?? null);
    if (val === null || val === undefined) continue;
    const norm = normalizeDim(key, val, dir);
    const pts = norm * WEIGHTS[key] * 100;
    total += pts;
    detail[key] = { value: val, norm: Math.round(norm * 100) / 100, pts: Math.round(pts * 10) / 10 };
  }
  return { score: Math.round(total), detail };
}

/**
 * Score pour une page individuelle (à partir d'une row SF buildSfPageVectors)
 * @param {object} page — un objet page issu de buildSfPageVectors
 * @returns {{ score: number, detail: object }}
 */
export function computePageScore(page) {
  if (!page) return { score: null, detail: {} };
  // tableRate et schemaRate sont 0/1 par page dans buildSfPageVectors
  return computeSiteScore(page);
}

/**
 * Label et couleur selon le score
 */
export function scoreLabel(score) {
  if (score === null) return { label: "—", color: "#94A3B8", bg: "#F1F5F9" };
  if (score >= 75)   return { label: "Excellent",  color: "#059669", bg: "#ECFDF5" };
  if (score >= 55)   return { label: "Bon",        color: "#16A34A", bg: "#F0FDF4" };
  if (score >= 35)   return { label: "Moyen",      color: "#D97706", bg: "#FFFBEB" };
  if (score >= 20)   return { label: "Faible",     color: "#DC2626", bg: "#FEF2F2" };
  return                    { label: "Critique",   color: "#991B1B", bg: "#FEE2E2" };
}

/**
 * Top actions pour améliorer le score d'une page
 * Retourne les 3 dimensions avec le plus grand potentiel de gain
 */
export function topImprovements(page, sfMetrics) {
  const vals = page || sfMetrics;
  if (!vals) return [];
  const actions = [];
  for (const { key, dir } of DIMS) {
    const val = safeNum(vals[key] ?? null);
    if (val === null) continue;
    const currentNorm = normalizeDim(key, val, dir);
    const maxPts = WEIGHTS[key] * 100;
    const currentPts = currentNorm * maxPts;
    const potential = maxPts - currentPts; // points laissés sur la table
    if (potential > 0.5) actions.push({ key, potential: Math.round(potential * 10) / 10, currentPts: Math.round(currentPts * 10) / 10, maxPts: Math.round(maxPts * 10) / 10 });
  }
  return actions.sort((a, b) => b.potential - a.potential).slice(0, 3);
}