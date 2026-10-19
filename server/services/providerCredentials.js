'use strict';

const crypto = require('node:crypto');
const ProviderCredential = require('../models/ProviderCredential');

const PROVIDERS = {
  perfectcorp: { name: 'PerfectCorp', env: 'PERFECTCORP_API_KEY' },
  anthropic: { name: 'Anthropic', env: 'ANTHROPIC_API_KEY' },
};
const HEALTH = {
  verified: 'Verified',
  expired: 'Expired - replace this API key.',
  rejected: 'Key rejected - it may be invalid, revoked, expired or missing permission.',
  unavailable: 'Could not verify - the provider could not be reached or is unavailable.',
  unknown: 'Not checked yet',
  missing: 'No API key configured',
};

function providerInfo(provider) {
  if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Unknown API provider');
  return PROVIDERS[provider];
}

function encryptionKey() {
  const encoded = process.env.API_KEYS_ENCRYPTION_KEY || '';
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('API key storage needs a valid server encryption key.');
  }
  return key;
}

function storageReady() {
  try { encryptionKey(); return true; } catch { return false; }
}

function fingerprint(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function encrypt(provider, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  // Associated data prevents moving an encrypted key into the other provider's document.
  cipher.setAAD(Buffer.from(provider));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64')).join('.');
}

function decrypt(provider, value) {
  try {
    if (value.split('.').length !== 3) throw new Error('Invalid stored key format');
    const [iv, tag, encrypted] = value.split('.').map(part => Buffer.from(part, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAAD(Buffer.from(provider));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    // Crypto/database exceptions must never carry a credential into the application's logs.
    throw new Error('Stored API key could not be opened. Check the server encryption key.');
  }
}

async function read(provider, model) {
  providerInfo(provider);
  let timer;
  try {
    // maxTimeMS bounds MongoDB execution; the timer also bounds connection/server selection.
    return await Promise.race([
      model.findById(provider).select('+encrypted +fingerprint').maxTimeMS(2000).lean(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('API key storage read timed out.')), 2500); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function getKey(provider, { model = ProviderCredential } = {}) {
  const info = providerInfo(provider);
  const doc = await read(provider, model);
  // A damaged saved value is an error, never an excuse to use an older environment key.
  return doc?.encrypted ? decrypt(provider, doc.encrypted) : (process.env[info.env] || '');
}

async function listStatus({ model = ProviderCredential } = {}) {
  return Promise.all(Object.entries(PROVIDERS).map(async ([provider, info]) => {
    const doc = await read(provider, model);
    const configured = Boolean(doc?.encrypted || process.env[info.env]);
    const matches = doc?.encrypted || (configured && doc?.fingerprint === fingerprint(process.env[info.env]));
    const health = !configured ? 'missing' : matches && doc?.health ? doc.health : 'unknown';
    // Explicitly construct the public shape; never hand a database document to the template.
    return {
      provider, name: info.name, configured,
      source: doc?.encrypted ? 'Admin settings' : configured ? 'Server environment' : 'Not configured',
      health, message: HEALTH[health], checkedAt: matches ? doc?.checkedAt : null,
      updatedBy: doc?.encrypted ? doc.updatedBy : null, replacedAt: doc?.encrypted ? doc.replacedAt : null,
    };
  }));
}

function classifyFailure(status, code = '') {
  if (status === 401 || status === 403) return /expired/i.test(code) ? 'expired' : 'rejected';
  return 'unavailable';
}

async function verify(provider, key, { fetchImpl = fetch } = {}) {
  providerInfo(provider);
  if (typeof key !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(key)) {
    return { ok: false, health: 'rejected', message: 'Enter a valid API key without spaces.' };
  }
  // Fixed provider hosts prevent an admin form or environment URL from redirecting secrets.
  const url = provider === 'perfectcorp'
    ? 'https://yce-api-01.makeupar.com/s2s/v2.0/file/skin-analysis'
    : 'https://api.anthropic.com/v1/models/claude-opus-5-5';
  const options = {
    redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: provider === 'perfectcorp'
      ? { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
      : { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  };
  if (provider === 'perfectcorp') {
    // Only allocate an upload slot. Never upload photo bytes or create a paid analysis task.
    options.method = 'POST';
    options.body = JSON.stringify({ files: [{ content_type: 'image/jpeg', file_name: 'key-check.jpg', file_size: 1024 }] });
  }
  try {
    const response = await fetchImpl(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const health = classifyFailure(response.status, body.error_code || body.error?.type);
      return { ok: false, health, message: HEALTH[health] };
    }
    const valid = provider === 'perfectcorp'
      ? body.data?.files?.length === 1 && body.data.files[0]?.file_id && body.data.files[0]?.requests?.[0]?.url
      : body.id === 'claude-opus-5-5';
    return valid ? { ok: true, health: 'verified', message: HEALTH.verified }
      : { ok: false, health: 'unavailable', message: HEALTH.unavailable };
  } catch {
    return { ok: false, health: 'unavailable', message: HEALTH.unavailable };
  }
}

async function saveKey(provider, key, email, { model = ProviderCredential, fetchImpl } = {}) {
  providerInfo(provider);
  if (!storageReady()) return { ok: false, message: 'API key storage needs its one-time server setup.' };
  const checked = await verify(provider, key, { fetchImpl });
  // Verification is deliberately before the database write; a rejected replacement changes nothing.
  if (!checked.ok) return checked;
  await model.findByIdAndUpdate(provider, { $set: {
    encrypted: encrypt(provider, key), fingerprint: fingerprint(key), updatedBy: email,
    replacedAt: new Date(), health: 'verified', checkedAt: new Date(),
  } }, { upsert: true, runValidators: true });
  return { ok: true };
}

async function recordHealth(provider, key, health, { model = ProviderCredential } = {}) {
  if (!key || !['verified', 'expired', 'rejected', 'unavailable'].includes(health)) return;
  try {
    const doc = await read(provider, model);
    const hash = fingerprint(key);
    if (doc?.encrypted && doc.fingerprint !== hash) return;
    if (!doc?.encrypted && process.env[providerInfo(provider).env] !== key) return;
    // Match the version read above so an old in-flight failure cannot mark a replacement expired.
    const filter = { _id: provider, fingerprint: doc?.fingerprint ?? { $exists: false } };
    await model.updateOne(filter, { $set: { health, checkedAt: new Date(), fingerprint: hash } }, { upsert: !doc });
  } catch {
    // Status reporting must not break a live scan. Do not log raw provider or database errors.
    console.warn('API key health could not be recorded.');
  }
}

async function checkCurrent(provider, deps = {}) {
  const key = await getKey(provider, deps);
  if (!key) return { ok: false, message: HEALTH.missing };
  const result = await verify(provider, key, deps);
  await recordHealth(provider, key, result.health, deps);
  return result;
}

module.exports = { PROVIDERS, HEALTH, getKey, listStatus, storageReady, saveKey, verify, recordHealth, checkCurrent, classifyFailure };
