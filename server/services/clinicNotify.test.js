jest.mock('../models/SkinAnalysis');
jest.mock('../models/User');

const User = require('../models/User');
const { notifyClinic, buildClinicEmailHtml } = require('./clinicNotify');

function makeAnalysis(overrides = {}) {
  return {
    _id: '64b000000000000000000001',
    userId: '64b0000000000000000000aa',
    eraId: 'barrier_healing',
    era: { name: 'Barrier Healing Era' },
    routine: {
      am: [{ name: 'Gentle cleanser', description: 'Lukewarm water' }],
      pm: [{ name: 'Barrier cream' }],
    },
    quizAnswers: { name: 'Ada', skin_goals: ['dryness', 'sensitive'], allergies: ['none'] },
    clinicNotifiedAt: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('buildClinicEmailHtml', () => {
  test('puts a red allergy block first when allergies are reported', () => {
    const analysis = makeAnalysis({
      quizAnswers: { name: 'Ada', allergies: ['none', 'fragrance', 'nickel'], allergies_other: 'lanolin' },
    });
    const html = buildClinicEmailHtml({ analysis, user: { email: 'ada@example.com' } });

    expect(html.trimStart().startsWith('<p style="color:#b3261e')).toBe(true);
    expect(html).toContain('Allergies: fragrance, nickel, lanolin');
    expect(html).not.toContain('none,');
  });

  test('shows "No allergies reported" when only none/empty is present', () => {
    const html = buildClinicEmailHtml({ analysis: makeAnalysis(), user: { email: 'ada@example.com' } });
    expect(html).toContain('No allergies reported');
    expect(html).not.toContain('color:#b3261e');
  });

  test('includes name, email, era, and a dashboard link to the analysis id', () => {
    const analysis = makeAnalysis();
    const html = buildClinicEmailHtml({ analysis, user: { email: 'ada@example.com', firstName: 'Ada' } });
    expect(html).toContain('ada@example.com');
    expect(html).toContain('Barrier Healing Era');
    expect(html).toContain('dryness, sensitive');
    expect(html).toContain(`/admin/customer/${analysis._id}`);
  });

  test('escapes HTML in quiz answers', () => {
    const analysis = makeAnalysis({ quizAnswers: { name: '<script>x</script>', allergies: [] } });
    const html = buildClinicEmailHtml({ analysis, user: { email: 'a@b.co' } });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>x');
  });
});

describe('notifyClinic', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    // CLINIC_NOTIFY_TO / MESSAGE_STREAM are read at module load, not per call — the
    // assertions below expect the built-in defaults.
    process.env = { ...OLD_ENV, POSTMARK_SENDER_ADDRESS: 'hello@getpretty.app' };
    User.findById.mockResolvedValue({ email: 'ada@example.com', firstName: 'Ada' });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { process.env = OLD_ENV; jest.clearAllMocks(); jest.restoreAllMocks(); });

  test('skips sending when clinicNotifiedAt is already set', async () => {
    const client = { sendEmail: jest.fn() };
    const analysis = makeAnalysis({ clinicNotifiedAt: new Date('2026-01-01') });

    const result = await notifyClinic(analysis, { client });

    expect(result).toEqual({ sent: false, reason: 'already-notified' });
    expect(client.sendEmail).not.toHaveBeenCalled();
    expect(analysis.save).not.toHaveBeenCalled();
  });

  test('sends on first notification and stamps clinicNotifiedAt', async () => {
    const client = { sendEmail: jest.fn().mockResolvedValue({ MessageID: 'x' }) };
    const analysis = makeAnalysis();

    const result = await notifyClinic(analysis, { client });

    expect(result).toEqual({ sent: true });
    expect(client.sendEmail).toHaveBeenCalledTimes(1);
    const arg = client.sendEmail.mock.calls[0][0];
    expect(arg.From).toBe('hello@getpretty.app');
    expect(arg.To).toBe('lutreat@gmail.com,dzaturansky@gmail.com');
    expect(arg.Subject).toBe('New GetPretty client: Ada — Barrier Healing Era');
    expect(arg.MessageStream).toBe('outbound');
    expect(analysis.clinicNotifiedAt).toBeInstanceOf(Date);
    expect(analysis.save).toHaveBeenCalledTimes(1);
  });

  test('force resends even when clinicNotifiedAt is set', async () => {
    const client = { sendEmail: jest.fn().mockResolvedValue({}) };
    const analysis = makeAnalysis({ clinicNotifiedAt: new Date('2026-01-01') });

    const result = await notifyClinic(analysis, { client, force: true });

    expect(result).toEqual({ sent: true });
    expect(client.sendEmail).toHaveBeenCalledTimes(1);
    expect(analysis.save).toHaveBeenCalledTimes(1);
  });

  test('no-ops when the Postmark sender address is not configured', async () => {
    delete process.env.POSTMARK_SENDER_ADDRESS;
    const client = { sendEmail: jest.fn() };

    const result = await notifyClinic(makeAnalysis(), { client });

    expect(result).toEqual({ sent: false, reason: 'no-sender' });
    expect(client.sendEmail).not.toHaveBeenCalled();
  });
});
