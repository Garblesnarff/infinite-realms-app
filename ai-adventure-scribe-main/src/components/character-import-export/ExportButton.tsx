import { Download, Loader2 } from 'lucide-react';
import React, { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useTRPC } from '@/infrastructure/api/trpc-hooks';
import logger from '@/lib/logger';

interface ExportButtonProps {
  characterId: string;
  characterName?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  showLabel?: boolean;
  className?: string;
}

const generateFilename = (characterName: string): string => {
  const sanitizedName = characterName.replace(/[^a-z0-9]/gi, '_');
  const date = new Date().toISOString().split('T')[0];
  return `${sanitizedName}_${date}.json`;
};

const downloadJSON = (data: unknown, filename: string): void => {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const ExportButton: React.FC<ExportButtonProps> = ({
  characterId,
  characterName = 'Character',
  variant = 'outline',
  size = 'default',
  showLabel = true,
  className,
}) => {
  const { toast } = useToast();
  const trpc = useTRPC();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (format: 'json' | 'pdf' = 'json'): Promise<void> => {
    if (format === 'pdf') {
      toast({ title: 'Coming Soon', description: 'PDF export will be available in a future update.' });
      return;
    }
    setIsExporting(true);
    try {
      const characterData = await trpc.characters.export.query({ characterId });
      if (!characterData) throw new Error('No character data received');
      const filename = generateFilename(characterName);
      downloadJSON(characterData, filename);
      toast({
        title: 'Export Successful',
        description: `Character "${characterName}" has been exported to ${filename}`,
      });
    } catch (error) {
      logger.error('Export error', { error });
      toast({
        title: 'Export Failed',
        description: error instanceof Error ? error.message : 'Failed to export character.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const isIconOnly = size === 'icon' || !showLabel;
  const buttonAriaLabel = isIconOnly ? `Export options for ${characterName}` : undefined;
  const tooltipText = isExporting ? `Exporting ${characterName}...` : `Export options for ${characterName}`;

  return (
    <TooltipProvider>
      <DropdownMenu>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant={variant}
                size={size}
                disabled={isExporting}
                className={className}
                aria-label={buttonAriaLabel}
              >
                {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {!isIconOnly && <span className="ml-2">{isExporting ? 'Exporting...' : 'Export'}</span>}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>{tooltipText}</p>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleExport('json')}>
            <Download className="mr-2 h-4 w-4" />
            <div>
              <div className="font-medium">Export as JSON</div>
              <div className="text-xs text-muted-foreground">For backup or transfer</div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleExport('pdf')} disabled>
            <Download className="mr-2 h-4 w-4" />
            <div>
              <div className="font-medium">Export as PDF</div>
              <div className="text-xs text-muted-foreground">Coming soon</div>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
};

export const SimpleExportButton: React.FC<Omit<ExportButtonProps, 'showLabel'>> = ({
  characterId,
  characterName = 'Character',
  variant = 'outline',
  size = 'default',
  className,
}) => {
  const { toast } = useToast();
  const trpc = useTRPC();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (): Promise<void> => {
    setIsExporting(true);
    try {
      const characterData = await trpc.characters.export.query({ characterId });
      if (!characterData) throw new Error('No character data received');
      const filename = generateFilename(characterName);
      downloadJSON(characterData, filename);
      toast({ title: 'Export Successful', description: `Character exported as ${filename}` });
    } catch (error) {
      logger.error('Export error', { error });
      toast({
        title: 'Export Failed',
        description: error instanceof Error ? error.message : 'Failed to export character.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const isIconOnly = size === 'icon';
  const buttonAriaLabel = isIconOnly ? `Export ${characterName} data as JSON` : undefined;
  const tooltipText = isExporting ? `Exporting ${characterName}...` : `Export ${characterName} data as JSON`;

  return (
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <span className={isExporting ? 'cursor-not-allowed inline-block' : 'inline-block'}>
            <Button
              type="button"
              variant={variant}
              size={size}
              onClick={handleExport}
              disabled={isExporting}
              className={className}
              aria-label={buttonAriaLabel}
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {!isIconOnly && <span className="ml-2">Exporting...</span>}
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  {!isIconOnly && <span className="ml-2">Export</span>}
                </>
              )}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default ExportButton;
