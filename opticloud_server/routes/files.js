import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { HotTierFile, getAllFileModels, getFileModelByTier } from '../models/File.js';
import { calculateBufferHash } from '../utils/hashUtils.js';
import { evaluateTier, shouldMigrate } from '../services/decisionEngine.js';
import { migrateFile } from '../services/migrationService.js';

const router = express.Router();

/**
 * Helper function to find a file by ID across all tier collections
 * @param {string} fileId - File document ID
 * @returns {Promise<{file: Object, tier: string, model: Model} | null>}
 */
const findFileAcrossTiers = async (fileId) => {
  const allModels = getAllFileModels();
  const tierNames = ['HOT', 'WARM', 'COLD'];
  
  for (let i = 0; i < allModels.length; i++) {
    const Model = allModels[i];
    const file = await Model.findById(fileId);
    if (file) {
      return { file, tier: tierNames[i], model: Model };
    }
  }
  return null;
};

// Configure multer for memory storage (we'll save directly to MongoDB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

/**
 * POST /api/files/upload
 * Upload a file to the system
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    console.log('Upload request received');
    
    if (!req.file) {
      console.log('No file in request');
      return res.status(400).json({ error: 'No file provided' });
    }

    const { originalname, buffer, mimetype, size } = req.file;
    console.log(`Uploading file: ${originalname}, size: ${size} bytes, type: ${mimetype}`);
    
    // New uploads always go to HOT tier collection
    const initialTier = 'HOT';
    
    // Calculate hash of the file
    const checksum = calculateBufferHash(buffer);
    console.log(`File hash calculated: ${checksum}`);
    
    // Convert buffer to Base64 string for storage in MongoDB
    const fileDataBase64 = buffer.toString('base64');
    console.log(`File converted to Base64, length: ${fileDataBase64.length}`);
    
    // Create file document in HotTierFiles collection
    const fileDoc = new HotTierFile({
      fileName: originalname,
      originalFileName: originalname,
      fileData: fileDataBase64, // Store file data as Base64 string in MongoDB
      size: size,
      checksum: checksum,
      contentType: mimetype,
      lastAccessDate: new Date(),
      uploadDate: new Date()
    });
    
    await fileDoc.save();
    console.log(`File saved to HotTierFiles collection with ID: ${fileDoc._id}`);
    
    res.status(201).json({
      message: 'File uploaded successfully',
      file: {
        id: fileDoc._id,
        fileName: fileDoc.fileName,
        size: fileDoc.size,
        tier: initialTier,
        uploadDate: fileDoc.uploadDate
      }
    });
    console.log('Upload response sent successfully');
    
  } catch (error) {
    console.error('Upload error:', error);
    
    // Make sure we send a response
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Upload failed', 
        details: error.message 
      });
    }
  }
});

/**
 * GET /api/files
 * Get all files with metadata from all tier collections
 */
router.get('/', async (req, res) => {
  try {
    const allModels = getAllFileModels();
    const allFiles = [];
    
    // Fetch files from all tier collections
    for (const Model of allModels) {
      const files = await Model.find({}).sort({ uploadDate: -1 });
      
      // Determine tier based on collection name
      let tier = 'HOT';
      if (Model.collection.name === 'WarmTierFiles') tier = 'WARM';
      if (Model.collection.name === 'ColdTierFiles') tier = 'COLD';
      
      // Add tier to each file and push to allFiles
      files.forEach(file => {
        allFiles.push({
          ...file.toObject(),
          tier: tier
        });
      });
    }
    
    // Sort all files by upload date
    allFiles.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
    
    // Format response for frontend
    const formattedFiles = allFiles.map(file => ({
      id: file._id.toString(),
      name: file.fileName,
      size: formatFileSize(file.size),
      sizeBytes: file.size, // Add raw size in bytes for cost calculation
      tier: file.tier,
      status: file.migrationStatus,
      integrity: file.checksum ? 'Verified' : 'Pending',
      checksum: file.checksum,
      isLocked: file.isLocked,
      lastAccessDate: file.lastAccessDate,
      uploadDate: file.uploadDate,
      migrationStatus: file.migrationStatus
    }));
    
    res.json(formattedFiles);
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Failed to fetch files', details: error.message });
  }
});

/**
 * GET /api/files/:id
 * Get file metadata by ID (searches across all tier collections)
 */
router.get('/:id', async (req, res) => {
  try {
    const result = await findFileAcrossTiers(req.params.id);
    
    if (!result) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const { file, tier, model } = result;
    
    // If file is in migration process, calculate checksums in real-time
    let sourceChecksumBeforeMigration = file.sourceChecksumBeforeMigration || null;
    let targetChecksumAfterMigration = file.targetChecksumAfterMigration || null;
    
    if (file.migrationStatus === 'PROCESSING' || file.migrationStatus === 'VERIFYING') {
      // Load file with fileData to calculate checksum
      const fileWithData = await model.findById(req.params.id).select('+fileData');
      
      if (fileWithData && fileWithData.fileData) {
        // Calculate current checksum (this is the source checksum before migration)
        const buffer = Buffer.from(fileWithData.fileData, 'base64');
        sourceChecksumBeforeMigration = calculateBufferHash(buffer);
        console.log(`[API] Calculated source checksum for ${file.fileName}: ${sourceChecksumBeforeMigration}`);
        
        // If status is VERIFYING, try to find the target file in other tiers
        if (file.migrationStatus === 'VERIFYING') {
          // Search in all other tiers for a file with same fileName that's being migrated
          const allModels = getAllFileModels();
          const tierNames = ['HOT', 'WARM', 'COLD'];
          
          for (let i = 0; i < allModels.length; i++) {
            const targetModel = allModels[i];
            const targetTier = tierNames[i];
            
            // Skip current tier
            if (targetTier === tier) continue;
            
            // Try to find file with same fileName, VERIFYING status, and locked in target tier
            // Also check if it was created recently (within last 5 minutes) to ensure it's the migrated file
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            const targetFile = await targetModel.findOne({
              fileName: file.fileName,
              migrationStatus: 'VERIFYING',
              isLocked: true,
              createdAt: { $gte: fiveMinutesAgo }
            }).select('+fileData');
            
            if (targetFile && targetFile.fileData) {
              // Calculate target checksum
              const targetBuffer = Buffer.from(targetFile.fileData, 'base64');
              targetChecksumAfterMigration = calculateBufferHash(targetBuffer);
              console.log(`[API] Found and calculated target checksum for ${file.fileName} in ${targetTier}: ${targetChecksumAfterMigration}`);
              break; // Found it, no need to continue searching
            }
          }
        }
      }
    }
    
    res.json({
      id: file._id,
      fileName: file.fileName,
      size: file.size,
      tier: tier,
      checksum: file.checksum,
      sourceChecksumBeforeMigration: sourceChecksumBeforeMigration,
      targetChecksumAfterMigration: targetChecksumAfterMigration,
      isLocked: file.isLocked,
      migrationStatus: file.migrationStatus,
      lastAccessDate: file.lastAccessDate,
      uploadDate: file.uploadDate,
      retryAttempts: file.retryAttempts
    });
  } catch (error) {
    console.error('Error fetching file:', error);
    res.status(500).json({ error: 'Failed to fetch file', details: error.message });
  }
});

/**
 * GET /api/files/:id/download
 * Download a file (searches across all tier collections)
 */
router.get('/:id/download', async (req, res) => {
  try {
    // Find file across all tier collections with fileData
    const result = await findFileAcrossTiers(req.params.id);
    
    if (!result) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const { file: fileWithoutData, model } = result;
    
    // Load file with fileData included
    const file = await model.findById(req.params.id).select('+fileData');
    
    // Check if file is locked
    if (file.isLocked) {
      return res.status(409).json({ error: 'File is currently being migrated' });
    }
    
    // Update last access date
    file.lastAccessDate = new Date();
    await file.save();
    
    // Check if file data exists
    if (!file.fileData) {
      return res.status(404).json({ error: 'File data not found' });
    }
    
    // Convert Base64 string back to Buffer
    const fileBuffer = Buffer.from(file.fileData, 'base64');
    
    // Set headers
    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    
    // Send file data
    res.send(fileBuffer);
    
  } catch (error) {
    console.error('Error downloading file:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Download failed', details: error.message });
    }
  }
});

/**
 * DELETE /api/files/:id
 * Delete a file (searches across all tier collections)
 */
router.delete('/:id', async (req, res) => {
  try {
    const result = await findFileAcrossTiers(req.params.id);
    
    if (!result) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const { file, model } = result;
    
    // Check if file is locked
    if (file.isLocked) {
      return res.status(409).json({ 
        error: 'File is currently being migrated. Cannot delete locked file.' 
      });
    }
    
    // Delete file from the appropriate collection
    await model.findByIdAndDelete(req.params.id);
    console.log(`File deleted from ${model.collection.name}: ${req.params.id}`);
    
    res.json({ message: 'File deleted successfully' });
    
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file', details: error.message });
  }
});

/**
 * POST /api/files/:id/migrate
 * Manually trigger migration for a file
 */
router.post('/:id/migrate', async (req, res) => {
  try {
    const result = await findFileAcrossTiers(req.params.id);
    
    if (!result) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const { file, tier } = result;
    
    if (file.isLocked) {
      return res.status(409).json({ error: 'File is already being migrated' });
    }
    
    // Add tier to file object for decision engine
    const fileWithTier = { ...file.toObject(), currentTier: tier };
    const decision = shouldMigrate(fileWithTier);
    
    if (!decision.shouldMigrate) {
      return res.json({ 
        message: 'File is already in the correct tier',
        tier: tier
      });
    }
    
    // Trigger migration (will be handled by Agenda.js queue)
    // For now, we'll do it synchronously for manual triggers
    const migratedFile = await migrateFile(req.params.id, tier, decision.targetTier);
    
    res.json({
      message: 'Migration completed successfully',
      file: {
        id: migratedFile._id,
        tier: decision.targetTier,
        migrationStatus: migratedFile.migrationStatus
      }
    });
    
  } catch (error) {
    console.error('Error migrating file:', error);
    res.status(500).json({ error: 'Migration failed', details: error.message });
  }
});

/**
 * POST /api/files/:id/simulate-last-access-30-days
 * Simulate that the file was last accessed 30 days ago by updating lastAccessDate
 */
router.post('/:id/simulate-last-access-30-days', async (req, res) => {
  try {
    const result = await findFileAcrossTiers(req.params.id);

    if (!result) {
      return res.status(404).json({ error: 'File not found' });
    }

    const { file, model } = result;

    // Calculate new lastAccessDate: 30 days earlier than current lastAccessDate (if exists),
    // otherwise 30 days earlier than now. This makes the simulation cumulative per click.
    const currentLastAccess = file.lastAccessDate ? new Date(file.lastAccessDate) : new Date();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const newLastAccessDate = new Date(currentLastAccess.getTime() - thirtyDaysMs);

    file.lastAccessDate = newLastAccessDate;
    await file.save();

    console.log(`Simulated lastAccessDate -30 days for file ${file.fileName} (${file._id}). New lastAccessDate: ${file.lastAccessDate.toISOString()}`);

    res.json({
      message: 'Last access date simulated to 30 days ago successfully',
      file: {
        id: file._id,
        fileName: file.fileName,
        lastAccessDate: file.lastAccessDate
      }
    });
  } catch (error) {
    console.error('Error simulating last access date:', error);
    res.status(500).json({ error: 'Simulation failed', details: error.message });
  }
});

/**
 * Helper function to format file size
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

export default router;
