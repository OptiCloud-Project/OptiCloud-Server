import Agenda from 'agenda';
import { getFilesForMigration, shouldMigrate } from '../services/decisionEngine.js';
import { migrateFile } from '../services/migrationService.js';
import File from '../models/File.js';

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
      // Get files that need migration
      const filesToMigrate = await getFilesForMigration(File);
      
      console.log(`Found ${filesToMigrate.length} files to migrate`);
      
      // Process each file
      for (const file of filesToMigrate) {
        try {
          const decision = shouldMigrate(file);
          
          if (decision.shouldMigrate) {
            console.log(`Migrating ${file.fileName} from ${file.currentTier} to ${decision.targetTier}`);
            await migrateFile(file._id.toString(), decision.targetTier);
            console.log(`Successfully migrated ${file.fileName}`);
          }
        } catch (error) {
          console.error(`Failed to migrate ${file.fileName}:`, error.message);
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
  
  // Run recovery job every 10 minutes
  agenda.every('10 minutes', 'recover stuck migrations');
  
  console.log('Recovery job scheduled to run every 10 minutes');
};
