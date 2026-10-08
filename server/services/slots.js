// Pure slot generator for in-app booking. No database, no calendar, no clock:
// everything it needs (including "now") is passed in, so it is easy to test.
//
// Vocabulary: a "wall time" is what a clock on the clinic wall shows (e.g. 10:00 on 2026-10-25).
// An "instant" is a real moment on the UTC timeline (a JS Date). The same wall time maps to
// different instants depending on daylight saving time (DST), so we never hard-code +2/+3;
// we ask Intl.DateTimeFormat what the zone's offset is at that moment.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// One Intl formatter per time zone (creating them is slow, so we cache them).
const formatters = new Map();
function getFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return formatters.get(timeZone);
}

// Reads the wall clock of an instant in a zone as plain numbers.
function wallFields(date, timeZone) {
  const f = {};
  getFormatter(timeZone).formatToParts(date).forEach(p => { f[p.type] = p.value; });
  // Some engines print midnight as "24"; normalise it to 0.
  return {
    year: Number(f.year), month: Number(f.month), day: Number(f.day),
    hour: Number(f.hour) % 24, minute: Number(f.minute), second: Number(f.second),
  };
}

const pad = n => String(n).padStart(2, '0');

// Zone offset (in ms, local minus UTC) in force at a given instant. +3h in Israel summer.
function offsetAt(instantMs, timeZone) {
  const w = wallFields(new Date(instantMs), timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

// True for a real calendar date written as 'YYYY-MM-DD' (rejects 2026-02-30, 2026-1-1, non-strings).
function isDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC rolls invalid days over (Feb 30 -> Mar 2), so compare the fields back.
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// Instant -> { date: 'YYYY-MM-DD', time: 'HH:MM' } as shown on the clinic wall clock.
function localParts(date, timeZone) {
  const w = wallFields(date, timeZone);
  return {
    date: `${String(w.year).padStart(4, '0')}-${pad(w.month)}-${pad(w.day)}`,
    time: `${pad(w.hour)}:${pad(w.minute)}`,
  };
}

// Wall time ('YYYY-MM-DD', 'HH:MM') in a zone -> instant (Date).
//
// DST examples for Asia/Jerusalem:
//  - Fall-back (2026-10-25): clocks go 02:00 -> 01:00, so 01:30 happens twice (+3 then +2).
//    We return the EARLIER instant (the +3 one, 2026-10-24T22:30Z).
//  - Spring-forward (2026-03-27): clocks go 02:00 -> 03:00, so 02:30 never happens.
//    We return the instant using the offset from before the jump (02:30 -> 03:30 local).
//    computeSlots never needs this fallback for slots because it steps in real minutes.
function zonedToUtc(dateStr, timeStr, timeZone) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  // Pretend the wall time is UTC; the real instant is this minus the zone offset.
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // The offset can only change near a DST jump, so the offsets one day either side cover both cases.
  const offsets = [...new Set([offsetAt(naive - DAY, timeZone), offsetAt(naive + DAY, timeZone)])];
  const valid = offsets
    .map(off => naive - off)
    // Keep only candidates whose wall clock really reads the requested time.
    .filter(ms => offsetAt(ms, timeZone) === naive - ms)
    .sort((a, b) => a - b);
  if (valid.length > 0) return new Date(valid[0]); // earliest wins for the repeated hour
  // Gap: no real instant matches; use the offset from before the jump.
  return new Date(naive - offsets[0]);
}

// Accepts Date or ISO string, returns epoch ms.
const toMs = v => (v instanceof Date ? v.getTime() : Date.parse(v));

// Returns [{ startsAt, endsAt, date, time }] sorted by startsAt. See contract section 3.
function computeSlots({ now, fromDate, toDate, config, busy = [], booked = [] }) {
  if (!isDateString(fromDate) || !isDateString(toDate)) {
    throw new RangeError('fromDate and toDate must be valid YYYY-MM-DD dates');
  }
  if (fromDate > toDate) return []; // zero-padded ISO dates compare correctly as strings

  const { weekly, slotMinutes, bufferMinutes, leadHours, horizonDays, timeZone } = config;
  const stepMs = slotMinutes * MINUTE;
  const bufferMs = bufferMinutes * MINUTE;
  const earliest = now.getTime() + leadHours * HOUR;          // inclusive
  const horizon = now.getTime() + horizonDays * DAY;          // exclusive

  // Busy calendar times and confirmed bookings are treated the same way: [start, end) in ms.
  const blocked = [
    ...busy.map(b => [toMs(b.start), toMs(b.end)]),
    ...booked.map(b => [toMs(b.startsAt), toMs(b.endsAt)]),
  ];

  const slots = [];
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const dayCount = Math.round((Date.parse(toDate) - Date.parse(fromDate)) / DAY);

  for (let i = 0; i <= dayCount; i += 1) {
    // Walk calendar days in UTC arithmetic (pure date maths, no zone involved).
    const cursor = new Date(Date.UTC(fy, fm - 1, fd + i));
    const dateStr = cursor.toISOString().slice(0, 10);
    const weekday = cursor.getUTCDay(); // 0 = Sunday

    weekly.filter(w => w.day === weekday).forEach(window => {
      const openMs = zonedToUtc(dateStr, window.open, timeZone).getTime();
      const closeMs = zonedToUtc(dateStr, window.close, timeZone).getTime();

      // Step in REAL minutes from the open instant, so a DST jump can never create a slot
      // in a non-existent wall hour.
      for (let start = openMs; start + stepMs <= closeMs; start += stepMs) {
        const end = start + stepMs;
        if (start < earliest || start >= horizon) continue;
        // Overlap test on the buffered interval; touching edges do not overlap.
        const conflict = blocked.some(([bs, be]) => start - bufferMs < be && bs < end + bufferMs);
        if (conflict) continue;
        const startDate = new Date(start);
        const local = localParts(startDate, timeZone);
        slots.push({
          startsAt: startDate.toISOString(),
          endsAt: new Date(end).toISOString(),
          date: local.date,
          time: local.time,
        });
      }
    });
  }

  return slots.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

module.exports = { computeSlots, zonedToUtc, localParts, isDateString };
