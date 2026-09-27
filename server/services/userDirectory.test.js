const { escapeRegex, userSearchFilter, listUsers, getUserDetail, PAGE_SIZE } = require('./userDirectory');

// Chainable stand-in for a Mongoose query: find().select().sort().skip().limit().lean()
function query(result) {
  const q = {};
  ['select', 'sort', 'skip', 'limit'].forEach(m => { q[m] = jest.fn(() => q); });
  q.lean = jest.fn(async () => result);
  return q;
}

describe('search filter', () => {
  test('escapes regex metacharacters so input is matched literally', () => {
    expect(escapeRegex('a.b*(c)+[d]?')).toBe('a\\.b\\*\\(c\\)\\+\\[d\\]\\?');
    const { $or } = userSearchFilter('.*');
    expect($or[0].email.test('anything')).toBe(false);
    expect($or[0].email.test('has .* inside')).toBe(true);
  });

  test('is case-insensitive on email and first name', () => {
    const { $or } = userSearchFilter('  ADA ');
    expect($or[0].email.test('ada@example.com')).toBe(true);
    expect($or[1].firstName.test('Ada')).toBe(true);
  });

  test('empty, blank or non-string search means everyone', () => {
    expect(userSearchFilter('')).toEqual({});
    expect(userSearchFilter('   ')).toEqual({});
    expect(userSearchFilter(['a', 'b'])).toEqual({}); // ?q=a&q=b arrives as an array
    expect(userSearchFilter(undefined)).toEqual({});
  });
});

describe('listUsers', () => {
  test('pages users and attaches quiz-completion stats, 0 for users with none', async () => {
    const users = [{ _id: 'u1', email: 'a@x.co' }, { _id: 'u2', email: 'b@x.co' }];
    const find = query(users);
    const userModel = { countDocuments: jest.fn(async () => 120), find: jest.fn(() => find) };
    const analysisModel = { aggregate: jest.fn(async () => [{ _id: 'u1', count: 2, latestEraName: 'Glow Building Era' }]) };

    const result = await listUsers({ q: 'x', page: '3' }, { userModel, analysisModel });

    expect(find.skip).toHaveBeenCalledWith(2 * PAGE_SIZE);
    expect(find.select.mock.calls[0][0]).not.toContain('passwordHash');
    expect(result).toMatchObject({ total: 120, page: 3, pages: 3, q: 'x' });
    expect(result.users[0].analyses).toMatchObject({ count: 2, latestEraName: 'Glow Building Era' });
    expect(result.users[1].analyses).toEqual({ count: 0 });
  });

  test('bad page numbers fall back to page 1 and an empty page skips the aggregate', async () => {
    const find = query([]);
    const userModel = { countDocuments: jest.fn(async () => 0), find: jest.fn(() => find) };
    const analysisModel = { aggregate: jest.fn() };
    const result = await listUsers({ page: '-4' }, { userModel, analysisModel });
    expect(find.skip).toHaveBeenCalledWith(0);
    expect(analysisModel.aggregate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ users: [], page: 1, pages: 1 });
  });
});

describe('getUserDetail', () => {
  const id = '64b0000000000000000000aa';
  const models = user => ({
    userModel: { findById: jest.fn(() => query(user)) },
    analysisModel: { find: jest.fn(() => query([{ _id: 'a1' }])) },
    checkInModel: { find: jest.fn(() => query([])) },
    productLogModel: { find: jest.fn(() => query([])) },
    activityModel: { find: jest.fn(() => query([{ event: 'login' }])) },
  });

  test('returns the user with all of their lists', async () => {
    const detail = await getUserDetail(id, models({ _id: id, email: 'a@x.co' }));
    expect(detail.user.email).toBe('a@x.co');
    expect(detail.analyses).toHaveLength(1);
    expect(detail.activity[0].event).toBe('login');
  });

  test('returns null for an unknown user or a malformed id, without querying lists', async () => {
    const m = models(null);
    await expect(getUserDetail(id, m)).resolves.toBeNull();
    await expect(getUserDetail('not-an-id', m)).resolves.toBeNull();
    expect(m.analysisModel.find).not.toHaveBeenCalled();
  });
});
