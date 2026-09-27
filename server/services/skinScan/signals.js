// Rolls the PerfectCorp concern scores up into the four "signals" shown on the Profile score
// section. Pure: it only reads a merged scan (services/perfectcorp/merger.js output), so it runs
// on every read and works for scans made before firmness/age_spot were requested.
//
// Scores are the RAW PerfectCorp scores (owner decision), not the friendlier `ui` scale.
// Higher = healthier skin, 0-100.
const SIGNALS = [
  { key: 'barrier',    name: 'Barrier & Moisture', concerns: ['moisture', 'oiliness'] },
  { key: 'clarity',    name: 'Clarity & Texture',  concerns: ['pore', 'texture', 'acne'] },
  { key: 'tone',       name: 'Tone & Radiance',    concerns: ['radiance', 'redness', 'age_spot'] },
  { key: 'resilience', name: 'Resilience',         concerns: ['wrinkle', 'firmness'] },
];

const SIGNAL_KEYS = SIGNALS.map(s => s.key);

const isScore = value => typeof value === 'number' && Number.isFinite(value);

// merged: { concerns: { key: { raw } }, overall: { raw }, skinAge, skinType } or null.
// Returns null without a merged scan. A signal's score is the rounded average of the member
// concerns the vendor returned, or null when it returned none of them.
function computeSignals(merged) {
  if (!merged || typeof merged !== 'object') return null;
  const concerns = merged.concerns || {};

  const signals = SIGNALS.map(({ key, name, concerns: memberKeys }) => {
    // Only the members that actually have a score; sent to Railway so its copy can
    // name the concern that drags the signal.
    const members = {};
    memberKeys.forEach(k => {
      if (isScore(concerns[k]?.raw)) members[k] = concerns[k].raw;
    });
    const values = Object.values(members);
    const score = values.length
      ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
      : null;
    return { key, name, score, concerns: members };
  });

  return {
    overall: isScore(merged.overall?.raw) ? Math.round(merged.overall.raw) : null,
    skinAge: isScore(merged.skinAge) ? merged.skinAge : null,
    skinType: merged.skinType || null,
    signals,
  };
}

module.exports = { SIGNALS, SIGNAL_KEYS, computeSignals };
