#!/usr/bin/env node

/**
 * Script to download a specific backup file from S3
 * Usage: node download-backup.js <filename>
 * Example: node download-backup.js sitetechnology-2025-01-15-production-abc123.tar.gz
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const API_BASE = 'http://localhost:3001'; // Your API server
const DOWNLOAD_DIR = './backup-downloads'; // Where to save downloads

// Create download directory if it doesn't exist
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  console.log(`📁 Created download directory: ${DOWNLOAD_DIR}`);
}

// Helper function to download a file
function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const filepath = path.join(DOWNLOAD_DIR, filename);
    
    console.log(`📥 Downloading: ${filename}`);
    console.log(`📁 Saving to: ${filepath}`);
    
    const file = fs.createWriteStream(filepath);
    let downloadedBytes = 0;
    let totalBytes = 0;
    
    const req = client.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed with status: ${res.statusCode}`));
        return;
      }
      
      totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      
      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const percentage = ((downloadedBytes / totalBytes) * 100).toFixed(1);
          process.stdout.write(`\r📈 Progress: ${percentage}% (${(downloadedBytes / 1024 / 1024).toFixed(2)} MB)`);
        }
      });
      
      res.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log(`\n✅ Download completed: ${filepath}`);
        console.log(`📊 File size: ${(downloadedBytes / 1024 / 1024).toFixed(2)} MB`);
        resolve(filepath);
      });
    });
    
    req.on('error', (error) => {
      fs.unlink(filepath, () => {}); // Delete the file if download fails
      reject(error);
    });
    
    file.on('error', (error) => {
      fs.unlink(filepath, () => {}); // Delete the file if write fails
      reject(error);
    });
  });
}

// Main function to download a backup
async function downloadBackup(filename) {
  try {
    if (!filename) {
      console.error('❌ Please provide a filename to download');
      console.log('Usage: node download-backup.js <filename>');
      console.log('Example: node download-backup.js sitetechnology-2025-01-15-production-abc123.tar.gz');
      return;
    }
    
    const downloadUrl = `${API_BASE}/api/backups/download/${encodeURIComponent(filename)}`;
    
    console.log(`🔗 Download URL: ${downloadUrl}`);
    
    await downloadFile(downloadUrl, filename);
    
    console.log('\n🎉 Download successful!');
    console.log(`📁 File saved in: ${DOWNLOAD_DIR}`);
    
  } catch (error) {
    console.error('❌ Download failed:', error.message);
  }
}

// Run the script
if (require.main === module) {
  const filename = process.argv[2];
  downloadBackup(filename);
}

module.exports = { downloadBackup }; 