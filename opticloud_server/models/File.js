import mongoose from 'mongoose';

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
  currentTier: {
    type: String,
    enum: ['HOT', 'WARM', 'COLD'],
    default: 'HOT',
    required: true,
    index: true
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
FileSchema.index({ currentTier: 1, lastAccessDate: 1 });
FileSchema.index({ migrationStatus: 1 });
FileSchema.index({ isLocked: 1 });

const File = mongoose.model('File', FileSchema);

export default File;
