// In-app messages, the app side. Every route acts on the signed-in user's own thread
// (req.user.id from the JWT); a user can never read or write another user's messages.
// Logic lives in services/messages.js.
const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const messages = require('../services/messages');

// GET /api/messages - the user's thread, oldest first. Sender is 'admin' (shown as
// "Your clinic") or 'user'; which admin wrote a message is never exposed here.
router.get('/', requireAuth, async (req, res) => {
  try {
    res.json({ messages: await messages.threadForUser(req.user.id) });
  } catch {
    res.status(500).json({ error: 'Unable to load messages' });
  }
});

// GET /api/messages/unread-count - clinic messages not opened yet (the Home badge).
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    res.json({ count: await messages.unreadForUser(req.user.id) });
  } catch {
    res.status(500).json({ error: 'Unable to load messages' });
  }
});

// POST /api/messages/read - the user opened the thread.
router.post('/read', requireAuth, async (req, res) => {
  try {
    await messages.markReadByUser(req.user.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Unable to update messages' });
  }
});

const REPLY_ERRORS = {
  empty:        { status: 400, error: 'Write a message first.' },
  too_long:     { status: 400, error: `Messages can be up to ${messages.MAX_BODY} characters.` },
  user_gone:    { status: 404, error: 'Account not found' },
  rate_limited: { status: 429, error: 'You have sent a lot of messages. Please wait a little and try again.' },
};

// POST /api/messages { body } - the user replies to the clinic.
router.post('/', requireAuth, async (req, res) => {
  try {
    const result = await messages.postUserReply(req.user.id, req.body && req.body.body);
    if (!result.ok) {
      const e = REPLY_ERRORS[result.code];
      return res.status(e.status).json({ error: e.error });
    }
    res.status(201).json({ message: result.message });
  } catch {
    res.status(500).json({ error: 'Unable to send message' });
  }
});

module.exports = router;
