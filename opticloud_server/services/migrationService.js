import File from '../models/File.js';
import { calculateBufferHash } from '../utils/hashUtils.js';

/**
 * Migration Service - Handles Copy-Verify-Delete process
 * Since files are stored directly in MongoDB, migration is just updating the tier
 */

const MAX_RETRY_ATTEMPTS = 3;

/**
 * Lock a file for migration
 * @param {string} fileId - File document ID
 * @returns {Promise<Object>} - Locked file document
 */
export const lockFile = async (fileId) => {
  // Load file with fileData for migration
  const file = await File.findByIdAndUpdate(
    fileId,
    {
      isLocked: true,
      migrationStatus: 'PROCESSING'
    },
    { new: true }
  ).select('+fileData');
  
  if (!file) {
    throw new Error(`File not found: ${fileId}`);
  }
  
  return file;
};

/**
 * Unlock a file
 * @param {string} fileId - File document ID
 * @param {string} status - New migration status
 */
export const unlockFile = async (fileId, status = 'IDLE') => {
  await File.findByIdAndUpdate(fileId, {
    isLocked: false,
    migrationStatus: status
  });
};

/**
 * Verify file integrity by recalculating hash
 * @param {Object} file - File document with fileData (Base64 string)
 * @returns {Promise<string>} - Calculated hash
 */
const verifyFileIntegrity = async (file) => {
  if (!file.fileData) {
    throw new Error('File data is missing');
  }
  
  // Convert Base64 string to Buffer
  const buffer = Buffer.from(file.fileData, 'base64');
  const calculatedHash = calculateBufferHash(buffer);
  
  return calculatedHash;
};

/**
 * Main migration function - Copy-Verify-Delete process
 * Since files are in MongoDB, we just verify and update tier
 * @param {string} fileId - File document ID
 * @param {string} targetTier - Target tier
 * @returns {Promise<Object>} - Updated file document
 */
export const migrateFile = async (fileId, targetTier) => {
  let file;
  
  try {
    // Step 1: Lock the file
    file = await lockFile(fileId);
    
    // Step 2: Verify integrity (recalculate hash)
    file.migrationStatus = 'VERIFYING';
    await file.save();
    
    const calculatedHash = await verifyFileIntegrity(file);
    
    // Step 3: Compare with stored checksum
    if (file.checksum && calculatedHash !== file.checksum) {
      await unlockFile(fileId, 'FAILED');
      throw new Error('Hash mismatch - file integrity check failed');
    }
    
    // Step 4: Commit - Update tier (file data stays in MongoDB, just change tier)
    const oldTier = file.currentTier;
    file.currentTier = targetTier;
    file.checksum = calculatedHash; // Update checksum if it was missing
    file.migrationStatus = 'IDLE';
    file.isLocked = false;
    file.lastMigrationDate = new Date();
    file.retryAttempts = 0;
    await file.save();
    
    console.log(`File ${file.fileName} migrated from ${oldTier} to ${targetTier}`);
    
    return file;
    
  } catch (error) {
    // Handle errors and update retry attempts
    if (file) {
      file.retryAttempts += 1;
      
      if (file.retryAttempts >= MAX_RETRY_ATTEMPTS) {
        file.migrationStatus = 'FAILED';
        file.isLocked = false;
        await file.save();
        throw new Error(`Migration failed after ${MAX_RETRY_ATTEMPTS} attempts: ${error.message}`);
      } else {
        await unlockFile(fileId, 'IDLE');
        throw error; // Will be retried by Agenda.js
      }
    } else {
      throw error;
    }
  }
};

/**
 * Recover stuck migrations (files in PROCESSING or VERIFYING state)
 * @returns {Promise<Array>} - Array of recovered files
 */
export const recoverStuckMigrations = async () => {
  const stuckFiles = await File.find({
    migrationStatus: { $in: ['PROCESSING', 'VERIFYING'] },
    isLocked: true
  });
  
  for (const file of stuckFiles) {
    // Reset to IDLE and unlock
    file.migrationStatus = 'IDLE';
    file.isLocked = false;
    await file.save();
  }
  
  return stuckFiles;
};
