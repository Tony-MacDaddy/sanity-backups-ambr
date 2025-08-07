'use client'

import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import React, { useState } from 'react';
import { useMutation } from 'convex/react';
import { Button } from '../../../../components/ui/button';
import { api } from '../../../../../convex/_generated/api';
import { Doc, Id } from '../../../../../convex/_generated/dataModel';

export default function CreateBackupButton({ website, classNames }: { website: Doc<"websites">, classNames?: string }) {

  const { title, sanityConfig } = website;
  const { projectId, dataset, apiVersion, token } = sanityConfig;

  const createBackup = useMutation(api.backups.createBackup);
  const updateBackup = useMutation(api.backups.updateBackup);

  const [isLoading, setIsLoading] = useState(false);

  async function handleCreateBackup() {
    setIsLoading(true);

    try {
      console.log(`🚀 Starting backup process for website: ${title}`);
      console.log(`📋 Website details:`, {
        projectId,
        dataset,
        apiVersion,
        token: token ? `${token.substring(0, 8)}...` : 'Missing',
        title
      });
      
      const backup = await createBackup({
        websiteId: website._id,
        status: "pending",
      });

      console.log(`✅ Convex backup record created:`, backup);
      toast.success('Backup started');

      console.log(`🌐 Calling backup API: /api/backup/${projectId}/${dataset}/${apiVersion}/${token ? '***' : 'MISSING'}/${title}`);
      const response = await fetch(`/api/backup/${projectId}/${dataset}/${apiVersion}/${token}/${title}`);
      
      console.log(`📡 API Response status:`, response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ API request failed:`, {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log(`📦 API Response data:`, data);

      if (data.status === "OK" && data.backupId) {
        console.log(`✅ Backup started successfully with ID: ${data.backupId}`);
        // Start a single status check after a delay
        setTimeout(() => checkBackupStatus(data.backupId, backup), 10000);
      } else {
        console.error(`❌ Failed to start backup:`, data);
        throw new Error(`Failed to start backup: ${data.message || 'Unknown error'}`);
      }

    } catch (error) {
      console.error('❌ Backup failed:', error);
      console.error('🔍 Error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : 'No stack trace',
        website: title,
        projectId,
        dataset
      });
      
      toast.error(`Backup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsLoading(false);
    }
  }

  async function checkBackupStatus(backupId: string, convexBackupId: Id<"backups">) {
    try {
      console.log(`🔍 Checking backup status for ID: ${backupId}`);
      const statusResponse = await fetch(`/api/backup/status/${backupId}`);
      
      if (!statusResponse.ok) {
        const errorText = await statusResponse.text();
        console.error(`❌ Status check failed:`, {
          status: statusResponse.status,
          statusText: statusResponse.statusText,
          error: errorText
        });
        throw new Error(`Status check failed: ${statusResponse.status} ${statusResponse.statusText}`);
      }
      
      const statusData = await statusResponse.json();
      console.log(`📊 Backup status:`, statusData);

      if (statusData.status === 'completed') {
        console.log(`✅ Backup completed successfully`);
        await updateBackup({
          id: convexBackupId,
          websiteId: website._id,
          s3Location: statusData.s3Location || '',
          status: "success",
        });
        toast.success('Backup completed successfully');
        setIsLoading(false);
      } else if (statusData.status === 'failed') {
        console.error(`❌ Backup failed:`, statusData);
        await updateBackup({
          id: convexBackupId,
          websiteId: website._id,
          s3Location: '',
          status: "error",
          errorMessage: statusData.error || 'Unknown error',
        });
        toast.error(`Backup failed: ${statusData.error || 'Unknown error'}`);
        setIsLoading(false);
      } else if (statusData.status === 'exporting' || statusData.status === 'uploading') {
        console.log(`⏳ Backup in progress: ${statusData.message} (${statusData.progress || 0}%)`);
        // Check again in 30 seconds for long-running backups
        setTimeout(() => checkBackupStatus(backupId, convexBackupId), 30000);
      } else {
        console.log(`⏳ Backup status: ${statusData.status} - ${statusData.message}`);
        // Check again in 30 seconds for other statuses
        setTimeout(() => checkBackupStatus(backupId, convexBackupId), 30000);
      }
    } catch (error) {
      console.error('❌ Error checking backup status:', error);
      console.error('🔍 Status check error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        backupId,
        convexBackupId,
        website: title
      });
      // Retry once after 30 seconds
      setTimeout(() => checkBackupStatus(backupId, convexBackupId), 30000);
    }
  }

  return (
    <Button 
      onClick={handleCreateBackup} 
      disabled={isLoading}
      className={cn("rounded-none h-full px-4 border-y-0 border-l-0 group", classNames)}
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Creating Backup...
        </>
      ) : (
        <>
          Create Backup
        </>
      )}
    </Button>
  )
}