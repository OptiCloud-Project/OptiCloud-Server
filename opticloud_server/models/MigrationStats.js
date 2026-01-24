import mongoose from 'mongoose';

/**
 * MigrationStats - Tracks migration count for fines calculation.
 * Single document; $0.10 fine per migration between tiers.
 */
const MigrationStatsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'global' },
  totalMigrations: { type: Number, default: 0 }
}, { collection: 'migrationstats' });

const MigrationStats = mongoose.model('MigrationStats', MigrationStatsSchema);

/**
 * Increment migration count (call after each successful migration).
 * @returns {Promise<{ totalMigrations: number }>}
 */
export const incrementMigrationCount = async () => {
  const doc = await MigrationStats.findOneAndUpdate(
    { key: 'global' },
    { $inc: { totalMigrations: 1 } },
    { upsert: true, new: true }
  );
  return { totalMigrations: doc.totalMigrations };
};

/**
 * Get current migration stats.
 * @returns {Promise<{ totalMigrations: number }>}
 */
export const getMigrationStats = async () => {
  const doc = await MigrationStats.findOne({ key: 'global' });
  return {
    totalMigrations: doc ? doc.totalMigrations : 0
  };
};

export default MigrationStats;
