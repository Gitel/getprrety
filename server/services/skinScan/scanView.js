const { computeSignals } = require('./signals');

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
  };
}

module.exports = { scanView };
