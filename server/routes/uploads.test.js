const express = require('express');
const jwt = require('jsonwebtoken');

// Exercise real HTTP multipart parsing and authentication without connecting to MongoDB.
jest.mock('../models/Upload', () => ({ create: jest.fn() }));
const Upload = require('../models/Upload');
const router = require('./uploads');

const USER_ID = '64b000000000000000000001';
const UPLOAD_ID = '64b000000000000000000002';
// Minimal signatures exercise the route's existing magic-byte check, not image decoding.
const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const JPEG = Buffer.from('ffd8ffe00000', 'hex');
let server;
let base;
let token;
const previousSecret = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = 'synthetic-upload-test-secret';
  token = jwt.sign({ id: USER_ID }, process.env.JWT_SECRET);
  const app = express();
  app.use('/api/uploads', router);
  // Surface parser codes in this test harness; production maps LIMIT_* to 400/413.
  app.use((err, req, res, next) => {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ code: err.code });
  });
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/uploads`;
});

afterAll(async () => {
  // fetch keeps connections alive; close them so Jest can exit promptly.
  await new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  });
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

beforeEach(() => {
  jest.resetAllMocks();
  Upload.create.mockResolvedValue({ _id: UPLOAD_ID });
});

function addImage(form, bytes = PNG, field = 'image', mimeType = 'image/png') {
  form.append(field, new Blob([bytes], { type: mimeType }), 'photo.png');
}

async function post(form, authorization = `Bearer ${token}`) {
  // Let fetch generate the multipart Content-Type and boundary, as the app does.
  const response = await fetch(base, {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
    body: form,
  });
  return { status: response.status, body: await response.json() };
}

test.each([
  ['PNG', PNG, 'image/png'],
  ['JPEG', JPEG, 'image/jpeg'],
])('accepts a single %s image and saves its bytes for the authenticated user', async (name, bytes, mimeType) => {
  const form = new FormData();
  addImage(form, bytes, 'image', mimeType);
  expect(await post(form)).toEqual({ status: 201, body: { uploadId: UPLOAD_ID } });
  expect(Upload.create).toHaveBeenCalledTimes(1);
  expect(Upload.create).toHaveBeenCalledWith({
    userId: USER_ID, data: bytes, mimeType, size: bytes.length,
  });
});

test.each([
  ['missing', '', 'auth_required'],
  ['invalid', 'Bearer invalid-token', 'auth_invalid'],
])('rejects %s authentication before saving', async (name, authorization, code) => {
  const form = new FormData();
  addImage(form);
  const result = await post(form, authorization);
  expect(result.status).toBe(401);
  expect(result.body.code).toBe(code);
  expect(Upload.create).not.toHaveBeenCalled();
});

test('rejects a request without an image', async () => {
  expect(await post(new FormData())).toEqual({
    status: 400, body: { error: 'No image file received' },
  });
  expect(Upload.create).not.toHaveBeenCalled();
});

test('rejects unsupported bytes even when the client claims image/png', async () => {
  const form = new FormData();
  addImage(form, Buffer.from('not an image'));
  expect(await post(form)).toEqual({
    status: 400, body: { error: 'Only JPEG and PNG images are supported' },
  });
  expect(Upload.create).not.toHaveBeenCalled();
});

test.each([
  ['unexpected file field', form => addImage(form, PNG, 'photo'), 'LIMIT_UNEXPECTED_FILE'],
  ['extra text field', form => { addImage(form); form.append('caption', 'extra'); }, 'LIMIT_FIELD_COUNT'],
  ['second image', form => { addImage(form); addImage(form); }, 'LIMIT_FILE_COUNT'],
])('rejects %s with the original request limits', async (name, fill, code) => {
  const form = new FormData();
  fill(form);
  expect(await post(form)).toEqual({ status: 400, body: { code } });
  expect(Upload.create).not.toHaveBeenCalled();
});

test('rejects an image larger than 8 MB before saving', async () => {
  const form = new FormData();
  addImage(form, Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]));
  expect(await post(form)).toEqual({ status: 413, body: { code: 'LIMIT_FILE_SIZE' } });
  expect(Upload.create).not.toHaveBeenCalled();
});

test('preserves the existing 500 response if storage fails', async () => {
  Upload.create.mockRejectedValue(new Error('synthetic storage failure'));
  const form = new FormData();
  addImage(form);
  expect(await post(form)).toEqual({ status: 500, body: { error: 'Unable to upload image' } });
});
