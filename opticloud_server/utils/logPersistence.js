/**
 * Persist admin logs to MongoDB. Load on startup, append on each log.
 */

import Log from '../models/Log.js';

const MAX_LOAD = 1000;
const MAX_STORED = 5000;
const PRUNE_BATCH = 1000;

/**
 * Load last MAX_LOAD logs (newest in DB first, then reversed to oldest-first for display).
 * @returns {Promise<Array<{ ts: string, level: string, text: string }>>}
 */
export async function loadRecent() {
  const docs = await Log.find({})
    .sort({ ts: -1 })
    .limit(MAX_LOAD)
    .lean();
  const mapped = docs.map((d) => ({ ts: d.ts, level: d.level, text: d.text }));
  return mapped.reverse();
}

/**
 * Append one log entry to DB and prune if over limit.
 * @param {{ ts: string, level: string, text: string }} entry
 */
export async function append(entry) {
  await Log.create(entry);
  const count = await Log.countDocuments();
  if (count > MAX_STORED) {
    const toRemove = await Log.find({}).sort({ ts: 1 }).limit(PRUNE_BATCH).select('_id').lean();
    await Log.deleteMany({ _id: { $in: toRemove.map((d) => d._id) } });
  }
}
