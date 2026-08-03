const SkinScan = require('../models/SkinScan');
const client = require('../services/perfectcorp/client');
const { normalize } = require('../services/perfectcorp/normalizer');
const { merge } = require('../services/perfectcorp/merger');
const { runFusion } = require('../services/skinScan/fusionEngine');
const { mapVendorError } = require('../services/perfectcorp/errors');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const activePolls = new Set();

function pollIntervalMs() { return Number(process.env.SKIN_ANALYSIS_POLL_INTERVAL_MS || 2000); }
function maxPollMs() { return Number(process.env.SKIN_ANALYSIS_MAX_POLL_MS || 90000); }

// Polls a single vendor task to settlement. No units are consumed while `running`, and none on an
// `error` engine failure either — that's what makes the one automatic retry cheap.
async function pollTask(scanId, angle, { retried = false } = {}) {
  const start = Date.now();
  while (Date.now() - start < maxPollMs()) {
    await sleep(Date.now() - start < 30000 ? pollIntervalMs() : pollIntervalMs() * 2.5);

    const scan = await SkinScan.findById(scanId);
    if (!scan) return;
    const task = scan.tasks.find(t => t.angle === angle);
    if (!task || !task.taskId) return;

    let result;
    try {
      result = await client.getTask(task.taskId);
    } catch (err) {
      continue; // transient network hiccup — keep polling until the ceiling
    }

    if (result.task_status === 'running') continue;

    if (result.task_status === 'success') {
      const output = result.results?.output || [];
      const normalized = normalize({ output, angle, taskId: task.taskId, capturedAt: new Date() });
      await settleTask(scanId, angle, { status: 'success', normalized, unitsConsumed: 1 });
      return;
    }

    if (result.task_status === 'error') {
      if (!retried) {
        try {
          const newTaskId = await client.createTask(task.fileId);
          await SkinScan.updateOne(
            { _id: scanId, 'tasks.angle': angle },
            { $set: { 'tasks.$.taskId': newTaskId, 'tasks.$.status': 'processing' } }
          );
          return pollTask(scanId, angle, { retried: true });
        } catch (err) {
          await settleTask(scanId, angle, { status: 'error', error: err.code || 'VENDOR_UNAVAILABLE' });
          return;
        }
      }
      const mapped = mapVendorError(result.error);
      await settleTask(scanId, angle, { status: 'error', error: mapped.code });
      return;
    }
  }

  await settleTask(scanId, angle, { status: 'error', error: 'VENDOR_TIMEOUT' });
}

async function settleTask(scanId, angle, { status, normalized, error, unitsConsumed = 0 }) {
  const update = { 'tasks.$.status': status };
  if (error) update['tasks.$.error'] = error;
  if (normalized) update[`normalized.${angle}`] = normalized;

  await SkinScan.updateOne(
    { _id: scanId, 'tasks.angle': angle },
    { $set: update, ...(unitsConsumed ? { $inc: { unitsConsumed } } : {}) }
  );

  await maybeFinalize(scanId);
}

// Once every task has settled (success/error/skipped), merge + fuse and mark the scan complete.
// The front photo is required; side photos never block completion even if both fail.
async function maybeFinalize(scanId) {
  const scan = await SkinScan.findById(scanId);
  if (!scan || scan.status === 'complete' || scan.status === 'failed') return;

  const pending = scan.tasks.some(t => t.status === 'pending' || t.status === 'processing');
  if (pending) return;

  const front = scan.normalized?.front;
  if (!front) {
    const frontTask = scan.tasks.find(t => t.angle === 'front');
    await SkinScan.updateOne({ _id: scanId }, {
      $set: { status: 'failed', failureReason: frontTask?.error || 'VENDOR_UNAVAILABLE', completedAt: new Date() },
    });
    return;
  }

  const sides = ['left', 'right']
    .map(angle => {
      const task = scan.tasks.find(t => t.angle === angle);
      if (!task || task.status !== 'success') return null;
      return scan.normalized?.[angle] || null;
    })
    .filter(Boolean);

  const merged = merge(front, sides, { sidePhotoAnalysisEnabled: scan.sidePhotoAnalysisEnabled });
  const fusion = runFusion({ answers: scan.quizSnapshot || {}, concerns: merged.concerns, skinType: merged.skinType });

  await SkinScan.updateOne({ _id: scanId }, {
    $set: { status: 'complete', merged, fusion, completedAt: new Date() },
  });
}

function startPolling(scanId, angles) {
  angles.forEach(angle => {
    const key = `${scanId}:${angle}`;
    if (activePolls.has(key)) return;
    activePolls.add(key);
    pollTask(scanId, angle)
      .catch(() => {})
      .finally(() => activePolls.delete(key));
  });
}

// Web processes can restart while vendor work is in flight. Rehydrate all polling loops from Mongo
// on startup and periodically thereafter; startPolling's in-process guard keeps this idempotent.
async function recoverPendingScans() {
  const staleBefore = new Date(Date.now() - 2 * 60 * 1000);
  const starting = await SkinScan.find({ status: 'starting', updatedAt: { $lt: staleBefore } })
    .select('_id tasks')
    .limit(100);
  for (const scan of starting) {
    const front = scan.tasks.find(t => t.angle === 'front' && t.status === 'processing' && t.taskId);
    if (!front) {
      await SkinScan.updateOne({ _id: scan._id, status: 'starting' }, {
        $set: { status: 'failed', failureReason: 'START_INTERRUPTED', completedAt: new Date() },
      });
      continue;
    }
    await SkinScan.updateOne(
      { _id: scan._id, status: 'starting' },
      {
        $set: {
          status: 'processing',
          'tasks.$[pending].status': 'error',
          'tasks.$[pending].error': 'START_INTERRUPTED',
        },
      },
      { arrayFilters: [{ 'pending.status': 'pending' }] }
    );
  }

  const scans = await SkinScan.find({ status: 'processing', 'tasks.status': 'processing' })
    .select('_id tasks')
    .limit(100);
  scans.forEach(scan => {
    const angles = scan.tasks.filter(t => t.status === 'processing' && t.taskId).map(t => t.angle);
    startPolling(scan._id, angles);
  });
}

module.exports = { startPolling, pollTask, maybeFinalize, recoverPendingScans };
