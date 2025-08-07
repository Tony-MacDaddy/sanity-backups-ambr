import fs from 'fs';
import { Readable } from 'stream';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { createFilename } from './utils/lib';
import { createClient } from '@sanity/client';
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const exportDataset = require('@sanity/export');

dotenv.config();

const app = express();
const PORT = 3001;

app.use(cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const backupStatus = new Map<string, {
  status: 'pending' | 'exporting' | 'uploading' | 'completed' | 'failed';
  message: string;
  progress?: number;
  error?: string;
  s3Location?: string;
  etag?: string;
  startTime: number;
}>();

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ca-central-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

app.get('/api/backup/:projectId/:dataset/:apiVersion/:token/:projectName', async (req, res) => {
  
  const { projectId, dataset, apiVersion, token, projectName } = req.params;
  const backupId = `${projectId}-${dataset}-${Date.now()}`;
  
  console.log(`🚀 Starting backup process for ${projectName} (${projectId}/${dataset})`);
  console.log(`📋 Backup ID: ${backupId}`);
  console.log(`🔧 Environment check:`, {
    AWS_REGION: process.env.AWS_REGION || 'ca-central-1',
    S3_BUCKET_NAME: process.env.S3_BUCKET_NAME ? 'Set' : 'Missing',
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ? 'Set' : 'Missing',
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ? 'Set' : 'Missing',
  });
  
  backupStatus.set(backupId, {
    status: 'pending',
    message: 'Starting backup process...',
    startTime: Date.now(),
  });
  
  performBackup(backupId, projectId, dataset, apiVersion, token, projectName).catch(error => {
    console.error('❌ Background backup failed:', error);
    console.error('🔍 Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      backupId,
      projectId,
      dataset,
      projectName
    });
    backupStatus.set(backupId, {
      status: 'failed',
      message: 'Backup failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      startTime: Date.now(),
    });
  });
  
  res.json({
    status: 'OK',
    message: 'Backup started',
    backupId: backupId,
  });
});

async function performBackup(backupId: string, projectId: string, dataset: string, apiVersion: string, token: string, projectName: string) {
  try {
    console.log(`🔄 Starting backup for project: ${projectId}, dataset: ${dataset}`);

    // Validate environment variables
    if (!process.env.S3_BUCKET_NAME) {
      throw new Error('S3_BUCKET_NAME environment variable is not set');
    }
    if (!process.env.AWS_ACCESS_KEY_ID) {
      throw new Error('AWS_ACCESS_KEY_ID environment variable is not set');
    }
    if (!process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('AWS_SECRET_ACCESS_KEY environment variable is not set');
    }

    console.log(`🔐 Creating Sanity client for project: ${projectId}`);
    const client = createClient({
      projectId: projectId,
      dataset: dataset,
      apiVersion: apiVersion,
      token: token,
      useCdn: false,
    });

    // Test Sanity connection
    try {
      console.log(`🔍 Testing Sanity connection...`);
      await client.fetch('*[_type == "sanity.imageAsset"][0]');
      console.log(`✅ Sanity connection successful`);
    } catch (sanityError) {
      console.error(`❌ Sanity connection failed:`, sanityError);
      throw new Error(`Failed to connect to Sanity: ${sanityError instanceof Error ? sanityError.message : 'Unknown error'}`);
    }

    const filename = createFilename(projectId, dataset, projectName);
    console.log(`📁 Backup filename: ${filename}`);
    
    backupStatus.set(backupId, {
      status: 'exporting',
      message: 'Exporting data',
      startTime: Date.now(),
    });
    
    console.log(`📤 Beginning export of ${filename}`);

    const newExport = exportDataset({
      client: client,
      dataset: dataset,
      outputPath: filename,
      assets: true,
      raw: false,
      drafts: true,
      assetConcurrency: 12,
    });

    console.log(`⏳ Waiting for export to complete...`);
    const exportRes = await newExport;
    console.log(`✅ Export completed successfully`);
    
    backupStatus.set(backupId, {
      status: 'uploading',
      message: 'Uploading to S3...',
      startTime: Date.now(),
    });
    
    console.log('📤 Export finished, uploading to S3...');
    
    // Check if file exists and get its size
    if (!fs.existsSync(filename)) {
      throw new Error(`Export file not found: ${filename}`);
    }
    
    const stats = fs.statSync(filename);
    console.log(`📊 File size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
    
    // Use streaming upload instead of loading entire file into memory
    const fileStream = fs.createReadStream(filename);
    
    console.log(`☁️ Starting S3 upload to bucket: ${process.env.S3_BUCKET_NAME}`);
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: `${filename}`,
        Body: fileStream,
        ContentType: 'application/gzip',
        Metadata: {
          projectId: projectId,
          dataset: dataset,
          exportDate: new Date().toISOString(),
        },
      },
      queueSize: 4, // Number of parts to upload concurrently
      partSize: 1024 * 1024 * 5, // 5MB per part
    });

    // Add progress tracking
    upload.on('httpUploadProgress', (progress) => {
      if (progress.loaded && progress.total) {
        const percentage = Math.round((progress.loaded / progress.total) * 100);
        console.log(`📈 Upload progress: ${percentage}% (${(progress.loaded / (1024 * 1024)).toFixed(2)}MB / ${(progress.total / (1024 * 1024)).toFixed(2)}MB)`);
        backupStatus.set(backupId, {
          ...backupStatus.get(backupId)!,
          status: 'uploading',
          message: `Uploading to S3... ${percentage}%`,
          progress: percentage,
        });
      }
    });

    const s3Result = await upload.done();
    
    console.log('✅ Backup uploaded to S3 successfully', {
      ETag: s3Result.ETag,
      Location: s3Result.Location,
      Bucket: s3Result.Bucket,
      Key: s3Result.Key
    });

    console.log(`🧹 Cleaning up local file: ${filename}`);
    fs.unlinkSync(filename);
    console.log(`✅ Local file cleanup successful`);

    backupStatus.set(backupId, {
      status: 'completed',
      message: 'Backup completed successfully',
      s3Location: filename,
      etag: s3Result.ETag,
      startTime: Date.now(),
    });
    
    console.log(`🎉 Backup process completed successfully for ${projectName}`);
    
  } catch (error) {
    console.error('❌ Backup process failed:', error);
    console.error('🔍 Detailed error information:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : 'No stack trace',
      backupId,
      projectId,
      dataset,
      projectName,
      timestamp: new Date().toISOString()
    });
    
    const filename = createFilename(projectId, dataset, projectName);

    // Clean up the export file if it exists
    if (fs.existsSync(filename)) {
      try {
        const stats = fs.statSync(filename);
        console.log(`🧹 Cleaning up failed export file: ${filename} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
        fs.unlinkSync(filename);
        console.log('✅ File cleanup successful');
      } catch (cleanupError) {
        console.error('❌ Failed to cleanup file:', cleanupError);
      }
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('📋 Backup error summary:', {
      error: errorMessage,
      backupId,
      projectId,
      dataset,
      projectName
    });
    
    backupStatus.set(backupId, {
      status: 'failed',
      message: 'Backup failed',
      error: errorMessage,
      startTime: Date.now(),
    });
    
    throw error;
  }
}

app.get('/api/backup/status/:backupId', (req, res) => {

  const { backupId } = req.params;
  const status = backupStatus.get(backupId);
  
  if (!status) {
    return res.status(404).json({
      status: 'ERROR',
      message: 'Backup not found',
    });
  }
  
  res.json({
    status: status.status,
    message: status.message,
    progress: status.progress,
    error: status.error,
    s3Location: status.s3Location,
    etag: status.etag,
    startTime: status.startTime,
    duration: Date.now() - status.startTime,
  });
});

app.get('/api/backups/list', async (req, res) => {
  try {
    console.log('📋 Listing all backup files from S3 bucket');
    
    if (!process.env.S3_BUCKET_NAME) {
      return res.status(500).json({
        error: 'S3_BUCKET_NAME environment variable is not set'
      });
    }

    const command = new ListObjectsV2Command({
      Bucket: process.env.S3_BUCKET_NAME,
      MaxKeys: 1000, // Adjust as needed
    });

    const response = await s3Client.send(command);
    
    if (!response.Contents) {
      return res.json({
        backups: [],
        totalCount: 0,
        message: 'No backup files found in bucket'
      });
    }

    // Filter for backup files and extract useful information
    const backupFiles = response.Contents
      .filter(obj => obj.Key && obj.Key.endsWith('.tar.gz'))
      .map(obj => {
        const key = obj.Key!;
        const parts = key.split('-');
        
        // Parse filename: projectName-date-dataset-projectId.tar.gz
        let projectName = '';
        let date = '';
        let dataset = '';
        let projectId = '';
        
        if (parts.length >= 4) {
          // Handle project names that might contain hyphens
          const lastThreeParts = parts.slice(-3);
          projectName = parts.slice(0, -3).join('-');
          date = lastThreeParts[0];
          dataset = lastThreeParts[1];
          projectId = lastThreeParts[2].replace('.tar.gz', '');
        }
        
        return {
          key: key,
          projectName: projectName,
          date: date,
          dataset: dataset,
          projectId: projectId,
          size: obj.Size || 0,
          lastModified: obj.LastModified,
          sizeMB: obj.Size ? (obj.Size / (1024 * 1024)).toFixed(2) : '0'
        };
      })
      .sort((a, b) => {
        // Sort by date (newest first)
        if (a.date && b.date) {
          return b.date.localeCompare(a.date);
        }
        return 0;
      });

    console.log(`✅ Found ${backupFiles.length} backup files`);

    res.json({
      backups: backupFiles,
      totalCount: backupFiles.length,
      bucket: process.env.S3_BUCKET_NAME,
      region: process.env.AWS_REGION || 'ca-central-1'
    });

  } catch (error) {
    console.error('❌ Error listing backup files:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      details: error instanceof Error ? error.stack : undefined
    });
  }
});

app.get('/api/backups/download/:key(*)', async (req, res) => {
  try {
    const { key } = req.params;
    
    console.log(`📥 Downloading backup file: ${key}`);
    
    if (!process.env.S3_BUCKET_NAME) {
      return res.status(500).json({
        error: 'S3_BUCKET_NAME environment variable is not set'
      });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      throw new Error('No response body received from S3');
    }

    // Set appropriate headers for file download
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`);
    
    if (response.ContentLength) {
      res.setHeader('Content-Length', response.ContentLength.toString());
    }

    // Stream the file directly to the response
    const stream = response.Body as Readable;
    stream.pipe(res);

  } catch (error) {
    console.error('❌ Error downloading backup file:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      details: error instanceof Error ? error.stack : undefined
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

app.get('/', (req, res) => {
  res.send('Sanity Backup Service - Need a route!');
});