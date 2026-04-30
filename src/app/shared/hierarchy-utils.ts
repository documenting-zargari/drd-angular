/**
 * Strip the root "RLB" element from a hierarchy array.
 * Returns a new array without "RLB" at the start.
 */
export function cleanHierarchy(hierarchy: string[]): string[] {
  if (!hierarchy || hierarchy.length === 0) return [];
  if (hierarchy[0] === 'RLB') return hierarchy.slice(1);
  return hierarchy;
}
