import mongoose from 'mongoose';

// Base File Schema - will be used for all tiers
const FileSchema = new mongoose.Schema({
  fileName: {
    type: String,
    required: true,
    index: true
  },
  originalFileName: {
    type: String,
    required: true
  },
  fileData: {
    type: String, // Store as Base64 string
    required: true,
    select: false // Don't load file data by default (only when needed)
  },
  size: {
    type: Number,
    required: true
  },
  checksum: {
    type: String,
    required: false // Will be calculated on upload/migration
  },
  isLocked: {
    type: Boolean,
    default: false,
    index: true
  },
  migrationStatus: {
    type: String,
    enum: ['IDLE', 'PROCESSING', 'VERIFYING', 'FAILED'],
    default: 'IDLE',
    index: true
  },
  retryAttempts: {
    type: Number,
    default: 0
  },
  lastMigrationDate: {
    type: Date,
    default: null
  },
  lastAccessDate: {
    type: Date,
    default: Date.now,
    index: true
  },
  uploadDate: {
    type: Date,
    default: Date.now
  },
  contentType: {
    type: String,
    default: 'application/octet-stream'
  }
}, {
  timestamps: true
});

// Compound indexes for performance
FileSchema.index({ lastAccessDate: 1 });
FileSchema.index({ migrationStatus: 1 });
FileSchema.index({ isLocked: 1 });

// Create models for each tier collection
export const HotTierFile = mongoose.model('HotTierFile', FileSchema, 'HotTierFiles');
export const WarmTierFile = mongoose.model('WarmTierFile', FileSchema, 'WarmTierFiles');
export const ColdTierFile = mongoose.model('ColdTierFile', FileSchema, 'ColdTierFiles');

// Helper function to get the correct model based on tier
export const getFileModelByTier = (tier) => {
  switch (tier) {
    case 'HOT':
      return HotTierFile;
    case 'WARM':
      return WarmTierFile;
    case 'COLD':
      return ColdTierFile;
    default:
      return HotTierFile;
  }
};

// Helper function to get all file models
export const getAllFileModels = () => {
  return [HotTierFile, WarmTierFile, ColdTierFile];
};

// Default export for backward compatibility (will use HotTierFile)
export default HotTierFile;
