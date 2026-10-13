import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { Badge } from '../badge';
import { Checkbox } from '../checkbox';
import { Dialog, DialogContent, DialogTitle } from '../dialog';
import { HexagonalBadge } from '../hexagonal-badge';
import { Input } from '../input';
import { RadioGroup, RadioGroupItem } from '../radio-group';
import { Select, SelectTrigger, SelectValue } from '../select';
import { Sheet, SheetContent, SheetTitle } from '../sheet';
import { Slider } from '../slider';
import { Switch } from '../switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../tabs';
import { Textarea } from '../textarea';
import { ToastAction } from '../toast';
import { Toggle } from '../toggle';

const FOCUS_GOLD_RING = 'focus:ring-ring';
const FOCUS_VISIBLE_GOLD_RING = 'focus-visible:ring-ring';

beforeAll(() => {
  if (typeof global.ResizeObserver === 'undefined') {
    global.ResizeObserver = class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

describe('default focus ring (#2324 & #110)', () => {
  it('puts the gold ring token on Textarea', () => {
    render(<Textarea aria-label="Message" />);
    const className = screen.getByRole('textbox', { name: 'Message' }).className;
    expect(className).toContain(FOCUS_VISIBLE_GOLD_RING);
    expect(className).not.toContain('electricCyan');
  });

  it('puts the gold ring token on Input', () => {
    render(<Input aria-label="Name" />);
    const className = screen.getByRole('textbox', { name: 'Name' }).className;
    expect(className).toContain(FOCUS_VISIBLE_GOLD_RING);
    expect(className).not.toContain('electricCyan');
  });

  it('puts the gold ring token on TabsTrigger and TabsContent', () => {
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
        </TabsList>
        <TabsContent value="one">Panel</TabsContent>
      </Tabs>,
    );
    const trigger = screen.getByRole('tab', { name: 'One' }).className;
    const panel = screen.getByRole('tabpanel').className;
    expect(trigger).toContain(FOCUS_VISIBLE_GOLD_RING);
    expect(trigger).not.toContain('electricCyan');
    expect(panel).toContain(FOCUS_VISIBLE_GOLD_RING);
    expect(panel).not.toContain('electricCyan');
  });

  it('puts the gold ring token on Badge', () => {
    render(<Badge>Badge Label</Badge>);
    const className = screen.getByText('Badge Label').className;
    expect(className).toContain(FOCUS_GOLD_RING);
    expect(className).not.toContain('electricCyan');
  });

  it('puts the gold ring token on Checkbox', () => {
    render(<Checkbox aria-label="Accept terms" />);
    const className = screen.getByRole('checkbox', { name: 'Accept terms' }).className;
    expect(className).toContain(FOCUS_VISIBLE_GOLD_RING);
    expect(className).not.toContain('electricCyan');
  });

  it('puts the gold ring token on Dialog close button', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Dialog Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const closeBtn = screen.getByRole('button', { name: 'Close (Esc)' }).className;
    expect(closeBtn).toContain(FOCUS_GOLD_RING);
    expect(closeBtn).not.toContain('electricCyan');
  });

  it('puts the gold ring token on HexagonalBadge', () => {
    render(<HexagonalBadge>Hex Label</HexagonalBadge>);
    const className = screen.getByText('Hex Label').className;
    expect(className).toContain(FOCUS_VISIBLE_GOLD_RING);
    expect(className).not.toContain('electricCyan');
  });

  it('puts the gold ring token on RadioGroupItem', () => {
    render(
      <RadioGroup>
        <RadioGroupItem value="option1" aria-label="Option 1" />
      </RadioGroup>,
    );
    const className = screen.getByRole('radio', { name: 'Option 1' }).className;
    expect(className).toContain(FOCUS_VISIBLE_GOLD_RING);
    expect(className).not.toContain('electricCyan');
  });

  it('puts the gold ring token on SelectTrigger', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Select item">
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
      </Select>,
    );
    const className = screen.getByRole('combobox', { name: 'Select item' }).className;
    expect(className).toContain(FOCUS_GOLD_RING);
    expect(className).not.toContain('electricCyan');
  });

  it('puts the gold ring token on Sheet close button', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Sheet Title</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    const closeBtn = screen.getByRole('button', { name: 'Close (Esc)' }).className;
    expect(closeBtn).toContain(FOCUS_GOLD_RING);
    expect(closeBtn).not.toContain('electricCyan');
  });

  it('puts the gold ring token on Slider thumb', () => {
    render(<Slider defaultValue={[50]} max={100} step={1} aria-label="Volume" />);
    const className = screen.getByRole('slider').className;
    expect(className).toContain(FOCUS_VISIBLE_GOLD_RING);
    expect(className).not.toContain('electricCyan');
  });

  it('puts the gold ring token on ToastAction', () => {
    render(<ToastAction altText="Undo action">Undo</ToastAction>);
    const className = screen.getByRole('button', { name: 'Undo' }).className;
    expect(className).toContain(FOCUS_GOLD_RING);
    expect(className).not.toContain('electricCyan');
  });

  it('puts the gold ring token on Switch', () => {
    render(<Switch aria-label="Enable notification" />);
    const className = screen.getByRole('switch', { name: 'Enable notification' }).className;
    expect(className).toContain(FOCUS_VISIBLE_GOLD_RING);
    expect(className).not.toContain('electricCyan');
  });

  it('puts the gold ring token on Toggle', () => {
    render(<Toggle aria-label="Mute audio">Mute</Toggle>);
    const className = screen.getByRole('button', { name: 'Mute audio' }).className;
    expect(className).toContain(FOCUS_VISIBLE_GOLD_RING);
    expect(className).not.toContain('electricCyan');
  });
});
