const { mapVendorError, AnalysisError } = require('./errors');

function getConfig() {
  return {
    baseUrl: process.env.PERFECTCORP_BASE_URL || 'https://yce-api-01.makeupar.com/s2s/v2.0',
    apiKey: process.env.PERFECTCORP_API_KEY,
    dstActions: (process.env.PERFECTCORP_DST_ACTIONS ||
      'acne,pore,texture,redness,oiliness,moisture,radiance,wrinkle,skin_type').split(','),
  };
}

function authHeaders() {
  const { apiKey } = getConfig();
  if (!apiKey) throw new AnalysisError('VENDOR_UNAVAILABLE', 'PERFECTCORP_API_KEY is not configured');
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

// Every PerfectCorp response is wrapped as { status, data: {...} } (confirmed against the live API —
// not documented in the integration spec, which showed unwrapped shapes). Unwrap here so the rest of
// the codebase can work with the inner payload directly.
async function vendorFetch(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw mapVendorError(body.error_code || body.error || `http_${res.status}`);
  return body.data;
}

// Requests upload slots for a batch of files. Does NOT upload bytes — the caller must PUT to the
// returned presigned URL before creating a task, or the task fails with a 404 / unknown_internal_error.
// `file_size` (bytes) is required by the vendor even though the integration spec's example omits it.
async function requestFileSlots(files) {
  const { baseUrl } = getConfig();
  const data = await vendorFetch(`${baseUrl}/file/skin-analysis`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      files: files.map(f => ({ content_type: f.contentType, file_name: f.fileName, file_size: f.fileSize })),
    }),
  });
  // Each file's presigned PUT lives under requests[0], not at the top level of the file entry.
  return (data?.files || []).map(f => {
    const req = (f.requests && f.requests[0]) || {};
    return { file_id: f.file_id, url: req.url, headers: req.headers || {} };
  });
}

async function putToPresignedUrl(url, buffer, headers = {}) {
  const res = await fetch(url, { method: 'PUT', headers, body: buffer });
  if (!res.ok) throw mapVendorError(`upload_incomplete_http_${res.status}`);
}

async function createTask(srcFileId) {
  const { baseUrl, dstActions } = getConfig();
  const data = await vendorFetch(`${baseUrl}/task/skin-analysis`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      src_file_id: srcFileId,
      dst_actions: dstActions,
      miniserver_args: { enable_mask_overlay: false },
      format: 'json',
    }),
  });
  return data?.task_id;
}

// Returns the unwrapped { task_status, error, results } — results.output[] once task_status is
// 'success' (see normalizer.js for how that heterogeneous array gets parsed).
async function getTask(taskId) {
  const { baseUrl } = getConfig();
  return vendorFetch(`${baseUrl}/task/skin-analysis/${taskId}`, { headers: authHeaders() });
}

module.exports = { getConfig, requestFileSlots, putToPresignedUrl, createTask, getTask };
