const SkinAnalysis = require('../models/SkinAnalysis');

// The client retries POST /api/analysis (src/lib/retry.js), and a plain create() is
// not idempotent: when a response was lost after the insert already landed, the
// retry wrote a second analysis — and because clinicNotifiedAt is a per-document
// guard, that second document emailed the clinic all over again. The client now
// sends one stable clientRequestId per save; the unique partial index on
// (userId, clientRequestId) turns the retry into a lookup.
//
// Returns { doc, created }. Callers MUST gate side effects on `created` — that is
// the whole point of the flag.
async function saveAnalysis(fields, { model = SkinAnalysis } = {}) {
  try {
    return { doc: await model.create(fields), created: true };
  } catch (err) {
    if (err.code !== 11000 || !fields.clientRequestId) throw err;
    const doc = await model.findOne({
      userId: fields.userId,
      clientRequestId: fields.clientRequestId,
    });
    // No document behind the duplicate means the collision was something else
    // entirely. Surfacing it is right; pretending the save worked is not.
    if (!doc) throw err;
    return { doc, created: false };
  }
}

module.exports = { saveAnalysis };
