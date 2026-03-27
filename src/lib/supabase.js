const PROXY = "/api/supabase";

export async function sbUpload(path, csvText) {
  const res = await fetch(`${PROXY}/storage/v1/object/csv-imports/${path}`, {
    method: "POST",
    headers: { "Content-Type": "text/csv", "x-upsert": "true" },
    body: csvText,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return path;
}

export async function sbInsertImport({ project_id, site_id, source, filename, storage_path, row_count }) {
  const res = await fetch(`${PROXY}/rest/v1/imports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ project_id, site_id, source, filename, storage_path, row_count }),
  });
  if (!res.ok) throw new Error(`Insert failed: ${res.status}`);
  return res.json();
}

export async function sbDeleteImport(id) {
  const res = await fetch(`${PROXY}/rest/v1/imports?id=eq.${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete import failed: ${res.status}`);
}

export async function sbDeleteFile(storage_path) {
  const res = await fetch(`${PROXY}/storage/v1/object/csv-imports/${storage_path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete file failed: ${res.status}`);
}

export async function sbGetHistory(projectId, limit = 50) {
  const filter = projectId ? `&project_id=eq.${encodeURIComponent(projectId)}` : "";
  const res = await fetch(`${PROXY}/rest/v1/imports?select=*&order=uploaded_at.desc&limit=${limit}${filter}`);
  if (!res.ok) throw new Error(`Fetch history failed: ${res.status}`);
  return res.json();
}

export async function sbGetLatest(projectId) {
  const filter = projectId ? `&project_id=eq.${encodeURIComponent(projectId)}` : "";
  const res = await fetch(`${PROXY}/rest/v1/imports?select=*&order=uploaded_at.desc&limit=200${filter}`);
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
  const res = await fetch(`${PROXY}/storage/v1/object/csv-imports/${storage_path}`);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.text();
}

export async function sbSaveProject(project) {
  const res = await fetch(`${PROXY}/rest/v1/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ id: project.id, name: project.name, sites_json: JSON.stringify(project.sites.map(s => ({ id: s.id, label: s.label, color: s.color, bg: s.bg }))), geo_axes_json: JSON.stringify(project.geo_axes || '["Quoi ?","Pourquoi ?","Comment ?","Comparaison","Coût/budget"]'), updated_at: new Date().toISOString() }),
  });
  if (!res.ok) console.warn("Save project failed:", res.status);
}

export async function sbLoadProjects() {
  const res = await fetch(`${PROXY}/rest/v1/projects?select=*&order=created_at.asc`);
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.map(r => ({ id: r.id, name: r.name, sites: JSON.parse(r.sites_json || "[]"), openai_key_enc: r.openai_key_enc || null, geo_axes: JSON.parse(r.geo_axes_json || "null") || ["Quoi ?","Pourquoi ?","Comment ?","Comparaison","Coût/budget"] }));
}

export async function sbDeleteProject(projectId) {
  await fetch(`${PROXY}/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}`, { method: "DELETE" });
}

// ── ANALYSES ─────────────────────────────────────────────────────
export async function sbSaveAnalysis({ id, project_id, content }) {
  const res = await fetch(`${PROXY}/rest/v1/analyses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ id, project_id, content }),
  });
  if (!res.ok) throw new Error(`Save analysis failed: ${res.status}`);
  return res.json();
}

export async function sbGetLatestAnalysis(project_id) {
  const res = await fetch(`${PROXY}/rest/v1/analyses?project_id=eq.${encodeURIComponent(project_id)}&order=created_at.desc&limit=1`);
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// ── RECOMMENDATIONS ───────────────────────────────────────────────
export async function sbSaveRecommendations(recs) {
  if (!recs.length) return;
  const res = await fetch(`${PROXY}/rest/v1/recommendations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(recs),
  });
  if (!res.ok) throw new Error(`Save recommendations failed: ${res.status}`);
  return res.json();
}

export async function sbGetRecommendations(project_id) {
  const res = await fetch(`${PROXY}/rest/v1/recommendations?project_id=eq.${encodeURIComponent(project_id)}&order=created_at.desc&limit=200`);
  if (!res.ok) return [];
  return res.json();
}

export async function sbUpdateRecommendation(id, patch) {
  const res = await fetch(`${PROXY}/rest/v1/recommendations?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Update recommendation failed: ${res.status}`);
}

// ── PAGE TYPES ───────────────────────────────────────────────────
export async function sbSavePageTypes(rows) {
  if (!rows.length) return;
  const res = await fetch(`${PROXY}/rest/v1/page_types`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) console.warn("sbSavePageTypes failed:", res.status);
  return res.ok;
}

export async function sbGetPageTypes(project_id, site_id) {
  const params = new URLSearchParams({ project_id: `eq.${project_id}`, site_id: `eq.${site_id}`, select: "url,page_type,confidence" });
  const res = await fetch(`${PROXY}/rest/v1/page_types?${params}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function sbDeletePageTypes(project_id, site_id) {
  const params = new URLSearchParams({ project_id: `eq.${project_id}`, site_id: `eq.${site_id}` });
  const res = await fetch(`${PROXY}/rest/v1/page_types?${params}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  return res.ok;
}

// ── SNAPSHOTS ─────────────────────────────────────────────────────
export async function sbSaveSnapshot(snap) {
  const res = await fetch(`${PROXY}/rest/v1/snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(snap),
  });
  if (!res.ok) throw new Error(`Save snapshot failed: ${res.status}`);
  return res.json();
}

export async function sbGetSnapshots(project_id, site_id) {
  const q = `project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&order=date_end.asc`;
  const res = await fetch(`${PROXY}/rest/v1/snapshots?${q}`);
  if (!res.ok) return [];
  return res.json();
}

export async function sbDeleteSnapshot(id) {
  const res = await fetch(`${PROXY}/rest/v1/snapshots?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  return res.ok;
}

// ── MILESTONES ────────────────────────────────────────────────────
export async function sbSaveMilestone(m) {
  const res = await fetch(`${PROXY}/rest/v1/milestones`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "return=representation" },
    body: JSON.stringify(m),
  });
  if (!res.ok) throw new Error(`Save milestone failed: ${res.status}`);
  return res.json();
}

export async function sbGetMilestones(project_id) {
  const res = await fetch(`${PROXY}/rest/v1/milestones?project_id=eq.${encodeURIComponent(project_id)}&order=milestone_date.asc`);
  if (!res.ok) return [];
  return res.json();
}

export async function sbDeleteMilestone(id) {
  const res = await fetch(`${PROXY}/rest/v1/milestones?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  return res.ok;
}

export async function sbUpdateMilestone(id, patch) {
  const res = await fetch(`${PROXY}/rest/v1/milestones?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.ok;
}

// ── GEO — BRAND SETTINGS ─────────────────────────────────────────

export async function sbSaveBrand({ project_id, site_id, brand_name, brand_aliases, competitors, context }) {
  const res = await fetch(`${PROXY}/rest/v1/site_brand`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ project_id, site_id, brand_name, brand_aliases, competitors, context, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Save brand failed: ${res.status}`);
  return res.json();
}

export async function sbGetBrand(project_id, site_id) {
  const res = await fetch(`${PROXY}/rest/v1/site_brand?project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&limit=1`);
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// ── GEO — OPENAI KEY (encrypted) on project ──────────────────────

export async function sbSaveOpenAIKey(project_id, enc) {
  const res = await fetch(`${PROXY}/rest/v1/projects?id=eq.${encodeURIComponent(project_id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ openai_key_enc: enc }),
  });
  return res.ok;
}

export async function sbSaveGeoAxes(project_id, axes) {
  const res = await fetch(`${PROXY}/rest/v1/projects?id=eq.${encodeURIComponent(project_id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ geo_axes_json: JSON.stringify(axes) }),
  });
  return res.ok;
}

// ── GEO — KEYWORDS ───────────────────────────────────────────────

export async function sbSaveKeywords(rows) {
  // rows: [{ project_id, site_id, keyword }]
  const res = await fetch(`${PROXY}/rest/v1/geo_keywords`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Save keywords failed: ${res.status}`);
  return res.json();
}

export async function sbGetKeywords(project_id, site_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_keywords?project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&order=created_at.asc`);
  if (!res.ok) return [];
  return res.json();
}

export async function sbUpdateKeywordStatus(id, status) {
  const res = await fetch(`${PROXY}/rest/v1/geo_keywords?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return res.ok;
}

export async function sbDeleteKeyword(id) {
  await fetch(`${PROXY}/rest/v1/geo_keywords?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── GEO — QUESTIONS ──────────────────────────────────────────────

export async function sbSaveQuestions(rows) {
  // rows: [{ project_id, site_id, keyword_id, question, is_manual }]
  const res = await fetch(`${PROXY}/rest/v1/geo_questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "return=representation" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Save questions failed: ${res.status}`);
  return res.json();
}

export async function sbGetQuestions(project_id, site_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_questions?project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&order=created_at.asc`);
  if (!res.ok) return [];
  return res.json();
}

export async function sbUpdateQuestion(id, patch) {
  const res = await fetch(`${PROXY}/rest/v1/geo_questions?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.ok;
}

export async function sbDeleteQuestion(id) {
  await fetch(`${PROXY}/rest/v1/geo_questions?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── GEO — RESULTS ────────────────────────────────────────────────

export async function sbSaveGeoResult(result) {
  const res = await fetch(`${PROXY}/rest/v1/geo_results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "return=representation" },
    body: JSON.stringify(result),
  });
  if (!res.ok) throw new Error(`Save geo result failed: ${res.status}`);
  return res.json();
}

export async function sbGetGeoResults(project_id, site_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_results?project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&order=created_at.desc`);
  if (!res.ok) return [];
  return res.json();
}

export async function sbGetResultsForQuestion(question_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_results?question_id=eq.${encodeURIComponent(question_id)}&order=created_at.desc`);
  if (!res.ok) return [];
  return res.json();
}

// ── GEO v2 — CATEGORIES ──────────────────────────────────────────

export async function sbGetCategories(project_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_categories?project_id=eq.${encodeURIComponent(project_id)}&order=name.asc`);
  if (!res.ok) return [];
  return res.json();
}

export async function sbSaveCategory({ project_id, name, color }) {
  const res = await fetch(`${PROXY}/rest/v1/geo_categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ project_id, name, color }),
  });
  if (!res.ok) throw new Error(`Save category failed: ${res.status}`);
  const rows = await res.json();
  return rows[0] || rows;
}

export async function sbDeleteCategory(id) {
  await fetch(`${PROXY}/rest/v1/geo_categories?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function sbSetKeywordCategory(id, category_id) {
  await fetch(`${PROXY}/rest/v1/geo_keywords?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_id }),
  });
}

export async function sbSetQuestionCategory(id, category_id) {
  await fetch(`${PROXY}/rest/v1/geo_questions?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_id }),
  });
}

export async function sbBulkSetKeywordCategory(ids, category_id) {
  // Supabase REST: PATCH with in() filter
  const filter = ids.map(id => encodeURIComponent(id)).join(",");
  await fetch(`${PROXY}/rest/v1/geo_keywords?id=in.(${filter})`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_id }),
  });
}

export async function sbBulkSetQuestionCategory(ids, category_id) {
  const filter = ids.map(id => encodeURIComponent(id)).join(",");
  await fetch(`${PROXY}/rest/v1/geo_questions?id=in.(${filter})`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_id }),
  });
}

// ── GEO v2 — URL INDEX ───────────────────────────────────────────

export async function sbGetUrlIndex(project_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_url_index?project_id=eq.${encodeURIComponent(project_id)}&order=count_as_source.desc`);
  if (!res.ok) return [];
  return res.json();
}

export async function sbUpsertUrl({ project_id, url, domain, count_as_source = 0, count_in_answer = 0 }) {
  const res = await fetch(`${PROXY}/rest/v1/geo_url_index`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count_as_source: cur.count_as_source + as_source, count_in_answer: cur.count_in_answer + in_answer, updated_at: new Date().toISOString() }),
  });
}

export async function sbUpdateUrlMeta(id, patch) {
  await fetch(`${PROXY}/rest/v1/geo_url_index?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

export async function sbSaveUrlQuestion({ url_id, question_id, result_id, as_source, in_answer }) {
  await fetch(`${PROXY}/rest/v1/geo_url_question`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify({ url_id, question_id, result_id, as_source, in_answer }),
  });
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
}