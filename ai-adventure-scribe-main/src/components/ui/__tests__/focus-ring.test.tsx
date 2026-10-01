import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from '../input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../tabs';
import { Textarea } from '../textarea';

const GOLD_RING = 'focus-visible:ring-ring';

describe('default focus ring (#2324)', () => {
  it('puts the gold ring token on Textarea', () => {
    render(<Textarea aria-label="Message" />);
    const className = screen.getByRole('textbox', { name: 'Message' }).className;
    expect(className).toContain(GOLD_RING);
    expect(className).not.toContain('electricCyan');
  });

  it('puts the gold ring token on Input', () => {
    render(<Input aria-label="Name" />);
    const className = screen.getByRole('textbox', { name: 'Name' }).className;
    expect(className).toContain(GOLD_RING);
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
    expect(trigger).toContain(GOLD_RING);
    expect(trigger).not.toContain('electricCyan');
    expect(panel).toContain(GOLD_RING);
    expect(panel).not.toContain('electricCyan');
  });
});
