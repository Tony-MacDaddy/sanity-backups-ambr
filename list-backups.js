#!/usr/bin/env node

/**
 * Script to list and download backup files from S3
 * Usage: node list-backups.js
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

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    
    const req = client.request(url, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ status: res.statusCode, data: jsonData });
        } catch (error) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.end();
  });
}

// Helper function to download a file
function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const filepath = path.join(DOWNLOAD_DIR, filename);
    
    const file = fs.createWriteStream(filepath);
    
    const req = client.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed with status: ${res.statusCode}`));
        return;
      }
      
      res.pipe(file);
      
      file.on('finish', () => {
        file.close();
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

// Main function to list backups
async function listBackups() {
  try {
    console.log('🔍 Fetching backup files from S3...');
    
    const response = await makeRequest(`${API_BASE}/api/backups/list`);
    
    if (response.status !== 200) {
      console.error('❌ Failed to fetch backup list:', response.data);
      return;
    }
    
    const { backups, totalCount, bucket, region } = response.data;
    
    console.log(`\n📊 Found ${totalCount} backup files in bucket: ${bucket} (${region})`);
    console.log('=' .repeat(80));
    
    if (backups.length === 0) {
      console.log('No backup files found.');
      return;
    }
    
    // Group backups by month/year
    const groupedBackups = {};
    backups.forEach(backup => {
      if (backup.date) {
        const dateParts = backup.date.split('-');
        if (dateParts.length >= 2) {
          const year = dateParts[0];
          const month = dateParts[1];
          const monthYear = `${year}-${month}`;
          
          if (!groupedBackups[monthYear]) {
            groupedBackups[monthYear] = [];
          }
          groupedBackups[monthYear].push(backup);
        }
      }
    });
    
    // Display grouped backups
    Object.keys(groupedBackups).sort().reverse().forEach(monthYear => {
      const [year, month] = monthYear.split('-');
      const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
      
      console.log(`\n📅 ${monthName} ${year} (${groupedBackups[monthYear].length} backups)`);
      console.log('-'.repeat(50));
      
      groupedBackups[monthYear].forEach((backup, index) => {
        const date = backup.lastModified ? new Date(backup.lastModified).toLocaleDateString() : 'Unknown';
        console.log(`${index + 1}. ${backup.projectName} (${backup.dataset})`);
        console.log(`   📁 ${backup.key}`);
        console.log(`   📊 ${backup.sizeMB} MB | 📅 ${date}`);
        console.log(`   🔗 Download: ${API_BASE}/api/backups/download/${encodeURIComponent(backup.key)}`);
        console.log('');
      });
    });
    
    // Interactive download option
    console.log('\n💡 To download a specific backup, use the download URL above');
    console.log('💡 Or run: node download-backup.js <filename>');
    
  } catch (error) {
    console.error('❌ Error listing backups:', error.message);
  }
}

// Run the script
if (require.main === module) {
  listBackups();
}

module.exports = { listBackups, downloadFile }; 