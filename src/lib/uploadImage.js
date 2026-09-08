import { getToken } from './auth';

const BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// Photos are larger than a JSON request and go over the same untrusted network, so
// they get a longer ceiling than api.js — but a ceiling all the same. uploadAll()
// uses allSettled, so one photo timing out drops that photo, not the whole save.
const UPLOAD_TIMEOUT_MS = 30000;

export async function uploadImage(uri) {
  const token = await getToken();
  const formData = new FormData();

  if (uri.startsWith('data:')) {
    // Web: data URL → Blob → proper multipart upload
    const response = await fetch(uri);
    const blob = await response.blob();
    const mimeMatch = uri.match(/^data:([^;]+);/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const ext = mimeType.split('/')[1] || 'jpg';
    formData.append('image', blob, `photo.${ext}`);
  } else {
    // Native: RN FormData object format
    const filename = uri.split('/').pop() || 'photo.jpg';
    const ext      = filename.split('.').pop().toLowerCase();
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
    formData.append('image', { uri, name: filename, type: mimeType });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/api/uploads`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` },
      body:    formData,
      signal:  controller.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Upload failed: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data.uploadId;
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`Upload timed out after ${UPLOAD_TIMEOUT_MS}ms`);
      timeoutErr.status = 408;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadAll(uris) {
  const results = await Promise.allSettled(uris.filter(Boolean).map(uploadImage));
  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}
