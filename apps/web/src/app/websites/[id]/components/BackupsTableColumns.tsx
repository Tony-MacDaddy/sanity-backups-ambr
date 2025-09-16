"use client"

import { Loader2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ColumnDef, Row, Table } from "@tanstack/react-table";
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import DownloadBackupButton from "@/app/websites/[id]/components/DownloadBackupButton";

export type Backup = {
  _id: string;
  status: "pending" | "success" | "error";
  s3Location: string;
  errorMessage?: string;
  createdAt: number;
};

export const columns: ColumnDef<Backup>[] = [
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ getValue, row }) => {
      const value = getValue() as string;
      const errorMessage = row.original.errorMessage;
      
      if (value === "pending") {
        return (
          <PendingIndicator />
        );
      } else if (value === "success") {
        return (
          <SuccessIndicator />
        );
      } else if (value === "error") {
        return (
          <FailedIndicator errorMessage={errorMessage} />
        );
      }

      return value.charAt(0).toUpperCase() + value.slice(1);
    },
  },
  {
    accessorKey: "createdAt",
    header: "Date",
    cell: ({ getValue }) => {
      const value = getValue() as number;
      const date = new Date(value);
      const month = date.toLocaleString('default', { month: 'long' });
      const day = date.getDate();
      const year = date.getFullYear();
      const time = date.toLocaleTimeString();
      return `${month} ${day}, ${year} at ${time}`;
    },
  },
  {
    accessorKey: "s3Location",
    header: "Download",
    cell: ({ row, getValue }) => {
      const value = getValue() as string;
      const status = row.getValue("status") as string;
      return (
        <DownloadBackupButton 
          disabled={status === "error"} 
          objectKey={value}
        />
      )
    },
  },
];

export const selectionColumn = {
  id: 'select',
  header: ({ table }: { table: Table<Backup> }) => (
    <Checkbox
      checked={table.getIsAllPageRowsSelected()}
      onCheckedChange={value => table.toggleAllPageRowsSelected(!!value)}
      aria-label="Select all"
      className="translate-y-[2px] bg-white"
    />
  ),
  cell: ({ row }: { row: Row<Backup> }) => (
    <Checkbox
      checked={row.getIsSelected()}
      onCheckedChange={value => row.toggleSelected(!!value)}
      aria-label="Select row"
      className="translate-y-[2px]"
    />
  ),
  enableSorting: false,
  enableHiding: false,
};

function PendingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>Pending</span>
    </div>
  )
};

function SuccessIndicator() {
  return (
    <div className="flex items-center gap-2">
      <Badge variant="success">Success</Badge>
    </div>
  )
};

function FailedIndicator({ errorMessage }: { errorMessage?: string }) {
  if (!errorMessage) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="failure">Failed</Badge>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 cursor-help">
            <Badge variant="failure">Failed</Badge>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-md">
          <div className="text-sm">
            <p className="font-semibold mb-1">Backup Error:</p>
            <p className="text-xs break-words">{errorMessage}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export const allColumns: ColumnDef<Backup>[] = [selectionColumn, ...columns]; 