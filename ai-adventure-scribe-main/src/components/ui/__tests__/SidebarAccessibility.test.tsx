import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { SidebarProvider, SidebarTrigger, SidebarRail } from '../sidebar';

// Mock useIsMobile hook
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

describe('Sidebar Accessibility', () => {
  it('SidebarTrigger has correct accessibility attributes', () => {
    render(
      <SidebarProvider defaultOpen={true}>
        <SidebarTrigger />
      </SidebarProvider>
    );

    const trigger = screen.getByRole('button', { name: /Toggle Sidebar \(Ctrl\+B\)/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('title', 'Toggle Sidebar (Ctrl+B)');
    expect(trigger.querySelector('.sr-only')).toHaveTextContent('Toggle Sidebar (Ctrl+B)');
  });

  it('SidebarRail has correct accessibility attributes', () => {
    render(
      <SidebarProvider defaultOpen={false}>
        <SidebarRail />
      </SidebarProvider>
    );

    const rail = screen.getByRole('button', { name: /Toggle Sidebar \(Ctrl\+B\)/i });
    expect(rail).toBeInTheDocument();
    expect(rail).toHaveAttribute('aria-expanded', 'false');
    expect(rail).toHaveAttribute('title', 'Toggle Sidebar (Ctrl+B)');
  });
});
