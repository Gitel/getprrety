// In-app messages, the app side. Every route acts on the signed-in user's own thread
// (req.user.id from the JWT); a user can never read or write another user's messages.
// Logic lives in services/messages.js.
const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const messages = require('../services/messages');
const { notifyClinicOfReply } = require('../services/clinicNotify');

// GET /api/messages - the user's thread, oldest first. Sender is 'admin' (shown as
// "Your clinic") or 'user'; which admin wrote a message is never exposed here.
router.get('/', requireAuth, async (req, res) => {
  try {
    res.json({ messages: await messages.threadForUser(req.user.id) });
  } catch {
    res.status(500).json({ error: 'Unable to load messages', code: 'messages_load_failed' });
  }
});

// GET /api/messages/unread-count - clinic messages not opened yet (the Home badge).
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    res.json({ count: await messages.unreadForUser(req.user.id) });
  } catch {
    res.status(500).json({ error: 'Unable to load messages', code: 'messages_load_failed' });
  }
});

// POST /api/messages/read - the user opened the thread.
router.post('/read', requireAuth, async (req, res) => {
  try {
    await messages.markReadByUser(req.user.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Unable to update messages', code: 'messages_update_failed' });
  }
});

// Each error keeps its English text (`error`) and adds a stable snake_case `code` (plus `params` for
// values inside the text) so the app can show the message in the user's language.
const REPLY_ERRORS = {
  empty:        { status: 400, error: 'Write a message first.', code: 'message_empty' },
  too_long:     { status: 400, error: `Messages can be up to ${messages.MAX_BODY} characters.`, code: 'message_too_long', params: { max: messages.MAX_BODY } },
  user_gone:    { status: 404, error: 'Account not found', code: 'account_not_found' },
  rate_limited: { status: 429, error: 'You have sent a lot of messages. Please wait a little and try again.', code: 'message_rate_limited' },
};

// POST /api/messages { body } - the user replies to the clinic.
router.post('/', requireAuth, async (req, res) => {
  try {
    const result = await messages.postUserReply(req.user.id, req.body && req.body.body);
    if (!result.ok) {
      const e = REPLY_ERRORS[result.code];
      // Send the code (and params, when present) along with the English text.
      const payload = { error: e.error, code: e.code };
      if (e.params) payload.params = e.params;
      return res.status(e.status).json(payload);
    }
    res.status(201).json({ message: result.message });
    // Tell the clinic by email. Fire-and-forget, after the response: an email problem
    // must never turn a delivered reply into an error for the user.
    notifyClinicOfReply({ userId: req.user.id, body: result.message.body })
      .catch(err => console.error('Reply notification email failed:', err.message));
  } catch {
    res.status(500).json({ error: 'Unable to send message', code: 'message_send_failed' });
  }
});

module.exports = router;
