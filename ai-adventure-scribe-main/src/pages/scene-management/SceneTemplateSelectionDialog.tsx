import { Map, Plus, Settings } from 'lucide-react';
import React from 'react';

import type { SceneTemplate } from '@/components/scenes/scene-templates';

import { SceneTemplateLibrary } from '@/components/scenes/SceneTemplateLibrary';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface SceneTemplateSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedTemplateId: string | undefined;
  onSelectTemplate: (template: SceneTemplate) => void;
  onStartBlank: () => void;
}

export const SceneTemplateSelectionDialog: React.FC<SceneTemplateSelectionDialogProps> = ({
  open,
  onOpenChange,
  selectedTemplateId,
  onSelectTemplate,
  onStartBlank,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Choose How to Create Your Scene</DialogTitle>
        <DialogDescription>
          Start with a template or create a custom scene from scratch
        </DialogDescription>
      </DialogHeader>

      <Tabs defaultValue="templates" className="mt-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="templates">
            <Map className="mr-2 h-4 w-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="blank">
            <Settings className="mr-2 h-4 w-4" />
            Blank Scene
          </TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-6">
          <SceneTemplateLibrary
            onSelectTemplate={onSelectTemplate}
            selectedTemplateId={selectedTemplateId}
          />
        </TabsContent>

        <TabsContent value="blank" className="mt-6">
          <Card className="p-12 text-center">
            <div className="text-6xl mb-4">🎨</div>
            <CardTitle className="mb-2">Start from Scratch</CardTitle>
            <CardDescription className="mb-6">
              Create a fully customized scene with your own dimensions, grid settings, and
              background image.
            </CardDescription>
            <Button variant="cosmic" onClick={onStartBlank}>
              <Plus className="mr-2 h-4 w-4" />
              Create Blank Scene
            </Button>
          </Card>
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
);
