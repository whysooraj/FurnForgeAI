const API_BASE = '/api';

export async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error('Health check failed');
    return await res.json();
  } catch (err) {
    console.warn('Backend offline or initializing:', err);
    return { status: 'offline', pipeline_mode: 'FurnForge Local Hybrid Client' };
  }
}

export async function triggerModelLoad() {
  const res = await fetch(`${API_BASE}/model/load`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to trigger model load');
  return await res.json();
}

export async function getSampleSketches() {
  const res = await fetch(`${API_BASE}/samples`);
  if (!res.ok) throw new Error('Failed to fetch samples');
  return await res.json();
}

export async function preprocessSketch(payload) {
  const res = await fetch(`${API_BASE}/preprocess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Preprocessing failed' }));
    throw new Error(err.detail || 'Preprocessing error');
  }
  return await res.json();
}

export async function analyzeCNN(payload, category = 'Chair') {
  const res = await fetch(`${API_BASE}/analyze-cnn?category=${encodeURIComponent(category)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'CNN analysis failed' }));
    throw new Error(err.detail || 'CNN analysis error');
  }
  return await res.json();
}

export async function generateFurniture(payload, onProgress) {
  const res = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Generation request failed' }));
    throw new Error(err.detail || 'Generation request failed');
  }
  const initData = await res.json();

  // If immediate sync response
  if (initData.status === 'completed' && (initData.primary_image_url || initData.result_image_url)) {
    return initData;
  }

  // If asynchronous job queue
  if (initData.job_id) {
    const jobId = initData.job_id;
    while (true) {
      await new Promise((r) => setTimeout(r, 1200));
      const jobRes = await fetch(`${API_BASE}/jobs/${jobId}`);
      if (!jobRes.ok) throw new Error('Failed to check job status');
      const job = await jobRes.json();

      if (onProgress) {
        onProgress(job);
      }

      if (job.status === 'completed' && job.result) {
        return job.result;
      }
      if (job.status === 'failed') {
        throw new Error(job.error || job.message || 'Generation failed');
      }
    }
  }

  return initData;
}

export async function getGallery(category = null) {
  const url = category && category !== 'All' 
    ? `${API_BASE}/gallery?category=${encodeURIComponent(category)}`
    : `${API_BASE}/gallery`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load gallery');
  return await res.json();
}

export async function getGalleryItem(id) {
  const res = await fetch(`${API_BASE}/gallery/${id}`);
  if (!res.ok) throw new Error('Failed to load gallery item');
  return await res.json();
}

export async function deleteGalleryItem(id) {
  const res = await fetch(`${API_BASE}/gallery/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete item');
  return await res.json();
}
