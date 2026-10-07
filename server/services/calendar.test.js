// Tests for services/calendar.js. Google is NEVER called: either the built-in mock calendar is
// used (BOOKING_CALENDAR_MOCK=1) or a fake Google client is injected with createCalendarService.
const SECRET = 'SUPER-SECRET-PRIVATE-KEY-123';
const KEY_JSON = JSON.stringify({ client_email: 'svc@proj.iam.gserviceaccount.com', private_key: SECRET });
const KEY_B64 = Buffer.from(KEY_JSON).toString('base64');
const CAL_ID = 'clinic@group.calendar.google.com';

const ENV_KEYS = ['NODE_ENV', 'BOOKING_CALENDAR_MOCK', 'GOOGLE_CALENDAR_ID', 'GOOGLE_SERVICE_ACCOUNT_JSON_B64'];
let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ['BOOKING_CALENDAR_MOCK', 'GOOGLE_CALENDAR_ID', 'GOOGLE_SERVICE_ACCOUNT_JSON_B64']) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// Fresh module instance per test so module-level state (mock events, cache) never leaks.
function load() {
  jest.resetModules();
  return require('./calendar');
}

const rangeOf = (a, b) => ({ start: new Date(a), end: new Date(b) });

describe('isConfigured', () => {
  test('false with nothing set, false with only one Google var, true with both', () => {
    const cal = load();
    expect(cal.isConfigured()).toBe(false);
    process.env.GOOGLE_CALENDAR_ID = CAL_ID;
    expect(cal.isConfigured()).toBe(false);
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 = KEY_B64;
    expect(cal.isConfigured()).toBe(true);
  });

  test('true in mock mode without any Google var', () => {
    process.env.BOOKING_CALENDAR_MOCK = '1';
    expect(load().isConfigured()).toBe(true);
  });

  test('BOOKING_CALENDAR_MOCK is IGNORED when NODE_ENV=production (a fake calendar must never run in prod)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BOOKING_CALENDAR_MOCK = '1';
    const cal = load();
    expect(cal.isConfigured()).toBe(false);
    await expect(cal.getBusy(rangeOf('2026-10-24T00:00:00Z', '2026-10-25T21:00:00Z'))).rejects.toMatchObject({ code: 'calendar_unavailable' });
  });
});

describe('unconfigured calendar', () => {
  test('every call rejects with a CalendarError (code calendar_unavailable)', async () => {
    const cal = load();
    const calls = [
      () => cal.getBusy(rangeOf('2026-10-24T00:00:00Z', '2026-10-25T21:00:00Z')),
      () => cal.createEvent({ bookingId: 'b1', startsAt: new Date(), endsAt: new Date(), summary: 's', description: 'd' }),
      () => cal.deleteEvent('evt-1'),
    ];
    for (const call of calls) {
      const err = await call().catch(e => e);
      expect(err).toBeInstanceOf(cal.CalendarError);
      expect(err.name).toBe('CalendarError');
      expect(err.code).toBe('calendar_unavailable');
    }
  });

  test('a broken key never leaks into the error text or the logs', async () => {
    process.env.GOOGLE_CALENDAR_ID = CAL_ID;
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 = `not-json-${SECRET}`; // decodes to garbage
    const spies = ['log', 'warn', 'error', 'info'].map(m => jest.spyOn(console, m).mockImplementation(() => {}));
    const cal = load();
    const err = await cal.getBusy(rangeOf('2026-10-24T00:00:00Z', '2026-10-25T21:00:00Z')).catch(e => e);
    expect(err).toBeInstanceOf(cal.CalendarError);
    const everything = [err.message, String(err.stack), JSON.stringify(err), ...spies.flatMap(s => s.mock.calls.map(c => c.join(' ')))].join('\n');
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64);
  });
});

describe('mock calendar (BOOKING_CALENDAR_MOCK=1)', () => {
  beforeEach(() => { process.env.BOOKING_CALENDAR_MOCK = '1'; });

  test('getBusy: one 12:00-13:00 clinic-local block per local day, DST-aware', async () => {
    const cal = load();
    // Oct 24 is UTC+3, Oct 25 is the day DST ends (UTC+2 by noon). The range covers both noons.
    const busy = await cal.getBusy(rangeOf('2026-10-24T00:00:00Z', '2026-10-25T21:00:00Z'));
    expect(busy.map(b => [b.start.toISOString(), b.end.toISOString()])).toEqual([
      ['2026-10-24T09:00:00.000Z', '2026-10-24T10:00:00.000Z'],
      ['2026-10-25T10:00:00.000Z', '2026-10-25T11:00:00.000Z'],
    ]);
  });

  test('createEvent stores the event, deleteEvent removes it, reset clears everything', async () => {
    const cal = load();
    const input = {
      bookingId: 'b1',
      startsAt: new Date('2026-10-08T07:00:00Z'),
      endsAt: new Date('2026-10-08T07:30:00Z'),
      summary: 'Consultation - Dana',
      description: 'Booked in the GetPretty app.',
    };
    const { eventId } = await cal.createEvent(input);
    expect(eventId).toMatch(/^mock-event-\d+$/);
    expect(cal.__mock.events()).toHaveLength(1);
    expect(cal.__mock.events()[0]).toMatchObject({ eventId, summary: 'Consultation - Dana' });

    await cal.deleteEvent(eventId);
    expect(cal.__mock.events()).toHaveLength(0);

    await cal.createEvent(input);
    await cal.createEvent(input);
    expect(cal.__mock.events()).toHaveLength(2);
    cal.__mock.reset();
    expect(cal.__mock.events()).toHaveLength(0);
  });

  test('deleteEvent is idempotent: an unknown or already deleted id resolves', async () => {
    const cal = load();
    await expect(cal.deleteEvent('mock-event-999')).resolves.toBeUndefined();
    const { eventId } = await cal.createEvent({ bookingId: 'b', startsAt: new Date(), endsAt: new Date(), summary: 's', description: 'd' });
    await cal.deleteEvent(eventId);
    await expect(cal.deleteEvent(eventId)).resolves.toBeUndefined();
  });
});

describe('real client behaviour with an injected fake Google client', () => {
  // Shape of the @googleapis/calendar client: freebusy.query, events.insert, events.delete.
  function fakeClient(over = {}) {
    return {
      freebusy: { query: jest.fn().mockResolvedValue({ data: { calendars: { [CAL_ID]: { busy: [{ start: '2026-10-08T09:00:00Z', end: '2026-10-08T10:00:00Z' }] } } } }) },
      events: {
        insert: jest.fn().mockResolvedValue({ data: { id: 'evt-1' } }),
        delete: jest.fn().mockResolvedValue({}),
      },
      ...over,
    };
  }
  const build = client => {
    process.env.GOOGLE_CALENDAR_ID = CAL_ID;
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 = KEY_B64;
    const cal = load();
    return { cal, svc: cal.createCalendarService({ client }) };
  };
  const range = rangeOf('2026-10-08T00:00:00Z', '2026-10-09T00:00:00Z');

  test('getBusy queries the configured calendar and returns Date intervals', async () => {
    const client = fakeClient();
    const { svc } = build(client);
    const busy = await svc.getBusy(range);
    expect(client.freebusy.query).toHaveBeenCalledTimes(1);
    const req = client.freebusy.query.mock.calls[0][0].requestBody;
    expect(req.items).toEqual([{ id: CAL_ID }]);
    expect(new Date(req.timeMin).getTime()).toBe(range.start.getTime());
    expect(new Date(req.timeMax).getTime()).toBe(range.end.getTime());
    expect(busy).toHaveLength(1);
    expect(busy[0].start).toEqual(new Date('2026-10-08T09:00:00Z'));
    expect(busy[0].end).toEqual(new Date('2026-10-08T10:00:00Z'));
  });

  test('getBusy is cached for the same range; fresh:true and other ranges bypass the cache', async () => {
    const client = fakeClient();
    const { svc } = build(client);
    await svc.getBusy(range);
    await svc.getBusy(range);
    expect(client.freebusy.query).toHaveBeenCalledTimes(1);
    await svc.getBusy(range, { fresh: true });
    expect(client.freebusy.query).toHaveBeenCalledTimes(2);
    await svc.getBusy(rangeOf('2026-10-09T00:00:00Z', '2026-10-10T00:00:00Z'));
    expect(client.freebusy.query).toHaveBeenCalledTimes(3);
  });

  test('getBusy cache expires after 45 seconds', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-07T06:00:00Z') });
    const client = fakeClient();
    const { svc } = build(client);
    await svc.getBusy(range);
    jest.setSystemTime(new Date('2026-10-07T06:00:44Z'));
    await svc.getBusy(range);
    expect(client.freebusy.query).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date('2026-10-07T06:00:46Z'));
    await svc.getBusy(range);
    expect(client.freebusy.query).toHaveBeenCalledTimes(2);
  });

  // M-1: Google can answer HTTP 200 and still say the calendar failed (errors) or leave it out.
  test('M-1: a freebusy reply with errors for our calendar -> CalendarError, with the Google reason, never cached', async () => {
    const client = fakeClient();
    client.freebusy.query.mockResolvedValueOnce({ data: { calendars: { [CAL_ID]: { errors: [{ domain: 'global', reason: 'notFound' }], busy: [] } } } });
    const { svc } = build(client);
    await expect(svc.getBusy(range)).rejects.toMatchObject({ code: 'calendar_unavailable', reason: 'notFound' });
    // Not cached: the next call asks Google again and (now healthy) succeeds.
    expect(await svc.getBusy(range)).toHaveLength(1);
    expect(client.freebusy.query).toHaveBeenCalledTimes(2);
  });

  test('M-1: a freebusy reply that does not mention our calendar -> CalendarError, never cached', async () => {
    const client = fakeClient();
    client.freebusy.query.mockResolvedValueOnce({ data: { calendars: {} } });
    const { svc } = build(client);
    await expect(svc.getBusy(range)).rejects.toMatchObject({ code: 'calendar_unavailable' });
    expect(await svc.getBusy(range)).toHaveLength(1);
    expect(client.freebusy.query).toHaveBeenCalledTimes(2);
  });

  // L5: the busy cache must not grow forever.
  test('L5: expired cache entries are dropped when a new answer is stored', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-07T06:00:00Z') });
    const client = fakeClient();
    const { svc } = build(client);
    await svc.getBusy(rangeOf('2026-10-08T00:00:00Z', '2026-10-09T00:00:00Z'));
    await svc.getBusy(rangeOf('2026-10-09T00:00:00Z', '2026-10-10T00:00:00Z'));
    expect(svc.__mock.cacheSize()).toBe(2);
    jest.setSystemTime(new Date('2026-10-07T06:01:00Z')); // both entries are now older than 45 s
    await svc.getBusy(rangeOf('2026-10-10T00:00:00Z', '2026-10-11T00:00:00Z'));
    expect(svc.__mock.cacheSize()).toBe(1); // only the new answer is left
  });

  // L8: events are deleted on the calendar the booking was made on (its stored snapshot).
  test('L8: deleteEvent uses the given calendar id, falling back to the configured one', async () => {
    const client = fakeClient();
    const { svc } = build(client);
    await svc.deleteEvent('evt-1', 'old-calendar@group.calendar.google.com');
    expect(client.events.delete.mock.calls[0][0]).toMatchObject({ calendarId: 'old-calendar@group.calendar.google.com', eventId: 'evt-1' });
    await svc.deleteEvent('evt-2');
    expect(client.events.delete.mock.calls[1][0]).toMatchObject({ calendarId: CAL_ID, eventId: 'evt-2' });
  });

  // M-2: errors carry only short codes (never the original error, which may hold the key).
  test('M-2: describeCalendarError gives only safe codes: Google reason, status', async () => {
    const client = fakeClient();
    const { cal, svc } = build(client);
    const boom = Object.assign(new Error(`failed with ${SECRET}`), { code: 403, errors: [{ reason: 'forbidden' }] });
    client.events.insert.mockRejectedValueOnce(boom);
    const err = await svc.createEvent({ bookingId: 'b1', startsAt: new Date(), endsAt: new Date(), summary: 's', description: 'd' }).catch(e => e);
    const text = cal.describeCalendarError(err);
    expect(text).toBe('(Google: forbidden, status 403)');
    expect(text).not.toContain(SECRET);
    expect(cal.describeCalendarError(new Error('plain'))).toBe('');
  });

  test('createEvent sends no attendees, no invite mail, the Jerusalem zone and our booking id', async () => {
    const client = fakeClient();
    const { svc } = build(client);
    const out = await svc.createEvent({
      bookingId: 'b1',
      startsAt: new Date('2026-10-08T07:00:00Z'),
      endsAt: new Date('2026-10-08T07:30:00Z'),
      summary: 'Consultation - Dana',
      description: 'Booked in the GetPretty app.',
    });
    expect(out).toEqual({ eventId: 'evt-1' });
    const arg = client.events.insert.mock.calls[0][0];
    expect(arg.calendarId).toBe(CAL_ID);
    expect(arg.sendUpdates).toBe('none');
    expect(arg.requestBody.attendees).toBeUndefined();
    expect(arg.requestBody.summary).toBe('Consultation - Dana');
    expect(arg.requestBody.description).toBe('Booked in the GetPretty app.');
    expect(arg.requestBody.start.timeZone).toBe('Asia/Jerusalem');
    expect(arg.requestBody.end.timeZone).toBe('Asia/Jerusalem');
    expect(new Date(arg.requestBody.start.dateTime).getTime()).toBe(Date.parse('2026-10-08T07:00:00Z'));
    expect(new Date(arg.requestBody.end.dateTime).getTime()).toBe(Date.parse('2026-10-08T07:30:00Z'));
    expect(arg.requestBody.extendedProperties.private.getprettyBookingId).toBe('b1');
  });

  test('deleteEvent calls Google; a 404 or 410 means already gone, so it succeeds', async () => {
    const client = fakeClient();
    const { svc } = build(client);
    await svc.deleteEvent('evt-1');
    expect(client.events.delete).toHaveBeenCalledWith(expect.objectContaining({ calendarId: CAL_ID, eventId: 'evt-1' }));

    client.events.delete.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { code: 404 }));
    await expect(svc.deleteEvent('evt-2')).resolves.toBeUndefined();
    client.events.delete.mockRejectedValueOnce(Object.assign(new Error('Gone'), { response: { status: 410 } }));
    await expect(svc.deleteEvent('evt-3')).resolves.toBeUndefined();
  });

  test('any other Google failure becomes a CalendarError and the original is kept as cause', async () => {
    const boom = Object.assign(new Error('backend down'), { code: 500 });
    const client = fakeClient();
    client.freebusy.query.mockRejectedValue(boom);
    client.events.insert.mockRejectedValue(boom);
    client.events.delete.mockRejectedValue(boom);
    const { cal, svc } = build(client);
    const input = { bookingId: 'b', startsAt: new Date(), endsAt: new Date(), summary: 's', description: 'd' };
    for (const call of [() => svc.getBusy(range), () => svc.createEvent(input), () => svc.deleteEvent('evt-1')]) {
      const err = await call().catch(e => e);
      expect(err).toBeInstanceOf(cal.CalendarError);
      expect(err.name).toBe('CalendarError');
      expect(err.code).toBe('calendar_unavailable');
      expect(err.cause).toBe(boom);
    }
  });

  test('a failed query is not cached: the next call asks Google again', async () => {
    const client = fakeClient();
    client.freebusy.query.mockRejectedValueOnce(new Error('network'));
    const { svc } = build(client);
    await expect(svc.getBusy(range)).rejects.toMatchObject({ code: 'calendar_unavailable' });
    await expect(svc.getBusy(range)).resolves.toHaveLength(1);
  });

  test('a call that hangs is cut off after 8 seconds with a CalendarError', async () => {
    jest.useFakeTimers();
    const client = fakeClient();
    client.freebusy.query.mockReturnValue(new Promise(() => {})); // never settles
    const { svc } = build(client);
    const outcome = svc.getBusy(range).catch(e => e);
    await jest.advanceTimersByTimeAsync(8100);
    const err = await outcome;
    expect(err.name).toBe('CalendarError');
    expect(err.code).toBe('calendar_unavailable');
  });

  test('the error text never contains the key, even if the failing call mentions it', async () => {
    const client = fakeClient();
    client.freebusy.query.mockRejectedValue(new Error('auth failed'));
    const spies = ['log', 'warn', 'error', 'info'].map(m => jest.spyOn(console, m).mockImplementation(() => {}));
    const { svc } = build(client);
    const err = await svc.getBusy(range).catch(e => e);
    const everything = [err.message, String(err.stack), ...spies.flatMap(s => s.mock.calls.map(c => c.join(' ')))].join('\n');
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(KEY_B64);
  });
});
