import React from 'react';

import type { HeroNameCheck } from '@/data/hero-names';

import { HERO_NAME_MAX_LENGTH, heroEpithetName, suggestHeroNames } from '@/data/hero-names';

/** #1741: the name field at hero choice, with three suggested names. */
export const HeroNameField: React.FC<{
  hero: { id: string; name: string; race: string };
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  check: HeroNameCheck;
}> = ({ hero, value, onChange, disabled = false, check }) => {
  const suggestions = React.useMemo(() => suggestHeroNames(hero), [hero]);
  const inputId = `hero-name-${hero.id}`;
  const errorId = `${inputId}-error`;
  const shown = check.ok && value.trim() !== '' ? heroEpithetName(check.name, hero.name) : null;

  return (
    <div className="space-y-2 text-left">
      <label htmlFor={inputId} className="block text-sm font-semibold">
        Name your hero
      </label>
      <input
        id={inputId}
        type="text"
        value={value}
        maxLength={HERO_NAME_MAX_LENGTH}
        disabled={disabled}
        placeholder={`Leave empty to keep "${hero.name}"`}
        aria-invalid={!check.ok}
        aria-describedby={check.ok ? undefined : errorId}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-h-11 rounded border border-white/20 bg-black/30 px-3 text-foreground"
      />
      <div className="flex flex-wrap gap-2" aria-label="Suggested names">
        {suggestions.map((name) => (
          <button
            key={name}
            type="button"
            disabled={disabled}
            onClick={() => onChange(name)}
            className="min-h-11 rounded-full border border-white/20 px-3 text-sm"
          >
            {name}
          </button>
        ))}
      </div>
      {!check.ok && (
        <p id={errorId} role="alert" className="text-sm text-red-300">
          {check.message}
        </p>
      )}
      {shown && <p className="text-sm italic">Playing as {shown}</p>}
    </div>
  );
};
