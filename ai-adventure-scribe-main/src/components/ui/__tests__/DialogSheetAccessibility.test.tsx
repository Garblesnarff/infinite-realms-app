import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import React from 'react';
import { Dialog, DialogContent, DialogTrigger } from '../dialog';
import { Sheet, SheetContent, SheetTrigger } from '../sheet';

test('Dialog has Close button with title', () => {
  render(
    <Dialog open={true}>
      <DialogContent>
        <div>Content</div>
      </DialogContent>
    </Dialog>,
  );

  const closeButton = screen.getByRole('button', { name: /close/i });
  expect(closeButton.getAttribute('title')).toBe('Close');
});

test('Sheet has Close button with title', () => {
  render(
    <Sheet open={true}>
      <SheetContent>
        <div>Content</div>
      </SheetContent>
    </Sheet>,
  );

  const closeButton = screen.getByRole('button', { name: /close/i });
  expect(closeButton.getAttribute('title')).toBe('Close');
});
