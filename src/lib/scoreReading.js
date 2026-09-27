// Pure helpers for the Profile score section (src/components/ScoreSection.jsx).

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Midnight of that day in the device's local time zone.
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// "Your skin reading · Day N": calendar days (device local time) from the user's first saved
// reading (`firstReadingAt`, from the server) to this reading (`readingAt` = the analysis'
// createdAt, or now while it is not saved yet), counting the first day as Day 1 (owner
// decision). No first reading (anonymous / not saved yet) -> Day 1.
export function dayNumber(firstReadingAt, readingAt, now = new Date()) {
  const first = toDate(firstReadingAt);
  if (!first) return 1;
  const reading = toDate(readingAt) || now;
  // Math.round, not floor: a day across a daylight-saving change is 23 or 25 hours long.
  const days = Math.round((startOfDay(reading) - startOfDay(first)) / DAY_MS);
  return Math.max(1, days + 1);
}
