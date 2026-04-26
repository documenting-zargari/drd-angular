import { Component, OnDestroy, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { DataService, SearchCriterion } from '../api/data.service';
import { SearchStateService } from '../api/search-state.service';
import { UrlStateService } from '../api/url-state.service';
import { UserService } from '../api/user.service';
import { SampleSelectionComponent } from '../shared/sample-selection/sample-selection.component';
import { Observable, Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
declare var bootstrap: any;

interface SearchUrlState {
  samples: string[];
  cats: number[];
  pub: boolean;
  migrant: boolean;
  searches: SearchCriterion[];
}

@Component({
  selector: 'app-search',
  imports: [CommonModule, FormsModule, RouterModule, SampleSelectionComponent],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss'
})
export class SearchComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('categorySearchInput') categorySearchInput!: ElementRef;

  samples: any[] = []
  selectedSamples: any[] = []
  categories: any[] = []
  selectedCategories: any[] = []
  searches: SearchCriterion[] = []
  expandedCategories: Set<number> = new Set()
  loadingCategories: Set<number> = new Set()
  searchResult = ''
  results: any[] = []
  status = ''
  categorySearchString = '';
  categorySearchResults: any[] = [];
  pub = false;
  migrant = true;

  private samplesLoaded = false;
  private pendingSampleRefs: string[] | null = null;
  private autoSearch = false;        // fires search() once on cold start with tab=results
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
    this.dataService.getCategories().subscribe(categories => {
      this.categories = this.initializeCategoriesHierarchy(categories)
    })

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
    const snap = this.urlState.snapshot();
    if (snap.get('tab') === 'results' && (snap.get('cats') || snap.get('searches') || snap.get('samples'))) {
      this.autoSearch = true;
    }

    this.subscriptions.push(
      this.urlState.selectMany<SearchUrlState>({
        samples: raw => this.urlState.parseCSV(raw),
        cats: raw => this.urlState.parseCSV(raw)
          .map(s => parseInt(s, 10))
          .filter(n => Number.isFinite(n)),
        pub: raw => this.urlState.parseBool(raw, false),
        migrant: raw => this.urlState.parseBool(raw, true),
        searches: raw => this.urlState.parseSearches(raw),
      }).subscribe(vm => {
        this.pub = vm.pub;
        this.migrant = vm.migrant;
        this.searches = vm.searches;
        this.searchStateService.updateSearchCriteria(vm.searches);
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
    if (!this.autoSearch) return;
    if (!this.samplesLoaded) return;
    if (this.pendingCategoryFetches > 0) return;
    this.autoSearch = false;
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

  expandCategory(category: any): void {
    if (this.expandedCategories.has(category.id)) {
      this.expandedCategories.delete(category.id);
      this.collapseCategory(category);
    } else {
      this.expandedCategories.add(category.id);
      if (!category.children || category.children.length === 0) {
        this.loadChildCategories(category);
      }
    }
  }

  private collapseCategory(category: any): void {
    if (category.children) {
      category.children.forEach((child: any) => {
        if (this.expandedCategories.has(child.id)) {
          this.expandedCategories.delete(child.id);
          this.collapseCategory(child);
        }
      });
    }
  }

  private loadChildCategories(category: any): void {
    if (this.loadingCategories.has(category.id)) {
      return;
    }

    this.loadingCategories.add(category.id);

    if (category.has_children) {
      this.dataService.getChildCategories(category.id).subscribe({
        next: (children) => {
          category.children = this.initializeCategoriesHierarchy(children);
          this.loadingCategories.delete(category.id);
        },
        error: (error) => {
          console.error('Error loading child categories:', error);
          this.loadingCategories.delete(category.id);
        }
      });
    } else {
      this.loadingCategories.delete(category.id);
    }
  }

  private initializeCategoriesHierarchy(categories: any[]): any[] {
    return categories.map(category => ({
      ...category,
      children: [],
      level: category.level || 0
    }));
  }

  isCategoryExpanded(category: any): boolean {
    return this.expandedCategories.has(category.id);
  }

  isCategoryLoading(category: any): boolean {
    return this.loadingCategories.has(category.id);
  }

  isCategorySelected(category: any): boolean {
    return this.selectedCategories.some(c => Number(c.id) === Number(category.id));
  }

  getFlattenedCategories(categories: any[] = this.categories, level: number = 0): any[] {
    const result: any[] = [];

    for (const category of categories) {
      category.level = level;
      result.push(category);

      if (this.isCategoryExpanded(category) && category.children && category.children.length > 0) {
        result.push(...this.getFlattenedCategories(category.children, level + 1));
      }
    }

    return result;
  }

  toggleCategory(category: any): void {
    if (this.isCategorySelected(category)) {
      this.deselectCategory(category);
    } else {
      this.selectCategory(category);
    }
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
    const sampleRefs = this.selectedSamples.map(s => s.sample_ref);
    const criteria = this.searches;

    if (questionIds.length === 0 && criteria.length === 0) {
      this.status = 'Please provide either search criteria or select at least one category to search.';
      this.searchStateService.updateSearchResults([], this.status);
      return;
    }

    this.searchStateService.updateSampleSelection(this.selectedSamples);
    this.searchStateService.updateQuestionSelection(this.selectedCategories);
    this.searchStateService.updateSearchCriteria(criteria);

    // Criteria-only → searchAnswers
    if (criteria.length > 0 && questionIds.length === 0) {
      this.dataService.searchAnswers(criteria).subscribe({
        next: answers => this.handleSearchResults(answers, 'searchAnswers', { criteria, sampleRefs }),
        error: () => this.handleSearchError(),
      });
      return;
    }

    // Questions-only → getAnswers
    if (criteria.length === 0) {
      const effectiveSampleRefs = sampleRefs.length > 0 ? sampleRefs : undefined;
      this.dataService.getAnswers(questionIds, effectiveSampleRefs).subscribe({
        next: answers => this.handleSearchResults(answers, 'getAnswers', { questionIds, sampleRefs }),
        error: () => this.handleSearchError(),
      });
      return;
    }

    // Mixed → execute both and merge
    const questions$ = this.dataService.getAnswers(questionIds, sampleRefs.length > 0 ? sampleRefs : undefined);
    const searches$: Observable<any[]> = this.dataService.searchAnswers(criteria);
    questions$.subscribe({
      next: (qAnswers) => {
        searches$.subscribe({
          next: (sAnswers) => {
            const combined = [...qAnswers, ...sAnswers];
            this.handleSearchResults(combined, 'getAnswers', {
              mixed: true, questionIds, sampleRefs, criteria,
              questionCount: qAnswers.length, criteriaCount: sAnswers.length,
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
      this.searchStateService.updateSearchResults([], this.status, null);
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

    this.searchStateService.updateSearchResults(this.results, this.status, method);
    this.urlState.patch({ tab: 'results', page: null }, { replaceUrl: false });
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
    this.selectedCategories = [];
    this.searches = [];
    this.pub = false;
    this.migrant = true;
    this.status = '';
    this.results = [];
    this.expandedCategories = new Set();
    this.categorySearchString = '';
    this.categorySearchResults = [];

    this.urlState.patch({
      samples: null,
      cats: null,
      pub: null,
      migrant: null,
      searches: null,
      page: null,
      lat: null,
      lng: null,
      zoom: null,
    }, { replaceUrl: false });
    this.searchStateService.clearSearchState();
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
