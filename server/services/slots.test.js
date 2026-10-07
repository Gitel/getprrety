// Tests for the PURE slot generator (services/slots.js): no database, no calendar, no clock.
// Every example below is worked out by hand in AI/plans/in-app-booking-contract.md section 3.
// Reminder for the numbers: Israel is UTC+3 until 2026-10-25 02:00 local, then UTC+2 (DST ends);
// DST starts again on Friday 2026-03-27 at 02:00 (clocks jump to 03:00).
const { computeSlots, zonedToUtc, localParts, isDateString } = require('./slots');

// Default clinic config: Sunday (0) to Thursday (4), 10:00-18:00, 30 min slots, no buffer.
const DEFAULT_CONFIG = {
  weekly: [0, 1, 2, 3, 4].map(day => ({ day, open: '10:00', close: '18:00' })),
  slotMinutes: 30,
  bufferMinutes: 0,
  leadHours: 12,
  horizonDays: 30,
  timeZone: 'Asia/Jerusalem',
};

const iso = d => new Date(d).toISOString();
const run = (over = {}) => computeSlots({
  now: new Date('2026-10-07T06:00:00Z'),
  fromDate: '2026-10-11',
  toDate: '2026-10-11',
  config: DEFAULT_CONFIG,
  busy: [],
  booked: [],
  ...over,
});
const times = slots => slots.map(s => s.time);

describe('worked examples A-F from the contract', () => {
  test('A: lead time boundary - the earliest start is exactly now + 12 h (inclusive)', () => {
    const slots = computeSlots({
      now: new Date('2026-10-07T20:00:00Z'),
      fromDate: '2026-10-07',
      toDate: '2026-10-08',
      config: DEFAULT_CONFIG,
      busy: [],
      booked: [],
    });
    // Oct 7 (Wed) is already past closing once the lead time is applied, so only Oct 8 is left.
    expect(slots.filter(s => s.date === '2026-10-07')).toHaveLength(0);
    expect(slots).toHaveLength(14);
    expect(slots[0]).toEqual({
      startsAt: '2026-10-08T08:00:00.000Z',
      endsAt: '2026-10-08T08:30:00.000Z',
      date: '2026-10-08',
      time: '11:00',
    });
    expect(slots[13].time).toBe('17:30');
    expect(slots[13].startsAt).toBe('2026-10-08T14:30:00.000Z');
  });

  test('B: a busy interval removes every slot it overlaps; touching slots stay', () => {
    // Busy 10:30-11:15 local. 10:00 ends exactly at 10:30 (touching) so it stays; 11:30 stays too.
    const slots = run({ busy: [{ start: '2026-10-11T07:30:00Z', end: '2026-10-11T08:15:00Z' }] });
    expect(slots).toHaveLength(14);
    expect(times(slots)).not.toContain('10:30');
    expect(times(slots)).not.toContain('11:00');
    expect(times(slots)).toContain('10:00');
    expect(times(slots)).toContain('11:30');
  });

  test('C: an existing booking removes its slot; a 30 minute buffer also removes the neighbours', () => {
    const booked = [{ startsAt: '2026-10-11T09:00:00Z', endsAt: '2026-10-11T09:30:00Z' }]; // 12:00 local
    const plain = run({ booked });
    expect(times(plain)).not.toContain('12:00');
    expect(plain).toHaveLength(15);

    const buffered = run({ booked, config: { ...DEFAULT_CONFIG, bufferMinutes: 30 } });
    expect(times(buffered)).not.toContain('11:30');
    expect(times(buffered)).not.toContain('12:00');
    expect(times(buffered)).not.toContain('12:30');
    expect(times(buffered)).toContain('11:00'); // its buffered end touches 12:00, no overlap
    expect(times(buffered)).toContain('13:00');
  });

  test('D: the day DST ends (2026-10-25) starts at 10:00 UTC+2, a normal day at 10:00 UTC+3', () => {
    const slots = run({ fromDate: '2026-10-22', toDate: '2026-10-25' });
    const oct22 = slots.filter(s => s.date === '2026-10-22');
    const oct25 = slots.filter(s => s.date === '2026-10-25');
    expect(oct22).toHaveLength(16);
    expect(oct25).toHaveLength(16);
    expect(oct22[0].startsAt).toBe('2026-10-22T07:00:00.000Z');
    expect(oct25[0].startsAt).toBe('2026-10-25T08:00:00.000Z');
    expect(oct22[15].time).toBe('17:30');
    expect(oct25[15].time).toBe('17:30');
    expect(oct25[0].time).toBe('10:00');
  });

  test('E: spring-forward gap - nothing lands in the non-existent 02:xx hour', () => {
    const config = { ...DEFAULT_CONFIG, weekly: [{ day: 5, open: '01:00', close: '04:00' }] };
    const slots = computeSlots({
      now: new Date('2026-03-20T00:00:00Z'),
      fromDate: '2026-03-27',
      toDate: '2026-03-27',
      config,
      busy: [],
      booked: [],
    });
    expect(slots.map(s => s.startsAt)).toEqual([
      '2026-03-26T23:00:00.000Z',
      '2026-03-26T23:30:00.000Z',
      '2026-03-27T00:00:00.000Z',
      '2026-03-27T00:30:00.000Z',
    ]);
    expect(times(slots)).toEqual(['01:00', '01:30', '03:00', '03:30']);
  });

  test('F: the horizon is exclusive (now + 30 days), a slot just before it is kept', () => {
    // 2026-11-06 is a Friday; UTC+2 then, so 07:30 local = 05:30Z and 08:00 local = 06:00Z.
    const config = { ...DEFAULT_CONFIG, weekly: [{ day: 5, open: '07:30', close: '09:00' }] };
    const slots = run({ fromDate: '2026-11-06', toDate: '2026-11-06', config });
    expect(slots.map(s => s.startsAt)).toEqual(['2026-11-06T05:30:00.000Z']); // 06:00Z is excluded
  });
});

describe('range, weekday and slot length rules', () => {
  test('only weekdays present in config.weekly produce slots (Fri and Sat are closed)', () => {
    const slots = run({ fromDate: '2026-10-08', toDate: '2026-10-10' }); // Thu, Fri, Sat
    expect(slots).toHaveLength(16);
    expect(new Set(slots.map(s => s.date))).toEqual(new Set(['2026-10-08']));
  });

  test('both ends of the range are inclusive and the result is sorted by startsAt', () => {
    const slots = run({ fromDate: '2026-10-11', toDate: '2026-10-12' }); // Sun + Mon
    expect(slots).toHaveLength(32);
    expect(slots[0].date).toBe('2026-10-11');
    expect(slots[31].date).toBe('2026-10-12');
    const starts = slots.map(s => Date.parse(s.startsAt));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  test('fromDate after toDate gives an empty list', () => {
    expect(run({ fromDate: '2026-10-12', toDate: '2026-10-11' })).toEqual([]);
  });

  test.each([
    ['nope', '2026-10-11'],
    ['2026-10-11', 'nope'],
    ['2026-13-01', '2026-10-11'],
    ['2026-02-30', '2026-10-11'],
    [undefined, '2026-10-11'],
  ])('a malformed date (%p, %p) throws RangeError', (fromDate, toDate) => {
    expect(() => run({ fromDate, toDate })).toThrow(RangeError);
  });

  test('20 minute slots: 24 slots, the last starts at 17:40', () => {
    const slots = run({ config: { ...DEFAULT_CONFIG, slotMinutes: 20 } });
    expect(slots).toHaveLength(24);
    expect(slots[1].time).toBe('10:20');
    expect(slots[23].time).toBe('17:40');
  });

  test('45 minute slots: a candidate that would end after closing is dropped (10 slots, last 16:45)', () => {
    const slots = run({ config: { ...DEFAULT_CONFIG, slotMinutes: 45 } });
    expect(slots).toHaveLength(10);
    expect(slots[9].time).toBe('16:45');
    expect(slots[9].endsAt).toBe('2026-10-11T14:30:00.000Z'); // 17:30 local
  });

  test('busy and booked intervals may be Date objects or ISO strings', () => {
    const slots = run({
      busy: [{ start: new Date('2026-10-11T07:00:00Z'), end: new Date('2026-10-11T07:30:00Z') }],
      booked: [{ startsAt: new Date('2026-10-11T09:00:00Z'), endsAt: new Date('2026-10-11T09:30:00Z') }],
    });
    expect(times(slots)).not.toContain('10:00');
    expect(times(slots)).not.toContain('12:00');
    expect(slots).toHaveLength(14);
  });
});

describe('purity', () => {
  test('inputs are not mutated and the same call twice gives the same answer', () => {
    const deepFreeze = o => { Object.values(o).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };
    const config = deepFreeze(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
    const busy = deepFreeze([{ start: '2026-10-11T07:30:00Z', end: '2026-10-11T08:15:00Z' }]);
    const booked = deepFreeze([{ startsAt: '2026-10-11T09:00:00Z', endsAt: '2026-10-11T09:30:00Z' }]);
    const before = JSON.stringify({ config, busy, booked });
    const a = run({ config, busy, booked });
    const b = run({ config, busy, booked });
    expect(a).toEqual(b);
    expect(JSON.stringify({ config, busy, booked })).toBe(before);
  });
});

describe('zonedToUtc', () => {
  const utc = (date, time) => iso(zonedToUtc(date, time, 'Asia/Jerusalem'));

  test('uses the real offset of the day: +3 before DST ends, +2 after', () => {
    expect(utc('2026-10-22', '10:00')).toBe('2026-10-22T07:00:00.000Z');
    expect(utc('2026-10-25', '10:00')).toBe('2026-10-25T08:00:00.000Z');
  });

  test('spring: before the jump +2, after the jump +3', () => {
    expect(utc('2026-03-27', '01:00')).toBe('2026-03-26T23:00:00.000Z');
    expect(utc('2026-03-27', '03:00')).toBe('2026-03-27T00:00:00.000Z');
  });

  test('an ambiguous fall-back wall time (01:30 on 2026-10-25) resolves to the EARLIER instant', () => {
    expect(utc('2026-10-25', '01:30')).toBe('2026-10-24T22:30:00.000Z');
  });
});

describe('localParts and isDateString', () => {
  test('localParts gives the clinic wall clock date and time of an instant', () => {
    expect(localParts(new Date('2026-10-22T07:00:00Z'), 'Asia/Jerusalem')).toMatchObject({ date: '2026-10-22', time: '10:00' });
    expect(localParts(new Date('2026-10-25T08:00:00Z'), 'Asia/Jerusalem')).toMatchObject({ date: '2026-10-25', time: '10:00' });
    // 22:30Z is already the next local day in Israel.
    expect(localParts(new Date('2026-10-20T22:30:00Z'), 'Asia/Jerusalem')).toMatchObject({ date: '2026-10-21', time: '01:30' });
  });

  test.each(['2026-10-07', '2026-02-28', '2028-02-29'])('%p is a valid date string', s => {
    expect(isDateString(s)).toBe(true);
  });

  test.each(['2026-13-01', '2026-02-30', '2026-1-1', 'abc', '', '2026-10-07T00:00', null, undefined, 20261007])('%p is not', s => {
    expect(isDateString(s)).toBe(false);
  });
});
