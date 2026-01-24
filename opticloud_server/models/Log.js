import mongoose from 'mongoose';

/**
 * Admin logs - persisted for Admin Logs UI across restarts.
 */
const LogSchema = new mongoose.Schema({
  ts: { type: String, required: true },
  level: { type: String, required: true },
  text: { type: String, required: true }
}, { collection: 'adminlogs', timestamps: false });

LogSchema.index({ ts: 1 });

const Log = mongoose.model('Log', LogSchema);
export default Log;
