import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { UserService } from './user.service';
import { SearchStateService } from './search-state.service';
import { commonTestProviders } from '../testing/test-providers';

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...commonTestProviders()] });
    service = TestBed.inject(UserService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // Regression test: SearchStateService.samplesCache is populated under
  // whatever authorization the current user had (an admin's fetch includes
  // hidden samples). Left uncleared across a sign-out, the next page view in
  // the same tab reused that cache and showed admin-only data — including a
  // sample explicitly marked hidden — to an anonymous visitor.
  // See conversation 2026-09-16.
  it('clears the SearchStateService cache on logout', () => {
    const searchStateService = TestBed.inject(SearchStateService);
    searchStateService.setSamplesCache([{ sample_ref: 'TR-001', visible: 'No' }]);
    expect(searchStateService.getSamplesCache()).not.toBeNull();

    service.logout();

    expect(searchStateService.getSamplesCache()).toBeNull();
  });

  it('clears the SearchStateService cache when an invalid token is cleared', () => {
    const searchStateService = TestBed.inject(SearchStateService);
    searchStateService.setSamplesCache([{ sample_ref: 'TR-001', visible: 'No' }]);

    service.clearInvalidToken();

    expect(searchStateService.getSamplesCache()).toBeNull();
  });

  // Regression test: clearing the cache alone wasn't enough — a hidden
  // sample the admin had *selected* (SearchStateService.selectedSamples /
  // currentSample) stayed selected after logout too, since that lives in a
  // separate BehaviorSubject the cache-clear never touched. See conversation
  // 2026-09-16: "select a hidden sample for tables, log out, go back to
  // tables — the hidden sample is still selected."
  it('clears SearchStateService selection state (selectedSamples, currentSample) on logout', () => {
    const searchStateService = TestBed.inject(SearchStateService);
    searchStateService.updateSampleSelection([{ sample_ref: 'TR-001' }]);
    searchStateService.setCurrentSample({ sample_ref: 'TR-001' });
    expect(searchStateService.hasSearchSelections()).toBeTrue();

    service.logout();

    expect(searchStateService.hasSearchSelections()).toBeFalse();
    expect(searchStateService.getCurrentSample()).toBeNull();
  });

  it('clears SearchStateService selection state when an invalid token is cleared', () => {
    const searchStateService = TestBed.inject(SearchStateService);
    searchStateService.updateSampleSelection([{ sample_ref: 'TR-001' }]);

    service.clearInvalidToken();

    expect(searchStateService.hasSearchSelections()).toBeFalse();
  });

  // Regression test: clearing the cache on logout wasn't the whole story —
  // a page visited anonymously *before* login (e.g. the homepage, or this
  // tab's very first load) can populate samplesCache with the restricted,
  // non-admin sample list. Nothing cleared it on the way IN, so that stale
  // entry survived straight into the freshly-authenticated session: opening
  // the sample picker right after logging in as an admin still showed the
  // anonymous-era list (no hidden samples), even though the login response
  // correctly reported show_hidden_samples: true. Toggling "show hidden"
  // off/on appeared to "fix" it only because that handler happens to clear
  // this same cache before refetching. See conversation 2026-09-16.
  it('clears a stale SearchStateService cache populated before login', () => {
    const searchStateService = TestBed.inject(SearchStateService);
    const httpMock = TestBed.inject(HttpTestingController);
    // Simulate an anonymous page having cached the restricted list already.
    searchStateService.setSamplesCache([{ sample_ref: 'AL-001', visible: 'Yes' }]);

    service.login('mundstein', 'pw').subscribe();
    const req = httpMock.expectOne(r => r.method === 'POST' && r.url.includes('/api/token/'));
    req.flush({
      id: 1, username: 'mundstein', email: 'a@b.com', name: 'Mundstein',
      token: 'abc123', is_global_admin: true, show_hidden_samples: true, project_roles: [],
    });

    expect(searchStateService.getSamplesCache()).toBeNull();
    httpMock.verify();
  });
});
