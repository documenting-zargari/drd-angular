import { ComponentFixture, TestBed } from '@angular/core/testing';
import { commonTestProviders } from '../../testing/test-providers';

import { SampleSelectionComponent } from './sample-selection.component';

describe('SampleSelectionComponent', () => {
  let component: SampleSelectionComponent;
  let fixture: ComponentFixture<SampleSelectionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SampleSelectionComponent],
      providers: [...commonTestProviders()],
    })
    .compileComponents();

    fixture = TestBed.createComponent(SampleSelectionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('resolveCurrentSampleFromRef (urlControlled mode)', () => {
    // Regression test: a currentSampleRef that doesn't resolve against the
    // already-loaded (authorization-filtered) sample list used to fall back
    // to a bare {sample_ref, dialect_name: ''} placeholder — indistinguishable
    // from a real selection — so a hidden sample someone had picked while
    // admin kept rendering as "selected" with no data after logout, forever
    // (this.samples excludes it, but the placeholder doesn't care). See
    // conversation 2026-09-16.
    it('clears the selection and emits sampleCleared when the ref is not in the loaded sample list', () => {
      component.urlControlled = true;
      component.samples = [{ sample_ref: 'AL-001', dialect_name: 'A', migrant: false }];
      component.currentSampleRef = 'TR-001'; // not authorized / not in the list
      const clearedSpy = jasmine.createSpy('sampleCleared');
      component.sampleCleared.subscribe(clearedSpy);

      component.ngOnChanges({ currentSampleRef: {} as any });

      expect(component.selectedSample).toBeNull();
      expect(clearedSpy).toHaveBeenCalled();
    });

    it('resolves normally when the ref is in the loaded sample list', () => {
      component.urlControlled = true;
      const sample = { sample_ref: 'AL-001', dialect_name: 'A', migrant: false };
      component.samples = [sample];
      component.currentSampleRef = 'AL-001';

      component.ngOnChanges({ currentSampleRef: {} as any });

      expect(component.selectedSample).toBe(sample);
    });

    it('keeps a loading placeholder (does not clear) while samples have not loaded yet', () => {
      component.urlControlled = true;
      component.samples = [];
      component.currentSampleRef = 'TR-001';
      const clearedSpy = jasmine.createSpy('sampleCleared');
      component.sampleCleared.subscribe(clearedSpy);

      component.ngOnChanges({ currentSampleRef: {} as any });

      expect(component.selectedSample?.sample_ref).toBe('TR-001');
      expect(clearedSpy).not.toHaveBeenCalled();
    });
  });
});
