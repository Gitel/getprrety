import { api } from './api';

// In-app messages with the clinic (server: server/routes/messages.js).
// Every call acts on the signed-in user's own thread.

export const MAX_MESSAGE_LENGTH = 2000; // same cap the server enforces
export const MESSAGES_POLL_MS = 15000;  // how often the open Messages screen checks for new ones

// The whole thread, oldest first: [{ id, from: 'admin' | 'user', body, createdAt, readAt }].
export async function fetchThread() {
  const { messages } = await api.get('/api/messages');
  return Array.isArray(messages) ? messages : [];
}

// Clinic messages not opened yet (the badge on Home).
export async function fetchUnreadCount() {
  const { count } = await api.get('/api/messages/unread-count');
  return Number.isInteger(count) && count > 0 ? count : 0;
}

// The user is looking at the thread: every clinic message counts as read.
export function markThreadRead() {
  return api.post('/api/messages/read', {});
}

// Send a reply; resolves to the stored message. Throws (with the server's message and
// err.status) on an empty / too-long message or when rate-limited.
export async function sendReply(body) {
  const { message } = await api.post('/api/messages', { body });
  return message;
}
