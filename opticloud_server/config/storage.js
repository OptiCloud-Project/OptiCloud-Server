import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base storage directory
const STORAGE_BASE = path.join(__dirname, '..', 'storage');

// Tier directories
export const STORAGE_DIRS = {
  HOT: path.join(STORAGE_BASE, 'HOT'),
  WARM: path.join(STORAGE_BASE, 'WARM'),
  COLD: path.join(STORAGE_BASE, 'COLD')
};

/**
 * Initialize storage directories
 */
export const initStorage = () => {
  // Create base storage directory if it doesn't exist
  if (!fs.existsSync(STORAGE_BASE)) {
    fs.mkdirSync(STORAGE_BASE, { recursive: true });
  }

  // Create tier directories
  Object.values(STORAGE_DIRS).forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created storage directory: ${dir}`);
    }
  });
  
  console.log('Storage directories initialized');
};

/**
 * Get storage path for a tier
 */
export const getStoragePath = (tier) => {
  return STORAGE_DIRS[tier] || STORAGE_DIRS.HOT;
};

/**
 * Get full file path
 */
export const getFilePath = (tier, fileName) => {
  return path.join(getStoragePath(tier), fileName);
};
