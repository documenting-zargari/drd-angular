import { Injectable } from '@angular/core';

import {
  CategoryNode,
  categoryAncestorIds,
  categoryAncestors,
  categoryLabel,
  categoryPath,
  unknownCategoryLabel,
} from '../shared/category-labels';

/**
 * Every category the client has seen, by id — filled by DataService as
 * category responses arrive, so pages never have to remember to cache what
 * they load. Labels for an id come from here only.
 */
@Injectable({ providedIn: 'root' })
export class CategoryLabelService {
  private readonly nodes = new Map<number, CategoryNode>();

  /** Record categories from any response. A node without a hierarchy never
   *  replaces one that has it (search-views omits it; categories/search sends
   *  [] for top-level categories). */
  remember(input: CategoryNode | CategoryNode[] | null | undefined): void {
    const list = Array.isArray(input) ? input : input ? [input] : [];
    for (const node of list) {
      if (node?.id == null) continue;
      const id = Number(node.id);
      const prev = this.nodes.get(id);
      const merged: CategoryNode = { ...prev, ...node, id };
      if (!node.hierarchy?.length && prev?.hierarchy?.length) merged.hierarchy = prev.hierarchy;
      if (!node.hierarchy_ids?.length && prev?.hierarchy_ids?.length) merged.hierarchy_ids = prev.hierarchy_ids;
      this.nodes.set(id, merged);
    }
  }

  get(id: number | string): CategoryNode | undefined {
    return this.nodes.get(Number(id));
  }

  has(id: number | string): boolean {
    return this.nodes.has(Number(id));
  }

  /** Ids from `ids` that aren't known yet (to fetch before labelling). */
  missing(ids: (number | string)[]): number[] {
    return [...new Set(ids.map(Number))].filter(id => !this.nodes.has(id));
  }

  /** "Adverbial Clauses > Time > Anteriority", or "Question N" if unknown. */
  label(id: number | string): string {
    return categoryLabel(this.get(id)) || unknownCategoryLabel(id);
  }

  /** Path below the root including the category; ["Question N"] if unknown. */
  path(id: number | string): string[] {
    const p = categoryPath(this.get(id));
    return p.length > 0 ? p : [unknownCategoryLabel(id)];
  }

  ancestors(id: number | string): string[] {
    return categoryAncestors(this.get(id));
  }

  ancestorIds(id: number | string): number[] {
    return categoryAncestorIds(this.get(id));
  }
}
