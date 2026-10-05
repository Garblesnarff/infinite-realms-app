import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../sheet';

const SRC_ROOT = path.resolve(__dirname, '../../..');
const PRIMITIVE_FILES = new Set([
  path.join(SRC_ROOT, 'components/ui/dialog.tsx'),
  path.join(SRC_ROOT, 'components/ui/sheet.tsx'),
]);

function collectProductionDialogFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const fullPath = path.join(directory, name);
    if (statSync(fullPath).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') return [];
      return collectProductionDialogFiles(fullPath);
    }
    if (!fullPath.endsWith('.tsx') || PRIMITIVE_FILES.has(fullPath)) return [];
    const content = readFileSync(fullPath, 'utf8');
    return /<DialogContent|<SheetContent/.test(content) ? [fullPath] : [];
  });
}

const RADIX_WARNING_PATTERN = /DialogTitle|DialogDescription|aria-labelledby|aria-describedby/i;

function radixWarnings(
  errorSpy: ReturnType<typeof vi.spyOn>,
  warnSpy: ReturnType<typeof vi.spyOn>,
): unknown[][] {
  return [...errorSpy.mock.calls, ...warnSpy.mock.calls].filter((call) =>
    call.some((arg) => typeof arg === 'string' && RADIX_WARNING_PATTERN.test(arg)),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

test('Dialog has Close button with title', () => {
  render(
    <Dialog open={true}>
      <DialogContent>
        <DialogTitle>Test dialog</DialogTitle>
        <DialogDescription>Test dialog description.</DialogDescription>
        <div>Content</div>
      </DialogContent>
    </Dialog>,
  );

  const closeButton = screen.getByRole('button', { name: /close/i });
  expect(closeButton.getAttribute('title')).toBe('Close (Esc)');
});

test('rendered DialogContent does not emit Radix accessibility warnings', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  render(
    <Dialog open={true}>
      <DialogContent>
        <DialogTitle>Test dialog</DialogTitle>
        <DialogDescription>Test dialog description.</DialogDescription>
        <div>Content</div>
      </DialogContent>
    </Dialog>,
  );

  expect(radixWarnings(consoleError, consoleWarn)).toEqual([]);
});

test('rendered SheetContent does not emit Radix accessibility warnings', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  render(
    <Sheet open={true}>
      <SheetContent>
        <SheetTitle>Test sheet</SheetTitle>
        <SheetDescription>Test sheet description.</SheetDescription>
        <div>Content</div>
      </SheetContent>
    </Sheet>,
  );

  expect(radixWarnings(consoleError, consoleWarn)).toEqual([]);
});

test('Radix warning detection bites when a Title or Description is removed', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  render(
    <Dialog open={true}>
      <DialogContent>
        <div>Content without a title or description</div>
      </DialogContent>
    </Dialog>,
  );

  expect(radixWarnings(consoleError, consoleWarn).length).toBeGreaterThan(0);
});

test('Sheet has Close button with title', () => {
  render(
    <Sheet open={true}>
      <SheetContent>
        <SheetTitle>Test sheet</SheetTitle>
        <SheetDescription>Test sheet description.</SheetDescription>
        <div>Content</div>
      </SheetContent>
    </Sheet>,
  );

  const closeButton = screen.getByRole('button', { name: /close/i });
  expect(closeButton.getAttribute('title')).toBe('Close (Esc)');
});

describe('production DialogContent/SheetContent accessibility coverage', () => {
  const files = collectProductionDialogFiles(SRC_ROOT);

  test('enumerates production dialog files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files.map((file) => [path.relative(SRC_ROOT, file), file] as const))(
    '%s renders a Title and a Description (or aria-describedby)',
    (_relative, file) => {
      const content = readFileSync(file, 'utf8');
      expect(content, `${file} is missing a DialogTitle/SheetTitle`).toMatch(
        /<DialogTitle|<SheetTitle/,
      );
      expect(content, `${file} is missing a DialogDescription/SheetDescription`).toMatch(
        /<DialogDescription|<SheetDescription|aria-describedby/,
      );
    },
  );
});
