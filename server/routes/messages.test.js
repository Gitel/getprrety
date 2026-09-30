// Message error codes: every error keeps its English text and adds a `code` the app translates.
jest.mock('../middleware/auth', () => (req, _res, next) => { req.user = { id: 'u1' }; next(); });
jest.mock('../services/messages');
jest.mock('../services/clinicNotify', () => ({ notifyClinicOfReply: jest.fn().mockResolvedValue() }));

const messages = require('../services/messages');
const router = require('./messages');

// Calls the final handler of a route directly (no HTTP server in this test suite).
async function call(method, path, body = {}) {
  const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
  const handlers = layer.route.stack.map(s => s.handle);
  const req = { body, user: { id: 'u1' } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handlers[handlers.length - 1](req, res);
  return res;
}

describe('POST /api/messages error codes', () => {
  afterEach(() => jest.clearAllMocks());

  test.each([
    ['empty', 400, 'Write a message first.', 'message_empty'],
    ['user_gone', 404, 'Account not found', 'account_not_found'],
    ['rate_limited', 429, 'You have sent a lot of messages. Please wait a little and try again.', 'message_rate_limited'],
  ])('%s -> status, English text and code, no params', async (result, status, error, code) => {
    messages.postUserReply.mockResolvedValue({ ok: false, code: result });
    const res = await call('post', '/', { body: 'x' });
    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual({ error, code });
  });

  test('too_long carries the limit that is in the text as params.max', async () => {
    messages.postUserReply.mockResolvedValue({ ok: false, code: 'too_long' });
    const res = await call('post', '/', { body: 'x' });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('message_too_long');
    expect(res.body.params).toEqual({ max: messages.MAX_BODY });
    expect(res.body.error).toContain(String(messages.MAX_BODY));
  });

  test('unexpected failure -> message_send_failed', async () => {
    messages.postUserReply.mockRejectedValue(new Error('db down'));
    const res = await call('post', '/', { body: 'x' });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Unable to send message', code: 'message_send_failed' });
  });
});

describe('other message routes error codes', () => {
  test('thread and unread-count load failures -> messages_load_failed', async () => {
    messages.threadForUser.mockRejectedValue(new Error('x'));
    messages.unreadForUser.mockRejectedValue(new Error('x'));
    for (const path of ['/', '/unread-count']) {
      const res = await call('get', path);
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Unable to load messages', code: 'messages_load_failed' });
    }
  });

  test('mark-read failure -> messages_update_failed', async () => {
    messages.markReadByUser.mockRejectedValue(new Error('x'));
    const res = await call('post', '/read');
    expect(res.body).toEqual({ error: 'Unable to update messages', code: 'messages_update_failed' });
  });
});
