// netlify/edge-functions/geo-scheduler.js
// DISPATCHER LÉGER — Edge Function (cron + trigger manuel)
// Ne fait PLUS le travail lourd (qui dépassait le timeout ~50s des Edge Functions).
// Il invoque la BACKGROUND FUNCTION geo-scheduler-background (timeout 15 min)
// en fire-and-forget, puis retourne 202 immédiatement.

export const config = {
  schedule: "0 * * * *",   // chaque heure (cron Netlify)
  path: "/api/geo-scheduler",
};

export default async function(request) {
  const secret    = request.headers.get("X-Scheduler-Secret");
  const envSecret = Deno.env.get("SCHEDULER_SECRET");
  if (request.method === "POST" && envSecret && secret !== envSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // Déterminer force (POST manuel = forcé par défaut)
  let force = request.method === "POST";
  if (request.method === "POST") {
    try {
      const body = await request.clone().json().catch(() => ({}));
      if (body?.force === false) force = false;
    } catch {}
  }

  // URL absolue de la background function (même origine)
  const origin = new URL(request.url).origin;
  const bgUrl  = `${origin}/.netlify/functions/geo-scheduler-background`;

  // Fire-and-forget : on déclenche la background function sans attendre sa fin.
  // La background renvoie 202 et continue jusqu'à 15 min en arrière-plan.
  try {
    // On n'attend volontairement PAS la réponse complète : un court timeout
    // suffit pour que Netlify accepte la requête et lance le job asynchrone.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    fetch(bgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
      signal: controller.signal,
    }).catch(() => {}).finally(() => clearTimeout(t));
  } catch {}

  // Réponse immédiate — pas de timeout possible
  return new Response(JSON.stringify({
    ok: true,
    dispatched: true,
    message: "Interrogation automatique lancée en arrière-plan. Les résultats apparaîtront dans l'onglet Questions dans quelques minutes.",
  }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
}