/**
 * ImportDialog Component
 *
 * Provides UI for importing characters from JSON files:
 * - File picker for JSON files
 * - Drag-and-drop support
 * - JSON validation
 * - Preview character data
 * - Rename on import option
 * - Import button with loading state
 */

import { Upload, AlertTriangle, X } from 'lucide-react';
import React, { useState, useCallback, useRef, useId } from 'react';

import { FileUploadZone } from './FileUploadZone';
import { ImportCharacterPreview } from './ImportCharacterPreview';

import type { CharacterPreview } from './ImportCharacterPreview';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useTRPC, useTRPCUtils } from '@/infrastructure/api/trpc-hooks';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportSuccess?: (characterId: string) => void;
}

/**
 * Main ImportDialog component
 */
export const ImportDialog: React.FC<ImportDialogProps> = ({
  open,
  onOpenChange,
  onImportSuccess,
}) => {
  const { toast } = useToast();
  const trpc = useTRPC();
  const utils = useTRPCUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputId = useId();

  const [isDragging, setIsDragging] = useState(false);
  const [_selectedFile, setSelectedFile] = useState<File | null>(null);
  const [characterData, setCharacterData] = useState<CharacterPreview | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [importName, setImportName] = useState('');

  // Import mutation
  const importMutation = trpc.characters.import.useMutation({
    onSuccess: (data) => {
      toast({
        title: 'Character Imported',
        description: `Character "${importName || characterData?.character.name}" has been imported successfully.`,
      });
      utils.characters.list.invalidate();
      if (onImportSuccess && data?.id) {
        onImportSuccess(data.id);
      }
      handleClose();
    },
    onError: (error) => {
      toast({
        title: 'Import Failed',
        description: error.message || 'Failed to import character. Please check the file format.',
        variant: 'destructive',
      });
    },
  });

  const handleClose = (): void => {
    setSelectedFile(null);
    setCharacterData(null);
    setValidationError(null);
    setImportName('');
    onOpenChange(false);
  };

  const validateAndParseJSON = useCallback((content: string): CharacterPreview | null => {
    try {
      const parsed = JSON.parse(content);

      // Basic validation
      if (!parsed.character || !parsed.character.name) {
        setValidationError('Invalid character file: Missing required character data');
        return null;
      }

      // Check version (optional)
      if (!parsed.version) {
        toast({
          title: 'Warning',
          description: 'This character file does not specify a version. Import may be incomplete.',
        });
      }

      setValidationError(null);
      return parsed as CharacterPreview;
    } catch (_error) {
      setValidationError('Invalid JSON file format');
      return null;
    }
  }, [toast]);

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.includes('json') && !file.name.endsWith('.json')) {
        toast({
          title: 'Invalid File Type',
          description: 'Please select a JSON file.',
          variant: 'destructive',
        });
        return;
      }

      setSelectedFile(file);

      // Read file content
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const parsedData = validateAndParseJSON(content);
        if (parsedData) {
          setCharacterData(parsedData);
          setImportName(parsedData.character.name);
        }
      };
      reader.onerror = () => {
        toast({
          title: 'Error',
          description: 'Failed to read file.',
          variant: 'destructive',
        });
      };
      reader.readAsText(file);
    },
    [toast, validateAndParseJSON],
  );

  const handleDragOver = useCallback((e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        handleFileSelect(files[0]);
      }
    },
    [handleFileSelect],
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleImport = (): void => {
    if (!characterData) {
      toast({
        title: 'No Character Data',
        description: 'Please select a valid character file to import.',
        variant: 'destructive',
      });
      return;
    }

    // Prepare import data with optional name override
    const importData = {
      ...characterData,
      character: {
        ...characterData.character,
        name: importName || characterData.character.name,
      },
    };

    importMutation.mutate(importData);
  };

  const clearSelection = (): void => {
    setSelectedFile(null);
    setCharacterData(null);
  };

  const clearValidationError = (): void => {
    setSelectedFile(null);
    setValidationError(null);
    setCharacterData(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <TooltipProvider>
        <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" aria-hidden="true" />
            Import Character
          </DialogTitle>
          <DialogDescription>
            Import a character from a JSON file. You can export characters from the character sheet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* File Upload Area */}
          {!characterData && (
            <FileUploadZone
              isDragging={isDragging}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              fileInputRef={fileInputRef}
              onFileInputChange={handleFileInputChange}
            />
          )}

          {/* Validation Error */}
          {validationError && (
            <div
              role="alert"
              aria-live="polite"
              className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg"
            >
              <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1">
                <div className="font-semibold text-sm text-destructive">Validation Error</div>
                <div className="text-sm text-destructive/80 mt-1">{validationError}</div>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={clearValidationError}
                    className="h-6 w-6"
                    aria-label="Clear validation error"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Clear validation error</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Character Preview */}
          {characterData && !validationError && (
            <ImportCharacterPreview
              characterData={characterData}
              importName={importName}
              onImportNameChange={setImportName}
              onClear={clearSelection}
              nameInputId={nameInputId}
            />
          )}
        </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={!characterData || !!validationError || importMutation.isPending}
            >
              {importMutation.isPending ? 'Importing...' : 'Import Character'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </TooltipProvider>
    </Dialog>
  );
};

export default ImportDialog;
