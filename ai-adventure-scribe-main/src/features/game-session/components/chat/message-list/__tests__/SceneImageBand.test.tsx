import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SceneImageBand } from '../SceneImageBand';

describe('SceneImageBand (#1236 D)', () => {
  it('shows the scene picture with its caption', () => {
    render(<SceneImageBand url="https://example.test/tavern.png" caption="The Tavern" />);

    expect(screen.getByRole('img', { name: 'The Tavern' })).toHaveAttribute(
      'src',
      'https://example.test/tavern.png',
    );
    expect(screen.getByText('The Tavern')).toBeInTheDocument();
  });

  it('removes itself when the picture fails to load, so no broken image shows', () => {
    const { container } = render(
      <SceneImageBand url="https://example.test/missing.png" caption="The Tavern" />,
    );

    fireEvent.error(screen.getByRole('img', { name: 'The Tavern' }));

    expect(container).toBeEmptyDOMElement();
  });
});
