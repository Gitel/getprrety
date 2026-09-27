// Shrinks photos before they are sent to the Gemini analysis (analyzeWithRailway.js).
// Phone cameras produce 3-5 MB photos; up to 14 of them went as base64 in ONE request
// with a 45 s timeout, so slow uploads silently fell back to the generic plan.
// Only the Gemini copies are shrunk (owner decision): the PerfectCorp scan and the stored
// uploads keep full resolution.

export const GEMINI_MAX_EDGE = 1600;     // px, longest side
export const GEMINI_JPEG_QUALITY = 0.85;

// Pure size math: the largest size that fits within maxEdge on its longest side, keeping
// the aspect ratio. Never upscales.
export function fitWithin(width, height, maxEdge) {
  const longest = Math.max(width, height);
  if (!longest || longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Returns the photo as a JPEG data URL at most maxEdge px on its longest side.
// Needs a browser/webview (Image + canvas). On any failure, or outside a browser, it
// returns the original data URL unchanged, so the photo is still sent, just larger.
export async function downscaleDataUrl(dataUrl, { maxEdge = GEMINI_MAX_EDGE, quality = GEMINI_JPEG_QUALITY } = {}) {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return dataUrl;
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode photo'));
      el.src = dataUrl;
    });
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // White first: JPEG has no transparency, so a transparent PNG would turn black.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return dataUrl;
  }
}
