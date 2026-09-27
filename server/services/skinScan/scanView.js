const { computeSignals } = require('./signals');
const { readingStatusFor } = require('./scoreReading');

// The `skinScan` object the app receives for a complete scan. One shape for both places that
// send it - GET /api/skin-scan/:id (routes/skinScan.js) and a saved analysis
// (withSkinScan in routes/analysis.js) - so a reloaded Profile renders exactly what the
// post-quiz Profile did. Everything derived (signals) is computed on read, never stored.
function scanView(scan) {
  return {
    merged: scan.merged,
    fusion: scan.fusion,
    // The four Profile score-section signals (services/skinScan/signals.js).
    signals: computeSignals(scan.merged),
    // Railway's written copy for the score section (services/skinScan/scoreReading.js), only
    // once it is ready. readingStatus tells the app whether to keep polling for it:
    // 'pending' (asked / about to be asked), 'ready', 'failed', 'unavailable' (feature off).
    reading: scan.readingStatus === 'ready' ? scan.reading : null,
    readingStatus: readingStatusFor(scan),
  };
}

module.exports = { scanView };
