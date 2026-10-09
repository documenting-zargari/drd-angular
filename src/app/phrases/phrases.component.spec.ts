import { ComponentFixture, TestBed } from '@angular/core/testing';
import { commonTestProviders } from '../testing/test-providers';

import { PhrasesComponent, filterPhrasesByField } from './phrases.component';

describe('PhrasesComponent', () => {
  let component: PhrasesComponent;
  let fixture: ComponentFixture<PhrasesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PhrasesComponent],
      providers: [...commonTestProviders()],
    })
    .compileComponents();

    fixture = TestBed.createComponent(PhrasesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

describe('filterPhrasesByField', () => {
  // Regression: the per-sample browse list used to always search both
  // `phrase` (Romani) and `english`, with no way to narrow it — unlike the
  // cross-sample search, which has always had this Romani/English/both
  // selector (24 Sept 2026 agenda: "add this menu to the other list too").
  const phrases = [
    { phrase: 'jakh', english: 'eye' },
    { phrase: 'akh', english: 'watch' },
  ];

  it('matches on both fields by default', () => {
    expect(filterPhrasesByField(phrases, 'akh', 'both')).toEqual(phrases);
    expect(filterPhrasesByField(phrases, 'watch', 'both')).toEqual([phrases[1]]);
  });

  it('restricts to the Romani field only', () => {
    expect(filterPhrasesByField(phrases, 'watch', 'romani')).toEqual([]);
    expect(filterPhrasesByField(phrases, 'akh', 'romani')).toEqual(phrases);
  });

  it('restricts to the English field only', () => {
    expect(filterPhrasesByField(phrases, 'akh', 'english')).toEqual([]);
    expect(filterPhrasesByField(phrases, 'watch', 'english')).toEqual([phrases[1]]);
  });

  it('returns everything unfiltered for a blank query, regardless of field', () => {
    expect(filterPhrasesByField(phrases, '  ', 'romani')).toEqual(phrases);
  });
});
