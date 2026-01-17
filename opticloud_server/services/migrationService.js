import { getFileModelByTier, getAllFileModels } from '../models/File.js';
import { calculateBufferHash } from '../utils/hashUtils.js';

/**
 * Migration Service - Handles Copy-Verify-Delete process
 * Migrates files between tier collections in MongoDB
 */

const MAX_RETRY_ATTEMPTS = 3;

/**
 * Find file across all tier collections
 * @param {string} fileId - File document ID
 * @returns {Promise<{file: Object, tier: string, model: Model} | null>}
 */
const findFileAcrossTiers = async (fileId) => {
  const allModels = getAllFileModels();
  const tierNames = ['HOT', 'WARM', 'COLD'];
  
  for (let i = 0; i < allModels.length; i++) {
    const Model = allModels[i];
    const file = await Model.findById(fileId).select('+fileData');
    if (file) {
      return { file, tier: tierNames[i], model: Model };
    }
  }
  return null;
};

/**
 * Lock a file for migration
 * @param {string} fileId - File document ID
 * @param {string} currentTier - Current tier of the file
 * @returns {Promise<{file: Object, tier: string, model: Model}>} - Locked file document
 */
export const lockFile = async (fileId, currentTier) => {
  const Model = getFileModelByTier(currentTier);
  const file = await Model.findByIdAndUpdate(
    fileId,
    {
      isLocked: true,
      migrationStatus: 'PROCESSING'
    },
    { new: true }
  ).select('+fileData');
  
  if (!file) {
    throw new Error(`File not found: ${fileId} in ${currentTier} tier`);
  }
  
  return { file, tier: currentTier, model: Model };
};

/**
 * Unlock a file
 * @param {string} fileId - File document ID
 * @param {string} tier - Tier of the file
 * @param {string} status - New migration status
 */
export const unlockFile = async (fileId, tier, status = 'IDLE') => {
  const Model = getFileModelByTier(tier);
  await Model.findByIdAndUpdate(fileId, {
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
 * Moves file document from source tier collection to target tier collection
 * @param {string} fileId - File document ID
 * @param {string} currentTier - Current tier
 * @param {string} targetTier - Target tier
 * @returns {Promise<Object>} - New file document in target collection
 */
export const migrateFile = async (fileId, currentTier, targetTier) => {
  let fileInfo;
  
  try {
    // Step 1: Lock the file
    fileInfo = await lockFile(fileId, currentTier);
    const { file, model: sourceModel } = fileInfo;
    
    // Step 2: Verify integrity (recalculate hash)
    await sourceModel.findByIdAndUpdate(fileId, {
      migrationStatus: 'VERIFYING'
    });
    
    const calculatedHash = await verifyFileIntegrity(file);
    
    // Step 3: Compare with stored checksum
    if (file.checksum && calculatedHash !== file.checksum) {
      await unlockFile(fileId, currentTier, 'FAILED');
      throw new Error('Hash mismatch - file integrity check failed');
    }
    
    // Step 4: Commit - Copy to target collection and delete from source
    const targetModel = getFileModelByTier(targetTier);
    
    // Create new document in target collection
    const newFileDoc = new targetModel({
      fileName: file.fileName,
      originalFileName: file.originalFileName,
      fileData: file.fileData, // Copy Base64 data
      size: file.size,
      checksum: calculatedHash,
      contentType: file.contentType,
      lastAccessDate: file.lastAccessDate,
      uploadDate: file.uploadDate,
      lastMigrationDate: new Date(),
      migrationStatus: 'IDLE',
      isLocked: false,
      retryAttempts: 0
    });
    
    await newFileDoc.save();
    console.log(`File copied to ${targetTier} collection with ID: ${newFileDoc._id}`);
    
    // Delete from source collection
    await sourceModel.findByIdAndDelete(fileId);
    console.log(`File deleted from ${currentTier} collection: ${fileId}`);
    
    console.log(`File ${file.fileName} migrated from ${currentTier} to ${targetTier}`);
    
    return newFileDoc;
    
  } catch (error) {
    // Handle errors and update retry attempts
    if (fileInfo && fileInfo.file) {
      const { file, model } = fileInfo;
      file.retryAttempts += 1;
      
      if (file.retryAttempts >= MAX_RETRY_ATTEMPTS) {
        await model.findByIdAndUpdate(fileInfo.file._id, {
          migrationStatus: 'FAILED',
          isLocked: false
        });
        throw new Error(`Migration failed after ${MAX_RETRY_ATTEMPTS} attempts: ${error.message}`);
      } else {
        await unlockFile(fileId, currentTier, 'IDLE');
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
  const allModels = getAllFileModels();
  const allStuckFiles = [];
  
  for (const Model of allModels) {
    const stuckFiles = await Model.find({
      migrationStatus: { $in: ['PROCESSING', 'VERIFYING'] },
      isLocked: true
    });
    
    for (const file of stuckFiles) {
      // Reset to IDLE and unlock
      file.migrationStatus = 'IDLE';
      file.isLocked = false;
      await file.save();
      allStuckFiles.push(file);
    }
  }
  
  return allStuckFiles;
};
