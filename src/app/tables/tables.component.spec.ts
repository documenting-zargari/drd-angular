import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { commonTestProviders } from '../testing/test-providers';

import { TablesComponent } from './tables.component';
import { DataService } from '../api/data.service';
import { UserService } from '../api/user.service';
import { RenderCell, RenderRow, TableSpec } from './table-spec.model';

describe('TablesComponent', () => {
  let component: TablesComponent;
  let fixture: ComponentFixture<TablesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TablesComponent],
      providers: [...commonTestProviders()],
    })
    .compileComponents();

    fixture = TestBed.createComponent(TablesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('spec-driven edit mode', () => {
    const SPEC: TableSpec = {
      schemaVersion: 1,
      title: 'Test',
      sections: [{
        heading: null,
        tables: [{
          kind: 'template',
          caption: null,
          rowHeaderWidth: 1,
          columnHeader: [[{ label: 'Word' }, { label: 'Origin' }]],
          columns: [
            { cell: { field: 'form' } },
            { cell: { field: 'origin.source|origin.language' } },
          ],
          multiAnswer: 'rows',
          rows: [{ labels: ['once'], questionId: 42 }],
        }],
      }],
    };

    function setUpEditableCell(answer: any) {
      const dataService = TestBed.inject(DataService);
      const userService = TestBed.inject(UserService);
      spyOn(userService, 'canEditSample').and.returnValue(true);
      component.selectedSample = { sample_ref: 'AL-001' };
      component.spec = SPEC;
      (component as any).specAnswersByQuestion = new Map([[42, [answer]]]);
      (component as any).updateRenderTables();
      return dataService;
    }

    it('reads a dotted nested field correctly into the edit dialog (regression: legacy read undefined for "origin.source")', () => {
      setUpEditableCell({ _key: 'a1', form: 'varesar', origin: { source: 'Current-L2', language: 'Bulgarian' } });
      const row: RenderRow = component.renderTables[0].bodyRows[0];
      const originCell = row.cells.find(c => c.kind === 'data' && c.field === 'origin.source|origin.language')!;

      (component as any).onSpecEditCellClick(originCell, row);

      expect(component.showEditModal).toBeTrue();
      // Consolidates every field of the row's answer into one dialog (both
      // columns share the row's questionId, per template-row semantics) —
      // matches legacy collectRowFieldNames' behavior.
      expect(component.editModalFields).toEqual([
        { name: 'form', value: 'varesar' },
        { name: 'origin.source', value: 'Current-L2' },
        { name: 'origin.language', value: 'Bulgarian' },
      ]);
    });

    it('saves a dotted nested field as a real nested update, not a literal flat key (regression: legacy PATCHed {"origin.source": v})', () => {
      const dataService = setUpEditableCell({ _key: 'a1', form: 'varesar', origin: { source: 'Current-L2', language: 'Bulgarian' } });
      spyOn(dataService, 'patchAnswer').and.returnValue(of({}));
      component.editModalQuestionId = '42';
      component.editModalAnswerKey = 'a1';

      component.onEditConfirmedMulti([
        { name: 'origin.source', newValue: 'Inherited' },
        { name: 'origin.language', newValue: 'Bulgarian' },
      ]);

      expect(dataService.patchAnswer).toHaveBeenCalledWith('a1', {
        origin: { source: 'Inherited', language: 'Bulgarian' },
      });
    });

    it('creates a new answer with a nested field correctly, not a literal "origin.source" document key', () => {
      const dataService = setUpEditableCell(undefined as any);
      (component as any).specAnswersByQuestion = new Map([[42, []]]);
      spyOn(dataService, 'createAnswer').and.returnValue(of({ _key: 'new1' }));
      spyOn(dataService, 'patchAnswer').and.returnValue(of({}));
      component.editModalQuestionId = '42';
      component.editModalAnswerKey = '';

      component.onEditConfirmedMulti([
        { name: 'origin.source', newValue: 'Inherited' },
        { name: 'origin.language', newValue: '' },
      ]);

      expect(dataService.createAnswer).toHaveBeenCalledWith(42, 'AL-001', 'origin', { source: 'Inherited' } as any);
    });

    it('a single-field pipe-combined cell (no other columns for the same question) still edits both parts', () => {
      setUpEditableCell({ _key: 'a1', form: 'varesar', source: 'Current-L2', language: 'Bulgarian' });
      const cell: RenderCell = {
        kind: 'data', text: '', colspan: 1, rowspan: 1, hidden: false,
        questionId: 42, field: 'source|language', answerKey: 'a1',
      };
      const row: RenderRow = { cells: [cell] };

      (component as any).onSpecEditCellClick(cell, row);

      expect(component.editModalFields).toEqual([
        { name: 'source', value: 'Current-L2' },
        { name: 'language', value: 'Bulgarian' },
      ]);
    });
  });

  describe('spec-driven master-edit mode', () => {
    it('opens the master-links dialog for the clicked cell\'s question id', () => {
      component.masterEditMode = true;
      const cell: RenderCell = {
        kind: 'data', text: '', colspan: 1, rowspan: 1, hidden: false, questionId: 55,
      };

      component.onSpecCellClick(cell, { cells: [cell] });

      expect(component.showMasterLinksModal).toBeTrue();
      expect(component.masterLinksQuestionId).toBe(55);
    });
  });

  describe('search mode empties the spec-driven table', () => {
    // Regression: entering search mode cleared only the legacy answerData,
    // so a table populated from a sample kept showing that sample's answers
    // (the spec renderer reads specAnswersByQuestion).
    const SPEC: TableSpec = {
      schemaVersion: 1,
      title: 'Test',
      sections: [{
        heading: null,
        tables: [{
          kind: 'template',
          caption: null,
          rowHeaderWidth: 1,
          columnHeader: [[{ label: 'Word' }]],
          columns: [{ cell: { field: 'form' } }],
          rows: [{ labels: ['once'], questionId: 42 }],
        }],
      }],
    };
    const cellTexts = () => component.renderTables
      .flatMap(t => t.bodyRows.flatMap(r => r.cells))
      .filter(c => c.kind === 'data')
      .map(c => c.text);
    let getAnswers: jasmine.Spy;

    beforeEach(() => {
      getAnswers = spyOn(TestBed.inject(DataService), 'getAnswers')
        .and.returnValue(of([{ _key: 'a1', question_id: 42, sample: 'AL-001', form: 'jekhvar' }]));
      component.selectedSample = { sample_ref: 'AL-001' };
      component.selectedView = { content: '' };
      component.spec = SPEC;
      (component as any).fetchSpecAnswers();
    });

    it('shows the sample\'s answers in browse mode', () => {
      expect(cellTexts()).toContain('jekhvar');
    });

    it('clears them when entering search mode', () => {
      component.toggleSearchMode();
      expect(cellTexts()).not.toContain('jekhvar');
    });

    it('does not refetch them while in search mode (e.g. on a sample change)', () => {
      component.toggleSearchMode();
      getAnswers.calls.reset();
      (component as any).fetchSpecAnswers();
      expect(getAnswers).not.toHaveBeenCalled();
      expect(cellTexts()).not.toContain('jekhvar');
    });

    it('restores them when leaving search mode', () => {
      component.toggleSearchMode();
      component.toggleSearchMode();
      expect(cellTexts()).toContain('jekhvar');
    });
  });

  describe('spec-driven search mode', () => {
    it('opens the search-value modal with the clicked cell\'s question id and field', () => {
      component.searchMode = true;
      (component as any).categoryData = { 77: { name: 'Test Question', hierarchy: [] } };
      const cell: RenderCell = {
        kind: 'data', text: '', colspan: 1, rowspan: 1, hidden: false,
        questionId: 77, field: 'form',
      };

      component.onSpecCellClick(cell, { cells: [cell] });

      expect(component.showSearchModal).toBeTrue();
      expect(component.searchModalQuestionId).toBe(77);
      expect(component.searchModalFieldName).toBe('form');
    });
  });

  describe('getQuestionHierarchy', () => {
    // Regression: the local categoryData fallback used to be keyed by the
    // answer's legacy `category` field (a per-source-table text label, since
    // dropped from Answers), so it never matched; it's keyed by question_id.
    it('falls back to the locally loaded category for the answer\'s question_id', () => {
      spyOn((component as any).searchStateService, 'getCategoryCache').and.returnValue(undefined);
      (component as any).categoryData = { 77: { name: 'Test Question', hierarchy: ['RLB', 'Nouns', 'Test Question'] } };

      expect(component.getQuestionHierarchy({ question_id: 77, category: 'Final devoicing' }))
        .toBe('Nouns > Test Question');
    });
  });

  describe('onSearchCriterionConfirmed', () => {
    // Regression: an empty-value criterion ("search all answers for this
    // question", e.g. clicking a Phonology/Sound cell and leaving the
    // search value blank) used to be silently downgraded to a plain
    // category selection, discarding which field was clicked — the map
    // and comparison table then fell back to a generic default field
    // instead of the one actually searched (24 Sept 2026 agenda). It must
    // now always be kept as a real criterion so the server can stamp
    // matched_field on each result.
    it('keeps an empty-value criterion as a search criterion, not a category selection', () => {
      const searchStateService = (component as any).searchStateService;
      spyOn(searchStateService, 'addSearchCriterion');
      spyOn(searchStateService, 'updateQuestionSelection');

      component.onSearchCriterionConfirmed({ questionId: 1483, fieldName: 'phonology', value: '' });

      expect(searchStateService.addSearchCriterion).toHaveBeenCalledWith(
        { questionId: 1483, fieldName: 'phonology', value: '' }
      );
      expect(searchStateService.updateQuestionSelection).not.toHaveBeenCalled();
    });

    it('keeps a non-empty-value criterion as a search criterion too', () => {
      const searchStateService = (component as any).searchStateService;
      spyOn(searchStateService, 'addSearchCriterion');

      component.onSearchCriterionConfirmed({ questionId: 1483, fieldName: 'phonology', value: 'j-' });

      expect(searchStateService.addSearchCriterion).toHaveBeenCalledWith(
        { questionId: 1483, fieldName: 'phonology', value: 'j-' }
      );
    });
  });

  describe('executeSearch', () => {
    // Regression/DRY: Tables search mode used to run its own copy of the
    // Search page's query logic (always over every sample). It now hands the
    // criteria and its sample filters to the URL-driven Search page.
    it('navigates to the Search results with criteria, questions and sample filters', () => {
      const urlState = (component as any).urlState;
      const nav = spyOn(urlState, 'navigateMerge').and.returnValue(Promise.resolve(true));
      component.searchContext = { ...component.searchContext, searches: [{ questionId: 7, fieldName: 'form', value: 'x' }] };
      spyOn((component as any).searchStateService, 'getCurrentSelectedCategories').and.returnValue([{ id: 9 }]);
      component.searchFilters = { countries: [], l2: [], groups: ['Balkan'], source: null, migrant: 'exclude' };
      component.searchOperator = 'AND';

      component.executeSearch();

      expect(nav).toHaveBeenCalledWith(['/search'], jasmine.objectContaining({
        searches: urlState.encodeSearches(component.searchContext.searches),
        cats: '9', groups: 'Balkan', migrant: 'exclude', countries: null, tab: 'results', op: 'AND',
      }));
    });

    it('does nothing without criteria', () => {
      const nav = spyOn((component as any).urlState, 'navigateMerge');
      component.searchContext = { ...component.searchContext, searches: [] };
      spyOn((component as any).searchStateService, 'getCurrentSelectedCategories').and.returnValue([]);
      component.executeSearch();
      expect(nav).not.toHaveBeenCalled();
    });

    it('drops the sample filters on leaving search mode', () => {
      spyOn(TestBed.inject(DataService), 'getSamples').and.returnValue(of([]));
      component.toggleSearchMode();
      component.searchFilters = { countries: ['AL'], l2: [], groups: [], source: null, migrant: 'all' };
      component.toggleSearchMode();
      expect(component.searchFilters.countries).toEqual([]);
    });
  });
});
