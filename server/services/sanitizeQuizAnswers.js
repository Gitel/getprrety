const PHOTO_KEYS = new Set(['front', 'left', 'right', 'closeup', 'neck', 'shelf_photos', 'skinScanToken']);

function sanitizeValue(value, depth = 0) {
  if (depth > 5 || value == null) return value == null ? value : undefined;
  if (typeof value === 'string') {
    if (value.startsWith('data:') || value.length > 5000) return undefined;
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map(item => sanitizeValue(item, depth + 1)).filter(item => item !== undefined);
  }
  if (typeof value !== 'object') return undefined;
  const clean = {};
  for (const [key, child] of Object.entries(value).slice(0, 200)) {
    if (PHOTO_KEYS.has(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) continue;
    const sanitized = sanitizeValue(child, depth + 1);
    if (sanitized !== undefined) clean[key] = sanitized;
  }
  return clean;
}

function sanitizeQuizAnswers(answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return {};
  return sanitizeValue(answers) || {};
}

module.exports = { sanitizeQuizAnswers };
