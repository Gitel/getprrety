const AdminAuditLog = require('../models/AdminAuditLog');

/**
 * Record one admin action in the audit log.
 *
 * Called AFTER the action itself has succeeded. Best-effort on purpose: the edit is
 * already saved, so failing the request here would tell the admin "it didn't work" when
 * it did, and they would redo it. A failed write is logged loudly instead.
 *
 * @param {object} req      Express request; req.admin.email is the acting admin.
 * @param {string} action   One of AdminAuditLog.ACTIONS.
 * @param {object} [target] { userId, analysisId, catalogueProductId, targetAdminEmail, fields } - all optional.
 * @param {object} [deps]   { model } - injected for tests.
 */
async function logAdminAction(req, action, target = {}, { model = AdminAuditLog } = {}) {
  const { userId = null, analysisId = null, catalogueProductId = null, targetAdminEmail = null, fields = [] } = target;
  try {
    await model.create({
      adminEmail: req.admin.email,
      action,
      userId,
      analysisId,
      catalogueProductId,
      targetAdminEmail,
      fields,
    });
  } catch (err) {
    console.error(`Admin audit log write failed (${action}):`, err.message);
  }
}

module.exports = { logAdminAction };
