// Tests for bookings.releaseUserBookings (contract section 13): when an account is deleted we
// remove the user's UPCOMING calendar events first. No database, no Google: all fakes.
const { releaseUserBookings } = require('./bookings');

const NOW = new Date('2026-10-07T06:00:00Z');
const USER = 'user-1';

// Minimal fake Booking.find: filters the way the service must ask (user, confirmed, in the future).
function makeDeps(rows, calendar) {
  const find = jest.fn(filter => {
    const result = rows.filter(r => r.userId === filter.userId
      && r.status === filter.status
      && new Date(r.startsAt) > new Date(filter.startsAt.$gt));
    return { lean: async () => result, then: (res, rej) => Promise.resolve(result).then(res, rej) };
  });
  return { Booking: { find }, calendar, now: () => NOW };
}

const row = (id, over = {}) => ({
  _id: id, userId: USER, status: 'confirmed', startsAt: new Date('2026-10-20T07:00:00Z'), calendarEventId: `evt-${id}`, ...over,
});

afterEach(() => jest.restoreAllMocks());

test('deletes the calendar event of upcoming confirmed bookings only', async () => {
  const calendar = { deleteEvent: jest.fn(async () => {}) };
  const deps = makeDeps([
    row('a'),
    row('past', { startsAt: new Date('2026-09-01T07:00:00Z') }),
    row('cancelled', { status: 'cancelled' }),
    row('other-user', { userId: 'someone-else' }),
    row('no-event', { calendarEventId: null }),
  ], calendar);
  await releaseUserBookings(USER, deps);
  expect(calendar.deleteEvent.mock.calls).toEqual([['evt-a', undefined]]); // no stored calendarId -> undefined (falls back to the configured one)
});

test('a calendar failure is logged with the booking id and the loop continues', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const calendar = { deleteEvent: jest.fn(async id => { if (id === 'evt-booking-id-AAA111') throw new Error('google down'); }) };
  const deps = makeDeps([row('booking-id-AAA111'), row('b')], calendar);
  await expect(releaseUserBookings(USER, deps)).resolves.toBeUndefined();
  expect(calendar.deleteEvent).toHaveBeenCalledTimes(2);
  const text = spy.mock.calls.map(c => c.join(' ')).join('\n');
  expect(text).toContain('Booking booking-id-AAA111:'); // the booking id (distinctive, so this cannot pass by accident)
  expect(text).toContain('evt-booking-id-AAA111'); // and the event id
});
