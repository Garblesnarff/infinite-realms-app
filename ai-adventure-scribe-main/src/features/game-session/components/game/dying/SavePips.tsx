import React from 'react';

const PIP_COUNT = 3;

function Pip({ filled, kind }: { filled: boolean; kind: 'saved' | 'failed' }): React.ReactElement {
  const mark =
    kind === 'saved' ? (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M6 12.5l4 4L18 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ) : (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M7 7l10 10M17 7L7 17"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
      </svg>
    );
  const filledClass =
    kind === 'saved'
      ? 'bg-infinite-gold text-infinite-dark ir-end-pip-saved'
      : 'bg-destructive text-white ir-end-pip-failed';
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${
        filled ? filledClass : 'border-2 border-white/40 ir-end-pip-empty'
      }`}
    >
      {filled ? mark : null}
    </span>
  );
}

export function SavePips({
  successes,
  failures,
}: {
  successes: number;
  failures: number;
}): React.ReactElement {
  return (
    <div
      role="img"
      aria-label={`${successes} of 3 successes, ${failures} of 3 failures`}
      className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5"
    >
      <span className="inline-flex items-center gap-2" data-testid="dying-panel-successes">
        <span className="text-[13px] font-bold tracking-wide text-infinite-gold [body.ir-table-look_&]:text-[#f3deb0]">
          Saved
        </span>
        <span className="inline-flex gap-[5px]">
          {Array.from({ length: PIP_COUNT }, (_, index) => (
            <Pip key={`saved-${index}`} kind="saved" filled={index < successes} />
          ))}
        </span>
      </span>
      <span className="inline-flex items-center gap-2" data-testid="dying-panel-failures">
        <span className="text-[13px] font-bold tracking-wide text-red-300 [body.ir-table-look_&]:text-[#ef8a8a]">
          Failed
        </span>
        <span className="inline-flex gap-[5px]">
          {Array.from({ length: PIP_COUNT }, (_, index) => (
            <Pip key={`failed-${index}`} kind="failed" filled={index < failures} />
          ))}
        </span>
      </span>
    </div>
  );
}
