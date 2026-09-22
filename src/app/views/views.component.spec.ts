import { ComponentFixture, TestBed } from '@angular/core/testing';
import { commonTestProviders } from '../testing/test-providers';

import { ViewsComponent } from './views.component';

describe('ViewsComponent', () => {
  let component: ViewsComponent;
  let fixture: ComponentFixture<ViewsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ViewsComponent],
      providers: [...commonTestProviders()],
    })
    .compileComponents();

    fixture = TestBed.createComponent(ViewsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // formatValue just delegates to the shared formatFieldValue (see
  // shared/format-field-value.spec.ts for the full behaviour matrix) — this
  // pins the delegation itself, regression for the comparison view showing
  // literal "[object Object]" for origin/base_origin/markers-shaped fields.
  it('formatValue flattens a nested object instead of showing [object Object]', () => {
    expect(component.formatValue({ source: 'Inherited', language: null })).toBe('Inherited');
  });

  // Regression for the map display bug (24 Sept 2026 agenda): a search on
  // an analytical field (e.g. `phonology`) was showing the answer's raw
  // `form` value on the map/legend/table/popup instead, because
  // getAnswerValue always tried a hardcoded ['form','marker','inflection']
  // priority list regardless of which field the search actually matched.
  describe('getAnswerValue', () => {
    it('uses the server-stamped matched_field over the raw form value', () => {
      const result = { question_id: 42, form: 'jakh', phonology: 'j-', matched_field: 'phonology' };
      expect(component.getAnswerValue(result)).toBe('j-');
    });

    it('formats a nested matched_field value instead of [object Object]', () => {
      const result = {
        question_id: 5,
        form: 'nasul',
        source_language: { source: 'Inherited', language: null },
        matched_field: 'source_language',
      };
      expect(component.getAnswerValue(result)).toBe('Inherited');
    });

    it('falls back to the ANSWER_VALUE_FIELDS heuristic when matched_field is absent (plain browsing)', () => {
      const result = { question_id: 7, form: 'nasul' };
      expect(component.getAnswerValue(result)).toBe('nasul');
    });

    it('falls back to the heuristic when matched_field points at an empty value', () => {
      const result = { question_id: 7, form: 'nasul', preposition_origin: '', matched_field: 'preposition_origin' };
      expect(component.getAnswerValue(result)).toBe('nasul');
    });
  });

  // getPrimaryFieldForResult backs the click-to-edit dialog and has the same
  // failure mode as getAnswerValue — it must open on the field that was
  // actually searched, not a hardcoded guess.
  describe('getPrimaryFieldForResult (private, used by openEditDialog)', () => {
    it('edits the matched_field, not form', () => {
      const result = { question_id: 42, form: 'jakh', phonology: 'j-', matched_field: 'phonology' };
      const { fieldName, currentValue } = (component as any).getPrimaryFieldForResult(result);
      expect(fieldName).toBe('phonology');
      expect(currentValue).toBe('j-');
    });

    it('falls back to ANSWER_VALUE_FIELDS when matched_field is absent', () => {
      const result = { question_id: 7, form: 'nasul' };
      const { fieldName, currentValue } = (component as any).getPrimaryFieldForResult(result);
      expect(fieldName).toBe('form');
      expect(currentValue).toBe('nasul');
    });
  });
});
