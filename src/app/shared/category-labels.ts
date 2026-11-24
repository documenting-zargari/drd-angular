/**
 * The one place that turns a category's hierarchy into display text.
 *
 * The server sends `hierarchy` (ancestor names, root "RLB" first, the
 * category's own name last) and `hierarchy_ids` with every category; both are
 * computed from its cached tree. Everything the client shows — labels,
 * breadcrumbs, chip prefixes, column headers — derives from these functions,
 * so the format is decided here and nowhere else.
 */

export const CATEGORY_ROOT = 'RLB';
export const CATEGORY_SEPARATOR = ' > ';

/** The category fields the client relies on. Some endpoints omit
 *  `hierarchy` (search-views) or send it empty (categories/search for
 *  top-level categories), so both arrays are optional. */
export interface CategoryNode {
  id: number;
  name: string;
  parent_id?: number | null;
  is_leaf?: boolean | null;
  has_children?: boolean;
  hierarchy?: string[];
  hierarchy_ids?: number[];
}

/** Path from below the root down to the category itself, e.g.
 *  ["Adverbial Clauses", "Time", "Anteriority"]. Falls back to the name when
 *  no hierarchy was sent. */
export function categoryPath(c: CategoryNode | null | undefined): string[] {
  if (!c) return [];
  const h = c.hierarchy ?? [];
  const below = h[0] === CATEGORY_ROOT ? h.slice(1) : h;
  return below.length > 0 ? below : c.name ? [c.name] : [];
}

/** Ancestor names below the root, without the category itself. */
export function categoryAncestors(c: CategoryNode | null | undefined): string[] {
  return categoryPath(c).slice(0, -1);
}

/** Ancestor ids below the root, without the category itself. */
export function categoryAncestorIds(c: CategoryNode | null | undefined): number[] {
  const ids = c?.hierarchy_ids;
  return Array.isArray(ids) && ids.length >= 2 ? ids.slice(1, -1) : [];
}

/** Full label, e.g. "Adverbial Clauses > Time > Anteriority". */
export function categoryLabel(c: CategoryNode | null | undefined): string {
  return categoryPath(c).join(CATEGORY_SEPARATOR);
}

/** Ancestors as a prefix that leads into the (separately styled) name,
 *  e.g. "Adverbial Clauses > Time >"; undefined for top-level categories. */
export function categoryPrefix(c: CategoryNode | null | undefined): string | undefined {
  const a = categoryAncestors(c);
  return a.length > 0 ? a.join(CATEGORY_SEPARATOR) + ' >' : undefined;
}

/** Label for a category id that isn't known (yet). */
export function unknownCategoryLabel(id: number | string): string {
  return `Question ${id}`;
}
