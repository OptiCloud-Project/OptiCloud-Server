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
  let newFileDoc = null;
  
  try {
    // Step 1: Lock the file
    fileInfo = await lockFile(fileId, currentTier);
    const { file, model: sourceModel } = fileInfo;
    
    console.log(`Starting migration of ${file.fileName} from ${currentTier} to ${targetTier}`);
    
    // Step 2: Calculate checksum BEFORE migration (source file)
    await sourceModel.findByIdAndUpdate(fileId, {
      migrationStatus: 'VERIFYING'
    });
    
    const sourceHashBefore = await verifyFileIntegrity(file);
    console.log(`Source file checksum (before migration): ${sourceHashBefore}`);
    
    // Step 3: Compare with stored checksum (if exists)
    if (file.checksum && sourceHashBefore !== file.checksum) {
      await unlockFile(fileId, currentTier, 'FAILED');
      throw new Error(`Source file integrity check failed: stored checksum (${file.checksum}) does not match calculated (${sourceHashBefore})`);
    }
    
    // Step 4: Copy to target collection
    const targetModel = getFileModelByTier(targetTier);
    
    // Create new document in target collection
    newFileDoc = new targetModel({
      fileName: file.fileName,
      originalFileName: file.originalFileName,
      fileData: file.fileData, // Copy Base64 data
      size: file.size,
      checksum: sourceHashBefore, // Use the verified hash
      contentType: file.contentType,
      lastAccessDate: file.lastAccessDate,
      uploadDate: file.uploadDate,
      lastMigrationDate: new Date(),
      migrationStatus: 'VERIFYING', // Keep in VERIFYING until we verify the copy
      isLocked: true, // Keep locked until verification is complete
      retryAttempts: 0
    });
    
    await newFileDoc.save();
    console.log(`File copied to ${targetTier} collection with ID: ${newFileDoc._id}`);
    
    // Step 5: Verify integrity AFTER migration (target file)
    // Reload the new file to get fresh data
    const targetFile = await targetModel.findById(newFileDoc._id).select('+fileData');
    const targetHashAfter = await verifyFileIntegrity(targetFile);
    console.log(`Target file checksum (after migration): ${targetHashAfter}`);
    
    // Step 6: Compare source and target checksums
    if (sourceHashBefore !== targetHashAfter) {
      // Rollback: Delete target file
      await targetModel.findByIdAndDelete(newFileDoc._id);
      await unlockFile(fileId, currentTier, 'FAILED');
      throw new Error(`Checksum mismatch after migration: source (${sourceHashBefore}) !== target (${targetHashAfter}). Migration aborted, source file preserved.`);
    }
    
    console.log(`Checksum verification passed: ${sourceHashBefore} === ${targetHashAfter}`);
    
    // Step 7: Commit - Update target file status and delete source
    await targetModel.findByIdAndUpdate(newFileDoc._id, {
      migrationStatus: 'IDLE',
      isLocked: false
    });
    
    // Delete from source collection only after successful verification
    await sourceModel.findByIdAndDelete(fileId);
    console.log(`File deleted from ${currentTier} collection: ${fileId}`);
    
    console.log(`✓ File ${file.fileName} successfully migrated from ${currentTier} to ${targetTier} with verified integrity`);
    
    // Reload final file document
    const finalFile = await targetModel.findById(newFileDoc._id);
    return finalFile;
    
  } catch (error) {
    // Cleanup: If target file was created but verification failed, delete it
    if (newFileDoc && newFileDoc._id) {
      try {
        const targetModel = getFileModelByTier(targetTier);
        await targetModel.findByIdAndDelete(newFileDoc._id);
        console.log(`Cleaned up target file after error: ${newFileDoc._id}`);
      } catch (cleanupError) {
        console.error('Error cleaning up target file:', cleanupError);
      }
    }
    
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
