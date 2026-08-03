const { toSeverity, BANDS_VERSION } = require('./severityBands');

const SCORED_CONCERNS = new Set([
  'acne', 'pore', 'texture', 'redness', 'oiliness', 'moisture', 'radiance', 'wrinkle',
]);

// data.results.output[] is a heterogeneous array — index by `type` (+`region` for skin_type),
// never by array position. Unknown types are ignored, not thrown on (PerfectCorp can add concerns).
function normalize({ output, angle, taskId, capturedAt }) {
  const concerns = {};
  const skinType = {};
  let overall = null;
  let skinAge = null;
  let sourceImageUrl = null;

  for (const entry of output || []) {
    if (!entry || typeof entry !== 'object') continue;

    if (SCORED_CONCERNS.has(entry.type) && typeof entry.raw_score === 'number') {
      concerns[entry.type] = {
        raw: entry.raw_score,
        ui: entry.ui_score,
        severity: toSeverity(entry.raw_score),
        maskUrl: (entry.mask_urls && entry.mask_urls[0]) || null,
      };
      continue;
    }

    if (entry.type === 'skin_type' && entry.region) {
      const regionKey = { whole: 'whole', t_zone: 'tZone', u_zone: 'uZone' }[entry.region] || entry.region;
      skinType[regionKey] = entry.skin_type;
      continue;
    }

    if (entry.type === 'all' && typeof entry.score === 'number') {
      overall = { raw: entry.score, ui: entry.ui_score ?? Math.round(entry.score) };
      continue;
    }

    if (entry.type === 'skin_age' && typeof entry.score === 'number') {
      skinAge = Math.round(entry.score);
      continue;
    }

    if (entry.type === 'resize_image') {
      sourceImageUrl = (entry.mask_urls && entry.mask_urls[0]) || null;
      continue;
    }

    // Unknown type — ignored on purpose.
  }

  return {
    vendor: 'perfectcorp',
    angle,
    taskId,
    capturedAt,
    concerns,
    skinType,
    overall,
    skinAge,
    sourceImageUrl,
    bandsVersion: BANDS_VERSION,
  };
}

module.exports = { normalize, SCORED_CONCERNS };
