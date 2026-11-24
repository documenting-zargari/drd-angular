/**
 * Characterization tests for every place the client turns a category's
 * `hierarchy` / `hierarchy_ids` into a label, breadcrumb or chip.
 *
 * Purpose: pin down what the code does TODAY, before the label logic is
 * consolidated into one shared service (cleanup started 2026-11-24). The
 * reference rules below are the contract; each existing implementation is
 * checked against them over all 3577 real categories (beta snapshot, with
 * hierarchies computed by the server's CategoryTree). After the refactor the
 * same tests must still pass, now against the new code.
 *
 * Components are instantiated with Object.create(prototype) so only the
 * label methods run — no DI, no template, no network.
 */
import { of } from 'rxjs';

import categoriesFixture from '../testing/fixtures/categories-beta-20261124.json';
import { categoryPrefix } from './category-labels';
import { CategoryLabelService } from '../api/category-label.service';
import { TablesComponent } from '../tables/tables.component';
import { ViewsComponent } from '../views/views.component';
import { SearchComponent } from '../search/search.component';
import { PhrasesComponent } from '../phrases/phrases.component';
import { TranscriptionsComponent } from '../pages/transcriptions/transcriptions.component';

interface Cat {
  id: number;
  name: string;
  parent_id: number | null;
  is_leaf: boolean | null;
  hierarchy: string[];
  hierarchy_ids: number[];
}

const CATS = categoriesFixture as Cat[];
const byId = new Map(CATS.map(c => [c.id, c]));

// --- Reference rules (the contract) ----------------------------------------

/** Drop the root "RLB" (what cleanHierarchy does). */
const stripRoot = (h: string[] | undefined): string[] => (h?.[0] === 'RLB' ? h.slice(1) : h ?? []);
/** Full path without root, " > "-joined; the name alone if there's no hierarchy. */
const path = (c: any): string => (c.hierarchy?.length ? stripRoot(c.hierarchy).join(' > ') : c.name);
/** Picker label (Phrases/Transcriptions): drop the first element (whatever it is), " › "-joined. */
const pickerLabel = (c: any): string => {
  const p = c.hierarchy?.length ? c.hierarchy : [c.name];
  return (p.length > 1 ? p.slice(1) : p).join(' › ');
};
/** Chip prefix (Search/Views): ancestors between root and self, or undefined. */
const chipPrefix = (c: any): string | undefined =>
  c.hierarchy?.length > 2 ? c.hierarchy.slice(1, -1).join(' > ') + ' ›' : undefined;
/** Chip prefix after unifying on " > " (decided 2026-11-24). */
const unifiedPrefix = (c: any): string | undefined => chipPrefix(c)?.replace(/ ›$/, ' >');
/** Ancestor names without root and self. */
const ancestors = (c: any): string[] => stripRoot(c.hierarchy).slice(0, -1);
/** Ancestor ids without root and self, capped at 15 (Tables EXPAND_MAX). */
const ancestorIds = (c: any): number[] =>
  Array.isArray(c.hierarchy_ids) && c.hierarchy_ids.length >= 2 ? c.hierarchy_ids.slice(1, -1).slice(0, 15) : [];

/** Category names containing " > " — a label split on " > " breaks them apart. */
const NAMES_WITH_SEPARATOR = CATS.filter(c => c.name.includes(' > ')).map(c => c.id);
/** Categories whose path (self or an ancestor) contains such a name. */
const PATHS_WITH_SEPARATOR = CATS.filter(c => c.hierarchy.some(n => n.includes(' > '))).map(c => c.id);

/** Run `check` over every category; report the first few mismatches readably. */
function expectForAll(label: string, check: (c: Cat) => [actual: unknown, expected: unknown]): void {
  const bad: string[] = [];
  for (const c of CATS) {
    const [actual, expected] = check(c);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      bad.push(`#${c.id} ${c.name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
  }
  expect(bad.slice(0, 5)).withContext(`${label}: ${bad.length} mismatches`).toEqual([]);
}

/** Minimal SearchStateService stand-in. */
function stateStub(cache: Record<string, any> = {}, selected: any[] = []) {
  return {
    getCategoryCache: (id: number | string) => cache[String(id)] ?? null,
    setCategoryCache: (id: number | string, c: any) => (cache[String(id)] = c),
    getCurrentSelectedCategories: () => selected,
  };
}

const deep = CATS.find(c => c.hierarchy.length >= 6)!;
const nameOnly = { id: 999999, name: 'No hierarchy here', hierarchy: [] as string[] };

describe('fixture sanity', () => {
  it('is the full beta category tree with computed hierarchies', () => {
    expect(CATS.length).toBe(3577);
    expect(CATS.every(c => c.hierarchy[0] === 'RLB' && c.hierarchy.at(-1) === c.name)).toBeTrue();
    expect(CATS.every(c => c.hierarchy.length === c.hierarchy_ids.length && c.hierarchy_ids.at(-1) === c.id)).toBeTrue();
    expect(NAMES_WITH_SEPARATOR.map(id => byId.get(id)!.name)).toEqual(['Fortition v > b']);
    expect(PATHS_WITH_SEPARATOR.length).toBe(8); // the category itself + its 7 questions
  });
});

// --- Tables -----------------------------------------------------------------

describe('Tables: category labels (converted 2026-11-24)', () => {
  let t: any;
  let labels: CategoryLabelService;
  beforeEach(() => {
    t = Object.create(TablesComponent.prototype);
    labels = new CategoryLabelService();
    t.categoryLabels = labels;
    t.categoryData = {};
    t.searchStateService = stateStub();
  });

  it('getCategoryHierarchy: ancestors below the root', () => {
    expectForAll('getCategoryHierarchy', c => [t.getCategoryHierarchy(c), ancestors(c)]);
    expect(t.getCategoryHierarchy(nameOnly)).toEqual([]);
  });

  it('selected view: hierarchy, ancestor ids and clickable breadcrumbs', () => {
    expectForAll('getSelectedViewHierarchy', c => {
      t.selectedCategory = c;
      return [t.getSelectedViewHierarchy(), ancestors(c)];
    });
    expectForAll('getAncestorChainIds', c => {
      t.selectedCategory = c;
      return [t.getAncestorChainIds(), ancestorIds(c)];
    });
    expectForAll('getSelectedViewBreadcrumbs', c => {
      t.selectedCategory = c;
      return [t.getSelectedViewBreadcrumbs(), ancestors(c).map((name, i) => ({ id: ancestorIds(c)[i], name }))];
    });
    t.selectedCategory = null;
    expect(t.getSelectedViewHierarchy()).toEqual([]);
    expect(t.getSelectedViewBreadcrumbs()).toEqual([]);
  });

  it('applyHierarchyFilter matches name or space-joined hierarchy, case-insensitively', () => {
    t.categories = CATS;
    t.viewCategories = CATS;
    for (const term of ['adverbial', 'Time Simultaneity', 'rlb', 'v > b', 'xyzzy']) {
      t.applyHierarchyFilter(term);
      const lc = term.toLowerCase();
      const expected = CATS.filter(c => c.name.toLowerCase().includes(lc) || c.hierarchy.join(' ').toLowerCase().includes(lc));
      expect(t.filteredCategories.map((c: Cat) => c.id)).withContext(term).toEqual(expected.map(c => c.id));
    }
    t.applyHierarchyFilter('  ');
    expect(t.filteredCategories).toBe(CATS);
  });

  it('question labels: full path for known ids, "Question N" otherwise', () => {
    labels.remember(CATS);
    expectForAll('getQuestionHierarchy', c => [t.getQuestionHierarchy({ question_id: c.id }), path(c) || c.name]);
    expectForAll('getQuestionHierarchyForCriterion', c => [t.getQuestionHierarchyForCriterion(c.id), path(c) || c.name]);
    expect(t.getQuestionHierarchy({ question_id: 42424242 })).toBe('Question 42424242');
    expect(t.getQuestionHierarchyForCriterion(42424242)).toBe('Question 42424242');
    expect(t.getQuestionHierarchy({})).toBe('');
    expect(t.getQuestionHierarchy(null)).toBe('');
  });

  it('search-value modal: label and hierarchy from the label service', () => {
    labels.remember(CATS);
    expectForAll('showSearchValueModal hierarchy', c => {
      t.showSearchValueModal(c.id, 'form', 'x');
      return [t.searchModalHierarchy, c.id === 1 ? ['RLB'] : stripRoot(c.hierarchy)];
    });

    const shown: any[] = [];
    t.showSearchValueModal = (id: number, field: string, label: string) => shown.push([id, field, label]);
    expectForAll('onSpecSearchCellClick label', c => {
      shown.length = 0;
      t.onSpecSearchCellClick({ questionId: c.id, field: 'form' });
      return [shown[0]?.[2], path(c) || c.name];
    });
  });

  it('search-value modal for an unknown question loads it first, then labels it', () => {
    const shown: any[] = [];
    t.showSearchValueModal = (id: number, field: string, label: string) => shown.push([id, field, label]);
    t.dataService = { getCategoryById: () => { labels.remember(deep); return of(deep); } }; // DataService records it
    t.onSpecSearchCellClick({ questionId: deep.id, field: 'form' });
    expect(shown).toEqual([[deep.id, 'form', path(deep)]]);
    expect(t.categoryData[deep.id]).toBe(deep);

    shown.length = 0;
    t.dataService = { getCategoryById: () => of(null) };
    t.onSpecSearchCellClick({ questionId: 42424242, field: 'form' });
    expect(shown).toEqual([[42424242, 'form', 'Question 42424242']]);
  });
});

// --- Views ------------------------------------------------------------------

describe('Views: category labels (converted 2026-11-24)', () => {
  let v: any;
  let labels: CategoryLabelService;
  beforeEach(() => {
    v = Object.create(ViewsComponent.prototype);
    labels = new CategoryLabelService();
    v.categoryLabels = labels;
    v.selectedCategories = [];
    v.searchContext = { searches: [] };
  });

  it('getQuestionName: full path for known ids, "Question N" otherwise', () => {
    labels.remember(CATS);
    expectForAll('getQuestionName', c => [v.getQuestionName(c.id), path(c) || c.name]);
    expect(v.getQuestionName(42424242)).toBe('Question 42424242');
  });

  it('getQuestionHierarchy(result): label by question_id; "" without one', () => {
    labels.remember(CATS);
    expectForAll('getQuestionHierarchy', c => [v.getQuestionHierarchy({ question_id: c.id }), path(c) || c.name]);
    expect(v.getQuestionHierarchy({ question_id: 42424242 })).toBe('Question 42424242');
    expect(v.getQuestionHierarchy({})).toBe('');
    expect(v.getQuestionHierarchy(null)).toBe('');
  });

  it('comparison column hierarchy + display name = ancestors + own name, in both modes (" > " bug fixed)', () => {
    labels.remember(CATS);
    for (const searches of [[], [{ questionId: 1, fieldName: 'form', value: 'x' }]]) {
      v.searchContext = { searches };
      expectForAll(`hierarchy, ${searches.length ? 'criteria' : 'category'} mode`, c =>
        [v.getComparisonTableColumnHierarchy({ questionId: c.id }), ancestors(c)]);
      expectForAll(`display name, ${searches.length ? 'criteria' : 'category'} mode`, c =>
        [v.getComparisonTableColumnDisplayName({ questionId: c.id }), c.id === 1 ? 'RLB' : c.name]);
    }
    const fortition = byId.get(NAMES_WITH_SEPARATOR[0])!;
    expect(v.getComparisonTableColumnDisplayName({ questionId: fortition.id })).toBe('Fortition v > b');
    expect(v.getComparisonTableColumnHierarchy({ questionId: 42424242 })).toEqual([]);
    expect(v.getComparisonTableColumnDisplayName({ questionId: 42424242 })).toBe('Question 42424242');
  });

  it('categoryChips: name, ancestor prefix ending " >", title', () => {
    v.selectedCategories = CATS;
    const chips = v.categoryChips;
    expectForAll('chips', c => {
      const chip = chips[CATS.indexOf(c)];
      return [[chip.label, chip.prefix, chip.title], [c.name, unifiedPrefix(c), 'Question ' + c.id]];
    });
  });
});

// --- Search -----------------------------------------------------------------

describe('Search: category chips (converted 2026-11-24)', () => {
  it('categoryChips: name, ancestor prefix ending " >" (was " ›"), title', () => {
    const s: any = Object.create(SearchComponent.prototype);
    s.selectedCategories = CATS;
    const chips = s.categoryChips;
    expectForAll('chips', c => {
      const chip = chips[CATS.indexOf(c)];
      return [[chip.value, chip.label, chip.prefix, chip.title], [c, c.name, unifiedPrefix(c), 'Question ' + c.id]];
    });
  });

  it('search-result prefix matches the old inline template (ancestors, then " > ", then the name)', () => {
    // The template calls SearchComponent.categoryPrefix, i.e. this function.
    expectForAll('template prefix', c => {
      const old = c.hierarchy.slice(1, -1).join(' > ') + (c.hierarchy.length > 2 ? ' > ' : '');
      const now = categoryPrefix(c) ? categoryPrefix(c) + ' ' : '';
      return [now, old];
    });
  });
});

// --- Phrases / Transcriptions -------------------------------------------------

describe('Phrases + Transcriptions: picker labels (characterization)', () => {
  for (const [name, proto] of [
    ['Phrases', PhrasesComponent.prototype],
    ['Transcriptions', TranscriptionsComponent.prototype],
  ] as const) {
    it(`${name}.formatHierarchy drops the first element and joins with " › "`, () => {
      const p: any = Object.create(proto);
      expectForAll(name, c => [p.formatHierarchy(c.hierarchy, c.name), pickerLabel(c)]);
      expect(p.formatHierarchy([], 'Solo')).toBe('Solo');
      expect(p.formatHierarchy(undefined, 'Solo')).toBe('Solo');
      expect(p.formatHierarchy(['X', 'Y'], 'Y')).toBe('Y'); // drops ANY first element, not just "RLB"
    });
  }
});
