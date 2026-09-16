import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { commonTestProviders } from '../../testing/test-providers';

import { SampleDetailComponent } from './sample-detail.component';
import { DataService } from '../../api/data.service';

describe('SampleDetailComponent', () => {
  let component: SampleDetailComponent;
  let fixture: ComponentFixture<SampleDetailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SampleDetailComponent],
      providers: [...commonTestProviders()],
    })
    .compileComponents();

    fixture = TestBed.createComponent(SampleDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('edit modal / saveEdit', () => {
    const staleSample = {
      sample_ref: 'TR-001',
      dialect_name: 'Vlax',
      self_attrib_name: '',
      dialect_group_name: 'Balkan',
      location: 'Edirne',
      country_code: 'TR',
      coordinates: { latitude: 41.294479, longitude: 26.524761 },
      visible: 'No',
      migrant: 'No',
      contact_languages: [],
      annotations: {},
    };
    // What the server actually holds by the time the modal is opened —
    // differs from staleSample the way a page left open in a browser tab
    // would go stale after a server-side change.
    const freshSample = { ...staleSample, dialect_name: 'South Vlax', dialect_group_name: 'South Vlax', visible: 'Yes', migrant: 'Yes' };

    // Regression test: openEditModal() used to seed editData straight from
    // whatever this.sample already held, which is only ever fetched once
    // per page visit (ngOnInit). A tab left open across a server-side change
    // would silently resubmit the stale value for every field on save — see
    // conversation 2026-09-16, where this is exactly how Samples/TR-001's
    // 'visible' flag got flipped back after being corrected server-side.
    // The fix: re-fetch the sample when the modal opens, so "send the whole
    // form" (simpler than diffing) is safe again.
    it('openEditModal() re-fetches the sample and seeds the form from the fresh value', () => {
      component.sample = staleSample;
      const dataService = TestBed.inject(DataService);
      spyOn(dataService, 'getSampleById').and.returnValue(of(freshSample));

      component.openEditModal();

      expect(component.sample).toEqual(freshSample);
      expect(component.editData.visible).toBeTrue();
      expect(component.editData.migrant).toBeTrue();
      expect(component.editData.dialect_name).toBe('South Vlax');
      expect(component.showEditModal).toBeTrue();
    });

    it('opens with whatever data is already held if the re-fetch fails', () => {
      component.sample = staleSample;
      const dataService = TestBed.inject(DataService);
      spyOn(dataService, 'getSampleById').and.returnValue(throwError(() => 'network error'));

      component.openEditModal();

      expect(component.showEditModal).toBeTrue();
      expect(component.editData.dialect_name).toBe('Vlax');
    });

    it('saveEdit() sends the full, freshly-seeded form, not a stale value for an untouched field', () => {
      component.sample = staleSample;
      const dataService = TestBed.inject(DataService);
      spyOn(dataService, 'getSampleById').and.returnValue(of(freshSample));
      component.openEditModal(); // seeds editData from freshSample

      // User only touches dialect_group_name; never touches the visible/migrant toggles.
      component.editData.dialect_group_name = 'South Vlax (confirmed)';

      spyOn(component as any, 'updateMapWithSample'); // unrelated Leaflet side effect; not under test
      const updateSpy = spyOn(dataService, 'updateSample').and.returnValue(of(freshSample));

      component.saveEdit();

      expect(updateSpy).toHaveBeenCalledTimes(1);
      const [, payload] = updateSpy.calls.mostRecent().args;
      expect(payload['dialect_group_name']).toBe('South Vlax (confirmed)');
      // Sent because the form always sends everything — but correctly 'Yes',
      // from the fresh fetch, not the stale 'No' this.sample started with.
      expect(payload['visible']).toBe('Yes');
      expect(payload['migrant']).toBe('Yes');
    });
  });
});
