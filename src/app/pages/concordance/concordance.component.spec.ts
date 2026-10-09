import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { ConcordanceComponent } from './concordance.component';

describe('ConcordanceComponent', () => {
  let component: ConcordanceComponent;
  let fixture: ComponentFixture<ConcordanceComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConcordanceComponent, HttpClientTestingModule],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ConcordanceComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    // Drain incidental requests (e.g. getSamples()) so verify() only checks
    // for the wordlist calls this suite cares about.
    httpMock.match(() => true).forEach(req =>
      req.flush(req.request.url.includes('/samples') ? [] : {}),
    );
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not fetch the full word list on initial load (default view)', () => {
    // Regression: opening /concordance used to eagerly build a word list
    // across the whole corpus, which is expensive and slow. It must stay
    // idle until the user narrows by prefix or asks to see everything.
    const requests = httpMock.match(req => req.url.includes('/wordlist/'));
    expect(requests.length).toBe(0);
  });

  it('fetches the word list only after "Show all words" is clicked', async () => {
    component.showAllWords();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const requests = httpMock.match(req => req.url.includes('/wordlist/'));
    expect(requests.length).toBeGreaterThan(0);
    requests.forEach(req => req.flush({ count: 0, total: 0, results: [] }));
  });
});
