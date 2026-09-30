import {
  formatTime, formatDateTime, weekdayLetters, weekdayNames, monthNames,
} from './formatting';

// Copy of the pre-translation screen code, to prove English is unchanged.
function oldFormatTime(time) {
  const [h, m] = time.split(':').map(Number);
  if (h === 0)  return `12:${String(m).padStart(2,'0')} AM`;
  if (h < 12)  return `${h}:${String(m).padStart(2,'0')} AM`;
  if (h === 12) return `12:${String(m).padStart(2,'0')} PM`;
  return `${h - 12}:${String(m).padStart(2,'0')} PM`;
}

describe('formatting', () => {
  test('full ICU is available for he-IL', () => {
    expect(new Intl.DateTimeFormat('he-IL').resolvedOptions().locale).toBe('he-IL');
  });

  test('English formatTime equals old code across the day', () => {
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 5) {
        const t = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        expect(formatTime(t, 'en')).toBe(oldFormatTime(t));
      }
    }
    expect(formatTime('00:00', 'en')).toBe('12:00 AM');
    expect(formatTime('12:00', 'en')).toBe('12:00 PM');
    expect(formatTime('08:05', 'en')).toBe('8:05 AM');
    expect(formatTime('23:45', 'en')).toBe('11:45 PM');
    expect(formatTime('08:05', 'en')).not.toMatch(/\u202F/);
  });

  test('Hebrew formatTime is zero-padded 24h', () => {
    expect(formatTime('08:00', 'he')).toBe('08:00');
    expect(formatTime('8:05', 'he')).toBe('08:05');
    expect(formatTime('20:30', 'he')).toBe('20:30');
    expect(formatTime('00:00', 'he')).toBe('00:00');
  });

  test('unknown lang behaves like en', () => {
    expect(formatTime('20:30', 'fr')).toBe('8:30 PM');
    expect(formatTime('20:30')).toBe('8:30 PM');
    expect(weekdayLetters('xx')).toEqual(weekdayLetters('en'));
    expect(weekdayNames(undefined)).toEqual(weekdayNames('en'));
    expect(monthNames('xx')).toEqual(monthNames('en'));
  });

  test('English arrays equal the old constants', () => {
    expect(weekdayLetters('en')).toEqual(['S','M','T','W','T','F','S']);
    expect(weekdayNames('en')).toEqual(['Sun','Mon','Tue','Wed','Thu','Fri','Sat']);
    expect(monthNames('en')).toEqual(['January','February','March','April','May','June',
      'July','August','September','October','November','December']);
  });

  test('English arrays are copies (callers cannot mutate the source)', () => {
    weekdayLetters('en')[0] = 'X';
    expect(weekdayLetters('en')[0]).toBe('S');
  });

  test('Hebrew weekday/month lists have the right shape and content', () => {
    const letters = weekdayLetters('he');
    expect(letters).toHaveLength(7);
    letters.forEach((l) => expect(l).toMatch(/^[\u05D0-\u05EA]$/)); // one Hebrew letter each
    expect(letters[0]).toBe('\u05D0'); // Sunday = aleph
    expect(letters[6]).toBe('\u05E9'); // Saturday = shin
    expect(weekdayNames('he')).toHaveLength(7);
    expect(new Set(weekdayNames('he')).size).toBe(7);
    const months = monthNames('he');
    expect(months).toHaveLength(12);
    expect(new Set(months).size).toBe(12);
    expect(months[0]).toBe('\u05D9\u05E0\u05D5\u05D0\u05E8'); // January
  });

  test('formatDateTime en matches the old call, he uses he-IL', () => {
    const d = new Date(2026, 8, 24, 14, 5);
    expect(formatDateTime(d, 'en')).toBe(d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }));
    expect(formatDateTime(d, 'he')).toBe(d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }));
  });
});
