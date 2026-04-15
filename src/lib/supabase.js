const PROXY = "/api/supabase";

function authHeaders(extra = {}) {
  try {
    const s = sessionStorage.getItem("correl_session") || localStorage.getItem("correl_session");
    const token = s ? JSON.parse(s).access_token : null;
    if (token) return { "Authorization": `Bearer ${token}`, ...extra };
  } catch {}
  return extra;
}


export async function sbUpload(path, csvText) {
  // Upload via proxy Netlify — auth gérée côté serveur
  const token = (() => {
    try {
      const s = sessionStorage.getItem("correl_session") || localStorage.getItem("correl_session");
      return s ? JSON.parse(s).access_token : null;
    } catch { return null; }
  })();

  if (!token) throw new Error("Non authentifié — reconnectez-vous");

  const res = await fetch(`${PROXY}/storage/v1/object/csv-imports/${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "text/csv",
      "x-upsert": "true",
    },
    body: csvText,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[sbUpload] failed:", res.status, body);
    throw new Error(`Upload failed: ${res.status} — ${body.slice(0, 120)}`);
  }
  return path;
}


export async function sbInsertImport({ project_id, site_id, source, filename, storage_path, row_count }) {
  // UPSERT: on_conflict en URL obligatoire pour que PostgREST génère un vrai
  // INSERT … ON CONFLICT (project_id,site_id,source) DO UPDATE
  // Sans ça, "resolution=merge-duplicates" est ignoré et un INSERT nu lève 409.
  const payload = { project_id, site_id, source, filename, storage_path, row_count, uploaded_at: new Date().toISOString() };
  const res = await fetch(`${PROXY}/rest/v1/imports?on_conflict=project_id,site_id,source`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Fallback si la contrainte unique n'existe pas en DB : PATCH sur la ligne existante
    if (res.status === 409) {
      const res2 = await fetch(
        `${PROXY}/rest/v1/imports?project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&source=eq.${encodeURIComponent(source)}`,
        {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "return=representation" },
          body: JSON.stringify({ filename, storage_path, row_count, uploaded_at: payload.uploaded_at }),
        }
      );
      if (!res2.ok) return null;
      const data = await res2.json();
      return Array.isArray(data) ? data[0] || null : data;
    }
    throw new Error(`Insert failed: ${res.status} — ${body.slice(0, 120)}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data[0] || null : data;
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
  // With fixed path strategy, there's only 1 row per (project, site, source)
  const res = await fetch(`${PROXY}/rest/v1/imports?select=*&order=uploaded_at.desc&limit=50${filter}`, { headers: authHeaders() });
  if (!res.ok) return {};
  const rows = await res.json();
  const latest = {};
  for (const row of rows) {
    if (!row.storage_path) continue;
    const key = `${row.site_id}_${row.source}`;
    if (!latest[key]) latest[key] = row;
  }
  return latest;
}

export async function sbDownload(storage_path) {
  const res = await fetch(`${PROXY}/storage/v1/object/csv-imports/${storage_path}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[sbDownload] failed:", res.status, body);
    throw new Error(`Download failed: ${res.status}`);
  }
  return res.text();
}

export async function sbSaveProject(project) {
  const res = await fetch(`${PROXY}/rest/v1/projects`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ id: project.id, name: project.name, owner_email: project.owner_email || null,
      openai_key_enc:      project.openai_key_enc      || null,
      gemini_key_enc:      project.gemini_key_enc      || null,
      perplexity_key_enc:  project.perplexity_key_enc  || null,
      claude_geo_key_enc:  project.claude_geo_key_enc  || null,
      semrush_key_enc:     project.semrush_key_enc     || null,
      sites_json: JSON.stringify(project.sites.map(s => ({ id: s.id, label: s.label, color: s.color, bg: s.bg }))),
      settings_json: project.settings_json || null, geo_axes_json: JSON.stringify(project.geo_axes || ["Meilleur / top / recommandé","Pistes et approches pour utiliser / bénéficier du mot-clé","Avis / fiable / fiabilité","Pour atteindre un objectif lié au mot-clé","Pour résoudre une problématique liée au mot-clé"]), updated_at: new Date().toISOString() }),
  });
  if (!res.ok) console.warn("Save project failed:", res.status);
}

export async function sbLoadProjects() {
  const res = await fetch(`${PROXY}/rest/v1/projects?select=*&order=created_at.asc`, { headers: authHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.map(r => ({ id: r.id, name: r.name, sites: JSON.parse(r.sites_json || "[]"), openai_key_enc: r.openai_key_enc || null, geo_axes: JSON.parse(r.geo_axes_json || "null") || ["Meilleur / top / recommandé","Pistes et approches pour utiliser / bénéficier du mot-clé","Avis / fiable / fiabilité","Pour atteindre un objectif lié au mot-clé","Pour résoudre une problématique liée au mot-clé"], gemini_key_enc: r.gemini_key_enc || null, perplexity_key_enc: r.perplexity_key_enc || null, claude_geo_key_enc: r.claude_geo_key_enc || null, semrush_key_enc: r.semrush_key_enc || null, owner_email: r.owner_email || null, updated_at: r.updated_at || null, settings_json: r.settings_json || null }));
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
  // Filtre les lignes vides ou invalides
  const valid = rows.filter(r => r.keyword?.trim());
  if (!valid.length) return [];
  const res = await fetch(`${PROXY}/rest/v1/geo_keywords`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      "Prefer": "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify(valid),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 409 = duplicate unique key — retourner tableau vide plutôt que planter
    if (res.status === 409) return [];
    throw new Error(`Save keywords failed: ${res.status} — ${body.slice(0, 120)}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
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
  // Filtre les questions vides
  const valid = rows.filter(r => r.question?.trim());
  if (!valid.length) return [];
  const res = await fetch(`${PROXY}/rest/v1/geo_questions`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      "Prefer": "return=representation,resolution=ignore-duplicates",
    },
    body: JSON.stringify(valid),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    // 409 = contrainte unique — les questions existent déjà, récupérer depuis la base
    if (res.status === 409) {
      const pid = valid[0].project_id; const sid = valid[0].site_id;
      const res2 = await fetch(`${PROXY}/rest/v1/geo_questions?project_id=eq.${encodeURIComponent(pid)}&site_id=eq.${encodeURIComponent(sid)}&select=*&order=created_at.asc`, { headers: authHeaders() });
      return res2.ok ? res2.json() : [];
    }
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
  // Only include provider_id if column exists (optional)
  // Explicitly pick only columns that exist in geo_results table
  const row = {
    question_id:          result.question_id,
    project_id:           result.project_id,
    site_id:              result.site_id,
    model:                result.model,
    answer:               result.answer,
    answer_type:          result.answer_type   || null,
    intent_type:          result.intent_type   || null,
    sources:              result.sources       || [],
    source_types:         result.source_types  || [],
    brand_mentioned:      result.brand_mentioned    ?? false,
    brand_position:       result.brand_position     ?? null,
    brand_in_sources:     result.brand_in_sources   ?? false,
    competitors_mentioned: result.competitors_mentioned || [],
    input_tokens:         result.input_tokens  ?? null,
    output_tokens:        result.output_tokens ?? null,
    created_at:           result.created_at    || new Date().toISOString(),
  };

  const res = await fetch(`${PROXY}/rest/v1/geo_results`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      // UPSERT: replace existing result for same question+model
      "Prefer": "return=representation,resolution=merge-duplicates",
      "on-conflict": "question_id,model",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[sbSaveGeoResult] failed:", res.status, errBody);
    throw new Error(`Save geo result failed: ${res.status} — ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

export async function sbGetGeoResultsAll(project_id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_results?project_id=eq.${encodeURIComponent(project_id)}&select=*&order=created_at.desc`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function sbGetGeoResults(project_id, site_id) {
  const res = await fetch(
    `${PROXY}/rest/v1/geo_results?select=*&project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&order=created_at.desc&limit=2000`,
    { headers: authHeaders() }
  );
  if (!res.ok) {
    console.warn("[sbGetGeoResults] failed:", res.status, await res.text().catch(() => ""));
    return [];
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    console.warn("[sbGetGeoResults] unexpected response:", data);
    return [];
  }
  return data;
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

export async function sbSetKeywordTags(id, tags) {
  const res = await fetch(`${PROXY}/rest/v1/geo_keywords?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ tags: tags || [] }),
  });
  return res.ok;
}

export async function sbBulkSetKeywordTags(ids, tags) {
  if (!ids.length) return;
  const filter = ids.map(id => `"${id}"`).join(",");
  const res = await fetch(`${PROXY}/rest/v1/geo_keywords?id=in.(${filter})`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ tags: tags || [] }),
  });
  return res.ok;
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
  // keys: any of { openai_key_enc, gemini_key_enc, perplexity_key_enc, claude_geo_key_enc, semrush_key_enc }
  const allowed = ["openai_key_enc", "gemini_key_enc", "perplexity_key_enc", "claude_geo_key_enc", "semrush_key_enc"];
  const patch = {};
  allowed.forEach(k => { if (keys[k] !== undefined) patch[k] = keys[k]; });
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
// Table : geo_calendar_dates
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

// Par question (utilisé par PresenceCalendar)
export async function sbGetCalendarEntries(question_id) {
  try {
    const since = new Date(); since.setDate(since.getDate() - 30);
    const sinceStr = since.toISOString().slice(0, 10);
    const res = await fetch(
      `${PROXY}/rest/v1/geo_calendar_dates?question_id=eq.${encodeURIComponent(question_id)}&test_date=gte.${sinceStr}&order=test_date.asc&select=provider_id,test_date,brand_present`,
      { headers: authHeaders() }
    );
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

// ── NOUVEAU : batch pour tout un projet/site (utilisé par QuestionsTab pour lostByQ) ──
// Charge toutes les entrées des 30 derniers jours pour calculer "Positionnée précédemment"
// en utilisant la même source de vérité que PresenceCalendar.
export async function sbGetCalendarEntriesBatch(project_id, site_id) {
  try {
    const since = new Date(); since.setDate(since.getDate() - 30);
    const sinceStr = since.toISOString().slice(0, 10);

    // Étape 1 : récupérer les question_ids du projet/site
    const qRes = await fetch(
      `${PROXY}/rest/v1/geo_questions?project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&select=id`,
      { headers: authHeaders() }
    );
    if (!qRes.ok) {
      console.warn("[sbGetCalendarEntriesBatch] geo_questions fetch failed:", qRes.status);
      return [];
    }
    const questions = await qRes.json();
    if (!Array.isArray(questions) || !questions.length) return [];

    // Étape 2 : récupérer les entrées calendar pour ces question_ids
    // PostgREST : in.(uuid1,uuid2,...) — les UUIDs n'ont pas besoin d'être quotés
    const ids = questions.map(q => q.id).join(",");
    const url = `${PROXY}/rest/v1/geo_calendar_dates?question_id=in.(${ids})&test_date=gte.${sinceStr}&order=test_date.asc&select=question_id,provider_id,test_date,brand_present`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[sbGetCalendarEntriesBatch] calendar fetch failed:", res.status, body.slice(0, 120));
      return [];
    }
    const data = await res.json();
    console.log("[sbGetCalendarEntriesBatch] chargé:", data.length, "entrées pour", questions.length, "questions");
    return data;
  } catch(e) {
    console.warn("[sbGetCalendarEntriesBatch] error:", e.message);
    return [];
  }
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
  const res = await fetch(
    `${PROXY}/rest/v1/geo_hints?select=question_id,hint_text,updated_at&project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}`,
    { headers: authHeaders() }
  );
  if (!res.ok) {
    console.warn("[sbGetHints] failed:", res.status);
    return [];
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// ── PROJECT SETTINGS (UI preferences per project) ────────────────
export async function sbSaveProjectSettings(project_id, settings) {
  const res = await fetch(`${PROXY}/rest/v1/projects?id=eq.${encodeURIComponent(project_id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ settings_json: JSON.stringify(settings) }),
  });
  return res.ok;
}

// ── GEO SCHEDULES (automation) ───────────────────────────────────

export async function sbGetSchedule(project_id, site_id) {
  const res = await fetch(
    `${PROXY}/rest/v1/geo_schedules?project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&select=*&limit=1`,
    { headers: authHeaders() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

export async function sbSaveSchedule({ project_id, site_id, owner_email, frequency, providers, active, max_questions }) {
  // Compute initial next_run based on frequency
  const now = new Date();
  const nextRun = new Date(now);
  switch (frequency) {
    case "daily":    nextRun.setDate(now.getDate() + 1); break;
    case "weekly":   nextRun.setDate(now.getDate() + 7); break;
    case "biweekly": nextRun.setDate(now.getDate() + 14); break;
    case "monthly":  nextRun.setDate(now.getDate() + 30); break;
    default:         nextRun.setDate(now.getDate() + 7);
  }

  const payload = {
    project_id, site_id, owner_email,
    frequency, providers: providers || ["openai"],
    active: active !== false,
    max_questions: max_questions || 10,
    next_run: nextRun.toISOString(),
  };

  // Upsert : on_conflict dans l'URL est requis pour que PostgREST génère
  // un vrai INSERT … ON CONFLICT(project_id, site_id) DO UPDATE
  // plutôt qu'un INSERT pur qui lève une 409 si la ligne existe déjà.
  const res = await fetch(`${PROXY}/rest/v1/geo_schedules?on_conflict=project_id,site_id`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Save schedule failed: ${res.status} — ${body.slice(0, 120)}`);
  }
  return (await res.json())[0];
}

export async function sbUpdateSchedule(id, patch) {
  const res = await fetch(`${PROXY}/rest/v1/geo_schedules?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.ok;
}

export async function sbDeleteSchedule(id) {
  const res = await fetch(`${PROXY}/rest/v1/geo_schedules?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.ok;
}

export async function sbTriggerScheduler() {
  // Manual trigger — force=true bypasse le filtre next_run du scheduler
  const secret = process.env.REACT_APP_SCHEDULER_SECRET;
  const res = await fetch("/api/geo-scheduler", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "X-Scheduler-Secret": secret } : {}),
    },
    body: JSON.stringify({ force: true }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Trigger failed: ${res.status} — ${body.slice(0, 120)}`);
  }
  return res.json();
} 
// ── GEO COMPETITORS ───────────────────────────────────────────────
// Table: geo_competitors (id, project_id, site_id, name, domain, category, color, created_at)
// Catégories: "direct" | "geo" | "partner" | "other" | custom string

export async function sbGetCompetitors(project_id, site_id) {
  const res = await fetch(
    `${PROXY}/rest/v1/geo_competitors?project_id=eq.${encodeURIComponent(project_id)}&site_id=eq.${encodeURIComponent(site_id)}&order=name.asc`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  return res.json();
}

export async function sbSaveCompetitor({ project_id, site_id, name, domain, category, color }) {
  const res = await fetch(
    `${PROXY}/rest/v1/geo_competitors?on_conflict=project_id,site_id,name`,
    {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ project_id, site_id, name: name.trim(), domain: (domain || "").trim().toLowerCase(), category: category || "other", color: color || "#DC2626" }),
    }
  );
  if (!res.ok) throw new Error(`Save competitor failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

export async function sbUpdateCompetitor(id, patch) {
  const res = await fetch(
    `${PROXY}/rest/v1/geo_competitors?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify(patch),
    }
  );
  if (!res.ok) throw new Error(`Update competitor failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

export async function sbDeleteCompetitor(id) {
  const res = await fetch(
    `${PROXY}/rest/v1/geo_competitors?id=eq.${encodeURIComponent(id)}`,
    { method: "DELETE", headers: authHeaders() }
  );
  return res.ok;
}