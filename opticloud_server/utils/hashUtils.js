import crypto from 'crypto';
import { Readable } from 'stream';

/**
 * Calculate MD5 hash of a stream
 * @param {ReadableStream} stream - The stream to hash
 * @returns {Promise<string>} - The MD5 hash in hex format
 */
export const calculateStreamHash = (stream) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    
    stream.on('end', () => {
      const hashHex = hash.digest('hex');
      resolve(hashHex);
    });
    
    stream.on('error', (error) => {
      reject(error);
    });
  });
};

/**
 * Calculate MD5 hash of a buffer
 * @param {Buffer} buffer - The buffer to hash
 * @returns {string} - The MD5 hash in hex format
 */
export const calculateBufferHash = (buffer) => {
  return crypto.createHash('md5').update(buffer).digest('hex');
};

/**
 * Create a transform stream that calculates hash while passing data through
 * @returns {Object} - Object with stream and getHash function
 */
export const createHashTransform = () => {
  const hash = crypto.createHash('md5');
  const transform = new (class extends Readable {
    _read() {}
    
    _transform(chunk, encoding, callback) {
      hash.update(chunk);
      this.push(chunk);
      callback();
    }
    
    _flush(callback) {
      callback();
    }
    
    getHash() {
      return hash.digest('hex');
    }
  })();
  
  return {
    stream: transform,
    getHash: () => hash.digest('hex')
  };
};
