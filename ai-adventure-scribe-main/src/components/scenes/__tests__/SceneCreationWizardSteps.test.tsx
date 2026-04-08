import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { StepDimensions } from '../scene-creation-wizard/StepDimensions';
import { StepGridSettings } from '../scene-creation-wizard/StepGridSettings';

import { GridType } from '@/types/scene';

describe('SceneCreationWizard Steps Accessibility', () => {
  describe('StepGridSettings', () => {
    it('renders with accessible labels and IDs', () => {
      const onUpdate = vi.fn();
      render(
        <StepGridSettings
          gridType={GridType.SQUARE}
          gridSize={5}
          gridColor="#000000"
          onUpdate={onUpdate}
        />
      );

      // Check Grid Type RadioGroup
      const radioGroup = screen.getByRole('radiogroup', { name: /Grid Type \*/i });
      expect(radioGroup).toBeInTheDocument();

      // Check specific radio options by their accessible labels
      expect(screen.getByLabelText(/Square Grid/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Hex \(Horizontal\)/i)).toBeInTheDocument();

      // Check Grid Size input
      const gridSizeInput = screen.getByLabelText(/Grid Size \(feet per square\) \*/i);
      expect(gridSizeInput).toBeInTheDocument();
      expect(gridSizeInput).toHaveAttribute('id');

      // Check Color inputs
      expect(screen.getByLabelText(/Grid color picker/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Grid color hex code/i)).toBeInTheDocument();
    });
  });

  describe('StepDimensions', () => {
    it('renders with accessible labels and IDs', () => {
      const onUpdate = vi.fn();
      render(
        <StepDimensions
          width={20}
          height={20}
          gridSize={5}
          onUpdate={onUpdate}
        />
      );

      // Check width and height inputs
      const widthInput = screen.getByLabelText(/Width \(squares\) \*/i);
      const heightInput = screen.getByLabelText(/Height \(squares\) \*/i);
      expect(widthInput).toBeInTheDocument();
      expect(heightInput).toBeInTheDocument();
      expect(widthInput).toHaveAttribute('id');
      expect(heightInput).toHaveAttribute('id');

      // Check preview status region
      const previewRegion = screen.getByRole('status');
      expect(previewRegion).toBeInTheDocument();
      expect(previewRegion).toHaveAttribute('aria-live', 'polite');
      expect(previewRegion).toHaveTextContent(/20 × 20/);

      // Check quick presets group
      const presetGroup = screen.getByRole('group', { name: /Quick dimension presets/i });
      expect(presetGroup).toBeInTheDocument();

      const smallPreset = screen.getByRole('button', { name: /Set dimensions to Small \(15×15\)/i });
      expect(smallPreset).toBeInTheDocument();
    });
  });
});
