/**
 * #1797: one read of the weapon list per burst of map changes. A foe turn sends a delta for each
 * move; each used to re-read the list. This runs the first change at once, and then at most one
 * more run at the end of the window, however many changes arrive inside it. Five changes in a
 * row make two runs, not five.
 */
export interface ThrottledTrigger {
  trigger(): void;
  cancel(): void;
}

export function createThrottledTrigger(run: () => void, windowMs: number): ThrottledTrigger {
  let lastRun = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = (): void => {
    timer = null;
    lastRun = Date.now();
    run();
  };

  return {
    trigger(): void {
      const wait = windowMs - (Date.now() - lastRun);
      if (wait <= 0 && timer === null) {
        fire();
        return;
      }
      if (timer === null) timer = setTimeout(fire, Math.max(0, wait));
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
