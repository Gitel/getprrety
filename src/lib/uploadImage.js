import { getToken } from './auth';

const BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export async function uploadImage(uri) {
  const token    = await getToken();
  const filename = uri.split('/').pop() || 'photo.jpg';
  const ext      = filename.split('.').pop().toLowerCase();
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

  const formData = new FormData();
  formData.append('image', { uri, name: filename, type: mimeType });

  const res = await fetch(`${BASE}/api/uploads`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
    body:    formData,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Upload failed: HTTP ${res.status}`);
  return data.uploadId;
}

export async function uploadAll(uris) {
  const results = await Promise.allSettled(uris.filter(Boolean).map(uploadImage));
  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}
