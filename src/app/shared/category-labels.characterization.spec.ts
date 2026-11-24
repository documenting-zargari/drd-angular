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

describe('Tables: category labels (characterization)', () => {
  let t: any;
  beforeEach(() => {
    t = Object.create(TablesComponent.prototype);
    t.categoryData = {};
    t.searchStateService = stateStub();
  });

  it('getCategoryHierarchy: ancestors by default, full path / skipFirst variants', () => {
    expectForAll('default', c => [t.getCategoryHierarchy(c), ancestors(c)]);
    expectForAll('excludeCurrent:false', c => [t.getCategoryHierarchy(c, { excludeCurrent: false }), stripRoot(c.hierarchy)]);
    expectForAll('skipFirst', c => [t.getCategoryHierarchy(c, { skipFirst: true }), ancestors(c).slice(1)]);
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

  it('getQuestionHierarchy(answer): path from cache, then categoryData; fallbacks', () => {
    // Every category, found via the shared cache.
    const cache: Record<string, any> = Object.fromEntries(CATS.map(c => [String(c.id), c]));
    t.searchStateService = stateStub(cache);
    expectForAll('via cache', c => [t.getQuestionHierarchy({ question_id: c.id }), path(c)]);

    // Every category, found via categoryData only.
    t.searchStateService = stateStub();
    t.categoryData = Object.fromEntries(CATS.map(c => [c.id, c]));
    expectForAll('via categoryData', c => [t.getQuestionHierarchy({ question_id: c.id }), path(c)]);

    // Cache wins over categoryData.
    t.searchStateService = stateStub({ [deep.id]: { ...deep, hierarchy: ['RLB', 'From cache'] } });
    expect(t.getQuestionHierarchy({ question_id: deep.id })).toBe('From cache');

    // An answer's own `hierarchy` wins over both (no Answer carries one today).
    expect(t.getQuestionHierarchy({ question_id: deep.id, hierarchy: ['RLB', 'On answer'] })).toBe('On answer');

    // Name fallback, then "Question N", then "Unknown Question".
    t.searchStateService = stateStub({ [nameOnly.id]: nameOnly });
    expect(t.getQuestionHierarchy({ question_id: nameOnly.id })).toBe(nameOnly.name);
    t.searchStateService = stateStub({ [nameOnly.id]: { id: nameOnly.id, hierarchy: [] } });
    expect(t.getQuestionHierarchy({ question_id: nameOnly.id })).toBe(`Question ${nameOnly.id}`);
    t.searchStateService = stateStub();
    t.categoryData = {};
    expect(t.getQuestionHierarchy({ question_id: 42 })).toBe('Question 42');
    expect(t.getQuestionHierarchy({})).toBe('Unknown Question');
    expect(t.getQuestionHierarchy(null)).toBe('Unknown Question');
  });

  it('getQuestionHierarchyForCriterion: categoryData, then cache, then selected questions', () => {
    t.categoryData = Object.fromEntries(CATS.map(c => [c.id, c]));
    expectForAll('via categoryData', c => [t.getQuestionHierarchyForCriterion(c.id), path(c)]);

    t.categoryData = {};
    t.searchStateService = stateStub(Object.fromEntries(CATS.map(c => [String(c.id), c])));
    expectForAll('via cache', c => [t.getQuestionHierarchyForCriterion(c.id), path(c)]);

    t.searchStateService = stateStub({}, CATS);
    expectForAll('via selected questions', c => [t.getQuestionHierarchyForCriterion(c.id), path(c)]);

    // Order: categoryData beats cache beats selected.
    t.categoryData = { [deep.id]: { ...deep, hierarchy: ['RLB', 'A'] } };
    t.searchStateService = stateStub({ [deep.id]: { ...deep, hierarchy: ['RLB', 'B'] } }, [{ ...deep, hierarchy: ['RLB', 'C'] }]);
    expect(t.getQuestionHierarchyForCriterion(deep.id)).toBe('A');
    t.categoryData = {};
    expect(t.getQuestionHierarchyForCriterion(deep.id)).toBe('B');

    // Name-only entries return the name; unknown ids fall back.
    t.categoryData = { [nameOnly.id]: nameOnly };
    expect(t.getQuestionHierarchyForCriterion(nameOnly.id)).toBe(nameOnly.name);
    t.categoryData = {};
    t.searchStateService = stateStub();
    expect(t.getQuestionHierarchyForCriterion(42)).toBe('Question 42');
  });

  it('search-value modal: label from categoryData, hierarchy array without root', () => {
    const shown: any[] = [];
    t.categoryData = Object.fromEntries(CATS.map(c => [c.id, c]));
    expectForAll('showSearchValueModal hierarchy', c => {
      t.showSearchValueModal(c.id, 'form', 'x');
      return [t.searchModalHierarchy, stripRoot(c.hierarchy)];
    });

    t.showSearchValueModal = (id: number, field: string, label: string) => shown.push([id, field, label]);
    expectForAll('onSpecSearchCellClick label', c => {
      shown.length = 0;
      t.onSpecSearchCellClick({ questionId: c.id, field: 'form' });
      return [shown[0]?.[2], path(c)];
    });

    // Not in categoryData yet → loaded, cached, then shown with the same label.
    t.categoryData = {};
    t.searchStateService = stateStub();
    t.dataService = { getCategoryById: () => of(deep) };
    shown.length = 0;
    t.onSpecSearchCellClick({ questionId: deep.id, field: 'form' });
    expect(shown).toEqual([[deep.id, 'form', path(deep)]]);
    expect(t.searchStateService.getCategoryCache(deep.id)).toBe(deep);
  });
});

// --- Views ------------------------------------------------------------------

describe('Views: category labels (characterization)', () => {
  let v: any;
  beforeEach(() => {
    v = Object.create(ViewsComponent.prototype);
    v.searchStateService = stateStub();
    v.selectedCategories = [];
    v.searchContext = { searches: [] };
  });

  it('getQuestionName / getQuestionHierarchyForCriterion: cache, then selected categories', () => {
    for (const m of ['getQuestionName', 'getQuestionHierarchyForCriterion']) {
      v.searchStateService = stateStub(Object.fromEntries(CATS.map(c => [String(c.id), c])));
      v.selectedCategories = [];
      expectForAll(`${m} via cache`, c => [v[m](c.id), path(c)]);

      v.searchStateService = stateStub();
      v.selectedCategories = CATS;
      expectForAll(`${m} via selected`, c => [v[m](c.id), path(c)]);

      v.searchStateService = stateStub({ [deep.id]: { ...deep, hierarchy: ['RLB', 'From cache'] } });
      expect(v[m](deep.id)).withContext(m).toBe('From cache');

      v.searchStateService = stateStub();
      v.selectedCategories = [nameOnly];
      expect(v[m](nameOnly.id)).withContext(m).toBe(nameOnly.name);
      v.selectedCategories = [];
      expect(v[m](42)).withContext(m).toBe('Question 42');
    }
  });

  it('getQuestionHierarchy(result): own hierarchy, cache, selected; "" without question_id', () => {
    v.searchStateService = stateStub(Object.fromEntries(CATS.map(c => [String(c.id), c])));
    expectForAll('via cache', c => [v.getQuestionHierarchy({ question_id: c.id }), path(c)]);

    v.searchStateService = stateStub();
    v.selectedCategories = CATS;
    expectForAll('via selected', c => [v.getQuestionHierarchy({ question_id: c.id }), path(c)]);

    expect(v.getQuestionHierarchy({ question_id: deep.id, hierarchy: ['RLB', 'On result'] })).toBe('On result');
    v.selectedCategories = [];
    expect(v.getQuestionHierarchy({ question_id: 42 })).toBe('Question 42');
    expect(v.getQuestionHierarchy({})).toBe('');
    expect(v.getQuestionHierarchy(null)).toBe('');
  });

  it('comparison column hierarchy = ancestors (category mode)', () => {
    v.selectedCategories = CATS;
    expectForAll('category mode', c => [v.getComparisonTableColumnHierarchy({ questionId: c.id }), ancestors(c)]);
    v.selectedCategories = [];
    expect(v.getComparisonTableColumnHierarchy({ questionId: 42 })).toEqual([]);
  });

  it('comparison column hierarchy in criteria mode splits the label on " > " (KNOWN BUG: breaks "Fortition v > b" and its 7 questions)', () => {
    v.searchContext = { searches: [{ questionId: 1, fieldName: 'form', value: 'x' }] };
    v.searchStateService = stateStub(Object.fromEntries(CATS.map(c => [String(c.id), c])));
    expectForAll('criteria mode', c => {
      const expected = PATHS_WITH_SEPARATOR.includes(c.id)
        ? stripRoot(c.hierarchy).join(' > ').split(' > ').slice(0, -1) // current, wrong: "Fortition v" becomes an ancestor
        : ancestors(c);
      return [v.getComparisonTableColumnHierarchy({ questionId: c.id }), expected];
    });
  });

  it('categoryChips: name, ancestor prefix, title', () => {
    v.selectedCategories = CATS;
    const chips = v.categoryChips;
    expectForAll('chips', c => {
      const chip = chips[CATS.indexOf(c)];
      return [[chip.label, chip.prefix, chip.title], [c.name, chipPrefix(c), 'Question ' + c.id]];
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
