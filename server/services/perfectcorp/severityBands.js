// Higher raw_score = healthier skin. Severity is the INVERSE of score: 0 = no concern, 4 = biggest concern.
// Versioned so old analyses stay interpretable if thresholds are retuned later.
const BANDS_V1 = [
  { min: 80, severity: 0, label: 'strong' },
  { min: 65, severity: 1, label: 'good' },
  { min: 50, severity: 2, label: 'watch' },
  { min: 35, severity: 3, label: 'needsWork' },
  { min: 0, severity: 4, label: 'priority' },
];

const BANDS_VERSION = 'v1';

function toSeverity(rawScore) {
  const band = BANDS_V1.find(b => rawScore >= b.min);
  return band ? band.severity : 4;
}

function toSeverityLabel(rawScore) {
  const band = BANDS_V1.find(b => rawScore >= b.min);
  return band ? band.label : 'priority';
}

module.exports = { BANDS_V1, BANDS_VERSION, toSeverity, toSeverityLabel };
