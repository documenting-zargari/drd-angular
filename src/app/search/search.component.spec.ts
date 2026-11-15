import { ComponentFixture, TestBed } from '@angular/core/testing';
import { commonTestProviders } from '../testing/test-providers';

import { of } from 'rxjs';
import { SearchComponent } from './search.component';
import { DataService } from '../api/data.service';
import { EMPTY_SAMPLE_FILTERS } from '../shared/sample-filters';

describe('SearchComponent', () => {
  let component: SearchComponent;
  let fixture: ComponentFixture<SearchComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearchComponent],
      providers: [...commonTestProviders()],
    })
    .compileComponents();

    fixture = TestBed.createComponent(SearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('sample scope sent to the server', () => {
    // The server applies the sample filters (data/sample_scope.py); the page
    // used to fetch every sample's answers and filter by country / L2 in the
    // browser. Explicit sample picks still win over the filters.
    const FILTERS = { ...EMPTY_SAMPLE_FILTERS, groups: ['Balkan'], migrant: 'exclude' as const };
    let getAnswers: jasmine.Spy;
    let searchAnswers: jasmine.Spy;

    beforeEach(() => {
      const data = TestBed.inject(DataService);
      getAnswers = spyOn(data, 'getAnswers').and.returnValue(of([]));
      searchAnswers = spyOn(data, 'searchAnswers').and.returnValue(of([]));
      component.selectedCategories = [{ id: 5, name: 'Q' }];
      component.filters = FILTERS;
    });

    it('sends the filters when no samples are chosen', () => {
      component.search();
      expect(getAnswers).toHaveBeenCalledWith([5], undefined, 'OR', FILTERS);
    });

    it('sends only the chosen samples when there are any', () => {
      component.selectedSamples = [{ sample_ref: 'AL-001' }];
      component.search();
      expect(getAnswers).toHaveBeenCalledWith([5], ['AL-001'], 'OR', undefined);
    });

    it('sends the filters with criteria searches too', () => {
      component.selectedCategories = [];
      component.searches = [{ questionId: 5, fieldName: 'form', value: 'x' }];
      component.search();
      expect(searchAnswers).toHaveBeenCalledWith(component.searches, 'OR', FILTERS);
    });
  });
});
