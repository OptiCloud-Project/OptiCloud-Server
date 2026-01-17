/**
 * Decision Engine - Determines which tier a file should be in
 * based on access patterns and metadata
 */

const TIER_RULES = {
  HOT: {
    maxDaysSinceAccess: 30
  },
  WARM: {
    minDaysSinceAccess: 31,
    maxDaysSinceAccess: 90
  },
  COLD: {
    minDaysSinceAccess: 91
  }
};

/**
 * Calculate days since last access
 * @param {Date} lastAccessDate 
 * @returns {number}
 */
const getDaysSinceAccess = (lastAccessDate) => {
  if (!lastAccessDate) return Infinity;
  const now = new Date();
  const diffTime = Math.abs(now - new Date(lastAccessDate));
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

/**
 * Determine the appropriate tier for a file based on last access date
 * @param {Object} file - File document with lastAccessDate
 * @returns {string} - 'HOT', 'WARM', or 'COLD'
 */
export const evaluateTier = (file) => {
  const daysSinceAccess = getDaysSinceAccess(file.lastAccessDate);
  
  if (daysSinceAccess <= TIER_RULES.HOT.maxDaysSinceAccess) {
    return 'HOT';
  } else if (
    daysSinceAccess >= TIER_RULES.WARM.minDaysSinceAccess &&
    daysSinceAccess <= TIER_RULES.WARM.maxDaysSinceAccess
  ) {
    return 'WARM';
  } else {
    return 'COLD';
  }
};

/**
 * Check if a file should be migrated to a different tier
 * @param {Object} file - File document
 * @returns {Object|null} - { shouldMigrate: boolean, targetTier: string } or null
 */
export const shouldMigrate = (file) => {
  const targetTier = evaluateTier(file);
  
  if (targetTier !== file.currentTier) {
    return {
      shouldMigrate: true,
      targetTier,
      reason: `File accessed ${getDaysSinceAccess(file.lastAccessDate)} days ago`
    };
  }
  
  return {
    shouldMigrate: false,
    targetTier: file.currentTier
  };
};

/**
 * Get all files that need migration from all tier collections
 * @param {Array} FileModels - Array of Mongoose File models (HotTierFile, WarmTierFile, ColdTierFile)
 * @returns {Promise<Array>} - Array of files that need migration with tier info
 */
export const getFilesForMigration = async (FileModels) => {
  const allFilesToMigrate = [];
  const tierNames = ['HOT', 'WARM', 'COLD'];
  
  for (let i = 0; i < FileModels.length; i++) {
    const Model = FileModels[i];
    const tier = tierNames[i];
    
    const files = await Model.find({
      migrationStatus: 'IDLE',
      isLocked: false
    });
    
    // Add tier to each file and check if migration is needed
    for (const file of files) {
      const fileWithTier = { ...file.toObject(), currentTier: tier };
      const decision = shouldMigrate(fileWithTier);
      
      if (decision.shouldMigrate) {
        allFilesToMigrate.push({
          file: file,
          currentTier: tier,
          targetTier: decision.targetTier,
          model: Model
        });
      }
    }
  }
  
  return allFilesToMigrate;
};
