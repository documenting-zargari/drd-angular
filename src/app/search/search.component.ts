import { Component, OnDestroy, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { DataService, SearchCriterion } from '../api/data.service';
import { SearchStateService } from '../api/search-state.service';
import { UrlStateService } from '../api/url-state.service';
import { UserService } from '../api/user.service';
import { SampleSelectionComponent } from '../shared/sample-selection/sample-selection.component';
import { CountrySelectionComponent } from '../shared/country-selection/country-selection.component';
import { HierarchyPickerComponent } from '../shared/hierarchy-picker/hierarchy-picker.component';
import { resolveCountry } from '../shared/country-codes';
import { Observable, Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
declare var bootstrap: any;

interface SearchUrlState {
  samples: string[];
  countries: string[];
  cats: number[];
  pub: boolean;
  migrant: boolean;
  searches: SearchCriterion[];
  op: 'AND' | 'OR';
}

@Component({
  selector: 'app-search',
  imports: [CommonModule, FormsModule, RouterModule, SampleSelectionComponent, CountrySelectionComponent, HierarchyPickerComponent],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss'
})
export class SearchComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('categorySearchInput') categorySearchInput!: ElementRef;

  // Map-view state (viewport + legend overrides) is only meaningful for the
  // result set it was captured against — rank indices in mapExtra/mapHidden
  // are recomputed fresh per search and get silently reapplied to whatever
  // combinations now occupy those ranks, and a stale lat/lng/zoom points the
  // map at an unrelated place. Both must be cleared whenever the underlying
  // results change (a fresh search), not just on an explicit "clear all".
  private static readonly MAP_VIEW_RESET_PARAMS = {
    lat: null, lng: null, zoom: null, mapExtra: null, mapHidden: null,
  } as const;

  samples: any[] = []
  selectedSamples: any[] = []
  selectedCountries: string[] = []
  selectedCategories: any[] = []
  searches: SearchCriterion[] = []
  searchResult = ''
  results: any[] = []
  status = ''
  categorySearchString = '';
  categorySearchResults: any[] = [];
  pub = false;
  migrant = true;
  searchOperator: 'AND' | 'OR' = 'OR';

  private samplesLoaded = false;
  private pendingSampleRefs: string[] | null = null;
  // Fires search() whenever the criteria-defining params (searches/cats/samples/op)
  // change while tab=results — covers cold start, back/forward, and direct URL edits.
  private lastAutoSearchKey: string | null = null;
  private pendingAutoSearchKey: string | null = null;
  private pendingCategoryFetches = 0;
  private categorySearchSubject = new Subject<string>();
  private categorySearchSubscription?: Subscription;
  private subscriptions: Subscription[] = [];

  constructor(
    private dataService: DataService,
    public searchStateService: SearchStateService,
    private urlState: UrlStateService,
    private userService: UserService,
    private router: Router
  ) {
    this.loadSamples();

    this.subscriptions.push(
      this.userService.userInfo$.subscribe(() => this.loadSamples())
    );
    this.categorySearchSubscription = this.categorySearchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(searchTerm => {
        if (!searchTerm || searchTerm.trim() === '' || searchTerm.trim().length < 2) {
          this.categorySearchResults = [];
          return [];
        }
        return this.dataService.searchCategories(searchTerm);
      })
    ).subscribe({
      next: (categories) => {
        this.categorySearchResults = categories;
      },
      error: (error) => {
        console.error('Error fetching categories:', error);
        this.categorySearchResults = [];
      }
    });
  }

  ngOnInit(): void {
    this.subscriptions.push(
      this.urlState.selectMany<SearchUrlState>({
        samples: raw => this.urlState.parseCSV(raw),
        countries: raw => this.urlState.parseCSV(raw)
          .map(c => c === '__none__' ? c : c.toUpperCase()),
        cats: raw => this.urlState.parseCSV(raw)
          .map(s => parseInt(s, 10))
          .filter(n => Number.isFinite(n)),
        pub: raw => this.urlState.parseBool(raw, false),
        migrant: raw => this.urlState.parseBool(raw, true),
        searches: raw => this.urlState.parseSearches(raw),
        op: raw => raw === 'AND' ? 'AND' : 'OR',
      }).subscribe(vm => {
        this.pub = vm.pub;
        this.migrant = vm.migrant;
        this.selectedCountries = vm.countries;
        this.searchOperator = vm.op;
        this.searches = vm.searches;
        this.searchStateService.updateSearchCriteria(vm.searches);

        // Mark a fresh search as pending whenever the criteria-defining params
        // actually changed while we're on the results tab. Actually running it
        // is gated on samples/categories being resolved (see maybeAutoSearch).
        const snap = this.urlState.snapshot();
        if (snap.get('tab') === 'results' && (snap.get('cats') || snap.get('searches') || snap.get('samples'))) {
          const key = JSON.stringify([snap.get('searches'), snap.get('cats'), snap.get('samples'), snap.get('countries'), snap.get('op')]);
          if (key !== this.lastAutoSearchKey) {
            this.pendingAutoSearchKey = key;
          }
        } else {
          this.pendingAutoSearchKey = null;
        }
        for (const s of vm.searches) {
          if (!this.searchStateService.getCategoryCache(s.questionId)) {
            this.dataService.getCategoryById(s.questionId).subscribe({
              next: cat => { if (cat) this.searchStateService.setCategoryCache(s.questionId, cat); }
            });
          }
        }
        this.applySampleRefsFromUrl(vm.samples);
        this.applyCategoryIdsFromUrl(vm.cats);
      })
    );

    this.subscriptions.push(
      this.searchStateService.searchStatus$.subscribe(status => {
        this.status = status;
      })
    );
  }

  ngAfterViewInit(): void {
    // Bootstrap disposal errors are handled by try-catch in modal event listeners
  }

  private loadSamples(): void {
    this.dataService.getSamples().subscribe(samples => {
      this.samples = samples;
      this.samples.forEach(sample => sample.selected = false);
      this.samples.forEach(sample => sample.migrant = sample.migrant == "Yes" ? true : false);
      this.samplesLoaded = true;
      if (this.pendingSampleRefs !== null) {
        this.applySampleRefsFromUrl(this.pendingSampleRefs);
        this.pendingSampleRefs = null;
      } else {
        // Re-sync selection flags against the currently-selected refs
        const currentRefs = this.selectedSamples.map(s => s.sample_ref);
        this.applySampleRefsFromUrl(currentRefs);
      }
      this.maybeAutoSearch();
    });
  }

  private applySampleRefsFromUrl(refs: string[]): void {
    if (!this.samplesLoaded) {
      this.pendingSampleRefs = refs;
      return;
    }
    this.selectedSamples = refs
      .map(ref => this.samples.find(s => s.sample_ref === ref))
      .filter((s): s is any => !!s);
    const selectedSet = new Set(this.selectedSamples.map(s => s.sample_ref));
    this.samples.forEach(s => s.selected = selectedSet.has(s.sample_ref));
  }

  private applyCategoryIdsFromUrl(ids: number[]): void {
    const wanted = new Set(ids);
    this.selectedCategories = this.selectedCategories.filter(c => wanted.has(Number(c.id)));
    const existingIds = new Set(this.selectedCategories.map(c => Number(c.id)));
    const toFetch = ids.filter(id => !existingIds.has(id));

    if (toFetch.length === 0) {
      this.maybeAutoSearch();
      return;
    }

    this.pendingCategoryFetches += toFetch.length;
    for (const id of toFetch) {
      this.dataService.getCategoryById(id).subscribe({
        next: (category) => {
          this.pendingCategoryFetches = Math.max(0, this.pendingCategoryFetches - 1);
          if (!category) { this.maybeAutoSearch(); return; }
          if (!this.selectedCategories.some(c => Number(c.id) === Number(category.id))) {
            this.selectedCategories.push(category);
            this.selectedCategories.sort((a, b) => Number(a.id) - Number(b.id));
          }
          this.maybeAutoSearch();
        },
        error: () => {
          this.pendingCategoryFetches = Math.max(0, this.pendingCategoryFetches - 1);
          this.status = `Error: Category ${id} could not be loaded.`;
          this.maybeAutoSearch();
        }
      });
    }
  }

  private maybeAutoSearch(): void {
    if (this.pendingAutoSearchKey === null) return;
    if (!this.samplesLoaded) return;
    if (this.pendingCategoryFetches > 0) return;
    this.lastAutoSearchKey = this.pendingAutoSearchKey;
    this.pendingAutoSearchKey = null;
    this.search();
  }

  openCategoryModal(): void {
    setTimeout(() => {
      const modalElement = document.getElementById('chooseCategoryModal');
      if (modalElement) {
        const modal = new (window as any).bootstrap.Modal(modalElement);
        modal.show();
      }
    }, 0);
  }

  openSearchCategoryModal(): void {
    setTimeout(() => {
      const modalElement = document.getElementById('searchCategoryModal');
      if (modalElement) {
        const modal = new (window as any).bootstrap.Modal(modalElement);
        modal.show();
        setTimeout(() => {
          if (this.categorySearchInput) {
            this.categorySearchInput.nativeElement.focus();
          }
        }, 100);
      }
    }, 0);
  }

  onSearchSampleToggled(sample: any): void {
    this.toggleSample(sample);
  }

  toggleSample(sample: any): void {
    const alreadySelected = this.selectedSamples.some(s => s.sample_ref === sample.sample_ref);
    const newRefs = alreadySelected
      ? this.selectedSamples.filter(s => s.sample_ref !== sample.sample_ref).map(s => s.sample_ref)
      : [...this.selectedSamples.map(s => s.sample_ref), sample.sample_ref];
    this.urlState.patch({ samples: newRefs.join(',') || null }, { replaceUrl: true });
  }

  onCountryToggled(code: string): void {
    const selected = this.selectedCountries.includes(code)
      ? this.selectedCountries.filter(c => c !== code)
      : [...this.selectedCountries, code];
    this.urlState.patch({ countries: selected.join(',') || null }, { replaceUrl: true });
  }

  removeCountry(code: string): void {
    this.onCountryToggled(code);
  }

  countryLabel(code: string): string {
    if (code === '__none__') return 'Unknown';
    const info = resolveCountry(code);
    return info ? `${info.flag ? info.flag + ' ' : ''}${info.name}` : code;
  }

  /**
   * sample_refs of every loaded sample whose normalised country is in the
   * selected set ('__none__' matches samples with no resolvable country).
   * Empty when no countries are selected.
   */
  private countryScopedSampleRefs(): string[] {
    if (this.selectedCountries.length === 0) return [];
    const wanted = new Set(this.selectedCountries);
    return this.samples
      .filter(s => {
        const info = resolveCountry(s.country_code);
        return info ? wanted.has(info.code) : wanted.has('__none__');
      })
      .map(s => s.sample_ref);
  }

  selectCategory(category: any): void {
    const ids = new Set(this.selectedCategories.map(c => Number(c.id)));
    ids.add(Number(category.id));
    this.writeCategoryIds([...ids]);
  }

  deselectCategory(category: any): void {
    const ids = this.selectedCategories
      .map(c => Number(c.id))
      .filter(id => id !== Number(category.id));
    this.writeCategoryIds(ids);
  }

  private writeCategoryIds(ids: number[]): void {
    ids.sort((a, b) => a - b);
    this.urlState.patch({ cats: ids.join(',') || null }, { replaceUrl: true });
  }

  isCategorySelected(category: any): boolean {
    return this.selectedCategories.some(c => Number(c.id) === Number(category.id));
  }

  toggleCategory(category: any): void {
    if (this.isCategorySelected(category)) {
      this.deselectCategory(category);
    } else {
      this.selectCategory(category);
    }
  }

  get selectedQuestionIds(): number[] {
    return this.selectedCategories.map(c => Number(c.id));
  }

  onQuestionsPicked(nodes: any[]): void {
    this.writeCategoryIds(nodes.map(n => Number(n.id)));
  }

  onPubToggled(value: boolean): void {
    this.urlState.patch({ pub: value ? '1' : null }, { replaceUrl: true });
  }

  onMigrantToggled(value: boolean): void {
    // default true; emit '0' only when disabled
    this.urlState.patch({ migrant: value ? null : '0' }, { replaceUrl: true });
  }

  search(): void {
    this.results = [];
    this.status = '';

    const questionIds = this.selectedCategories.map(c => parseInt(c.id, 10));
    const explicitRefs = this.selectedSamples.map(s => s.sample_ref);
    const countryRefs = this.countryScopedSampleRefs();
    // Explicit sample picks win; otherwise fall back to the country-derived
    // subset; an empty list means "all samples".
    const sampleRefs = explicitRefs.length > 0 ? explicitRefs : countryRefs;
    const criteria = this.searches;

    if (questionIds.length === 0 && criteria.length === 0) {
      this.status = 'Please provide either search criteria or select at least one category to search.';
      this.searchStateService.updateSearchResults([], this.status);
      return;
    }

    // searchAnswers has no sample-scope parameter, so scope its results here.
    const countryScope = (explicitRefs.length === 0 && countryRefs.length > 0)
      ? new Set(countryRefs)
      : null;
    const scopeCriteriaAnswers = (answers: any[]): any[] =>
      countryScope ? answers.filter(a => countryScope.has(a.sample)) : answers;

    this.searchStateService.updateSampleSelection(this.selectedSamples);
    this.searchStateService.updateQuestionSelection(this.selectedCategories);
    this.searchStateService.updateSearchCriteria(criteria);

    // Criteria-only → searchAnswers
    if (criteria.length > 0 && questionIds.length === 0) {
      this.dataService.searchAnswers(criteria, this.searchOperator).subscribe({
        next: answers => this.handleSearchResults(scopeCriteriaAnswers(answers), 'searchAnswers', { criteria, sampleRefs }),
        error: () => this.handleSearchError(),
      });
      return;
    }

    // Questions-only → getAnswers
    if (criteria.length === 0) {
      const effectiveSampleRefs = sampleRefs.length > 0 ? sampleRefs : undefined;
      this.dataService.getAnswers(questionIds, effectiveSampleRefs, this.searchOperator).subscribe({
        next: answers => this.handleSearchResults(answers, 'getAnswers', { questionIds, sampleRefs }),
        error: () => this.handleSearchError(),
      });
      return;
    }

    // Mixed → execute both and merge
    const questions$ = this.dataService.getAnswers(questionIds, sampleRefs.length > 0 ? sampleRefs : undefined, this.searchOperator);
    const searches$: Observable<any[]> = this.dataService.searchAnswers(criteria, this.searchOperator);
    questions$.subscribe({
      next: (qAnswers) => {
        searches$.subscribe({
          next: (sAnswers) => {
            const scopedS = scopeCriteriaAnswers(sAnswers);
            const combined = [...qAnswers, ...scopedS];
            this.handleSearchResults(combined, 'getAnswers', {
              mixed: true, questionIds, sampleRefs, criteria,
              questionCount: qAnswers.length, criteriaCount: scopedS.length,
            });
          },
          error: () => this.handleSearchError(),
        });
      },
      error: () => this.handleSearchError(),
    });
  }

  private handleSearchResults(
    answers: any[],
    method: 'getAnswers' | 'searchAnswers',
    ctx: {
      questionIds?: number[];
      sampleRefs?: string[];
      criteria?: SearchCriterion[];
      mixed?: boolean;
      questionCount?: number;
      criteriaCount?: number;
    }
  ): void {
    if (answers.length === 0) {
      this.status = `No answers found for the search.`;
      // Reset map-view state before publishing results: views.component reads
      // the URL synchronously off the results notification, so patching first
      // (and waiting for the navigation to land) avoids hydrating the new
      // (empty) result set against stale mapExtra/mapHidden/viewport params.
      this.urlState.patch({ ...SearchComponent.MAP_VIEW_RESET_PARAMS }, { replaceUrl: false }).then(() => {
        this.searchStateService.updateSearchResults([], this.status, null);
      });
      return;
    }
    this.searchResult = JSON.stringify(answers, null, 2);
    this.results = answers;

    if (ctx.mixed) {
      this.status = `Found ${answers.length} answers (${ctx.questionCount} from questions, ${ctx.criteriaCount} from criteria).`;
    } else if (ctx.criteria && ctx.criteria.length > 0) {
      const word = ctx.criteria.length === 1 ? 'criterion' : 'criteria';
      this.status = `Found ${answers.length} answers for ${ctx.criteria.length} search ${word}. `;
      const uniqueSamples = new Set(answers.map((a: any) => a.sample));
      this.status += uniqueSamples.size === 1
        ? `Searched in sample ${[...uniqueSamples][0]}.`
        : `Searched in ${uniqueSamples.size} samples.`;
    } else if (ctx.questionIds) {
      const questionText = ctx.questionIds.length === 1
        ? `question ID ${ctx.questionIds[0]}`
        : `${ctx.questionIds.length} questions`;
      this.status = `Found ${answers.length} answers for ${questionText}. `;
      const sampleRefs = ctx.sampleRefs ?? [];
      if (sampleRefs.length === 1) {
        this.status += `Sample: ${sampleRefs[0]}`;
      } else if (sampleRefs.length > 1) {
        const distinctSamples = new Set(answers.map((a: any) => a.sample));
        this.status += `Samples: ${distinctSamples.size} distinct samples displayed.`;
      } else {
        this.status += `All samples selected.`;
      }
    }

    const op = this.searchOperator === 'AND' ? 'AND' : null;
    // Same ordering concern as the zero-results branch above: patch (and
    // await) the URL reset before publishing results, so the map-view
    // hydration triggered by updateSearchResults sees the reset params
    // rather than the previous search's stale ones.
    this.urlState.patch({
      tab: 'results', page: null, op,
      ...SearchComponent.MAP_VIEW_RESET_PARAMS,
    }, { replaceUrl: false }).then(() => {
      this.searchStateService.updateSearchResults(this.results, this.status, method);
    });
  }

  private handleSearchError(): void {
    this.status = 'Search failed. Please try again later.';
    this.searchStateService.updateSearchResults([], this.status, null);
  }

  searchCategories() {
    this.categorySearchSubject.next(this.categorySearchString);
  }

  focusCategorySearch() {
    setTimeout(() => {
      if (this.categorySearchInput) {
        this.categorySearchInput.nativeElement.focus();
      }
    }, 100);
  }

  clearAllSelections(): void {
    this.samples.forEach(s => s.selected = false);
    this.selectedSamples = [];
    this.selectedCountries = [];
    this.selectedCategories = [];
    this.searches = [];
    this.pub = false;
    this.migrant = true;
    this.searchOperator = 'OR';
    this.status = '';
    this.results = [];
    this.categorySearchString = '';
    this.categorySearchResults = [];

    // Await the navigation before clearing search state: clearSearchState()
    // synchronously triggers views.component's results subscriber, which
    // reads the URL back out (hydrateMapExtraFromUrl -> syncMapExtraToUrl)
    // and may itself patch mapExtra/mapHidden. Since patch() merges onto
    // whatever route snapshot is current at dispatch time, firing that second
    // patch before this one lands would re-merge in the params being cleared
    // here — leaving stale samples/cats/etc. in the URL.
    this.urlState.patch({
      samples: null,
      countries: null,
      cats: null,
      pub: null,
      migrant: null,
      searches: null,
      op: null,
      page: null,
      ...SearchComponent.MAP_VIEW_RESET_PARAMS,
    }, { replaceUrl: false }).then(() => {
      this.searchStateService.clearSearchState();
    });
  }

  getStatusClass(): string {
    if (!this.status) return '';

    if (this.status.includes('Invalid') ||
        this.status.includes('Please select') ||
        this.status.includes('failed') ||
        this.status.includes('No answers found') ||
        this.status.includes('Error')) {
      return 'alert-danger';
    }

    if (this.status.includes('Found')) {
      return 'alert-success';
    }

    return 'alert-info';
  }

  ngOnDestroy() {
    if (this.categorySearchSubscription) {
      this.categorySearchSubscription.unsubscribe();
    }
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }
}
