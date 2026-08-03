const { toSeverity } = require('./severityBands');
const { AnalysisError } = require('./errors');

// Side photos are opportunistic secondary evidence: only concerns with genuine lateral-cheek
// distribution may be influenced by them. Front is authoritative for everything else.
const LATERAL_CONCERNS = ['pore', 'redness'];
const OUTLIER_THRESHOLD = 25;

function merge(front, sides = [], { sidePhotoAnalysisEnabled = true } = {}) {
  if (!front) throw new AnalysisError('FRONT_PHOTO_REQUIRED', 'Front photo analysis is required to merge');

  const merged = JSON.parse(JSON.stringify(front));
  const sidesAttempted = sides.length;

  if (!sidePhotoAnalysisEnabled) {
    merged.mergeMeta = { sidesAttempted, sidesUsed: 0 };
    return merged;
  }

  const valid = sides.filter(s => s && !s.failed);

  for (const concern of LATERAL_CONCERNS) {
    const frontRaw = front.concerns[concern]?.raw;
    if (typeof frontRaw !== 'number') continue;

    const samples = valid
      .map(s => s.concerns[concern]?.raw)
      .filter(v => typeof v === 'number' && Math.abs(v - frontRaw) <= OUTLIER_THRESHOLD);

    if (!samples.length) continue;

    // Front weighted 2x, each valid side 1x.
    const raw = (frontRaw * 2 + samples.reduce((a, b) => a + b, 0)) / (2 + samples.length);
    merged.concerns[concern] = { ...front.concerns[concern], raw, severity: toSeverity(raw) };
  }

  merged.mergeMeta = { sidesAttempted, sidesUsed: valid.length };
  return merged;
}

module.exports = { merge, LATERAL_CONCERNS, OUTLIER_THRESHOLD };
