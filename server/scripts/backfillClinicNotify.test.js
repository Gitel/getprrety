const { parseArgs, buildSelector } = require('./backfillClinicNotify');

describe('parseArgs', () => {
  test('defaults to 30 days, not a dry run', () => {
    expect(parseArgs([])).toEqual({ days: 30, dryRun: false });
  });

  test('reads --days and --dry-run in any order', () => {
    expect(parseArgs(['--dry-run', '--days=7'])).toEqual({ days: 7, dryRun: true });
  });

  test('rejects unknown args and non-positive days', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--days=0'])).toThrow(/positive integer/);
  });
});

describe('buildSelector', () => {
  test('filters to un-notified analyses newer than the cutoff', () => {
    const now = Date.parse('2026-09-01T00:00:00Z');
    const selector = buildSelector(30, now);
    expect(selector.clinicNotifiedAt).toBeNull();
    expect(selector.createdAt.$gte).toEqual(new Date('2026-08-02T00:00:00Z'));
  });
});
