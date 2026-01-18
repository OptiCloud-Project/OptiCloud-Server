import Agenda from 'agenda';
import { getFilesForMigration } from '../services/decisionEngine.js';
import { migrateFile } from '../services/migrationService.js';
import { getAllFileModels } from '../models/File.js';

/**
 * Setup migration job with Agenda.js
 * @param {Agenda} agenda - Agenda instance
 */
export const setupMigrationJob = (agenda) => {
  // Define migration job with exponential backoff retry
  agenda.define('migrate files', {
    concurrency: 1, // Process one file at a time to avoid overwhelming the system
    lockLifetime: 10 * 60 * 1000, // 10 minutes lock lifetime
    lockLimit: 1,
    // Exponential backoff: retry after 1min, 2min, 4min (up to 3 attempts)
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 60000 // Start with 1 minute delay
    }
  }, async (job) => {
    console.log('Running migration job...');
    
    try {
      // Get files that need migration from all tier collections
      const allModels = getAllFileModels();
      const filesToMigrate = await getFilesForMigration(allModels);
      
      console.log(`Found ${filesToMigrate.length} files to migrate`);
      
      // Process each file
      for (const fileInfo of filesToMigrate) {
        try {
          const { file, currentTier, targetTier } = fileInfo;
          console.log(`Migrating ${file.fileName} from ${currentTier} to ${targetTier}`);
          await migrateFile(file._id.toString(), currentTier, targetTier);
          console.log(`Successfully migrated ${file.fileName}`);
        } catch (error) {
          console.error(`Failed to migrate ${fileInfo.file.fileName}:`, error.message);
          // Error handling is done in migrateFile (retry logic)
          // Agenda.js will handle retry with exponential backoff
        }
      }
    } catch (error) {
      console.error('Migration job error:', error);
      throw error; // Agenda will retry based on configuration
    }
  });
  
  // Schedule job to run every 20 seconds
  agenda.every('20 seconds', 'migrate files');
  
  console.log('Migration job scheduled to run every 20 seconds with exponential backoff retry');
};

/**
 * Setup recovery job for stuck migrations
 * @param {Agenda} agenda - Agenda instance
 */
export const setupRecoveryJob = (agenda) => {
  agenda.define('recover stuck migrations', async (job) => {
    console.log('Running recovery job...');
    
    try {
      const migrationService = await import('../services/migrationService.js');
      const recovered = await migrationService.recoverStuckMigrations();
      
      if (recovered && recovered.length > 0) {
        console.log(`Recovered ${recovered.length} stuck migrations`);
      }
    } catch (error) {
      console.error('Recovery job error:', error);
    }
  });
  
  // Run recovery job every 1 minute
  agenda.every('1 minute', 'recover stuck migrations');
  
  console.log('Recovery job scheduled to run every 1 minute');
};
