import { TestBed } from '@angular/core/testing';
import { commonTestProviders } from '../testing/test-providers';

import { UrlStateService } from './url-state.service';

describe('UrlStateService', () => {
  let service: UrlStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [UrlStateService, ...commonTestProviders()] });
    service = TestBed.inject(UrlStateService);
  });

  // Regression for the "compound field deep link finds nothing" bug (27
  // Sept 2026): encodeSearches/parseSearches used raw `|`/`:` as their own
  // delimiters without escaping those characters inside fieldName. A
  // compound cell field like "source|language" injected a stray `|` that
  // collided with the criteria-join separator, so parseSearches silently
  // dropped the whole criterion - a shared URL for such a search always
  // showed "no results", even though the same search worked fine when
  // built by clicking the cell directly (which never round-trips through
  // the URL encoder).
  describe('encodeSearches / parseSearches round-trip', () => {
    it('round-trips a plain field name', () => {
      const criteria = [{ questionId: 42, fieldName: 'phonology', value: 'j-' }];
      const encoded = service.encodeSearches(criteria);
      expect(service.parseSearches(encoded)).toEqual(criteria);
    });

    it('round-trips a pipe-compound field name without dropping the criterion', () => {
      const criteria = [{ questionId: 754, fieldName: 'source|language', value: '' }];
      const encoded = service.encodeSearches(criteria);
      expect(service.parseSearches(encoded)).toEqual(criteria);
    });

    it('round-trips multiple criteria, one of them compound', () => {
      const criteria = [
        { questionId: 754, fieldName: 'source|language', value: 'Inherited' },
        { questionId: 42, fieldName: 'form', value: 'jakh' },
      ];
      const encoded = service.encodeSearches(criteria);
      expect(service.parseSearches(encoded)).toEqual(criteria);
    });

    it('round-trips a field name containing a colon', () => {
      const criteria = [{ questionId: 7, fieldName: 'origin:source', value: 'x' }];
      const encoded = service.encodeSearches(criteria);
      expect(service.parseSearches(encoded)).toEqual(criteria);
    });
  });
});
