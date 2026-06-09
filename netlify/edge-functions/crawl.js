// netlify/edge-functions/crawl.js
// Proxy de crawl léger pour la génération de questions depuis une URL.
// Contrat : POST { url }  →  { sections: [{ title, text }] }
// Déclare son propre chemin (comme les autres proxies du projet) via `config.path`.

export const config = { path: "/api/crawl" };

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

// Réponse JSON garantie (le client rejette toute réponse HTML).
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// Décodage des entités HTML les plus courantes + entités numériques.
function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ""; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } });
}

// Nettoie un fragment HTML → texte simple.
function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<[^>]+>/g, " ")  // retire les balises
      .replace(/\s+/g, " ")
      .trim()
  );
}

// Bloque les cibles internes (anti-SSRF basique).
function isBlockedHost(hostname) {
  const h = (hostname || "").toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // link-local / metadata
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true; // 172.16-31.x
  return false;
}

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Méthode non autorisée (POST attendu)" }, 405);

  let url;
  try {
    const body = await request.json();
    url = (body && body.url ? String(body.url) : "").trim();
  } catch {
    return json({ error: "Corps JSON invalide" }, 400);
  }
  if (!url) return json({ error: "Paramètre 'url' manquant" }, 400);
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  let target;
  try { target = new URL(url); } catch { return json({ error: "URL invalide" }, 400); }
  if (target.protocol !== "http:" && target.protocol !== "https:") return json({ error: "Protocole non supporté" }, 400);
  if (isBlockedHost(target.hostname)) return json({ error: "Hôte non autorisé" }, 400);

  // Récupération de la page (timeout 12 s).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let res;
  try {
    res = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CorrelDashCrawler/1.0; +https://correledash.netlify.app)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fr,en;q=0.8",
      },
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e && (e.name === "AbortError");
    return json({ error: aborted ? "Délai dépassé en récupérant la page" : `Échec de récupération : ${e?.message || e}` }, 502);
  }
  clearTimeout(timer);

  if (!res.ok) return json({ error: `La page a répondu ${res.status}` }, 502);
  const ctype = res.headers.get("content-type") || "";
  if (ctype && !/text\/html|application\/xhtml|text\/plain/i.test(ctype)) {
    return json({ error: `Type de contenu non exploitable (${ctype.split(";")[0]})` }, 415);
  }

  let html = "";
  try { html = await res.text(); } catch { return json({ error: "Lecture du contenu impossible" }, 502); }
  if (html.length > 3_000_000) html = html.slice(0, 3_000_000); // borne de sécurité

  // Retire les blocs non textuels.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Titre de la page (fallback).
  const titleMatch = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = titleMatch ? htmlToText(titleMatch[1]) : (target.hostname || "Page");

  // Corps : on travaille sur <body> si présent.
  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const scope = bodyMatch ? bodyMatch[1] : cleaned;

  // Découpe par titres h1–h3.
  const headingRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const heads = [];
  let m;
  while ((m = headingRe.exec(scope)) !== null) {
    heads.push({ index: m.index, end: headingRe.lastIndex, title: htmlToText(m[2]) });
  }

  const sections = [];
  if (heads.length) {
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      const sliceEnd = i + 1 < heads.length ? heads[i + 1].index : scope.length;
      const text = htmlToText(scope.slice(h.end, sliceEnd)).slice(0, 1200);
      if (h.title || text) sections.push({ title: h.title || pageTitle, text });
      if (sections.length >= 40) break;
    }
  }

  // Fallback : aucune structure de titres → une section unique.
  if (!sections.length) {
    const text = htmlToText(scope).slice(0, 4000);
    if (text) sections.push({ title: pageTitle, text });
  }

  if (!sections.length) return json({ error: "Aucun contenu textuel exploitable sur cette page" }, 422);

  return json({ url: target.toString(), title: pageTitle, sections });
};