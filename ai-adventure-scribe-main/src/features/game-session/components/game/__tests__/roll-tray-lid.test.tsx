import { render } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { TRAY_LID_TEXT, useStableRollTraySlot } from '../game-content/roll-tray-slot';

function Harness({ tableHost }: { tableHost: boolean }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useStableRollTraySlot(host);
  return (
    <div
      ref={setHost}
      data-testid="host"
      className={tableHost ? 'ir-table-roll-host' : 'plain-host'}
    />
  );
}

describe('closed tray lid', () => {
  it('puts the lid text in the DOM on the Table host, in front of the empty slot', () => {
    const { getByTestId } = render(<Harness tableHost />);
    const host = getByTestId('host');
    const lid = host.querySelector('p.ir-roll-tray-lid');
    expect(lid).toHaveTextContent(TRAY_LID_TEXT);
    expect(host.querySelector('.ir-stable-roll-slot')).toBeEmptyDOMElement();
  });

  it('adds no lid on other hosts', () => {
    const { getByTestId } = render(<Harness tableHost={false} />);
    expect(getByTestId('host').querySelector('.ir-roll-tray-lid')).toBeNull();
    expect(getByTestId('host').querySelector('.ir-stable-roll-slot')).not.toBeNull();
  });
});
