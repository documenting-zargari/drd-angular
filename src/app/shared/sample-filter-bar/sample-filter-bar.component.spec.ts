import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SampleFilterBarComponent } from './sample-filter-bar.component';
import { EMPTY_SAMPLE_FILTERS, SampleFilters } from '../sample-filters';

describe('SampleFilterBarComponent', () => {
  let component: SampleFilterBarComponent;
  let fixture: ComponentFixture<SampleFilterBarComponent>;
  let emitted: SampleFilters[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SampleFilterBarComponent] }).compileComponents();
    fixture = TestBed.createComponent(SampleFilterBarComponent);
    component = fixture.componentInstance;
    component.samples = [{ sample_ref: 'AL-001', dialect_group_name: 'Balkan' }];
    emitted = [];
    component.filtersChange.subscribe(f => emitted.push(f));
    fixture.detectChanges();
  });

  function groupButtons(label: string): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(`[aria-label="${label}"] button`));
  }

  // Regression: source types are mutually exclusive (a sample has exactly
  // one), so the control is single-choice, not combinable checkboxes.
  it('picks one source type at a time, "All" clears it', () => {
    const buttons = groupButtons('Source type');
    expect(buttons.map(b => b.textContent!.trim())).toEqual(['All', 'RMS questionnaire', 'Published source', 'External fieldwork']);
    buttons[2].click();
    expect(emitted[0].source).toBe('Published Source');
    component.filters = emitted[0];
    buttons[3].click();
    expect(emitted[1].source).toBe('External Fieldwork');
    component.filters = emitted[1];
    buttons[0].click();
    expect(emitted[2].source).toBeNull();
  });

  it('offers All / Exclude for migrant dialects and ignores a re-click', () => {
    const buttons = groupButtons('Migrant dialects');
    expect(buttons.map(b => b.textContent!.trim())).toEqual(['All', 'Exclude']);
    buttons[0].click();          // "All" — already current
    buttons[1].click();
    expect(emitted.map(f => f.migrant)).toEqual(['exclude']);
  });

  it('removes a value via its chip and clears everything', () => {
    component.filters = { ...EMPTY_SAMPLE_FILTERS, groups: ['Balkan'], countries: ['AL'] };
    component.removeChip({ value: { kind: 'groups', value: 'Balkan', label: 'Balkan' }, label: 'Balkan' });
    expect(emitted[0]).toEqual({ ...EMPTY_SAMPLE_FILTERS, countries: ['AL'] });
    component.clear();
    expect(emitted[1]).toEqual(EMPTY_SAMPLE_FILTERS);
  });

  it('offers the dialect groups present in the samples', () => {
    expect(component.groupOptions.map(g => g.value)).toEqual(['Balkan']);
  });
});
