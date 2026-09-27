jest.mock('./api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));

import { api } from './api';
import { fetchThread, fetchUnreadCount, markThreadRead, sendReply } from './messages';

beforeEach(() => { api.get.mockReset(); api.post.mockReset(); });

test('fetchThread returns the list, or [] for a malformed answer', async () => {
  api.get.mockResolvedValueOnce({ messages: [{ id: 'm1', from: 'admin', body: 'Hi' }] });
  await expect(fetchThread()).resolves.toEqual([{ id: 'm1', from: 'admin', body: 'Hi' }]);
  expect(api.get).toHaveBeenCalledWith('/api/messages');
  api.get.mockResolvedValueOnce({});
  await expect(fetchThread()).resolves.toEqual([]);
});

test('fetchUnreadCount never returns anything but a non-negative integer', async () => {
  api.get.mockResolvedValueOnce({ count: 3 });
  await expect(fetchUnreadCount()).resolves.toBe(3);
  api.get.mockResolvedValueOnce({ count: 'lots' });
  await expect(fetchUnreadCount()).resolves.toBe(0);
});

test('markThreadRead and sendReply hit the right endpoints', async () => {
  api.post.mockResolvedValueOnce({ ok: true });
  await markThreadRead();
  expect(api.post).toHaveBeenLastCalledWith('/api/messages/read', {});

  api.post.mockResolvedValueOnce({ message: { id: 'm2', from: 'user', body: 'Thanks' } });
  await expect(sendReply('Thanks')).resolves.toEqual({ id: 'm2', from: 'user', body: 'Thanks' });
  expect(api.post).toHaveBeenLastCalledWith('/api/messages', { body: 'Thanks' });
});

test('sendReply surfaces a server rejection to the screen', async () => {
  const err = Object.assign(new Error('Please wait a little'), { status: 429 });
  api.post.mockRejectedValueOnce(err);
  await expect(sendReply('x')).rejects.toBe(err);
});
