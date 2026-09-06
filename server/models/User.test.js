const User = require('./User');

// Regression guard for a signup outage. googleId was declared
// { unique: true, sparse: true, default: null }. A sparse index skips documents that
// LACK the indexed field, but `default: null` wrote the field on every email signup — so
// the field was present, carried a null key, and got indexed. The second email-only
// account therefore collided on googleId_1, and routes/auth.js reported that E11000 as
// "Email already registered" for an address nobody had ever used. In practice only one
// email+password account could exist in the whole database.

test('an email signup stores no googleId at all, so it cannot share an index key', () => {
  const doc = new User({ email: 'brand-new@example.com', passwordHash: 'x' }).toObject();

  expect(Object.prototype.hasOwnProperty.call(doc, 'googleId')).toBe(false);
});

test('the googleId index excludes anything that is not a real string id', () => {
  const entry = User.schema.indexes().find(([keys]) => keys.googleId);
  expect(entry).toBeDefined();

  const [, options] = entry;
  expect(options.unique).toBe(true);
  // A partial filter is what actually keeps absent and null values out of a unique
  // index. `sparse` does not: a stored null is still indexed, which is the whole bug.
  expect(options.partialFilterExpression).toEqual({ googleId: { $type: 'string' } });
  expect(options.sparse).toBeUndefined();
});

test('a Google signup still stores its id', () => {
  const doc = new User({ email: 'g@example.com', googleId: 'sub-123' }).toObject();

  expect(doc.googleId).toBe('sub-123');
});
