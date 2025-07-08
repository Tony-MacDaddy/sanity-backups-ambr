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
      
      const backup = await createBackup({
        websiteId: website._id,
        status: "pending",
      });

      toast.success('Backup started');

      const response = await fetch(`/api/backup/${projectId}/${dataset}/${apiVersion}/${token}/${title}`);
      const data = await response.json();

      if (data.status === "OK" && data.backupId) {
        // Start a single status check after a delay
        setTimeout(() => checkBackupStatus(data.backupId, backup), 10000);
      } else {
        throw new Error('Failed to start backup');
      }

    } catch (error) {
      console.error('Backup failed:', error);
      toast.error('Backup failed');
      setIsLoading(false);
    }
  }

  async function checkBackupStatus(backupId: string, convexBackupId: Id<"backups">) {
    try {
      const statusResponse = await fetch(`/api/backup/status/${backupId}`);
      const statusData = await statusResponse.json();

      if (statusData.status === 'completed') {
        await updateBackup({
          id: convexBackupId,
          websiteId: website._id,
          s3Location: statusData.s3Location || '',
          status: "success",
        });
      } else if (statusData.status === 'failed') {
        await updateBackup({
          id: convexBackupId,
          websiteId: website._id,
          s3Location: '',
          status: "error",
        });
      } else if (statusData.status === 'exporting' || statusData.status === 'uploading') {
        // Check again in 30 seconds for long-running backups
        setTimeout(() => checkBackupStatus(backupId, convexBackupId), 30000);
      }
    } catch (error) {
      console.error('Error checking backup status:', error);
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