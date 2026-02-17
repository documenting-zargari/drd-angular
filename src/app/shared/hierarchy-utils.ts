/**
 * Strip the root "RMS" element from a hierarchy array.
 * Returns a new array without "RMS" at the start.
 */
export function cleanHierarchy(hierarchy: string[]): string[] {
  if (!hierarchy || hierarchy.length === 0) return [];
  if (hierarchy[0] === 'RMS') return hierarchy.slice(1);
  return hierarchy;
}
