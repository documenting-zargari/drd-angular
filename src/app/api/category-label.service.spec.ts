import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import categoriesFixture from '../testing/fixtures/categories-beta-20261124.json';
import { commonTestProviders } from '../testing/test-providers';
import { CategoryLabelService } from './category-label.service';
import { DataService } from './data.service';
import { SearchStateService } from './search-state.service';
import {
  CategoryNode,
  categoryAncestorIds,
  categoryAncestors,
  categoryLabel,
  categoryPath,
  categoryPrefix,
} from '../shared/category-labels';

const CATS = categoriesFixture as CategoryNode[];
const anteriority = CATS.find(c => c.name === 'Anteriority' && c.hierarchy?.includes('Adverbial Clauses'))!;

describe('category-labels functions', () => {
  it('format a real category', () => {
    expect(categoryPath(anteriority)).toEqual(['Adverbial Clauses', 'Time', 'Anteriority']);
    expect(categoryLabel(anteriority)).toBe('Adverbial Clauses > Time > Anteriority');
    expect(categoryAncestors(anteriority)).toEqual(['Adverbial Clauses', 'Time']);
    expect(categoryPrefix(anteriority)).toBe('Adverbial Clauses > Time >');
    expect(categoryAncestorIds(anteriority)).toEqual(anteriority.hierarchy_ids!.slice(1, -1));
  });

  it('fall back to the name without a hierarchy, and to nothing without a category', () => {
    const top = { id: 4, name: 'Adjective Derivation', hierarchy: [] };
    expect(categoryLabel(top)).toBe('Adjective Derivation');
    expect(categoryPrefix(top)).toBeUndefined();
    expect(categoryLabel({ id: 1, name: 'RLB', hierarchy: ['RLB'] })).toBe('RLB');
    expect(categoryLabel(null)).toBe('');
    expect(categoryAncestorIds(undefined)).toEqual([]);
  });

  it('keep names containing " > " intact in the path', () => {
    const fortition = CATS.find(c => c.name === 'Fortition v > b')!;
    expect(categoryPath(fortition).at(-1)).toBe('Fortition v > b');
  });
});

describe('CategoryLabelService', () => {
  let labels: CategoryLabelService;
  beforeEach(() => (labels = new CategoryLabelService()));

  it('labels remembered ids and says "Question N" for unknown ones', () => {
    labels.remember(CATS);
    for (const c of CATS) expect(labels.label(c.id)).toBe(categoryLabel(c) || c.name);
    expect(labels.label('' + anteriority.id)).toBe('Adverbial Clauses > Time > Anteriority'); // string ids
    expect(labels.label(424242)).toBe('Question 424242');
    expect(labels.path(424242)).toEqual(['Question 424242']);
  });

  it('never lets a node without hierarchy overwrite one with it', () => {
    labels.remember(anteriority);
    labels.remember({ id: anteriority.id, name: 'Anteriority', parent_id: anteriority.parent_id }); // search-views shape
    labels.remember({ ...anteriority, hierarchy: [], hierarchy_ids: [] }); // categories/search shape
    expect(labels.get(anteriority.id)!.hierarchy).toEqual(anteriority.hierarchy);
    expect(labels.ancestorIds(anteriority.id)).toEqual(anteriority.hierarchy_ids!.slice(1, -1));
  });

  it('reports which ids still need fetching', () => {
    labels.remember(anteriority);
    expect(labels.missing([anteriority.id, String(anteriority.id), 7, 7])).toEqual([7]);
  });
});

describe('DataService records category responses', () => {
  let http: HttpTestingController;
  let data: DataService;
  let labels: CategoryLabelService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...commonTestProviders()] });
    http = TestBed.inject(HttpTestingController);
    data = TestBed.inject(DataService);
    labels = TestBed.inject(CategoryLabelService);
  });
  afterEach(() => http.verify());

  const cases: [string, (d: DataService) => any, RegExp][] = [
    ['getCategoryById', d => d.getCategoryById(anteriority.id), /\/categories\/\d+$/],
    ['getCategoriesByIds', d => d.getCategoriesByIds([anteriority.id]), /\/categories\/batch\//],
    ['getChildCategories', d => d.getChildCategories(1), /\/categories\/\?parent_id=1$/],
    ['getCategories', d => d.getCategories(), /\/categories\/$/],
    ['searchCategories', d => d.searchCategories('ante'), /\/categories\/search\/\?q=ante$/],
    ['searchResearchQuestions', d => d.searchResearchQuestions('ante'), /\/research-questions\/search\//],
    ['getResearchQuestionsByIds', d => d.getResearchQuestionsByIds([anteriority.id]), /\/research-questions\/batch\//],
  ];
  for (const [name, call, url] of cases) {
    it(name, () => {
      call(data).subscribe();
      const req = http.expectOne(r => url.test(r.urlWithParams));
      req.flush(name === 'getCategoryById' ? anteriority : [anteriority]);
      expect(labels.label(anteriority.id)).toBe('Adverbial Clauses > Time > Anteriority');
    });
  }

  it('searchCategories URL-encodes the term', () => {
    data.searchCategories(' v > b & c ').subscribe();
    http.expectOne(r => r.urlWithParams.endsWith('/categories/search/?q=v%20%3E%20b%20%26%20c')).flush([]);
  });

  it('SearchStateService category cache delegates to the label service', () => {
    const state = TestBed.inject(SearchStateService);
    state.setCategoryCache(anteriority.id, anteriority);
    expect(labels.label(anteriority.id)).toBe('Adverbial Clauses > Time > Anteriority');
    expect(state.getCategoryCache(anteriority.id).name).toBe('Anteriority');
    expect(state.getCategoryCache(424242)).toBeNull();
  });
});
