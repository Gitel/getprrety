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

// Time zone of the clinic. A payment hold deadline is shown in THIS zone, never the phone's.
export const CLINIC_TIME_ZONE = 'Asia/Jerusalem';

// ISO instant -> 'HH:MM' (24 h) in clinic time, or '' when the value is missing/invalid.
// formatToParts is used (instead of toLocaleTimeString) so the output shape is stable on every engine.
export function clinicHHMM(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CLINIC_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = type => parts.find(p => p.type === type)?.value || '00';
  return `${get('hour')}:${get('minute')}`;
}
