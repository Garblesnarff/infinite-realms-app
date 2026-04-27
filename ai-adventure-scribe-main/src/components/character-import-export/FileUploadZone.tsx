import { FileJson, Upload } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FileUploadZoneProps {
  isDragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onClick: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const FileUploadZone: React.FC<FileUploadZoneProps> = ({
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
  fileInputRef,
  onFileInputChange,
}) => {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload character file"
      title="Upload character file"
      className={cn(
        'border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple',
        isDragging
          ? 'border-infinite-purple bg-infinite-purple/10'
          : 'border-border hover:border-infinite-purple/50 hover:bg-accent/50',
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={onFileInputChange}
        className="hidden"
      />

      <FileJson className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
      <h3 className="font-semibold text-lg mb-2">Drop your character file here</h3>
      <p className="text-sm text-muted-foreground mb-4">or click to browse for a JSON file</p>
      <Button variant="outline" type="button" tabIndex={-1}>
        <Upload className="mr-2 h-4 w-4" />
        Choose File
      </Button>
    </div>
  );
};
