/** "Ranger (Hunter)" when a subclass is known, otherwise the class name alone. */
export function formatClassWithSubclass(
  className: string | null | undefined,
  subclassName: string | null | undefined,
): string {
  const classLabel = className?.trim() ?? '';
  const subclassLabel = subclassName?.trim() ?? '';
  if (!classLabel) return subclassLabel;
  if (!subclassLabel) return classLabel;
  return `${classLabel} (${subclassLabel})`;
}
