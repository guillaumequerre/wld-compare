const PROXY = "/api/supabase";

function authHeaders(extra = {}) {
  try {
    const s = sessionStorage.getItem("correl_session") || localStorage.getItem("correl_session");
    const token = s ? JSON.parse(s).access_token : null;
    if (token) return { "Authorization": `Bearer ${token}`, ...extra };
  } catch {}
  return extra;
}

// Cache de la config Supabase publique (URL + anon key)
let _sbConfig = null;
async function getDirectConfig() {
  if (_sbConfig) return _sbConfig;
  try {
    const res = await fetch("/api/supabase-info"); // pas d'auth nécessaire
    if (res.ok) { _sbConfig = await res.json(); return _sbConfig; }
  } catch {}
  return null;
}

export async function sbUpload(path, csvText) {
  // Upload direct vers Supabase Storage (bypass proxy Netlify — limite 1MB)
  const cfg = await getDirectConfig();
  const jwt = (() => {
    try {
      const s = sessionStorage.getItem("correl_session") || localStorage.getItem("correl_session");
      return s ? JSON.parse(s).access_token : null;
    } catch { return null; }
  })();

  if (cfg?.url && cfg?.anon) {
    // Upload direct — pas de limite Netlify
    const res = await fetch(`${cfg.url}/storage/v1/object/csv-imports/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/csv",
        "x-upsert": "true",
        "apikey": cfg.anon,
        "Authorization": jwt ? `Bearer ${jwt}` : `Bearer ${cfg.anon}`,
      },
      body: csvText,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Upload failed: ${res.status} — ${body.slice(0, 120)}`);
    }
    return path;
  }

  // Fallback: proxy Netlify (limité ~1MB)
  const res = await fetch(`${PROXY}/storage/v1/object/csv-imports/${path}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "text/csv", "x-upsert": "true" },
    body: csvText,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Upload failed: ${res.status} — ${body.slice(0, 120)}`);
  }
  return path;
}

export async function sbInsertImport({ project_id, site_id, source, filename, storage_path, row_count }) {
  const res = await fetch(`${PROXY}/rest/v1/imports`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ project_id, site_id, source, filename, storage_path, row_count, uploaded_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Insert failed: ${res.status} — ${body.slice(0, 120)}`);
  }
  return res.json();
}

export async function sbDeleteImport(id) {
  const res = await fetch(`${PROXY}/rest/v1/imports?id=eq.${id}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(`Delete import failed: ${res.status}`);
}

export async function sbDeleteFile(storage_path) {
  const res = await fetch(`${PROXY}/storage/v1/object/csv-imports/${storage_path}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(`Delete file failed: ${res.status}`);
}

export async function sbGetHistory(projectId, limit = 50) {
  const filter = projectId ? `&project_id=eq.${encodeURIComponent(projectId)}` : "";
  const res = await fetch(`${PROXY}/rest/v1/imports?select=*&order=uploaded_at.desc&limit=${limit}${filter}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Fetch history failed: ${res.status}`);
  return res.json();
}

export async function sbGetLatest(projectId) {
  const filter = projectId ? `&project_id=eq.${encodeURIComponent(projectId)}` : "";
  const res = await fetch(`${PROXY}/rest/v1/imports?select=*&order=uploaded_at.desc&limit=200${filter}`, { headers: authHeaders() });
  if (!res.ok) return {};
  const rows = await res.json();
  const latest = {};
  for (const row of rows) {
    const key = `${row.site_id}_${row.source}`;
    if (!latest[key]) latest[key] = row;
  }
  return latest;
}

export async function sbDownload(storage_path) {
  const res = await fetch(`${PROXY}/storage/v1/object/csv-imports/${storage_path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.text();
}

export async function sbSaveProject(project) {
  const res = await fetch(`${PROXY}/rest/v1/projects`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ id: project.id, name: project.name, owner_email: project.owner_email || null, semrush_key_enc: project.semrush_key_enc || null, sites_json: JSON.stringify(project.sites.map(s => ({ id: s.id, label: s.label, color: s.color, bg: s.bg }))), geo_axes_json: JSON.stringify(project.geo_axes || ["Meilleur / top / recommandé","Pistes et approches pour utiliser / bénéficier du mot-clé","Avis / fiable / fiabilité","Pour atteindre un objectif lié au mot-clé","Pour résoudre une problématique liée au mot-clé"]), updated_at: new Date().toISOString() }),
  });
  if (!res.ok) console.warn("Save project failed:", res.status);
}

export async function sbLoadProjects() {
  const res = await fetch(`${PROXY}/rest/v1/projects?select=*&order=created_at.asc`, { headers: authHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.map(r => ({ id: r.id, name: r.name, sites: JSON.parse(r.sites_json || "[]"), openai_key_enc: r.openai_key_enc || null, geo_axes: JSON.parse(r.geo_axes_json || "null") || ["Meilleur / top / recommandé","Pistes et approches pour utiliser / bénéficier du mot-clé","Avis / fiable / fiabilité","Pour atteindre un objectif lié au mot-clé","Pour résoudre une problématique liée au mot-clé"], gemini_key_enc: r.gemini_key_enc || null, perplexity_key_enc: r.perplexity_key_enc || null, claude_geo_key_enc: r.claude_geo_key_enc || null }));
}

export async function sbDeleteProject(projectId) {
  await fetch(`${PROXY}/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}`, { method: "DELETE", headers: authHeaders() });
}

// ── ANALYSES ─────────────────────────────────────────────────────
export async function sbSaveAnalysis({ id, project_id, content }) {
  const res = await fetch(`${PROXY}/rest/v1/analyses`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ id, project_id, content }),
  });
  if (!res.ok) throw new Error(`Save analysis failed: ${res.status}`);
  return res.json();
}

export async function sbGetLatestAnalysis(project_id) {
  const res = await fetch(`${PROXY}/rest/v1/analyses?project_id=eq.${encodeURIComponent(project_id)}&order=created_at.desc&limit=1`, { headers: authHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// ── RECOMMENDATIONS ───────────────────────────────────────────────
export async function sbSaveRecommendations(recs) {
  if (!recs.length) return;
  const res = await fetch(`${PROXY}/rest/v1/recommendations`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(recs),
  });
  if (!res.ok) throw new Error(`Save recommendations failed: ${res.status}`);
  return res.json();
}

export async function sbGetRecommendations(project_id) {
  const res = await fetch(`${PROXY}/rest/v1/recommendations?project_id=eq.${encodeURIComponent(project_id)}&order=created_at.desc&limit=200`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function sbUpdateRecommendation(id, patch) {
  const res = await fetch(`${PROXY}/rest/v1/recommendations?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Update recommendation failed: ${res.status}`);
}

// ── PAGE TYPES ───────────────────────────────────────────────────
export async function sbSavePageTypes(rows) {
  if (!rows.length) return;
  const res = await fetch(`${PROXY}/rest/v1/page_types`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) console.warn("sbSavePageTypes failed:", res.status);
  return res.ok;
}

export async function sbGetPageTypes(project_id, site_id) {
  const params = new URLSearchParams({ project_id: `eq.${project_id}`, site_id: `eq.${site_id}`, select: "url,page_type,confidence" });
  const res = await fetch(`${PROXY}/rest/v1/page_types?${params}`, {
    headers: { ...authHeaders(), "Content-Type": "application/json" },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function sbDeletePageTypes(project_id, site_id) {
  const params = new URLSearchParams({ project_id: `eq.${project_id}`, site_id: `eq.${site_id}` });
  const res = await fetch(`${PROXY}/rest/v1/page_types?${params}`, {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
  });
  return res.ok;
}

// ── SNAPSHOTS ─────────────────────────────────────────────────────
export async function sbSaveSnapshot(snap) {
  const res = await fetch(`${PROXY}/rest/v1/snapshots`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(snap),
  });
  if (!res.ok) throw new Error(`Save snapshot failed: ${res.status}`);
  return res.json();
}

export async function sbGetSnapshots(project_id, site_id) {
  const q = `project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&order=date_end.asc`;
  const res = await fetch(`${PROXY}/rest/v1/snapshots?${q}`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function sbDeleteSnapshot(id) {
  const res = await fetch(`${PROXY}/rest/v1/snapshots?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
  });
  return res.ok;
}

// ── MILESTONES ────────────────────────────────────────────────────
export async function sbSaveMilestone(m) {
  const res = await fetch(`${PROXY}/rest/v1/milestones`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "return=representation" },
    body: JSON.stringify(m),
  });
  if (!res.ok) throw new Error(`Save milestone failed: ${res.status}`);
  return res.json();
}

export async function sbGetMilestones(project_id) {
  const res = await fetch(`${PROXY}/rest/v1/milestones?project_id=eq.${encodeURIComponent(project_id)}&order=milestone_date.asc`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function sbDeleteMilestone(id) {
  const res = await fetch(`${PROXY}/rest/v1/milestones?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
  });
  return res.ok;
}

export async function sbUpdateMilestone(id, patch) {
  const res = await fetch(`${PROXY}/rest/v1/milestones?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.ok;
}

// ── GEO — BRAND SETTINGS ─────────────────────────────────────────

export async function sbSaveBrand({ project_id, site_id, brand_name, brand_domain, brand_aliases, competitors, context }) {
  const res = await fetch(`${PROXY}/rest/v1/site_brand`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ project_id, site_id, brand_name, brand_domain, brand_aliases, competitors, context, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Save brand failed: ${res.status}`);
  return res.json();
}

export async function sbGetBrand(project_id, site_id) {
  const res = await fetch(`${PROXY}/rest/v1/site_brand?project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&limit=1`, { headers: authHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// ── GEO — OPENAI KEY (encrypted) on project ──────────────────────

export async function sbSaveGeoAxes(project_id, axes) {
  const res = await fetch(`${PROXY}/rest/v1/projects?id=eq.${encodeURIComponent(project_id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ geo_axes_json: JSON.stringify(axes) }),
  });
  return res.ok;
}

// ── GEO — KEYWORDS ───────────────────────────────────────────────

export async function sbSaveKeywords(rows) {
  // rows: [{ project_id, site_id, keyword }]
  const res = await fetch(`${PROXY}/rest/v1/geo_keywords`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Save keywords failed: ${res.status}`);
  return res.json();
}

export async function sbGetKeywords(project_id, site_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_keywords?project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&order=created_at.asc`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function sbUpdateKeywordStatus(id, status) {
  const res = await fetch(`${PROXY}/rest/v1/geo_keywords?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return res.ok;
}

export async function sbUpdateKeywordVolume(id, volume, source = "semrush_api") {
  const res = await fetch(`${PROXY}/rest/v1/geo_keywords?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ search_volume: volume, volume_source: source, volume_updated_at: new Date().toISOString() }),
  });
  return res.ok;
}

export async function sbDeleteKeyword(id) {
  await fetch(`${PROXY}/rest/v1/geo_keywords?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders() });
}

// ── GEO — QUESTIONS ──────────────────────────────────────────────

export async function sbSaveQuestions(rows) {
  if (!rows.length) return [];
  const res = await fetch(`${PROXY}/rest/v1/geo_questions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation,resolution=ignore-duplicates",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Save questions failed: ${res.status} — ${errText.slice(0, 200)}`);
  }
  const saved = await res.json();
  // ignore-duplicates returns [] for existing rows — fetch them back
  if (Array.isArray(saved) && saved.length === 0 && rows.length > 0) {
    const pid = rows[0].project_id;
    const sid = rows[0].site_id;
    const texts = rows.map(r => r.question);
    const qs = encodeURIComponent("(" + texts.map(t => `"${t.replace(/"/g, '\\"')}"`).join(",") + ")");
    const res2 = await fetch(`${PROXY}/rest/v1/geo_questions?project_id=eq.${encodeURIComponent(pid)}&site_id=eq.${encodeURIComponent(sid)}&question=in.${qs}&select=*`);
    if (res2.ok) return res2.json();
  }
  return saved;
}

export async function sbGetQuestions(project_id, site_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_questions?project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&order=created_at.asc&select=*`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function sbUpdateQuestion(id, patch) {
  if (!id || id.startsWith("tmp-")) return false; // skip optimistic/temp IDs
  const res = await fetch(`${PROXY}/rest/v1/geo_questions?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    console.error("sbUpdateQuestion failed:", res.status, id, patch);
    return false;
  }
  return res.json();
}

export async function sbDeleteQuestion(id) {
  await fetch(`${PROXY}/rest/v1/geo_questions?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders() });
}

// ── GEO — RESULTS ────────────────────────────────────────────────

export async function sbSaveGeoResult(result) {
  // Derive provider_id from model label for upsert deduplication
  const model = result.model || "";
  let provider_id = "other";
  if (model.toLowerCase().includes("openai") || model.toLowerCase().includes("gpt")) provider_id = "openai";
  else if (model.toLowerCase().includes("gemini")) provider_id = "gemini";
  else if (model.toLowerCase().includes("perplexity") || model.toLowerCase().includes("sonar")) provider_id = "perplexity";
  else if (model.toLowerCase().includes("claude")) provider_id = "claude";

  const row = { ...result, provider_id, updated_at: new Date().toISOString() };

  const res = await fetch(`${PROXY}/rest/v1/geo_results`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Upsert on (question_id, provider_id) — updates existing card instead of creating new
      "Prefer": "return=representation,resolution=merge-duplicates",
      "on-conflict": "question_id,provider_id",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Save geo result failed: ${res.status}`);
  return res.json();
}

export async function sbGetGeoResultsAll(project_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_results?project_id=eq.${encodeURIComponent(project_id)}&select=*&order=created_at.desc`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function sbGetGeoResults(project_id, site_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_results?project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&order=created_at.desc`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function sbGetResultsForQuestion(question_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_results?question_id=eq.${encodeURIComponent(question_id)}&order=created_at.desc`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

// ── GEO v2 — CATEGORIES ──────────────────────────────────────────

export async function sbGetCategories(project_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_categories?project_id=eq.${encodeURIComponent(project_id)}&order=name.asc`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function sbSaveCategory({ project_id, name, color }) {
  const res = await fetch(`${PROXY}/rest/v1/geo_categories`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ project_id, name, color }),
  });
  if (!res.ok) throw new Error(`Save category failed: ${res.status}`);
  const rows = await res.json();
  return rows[0] || rows;
}

export async function sbDeleteCategory(id) {
  await fetch(`${PROXY}/rest/v1/geo_categories?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders() });
}

export async function sbSetKeywordCategory(id, category_id) {
  await fetch(`${PROXY}/rest/v1/geo_keywords?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ category_id }),
  });
}

export async function sbSetQuestionCategory(id, category_id) {
  await fetch(`${PROXY}/rest/v1/geo_questions?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ category_id }),
  });
}

export async function sbBulkSetKeywordCategory(ids, category_id) {
  // Supabase REST: PATCH with in() filter
  const filter = ids.map(id => encodeURIComponent(id)).join(",");
  await fetch(`${PROXY}/rest/v1/geo_keywords?id=in.(${filter})`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ category_id }),
  });
}

export async function sbBulkSetQuestionCategory(ids, category_id) {
  const filter = ids.map(id => encodeURIComponent(id)).join(",");
  await fetch(`${PROXY}/rest/v1/geo_questions?id=in.(${filter})`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ category_id }),
  });
}

// ── GEO v2 — URL INDEX ───────────────────────────────────────────

export async function sbGetUrlIndex(project_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_url_index?project_id=eq.${encodeURIComponent(project_id)}&order=count_as_source.desc`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function sbUpsertUrl({ project_id, url, domain, count_as_source = 0, count_in_answer = 0 }) {
  const res = await fetch(`${PROXY}/rest/v1/geo_url_index`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ project_id, url, domain, count_as_source, count_in_answer, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || rows;
}

export async function sbIncrementUrlCounts(project_id, url, { as_source = 0, in_answer = 0 }) {
  // Fetch current, then patch
  const existing = await fetch(`${PROXY}/rest/v1/geo_url_index?project_id=eq.${encodeURIComponent(project_id)}&url=eq.${encodeURIComponent(url)}&limit=1`);
  const rows = existing.ok ? await existing.json() : [];
  const cur = rows[0];
  if (!cur) {
    return sbUpsertUrl({ project_id, url, domain: extractDomain(url), count_as_source: as_source, count_in_answer: in_answer });
  }
  await fetch(`${PROXY}/rest/v1/geo_url_index?id=eq.${cur.id}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ count_as_source: cur.count_as_source + as_source, count_in_answer: cur.count_in_answer + in_answer, updated_at: new Date().toISOString() }),
  });
}

export async function sbUpdateUrlMeta(id, patch) {
  await fetch(`${PROXY}/rest/v1/geo_url_index?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

export async function sbSaveUrlQuestion({ url_id, question_id, result_id, as_source, in_answer }) {
  await fetch(`${PROXY}/rest/v1/geo_url_question`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify({ url_id, question_id, result_id, as_source, in_answer }),
  });
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
}

export async function sbSaveProviderKeys(project_id, keys) {
  // keys: { gemini_key_enc, perplexity_key_enc, claude_geo_key_enc }
  const patch = {};
  if (keys.gemini_key_enc     !== undefined) patch.gemini_key_enc     = keys.gemini_key_enc;
  if (keys.perplexity_key_enc !== undefined) patch.perplexity_key_enc = keys.perplexity_key_enc;
  if (keys.claude_geo_key_enc !== undefined) patch.claude_geo_key_enc = keys.claude_geo_key_enc;
  const res = await fetch(`${PROXY}/rest/v1/projects?id=eq.${encodeURIComponent(project_id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.ok;
}

// ── GEO — PRESENCE HISTORY ───────────────────────────────────────

export async function sbGetPresenceHistory(question_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_presence_history?question_id=eq.${encodeURIComponent(question_id)}&order=test_date.asc&select=provider_id,test_date,brand_mentioned,brand_position,brand_in_sources`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function sbGetPresenceHistoryBatch(project_id, site_id) {
  try {
    const since = new Date(); since.setDate(since.getDate() - 30);
    const sinceStr = since.toISOString().slice(0, 10);
    const res = await fetch(`${PROXY}/rest/v1/geo_presence_history?project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&test_date=gte.${sinceStr}&order=test_date.asc&select=question_id,provider_id,test_date,brand_mentioned`, { headers: authHeaders() });
    if (!res.ok) return []; // table may not exist yet
    return res.json();
  } catch { return []; }
}

// ── GEO — CALENDAR ENTRIES ──────────────────────────────────────
// Single table: geo_calendar_dates
// Columns: id, question_id, provider_id, brand_present, test_date, created_at

export async function sbAddCalendarEntry(question_id, provider_id, brand_present) {
  try {
    const res = await fetch(`${PROXY}/rest/v1/geo_calendar_dates`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({
        question_id,
        provider_id,
        brand_present: brand_present === true || brand_present === 1,
        test_date: new Date().toISOString().slice(0, 10),
      }),
    });
    if (!res.ok) { console.warn("sbAddCalendarEntry failed:", res.status); return null; }
    const data = await res.json();
    return Array.isArray(data) ? data[0] : data;
  } catch(e) { console.warn("sbAddCalendarEntry error:", e.message); return null; }
}

export async function sbGetCalendarEntries(question_id) {
  try {
    const since = new Date(); since.setDate(since.getDate() - 30);
    const sinceStr = since.toISOString().slice(0, 10);
    const res = await fetch(
      `${PROXY}/rest/v1/geo_calendar_dates?question_id=eq.${encodeURIComponent(question_id)}&test_date=gte.${sinceStr}&order=test_date.asc&select=provider_id,test_date,brand_present`
    );
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

// ── GEO HINTS ────────────────────────────────────────────────────

export async function sbSaveHint(question_id, site_id, project_id, hint_text) {
  const res = await fetch(`${PROXY}/rest/v1/geo_hints`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ question_id, site_id, project_id, hint_text, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`Save hint failed: ${res.status} — ${body.slice(0, 80)}`);
    return null; // non-blocking
  }
  return res.json();
}

export async function sbGetHints(project_id, site_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_hints?project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&select=question_id,hint_text,updated_at`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}