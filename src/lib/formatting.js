// Display formatting helpers for times, dates, weekdays and months.
//
// WHY TWO STRATEGIES (for junior developers):
//  - English is HAND-BUILT so the output is character-for-character what the app
//    showed before translation existed. Intl en-US would differ (modern ICU puts a
//    narrow no-break space U+202F before AM/PM, and abbreviations can change between
//    engines), which would silently change the English screens.
//  - Hebrew uses Intl ('he-IL'), because there is no legacy output to preserve and
//    Intl gives correct Hebrew names without us typing Hebrew literals in code
//    (this file must stay ASCII). Names are read from Intl at runtime.
//
// `lang` is 'en' | 'he'. Any other value behaves like 'en'.

const isHe = (lang) => lang === 'he';

// Copies of the arrays that used to live in the screens (kept identical).
const EN_WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const EN_WEEKDAY_NAMES   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];

const pad2 = (n) => String(n).padStart(2, '0');

// Format a list of 7 weekday names, Sunday first, using Intl he-IL.
// 2023-01-01 was a Sunday; UTC noon + timeZone UTC avoids any timezone shifting.
function heWeekdays(weekday) {
  const fmt = new Intl.DateTimeFormat('he-IL', { weekday, timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2023, 0, 1 + i, 12))));
}

// 'HH:MM' (24h, as stored) -> display string.
//  en: '8:00 AM', '12:00 PM', '12:00 AM' (normal space, same as before).
//  he: 24-hour zero-padded 'HH:MM' ('08:00', '20:30') - Israeli convention.
export function formatTime(hhmm, lang) {
  const [h, m] = hhmm.split(':').map(Number);
  if (isHe(lang)) return `${pad2(h)}:${pad2(m)}`;
  if (h === 0)  return `12:${pad2(m)} AM`;
  if (h < 12)   return `${h}:${pad2(m)} AM`;
  if (h === 12) return `12:${pad2(m)} PM`;
  return `${h - 12}:${pad2(m)} PM`;
}

// Date -> short local date + time.
//  en: the exact call the Messages screen used (device locale), so unchanged.
//  he: he-IL locale.
export function formatDateTime(date, lang) {
  return isHe(lang)
    ? date.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
    : date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

// 7 one-letter weekday labels, Sunday first.
//  he: Intl 'narrow' gives a letter plus a geresh mark (U+05F3); the geresh is
//  stripped so the label fits a one-letter chip.
export function weekdayLetters(lang) {
  if (!isHe(lang)) return EN_WEEKDAY_LETTERS.slice();
  return heWeekdays('narrow').map((s) => s.replace(/\u05F3/g, ''));
}

// 7 short weekday names, Sunday first.
//  he: Intl 'short' ("day" word + letter + geresh; Saturday is the full word).
export function weekdayNames(lang) {
  return isHe(lang) ? heWeekdays('short') : EN_WEEKDAY_NAMES.slice();
}

// 12 month names, January first. he: Intl long names.
export function monthNames(lang) {
  if (!isHe(lang)) return EN_MONTHS.slice();
  const fmt = new Intl.DateTimeFormat('he-IL', { month: 'long', timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2023, i, 15))));
}
