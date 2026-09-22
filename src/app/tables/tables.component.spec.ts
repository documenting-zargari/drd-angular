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
});
