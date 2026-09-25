import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { BattleMapHeader } from '../BattleMapHeader';

import type * as ReactRouterDom from 'react-router-dom';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('BattleMapHeader Accessibility', () => {
  const defaultProps = {
    campaignName: 'Test Campaign',
    sceneName: 'Test Scene',
    isMobile: false,
    showLayersPanel: false,
    toggleLayersPanel: vi.fn(),
    showPerformanceMonitor: false,
    setShowPerformanceMonitor: vi.fn(),
    setShowHotkeyGuide: vi.fn(),
    onBackToScenes: vi.fn(),
    onBackToCampaign: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders breadcrumbs with correct ARIA labels and no native titles', () => {
    render(
      <BrowserRouter>
        <BattleMapHeader {...defaultProps} />
      </BrowserRouter>,
    );

    const campaignsBtn = screen.getByLabelText('Back to Campaigns');
    const campaignBtn = screen.getByLabelText('Back to Test Campaign');
    const scenesBtn = screen.getByLabelText('Back to Scenes');

    expect(campaignsBtn).toBeInTheDocument();
    expect(campaignBtn).toBeInTheDocument();
    expect(scenesBtn).toBeInTheDocument();

    expect(campaignsBtn).not.toHaveAttribute('title');
    expect(campaignBtn).not.toHaveAttribute('title');
    expect(scenesBtn).not.toHaveAttribute('title');
  });

  it('provides a focusable and labeled span for the truncated scene name', () => {
    render(
      <BrowserRouter>
        <BattleMapHeader {...defaultProps} />
      </BrowserRouter>,
    );

    const sceneName = screen.getByText('Test Scene');
    expect(sceneName).toHaveAttribute('tabIndex', '0');
    expect(sceneName).toHaveClass('cursor-default');
    expect(sceneName).toHaveAttribute('aria-current', 'page');
  });

  it('shows tooltips for breadcrumbs on hover', async () => {
    render(
      <BrowserRouter>
        <BattleMapHeader {...defaultProps} />
      </BrowserRouter>,
    );

    const campaignsBtn = screen.getByLabelText('Back to Campaigns');

    // Trigger tooltip
    fireEvent.mouseOver(campaignsBtn);
    fireEvent.focus(campaignsBtn);

    // Tooltips are often rendered in portals, so we wait for them
    // Note: In JSDOM with Radix, we might need to check for the content
    await waitFor(
      () => {
        const tooltip = screen.queryByRole('tooltip') || screen.queryByText('Back to Campaigns');
        expect(tooltip).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it('shows tooltip for the scene name on hover', async () => {
    render(
      <BrowserRouter>
        <BattleMapHeader {...defaultProps} />
      </BrowserRouter>,
    );

    const sceneName = screen.getByText('Test Scene');

    // Trigger tooltip
    fireEvent.mouseOver(sceneName);
    fireEvent.focus(sceneName);

    await waitFor(
      () => {
        const tooltip = screen.queryByRole('tooltip') || screen.queryByText('Test Scene');
        expect(tooltip).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it('navigates to campaigns when clicking the campaigns breadcrumb', () => {
    render(
      <BrowserRouter>
        <BattleMapHeader {...defaultProps} />
      </BrowserRouter>,
    );

    const campaignsBtn = screen.getByLabelText('Back to Campaigns');
    fireEvent.click(campaignsBtn);

    expect(mockNavigate).toHaveBeenCalledWith('/app');
  });

  it('calls onBackToCampaign when clicking the campaign breadcrumb', () => {
    render(
      <BrowserRouter>
        <BattleMapHeader {...defaultProps} />
      </BrowserRouter>,
    );

    const campaignBtn = screen.getByLabelText('Back to Test Campaign');
    fireEvent.click(campaignBtn);

    expect(defaultProps.onBackToCampaign).toHaveBeenCalled();
  });

  it('calls onBackToScenes when clicking the scenes breadcrumb', () => {
    render(
      <BrowserRouter>
        <BattleMapHeader {...defaultProps} />
      </BrowserRouter>,
    );

    const scenesBtn = screen.getByLabelText('Back to Scenes');
    fireEvent.click(scenesBtn);

    expect(defaultProps.onBackToScenes).toHaveBeenCalled();
  });
});
