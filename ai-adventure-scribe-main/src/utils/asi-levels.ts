export function canChooseAbilityScoreImprovement(className: string | undefined, level: number) {
  const asiLevels = [4, 8, 12, 16, 19];
  if (className?.toLowerCase() === 'fighter') asiLevels.push(6, 14);
  if (className?.toLowerCase() === 'rogue') asiLevels.push(10);
  return asiLevels.includes(level);
}
