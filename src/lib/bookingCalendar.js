// Pure date helpers for the booking calendar (Month / Week / Day views).
//
// WHY STRINGS AND UTC MATHS (for junior developers):
// Every date here is a clinic-local 'YYYY-MM-DD' string, exactly as the server sends it
// (slot.date). We never build a Date from the phone's local time: all arithmetic uses
// Date.UTC(...), which has no daylight-saving jumps, so "tomorrow" is always +1 calendar day
// whatever time zone the phone is in. Weeks start on SUNDAY (the Israeli week).
import { CLINIC_TIME_ZONE } from './bookingApi';

export { CLINIC_TIME_ZONE };

const pad2 = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' -> a Date at 00:00 UTC of that day (only ever read with getUTC* methods).
const toUtc = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
// Date (UTC based) -> 'YYYY-MM-DD'.
const fromUtc = (dt) =>
  `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;

// The calendar date it is RIGHT NOW at the clinic (not on the phone).
// formatToParts keeps the output shape stable on every JS engine.
export function clinicToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CLINIC_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// '2026-10-31' + 1 -> '2026-11-01'. n may be negative.
export function addDays(date, n) {
  const dt = toUtc(date);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUtc(dt);
}

// Groups free slots and taken times by date.
// -> Map<date, [{ startsAt, endsAt, date, time, taken }]>, each list sorted by startsAt.
export function buildDayIndex(slots = [], taken = []) {
  const index = new Map();
  const add = (list, isTaken) => {
    for (const sl of list || []) {
      if (!index.has(sl.date)) index.set(sl.date, []);
      index.get(sl.date).push({ ...sl, taken: isTaken });
    }
  };
  add(slots, false);
  add(taken, true);
  for (const rows of index.values()) {
    // ISO strings in the same format sort correctly as plain text.
    rows.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
  }
  return index;
}

// 'available' = at least one free time, 'full' = only taken times, 'none' = nothing that day.
export function dayStatus(index, date) {
  const rows = index.get(date);
  if (!rows || rows.length === 0) return 'none';
  return rows.some((r) => !r.taken) ? 'available' : 'full';
}

// Month grid: array of weeks, each week 7 entries (Sunday first): a date string or null padding.
// month is 1-12.
export function monthGrid(year, month) {
  const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday = no padding
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = Array(lead).fill(null);
  for (let d = 1; d <= length; d++) cells.push(`${year}-${pad2(month)}-${pad2(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// The 7 dates (Sunday..Saturday) of the week that contains `date`.
export function weekDates(date) {
  const sunday = addDays(date, -toUtc(date).getUTCDay());
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}

// Sorted unique 'HH:MM' values of every entry on the given dates (the Week view's row labels).
export function weekTimes(index, dates) {
  const times = new Set();
  for (const d of dates) for (const r of index.get(d) || []) times.add(r.time);
  return [...times].sort();
}

// Range the user may browse: from the earlier of today and the first date that has any entry,
// to the last date that has any entry (or today if none). Using the earliest entry as a lower
// bound means a wrong phone clock can never make a server-offered day untappable.
export function navRange(index, today) {
  let min = today;
  let max = today;
  for (const d of index.keys()) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

// Earliest date with a free time; else the earliest date with any entry; else null.
export function firstAvailableDate(index) {
  const dates = [...index.keys()].sort();
  return dates.find((d) => dayStatus(index, d) === 'available') || dates[0] || null;
}

// Limits a date to [range.min, range.max] (plain string comparison works for YYYY-MM-DD).
export function clampDate(date, range) {
  if (date < range.min) return range.min;
  if (date > range.max) return range.max;
  return date;
}
