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
    headers: { "Content-Type": "application/json", "Prefer": "return=representation" },
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
    body: JSON.stringify({ id: project.id, name: project.name, sites_json: JSON.stringify(project.sites), updated_at: new Date().toISOString() }),
  });
  if (!res.ok) console.warn("Save project failed:", res.status);
}

export async function sbLoadProjects() {
  const res = await fetch(`${PROXY}/rest/v1/projects?select=*&order=created_at.asc`);
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.map(r => ({ id: r.id, name: r.name, sites: JSON.parse(r.sites_json || "[]") }));
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