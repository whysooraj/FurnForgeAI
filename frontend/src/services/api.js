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

export async function renderSpec(payload) {
  const res = await fetch(`${API_BASE}/spec-render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Spec render failed' }));
    throw new Error(err.detail || 'Spec render error');
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

export async function get3DRequirements() {
  const res = await fetch(`${API_BASE}/3d/requirements`);
  if (!res.ok) throw new Error('Failed to check 3D GPU requirements');
  return await res.json();
}

export async function get3DStatus(generationId) {
  const res = await fetch(`${API_BASE}/3d/status/${encodeURIComponent(generationId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to check 3D status' }));
    throw new Error(typeof err.detail === 'string' ? err.detail : err.detail?.message || '3D status error');
  }
  return await res.json();
}

export async function generate3DModel(payload, onProgress) {
  const res = await fetch(`${API_BASE}/3d/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '3D model generation failed' }));
    const detail = err.detail;
    const message = typeof detail === 'string'
      ? detail
      : detail?.message || '3D model generation failed';
    const error = new Error(message);
    if (detail && typeof detail === 'object' && detail.compatibility) {
      error.compatibility = detail.compatibility;
    }
    throw error;
  }

  const initData = await res.json();
  if (initData.job_id) {
    let transientErrors = 0;
    while (true) {
      await new Promise((r) => setTimeout(r, 1200));
      let jobRes;
      try {
        jobRes = await fetch(`${API_BASE}/3d/jobs/${initData.job_id}`);
      } catch (networkErr) {
        transientErrors += 1;
        if (transientErrors >= 4) {
          throw new Error(
            'Lost connection to the FurnForge AI backend on port 8005 while generating the 3D model.'
          );
        }
        continue;
      }
      if (!jobRes.ok) {
        if (jobRes.status === 404) {
          throw new Error('3D job was interrupted because the backend restarted. Please try again.');
        }
        throw new Error('Failed to poll 3D reconstruction job');
      }
      transientErrors = 0;
      const job = await jobRes.json();

      if (onProgress) onProgress(job);

      if (job.status === 'completed' && job.result) {
        return job.result;
      }
      if (job.status === 'failed') {
        throw new Error(job.error || job.message || '3D reconstruction failed');
      }
    }
  }

  return initData;
}

export function get3DDownloadUrl(generationId, format = 'glb') {
  return `${API_BASE}/3d/download/${encodeURIComponent(generationId)}/${encodeURIComponent(format)}`;
}
