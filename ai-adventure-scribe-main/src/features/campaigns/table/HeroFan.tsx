import React from 'react';

import { tableImageUrl } from './image-url';
import { TableImage } from './TableImage';

import type { StarterCharacterTemplate } from '@/hooks/use-starter-character-templates';

export const HeroFan: React.FC<{
  templates: StarterCharacterTemplate[];
  disabled: boolean;
  signedIn: boolean;
  vitals: (template: StarterCharacterTemplate) => { hp: number; ac: number };
  onPlay: (template: StarterCharacterTemplate, fresh?: boolean) => void;
}> = ({ templates, disabled, signedIn, onPlay, vitals }) => {
  const [selectedId, setSelectedId] = React.useState(templates[0]?.id);
  const buttons = React.useRef<Array<HTMLButtonElement | null>>([]);
  const selected = templates.find((template) => template.id === selectedId) ?? templates[0];
  if (!selected) return null;

  const move = (event: React.KeyboardEvent, index: number): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = (index + delta + templates.length) % templates.length;
    setSelectedId(templates[next].id);
    buttons.current[next]?.focus();
  };

  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label="Choose your hero"
        className="flex max-w-full snap-x gap-3 overflow-x-auto px-3 pb-4 pt-4"
      >
        {templates.map((template, index) => {
          const image = tableImageUrl(template.cardImageUrl ?? template.portraitUrl, 360, 540);
          let preview: { hp: number; ac: number } | null = null;
          try {
            preview = vitals(template);
          } catch {
            /* A bad template must not hide the other heroes. */
          }
          const active = template.id === selected.id;
          const angle = templates.length > 1 ? -4 + (8 * index) / (templates.length - 1) : 0;
          return (
            <button
              key={template.id}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              type="button"
              aria-pressed={active}
              tabIndex={active ? 0 : -1}
              aria-label={`Choose ${template.name}`}
              onClick={() => setSelectedId(template.id)}
              onKeyDown={(event) => move(event, index)}
              className="ir-action-card min-h-11 w-40 shrink-0 snap-center overflow-hidden rounded-lg text-left transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f6e3b8] hover:-translate-y-2 focus-visible:-translate-y-2"
              style={{ rotate: `${angle}deg` }}
            >
              <TableImage
                src={image}
                alt=""
                width={360}
                height={540}
                className="aspect-[2/3] w-full object-cover"
                fallback={
                  <span className="flex aspect-[2/3] items-center justify-center text-4xl">
                    {template.name.charAt(0)}
                  </span>
                }
              />
              <span className="block p-2">
                <strong className="block">{template.name}</strong>
                <span className="block text-xs">
                  {template.race} {template.class}
                </span>
                {template.tagline && <span className="block text-xs">{template.tagline}</span>}
                {preview && (
                  <span className="block text-xs">
                    HP {preview.hp} · AC {preview.ac}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="ir-parchment rounded p-4">
        <h3 className="text-xl font-bold">{selected.name}</h3>
        <p>
          {selected.race} {selected.class} · Level {selected.level}
        </p>
        {selected.tagline && <p>{selected.tagline}</p>}
        <button
          type="button"
          className="ir-brass-btn mt-3 min-h-11 min-w-11 rounded px-4"
          disabled={disabled}
          onClick={() => onPlay(selected)}
        >
          {signedIn ? `Play as ${selected.name}` : `Sign in to play as ${selected.name}`}
        </button>
        {signedIn && (
          <button
            type="button"
            className="ml-2 min-h-11 px-3 underline"
            disabled={disabled}
            onClick={() => onPlay(selected, true)}
          >
            Start a fresh playthrough
          </button>
        )}
      </div>
    </div>
  );
};
