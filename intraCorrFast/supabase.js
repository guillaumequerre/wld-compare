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