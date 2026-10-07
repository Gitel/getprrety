// Client for the in-app booking API (server/routes/bookings.js) plus small display helpers.
// All times come from the SERVER as clinic-local `date` ('YYYY-MM-DD') and `time` ('HH:MM')
// fields, so what the user sees never depends on the phone's own time zone.
import { api } from './api';
import { weekdayNames, monthNames, formatTime } from './formatting';

// Same limit as the server (note_too_long). Used for the note input's maxLength.
export const MAX_NOTE_LENGTH = 300;

// { enabled, slotMinutes, ... }. The side menu only shows "Book" when enabled is true.
export const fetchBookingConfig = () => api.get('/api/bookings/config');

// Free times: { timeZone, slots: [{ startsAt, endsAt, date, time }] }. No params = server defaults.
export function fetchSlots({ from, to } = {}) {
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const qs = query.toString();
  return api.get(`/api/bookings/slots${qs ? `?${qs}` : ''}`);
}

// { upcoming: booking | null, past: [booking] } for the signed-in user.
export const fetchMine = () => api.get('/api/bookings/mine');

// Books one slot. Resolves { booking, warning } ('no_analysis' or null).
// Rejects with err.code (slot_taken, limit_reached, ...); errorText() turns that into text.
export const createBooking = ({ startsAt, note }) =>
  api.post('/api/bookings', { startsAt, note });

// [slot, slot, ...] -> [{ date, slots: [...] }], keeping the input order (the server sorts them).
export function groupSlotsByDate(slots) {
  const groups = [];
  for (const slot of slots) {
    const last = groups[groups.length - 1];
    if (last && last.date === slot.date) last.slots.push(slot);
    else groups.push({ date: slot.date, slots: [slot] });
  }
  return groups;
}

// '2026-10-01' -> 'Thu, 1 October' (he: Hebrew weekday + month names).
// The weekday is computed in UTC from the date string, so no time zone can shift it.
export function formatSlotDay(date, lang) {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return `${weekdayNames(lang)[weekday]}, ${d} ${monthNames(lang)[m - 1]}`;
}

// { date, time } -> 'Thu, 1 October, 10:00 AM' (he: 24 h).
export const formatBookingWhen = (booking, lang) =>
  `${formatSlotDay(booking.date, lang)}, ${formatTime(booking.time, lang)}`;
