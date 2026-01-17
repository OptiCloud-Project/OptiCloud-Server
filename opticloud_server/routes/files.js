import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import File from '../models/File.js';
import { calculateBufferHash } from '../utils/hashUtils.js';
import { evaluateTier, shouldMigrate } from '../services/decisionEngine.js';
import { migrateFile } from '../services/migrationService.js';

const router = express.Router();

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
    
    // Determine initial tier (always HOT for new uploads)
    const initialTier = 'HOT';
    
    // Calculate hash of the file
    const checksum = calculateBufferHash(buffer);
    console.log(`File hash calculated: ${checksum}`);
    
    // Convert buffer to Base64 string for storage in MongoDB
    const fileDataBase64 = buffer.toString('base64');
    console.log(`File converted to Base64, length: ${fileDataBase64.length}`);
    
    // Create file document with file data stored as Base64 string in MongoDB
    const fileDoc = new File({
      fileName: originalname,
      originalFileName: originalname,
      fileData: fileDataBase64, // Store file data as Base64 string in MongoDB
      currentTier: initialTier,
      size: size,
      checksum: checksum,
      contentType: mimetype,
      lastAccessDate: new Date(),
      uploadDate: new Date()
    });
    
    await fileDoc.save();
    console.log(`File saved to MongoDB with ID: ${fileDoc._id}`);
    
    res.status(201).json({
      message: 'File uploaded successfully',
      file: {
        id: fileDoc._id,
        fileName: fileDoc.fileName,
        size: fileDoc.size,
        currentTier: fileDoc.currentTier,
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
 * Get all files with metadata
 */
router.get('/', async (req, res) => {
  try {
    const files = await File.find({}).sort({ uploadDate: -1 });
    
    // Format response for frontend
    const formattedFiles = files.map(file => ({
      id: file._id.toString(),
      name: file.fileName,
      size: formatFileSize(file.size),
      tier: file.currentTier,
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
 * Get file metadata by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.json({
      id: file._id,
      fileName: file.fileName,
      size: file.size,
      currentTier: file.currentTier,
      checksum: file.checksum,
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
 * Download a file
 */
router.get('/:id/download', async (req, res) => {
  try {
    // Load file with fileData included
    const file = await File.findById(req.params.id).select('+fileData');
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
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
 * Delete a file
 */
router.delete('/:id', async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Check if file is locked
    if (file.isLocked) {
      return res.status(409).json({ 
        error: 'File is currently being migrated. Cannot delete locked file.' 
      });
    }
    
    // Delete file (data is stored in MongoDB, so deleting the document removes it)
    await File.findByIdAndDelete(req.params.id);
    console.log(`File deleted from MongoDB: ${req.params.id}`);
    
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
    const file = await File.findById(req.params.id);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    if (file.isLocked) {
      return res.status(409).json({ error: 'File is already being migrated' });
    }
    
    const decision = shouldMigrate(file);
    
    if (!decision.shouldMigrate) {
      return res.json({ 
        message: 'File is already in the correct tier',
        currentTier: file.currentTier
      });
    }
    
    // Trigger migration (will be handled by Agenda.js queue)
    // For now, we'll do it synchronously for manual triggers
    const migratedFile = await migrateFile(req.params.id, decision.targetTier);
    
    res.json({
      message: 'Migration completed successfully',
      file: {
        id: migratedFile._id,
        currentTier: migratedFile.currentTier,
        migrationStatus: migratedFile.migrationStatus
      }
    });
    
  } catch (error) {
    console.error('Error migrating file:', error);
    res.status(500).json({ error: 'Migration failed', details: error.message });
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
