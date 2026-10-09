import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ResultsComponent } from './results.component';

describe('ResultsComponent', () => {
  let component: ResultsComponent;
  let fixture: ComponentFixture<ResultsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResultsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ResultsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // formatValue just delegates to the shared formatFieldValue (see
  // shared/format-field-value.spec.ts for the full behaviour matrix) — this
  // just pins the delegation itself.
  it('formatValue flattens a nested object instead of showing [object Object]', () => {
    expect(component.formatValue({ source: 'Inherited', language: null })).toBe('Inherited');
  });
});
