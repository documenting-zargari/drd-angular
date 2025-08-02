import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SearchCriterion, SearchContext } from './data.service';

export interface FilterStates {
  pub: boolean;
  migrant: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class SearchStateService {
  private selectedSamplesSubject = new BehaviorSubject<any[]>([]);
  private selectedCategoriesSubject = new BehaviorSubject<any[]>([]);
  private searchResultsSubject = new BehaviorSubject<any[]>([]);
  private searchStatusSubject = new BehaviorSubject<string>('');
  private searchStringSubject = new BehaviorSubject<string>('');
  private expandedCategoriesSubject = new BehaviorSubject<Set<number>>(new Set());
  private filterStatesSubject = new BehaviorSubject<FilterStates>({ pub: false, migrant: true });
  
  // Global selected sample for phrases/transcriptions
  private currentSampleSubject = new BehaviorSubject<any>(null);
  
  // Unified search context - single source of truth
  private searchContextSubject = new BehaviorSubject<SearchContext>({
    // Search Configuration
    selectedQuestions: [],
    selectedSamples: [],
    searches: [],
    
    // Search Execution State
    searchResults: [],
    searchStatus: '',
    searchString: '',
    isLoading: false,
    
    // Search Type & Context
    searchType: 'none',
    lastSearchMethod: null,
    
    // Table Context (for navigation)
    selectedView: null,
    selectedCategory: null,
    currentSample: null
  });

  // Global audio playback state
  private currentAudio: HTMLAudioElement | null = null;
  private isAudioPlayingSubject = new BehaviorSubject<boolean>(false);
  private currentAudioUrlSubject = new BehaviorSubject<string | null>(null);

  // Cache for data to avoid redundant API calls
  private samplesCache: any[] | null = null;
  private phrasesCache: Map<string, any[]> = new Map();
  private transcriptionsCache: Map<string, any[]> = new Map();
  private viewsCache: any[] | null = null;
  private transcriptionCountsCache: any[] | null = null;
  private categoryCache: { [key: string]: any } = {};

  // Unified context observable - primary interface
  searchContext$: Observable<SearchContext> = this.searchContextSubject.asObservable();

  // Computed observables for backward compatibility
  selectedSamples$: Observable<any[]> = this.searchContext$.pipe(map(ctx => ctx.selectedSamples));
  selectedCategories$: Observable<any[]> = this.searchContext$.pipe(map(ctx => ctx.selectedQuestions));
  searchResults$: Observable<any[]> = this.searchContext$.pipe(map(ctx => ctx.searchResults));
  searchStatus$: Observable<string> = this.searchContext$.pipe(map(ctx => ctx.searchStatus));
  searchString$: Observable<string> = this.searchContext$.pipe(map(ctx => ctx.searchString));
  currentSample$: Observable<any> = this.searchContext$.pipe(map(ctx => ctx.currentSample));

  // Legacy observables (keep for gradual migration)
  expandedCategories$: Observable<Set<number>> = this.expandedCategoriesSubject.asObservable();
  filterStates$: Observable<FilterStates> = this.filterStatesSubject.asObservable();
  isAudioPlaying$: Observable<boolean> = this.isAudioPlayingSubject.asObservable();
  currentAudioUrl$: Observable<string | null> = this.currentAudioUrlSubject.asObservable();

  constructor() { }

  // UNIFIED UPDATE METHODS - Use these for new code
  updateQuestionSelection(questions: any[]): void {
    const currentContext = this.searchContextSubject.value;
    const updatedContext: SearchContext = {
      ...currentContext,
      selectedQuestions: [...questions],
      searchType: this.determineSearchType([...questions], currentContext.selectedSamples, currentContext.searches)
    };
    this.searchContextSubject.next(updatedContext);
    
    // Sync legacy state for backward compatibility
    this.selectedCategoriesSubject.next([...questions]);
  }

  updateSampleSelection(samples: any[]): void {
    const currentContext = this.searchContextSubject.value;
    const updatedContext: SearchContext = {
      ...currentContext,
      selectedSamples: [...samples],
      searchType: this.determineSearchType(currentContext.selectedQuestions, [...samples], currentContext.searches)
    };
    this.searchContextSubject.next(updatedContext);
    
    // Sync legacy state for backward compatibility
    this.selectedSamplesSubject.next([...samples]);
  }

  updateSearchCriteria(criteria: SearchCriterion[]): void {
    const currentContext = this.searchContextSubject.value;
    const updatedContext: SearchContext = {
      ...currentContext,
      searches: [...criteria],
      searchType: this.determineSearchType(currentContext.selectedQuestions, currentContext.selectedSamples, [...criteria])
    };
    this.searchContextSubject.next(updatedContext);
  }

  updateSearchResults(results: any[], status: string, method: 'getAnswers' | 'searchAnswers' | null = null): void {
    const currentContext = this.searchContextSubject.value;
    const updatedContext: SearchContext = {
      ...currentContext,
      searchResults: [...results],
      searchStatus: status,
      lastSearchMethod: method,
      isLoading: false
    };
    this.searchContextSubject.next(updatedContext);
    
    // Sync legacy state for backward compatibility
    this.searchResultsSubject.next([...results]);
    this.searchStatusSubject.next(status);
  }

  updateSearchString(searchString: string): void {
    const currentContext = this.searchContextSubject.value;
    const updatedContext: SearchContext = {
      ...currentContext,
      searchString: searchString
    };
    this.searchContextSubject.next(updatedContext);
    
    // Sync legacy state for backward compatibility
    this.searchStringSubject.next(searchString);
  }

  setLoadingState(isLoading: boolean): void {
    const currentContext = this.searchContextSubject.value;
    const updatedContext: SearchContext = {
      ...currentContext,
      isLoading: isLoading
    };
    this.searchContextSubject.next(updatedContext);
  }

  private determineSearchType(questions: any[], samples: any[], criteria: SearchCriterion[]): 'questions' | 'criteria' | 'mixed' | 'none' {
    const hasQuestions = questions.length > 0;
    const hasCriteria = criteria.length > 0;
    
    if (hasQuestions && hasCriteria) return 'mixed';
    if (hasCriteria) return 'criteria';
    if (hasQuestions) return 'questions';
    return 'none';
  }

  // LEGACY UPDATE METHODS - Deprecated, use unified methods above
  updateSelectedSamples(samples: any[]): void {
    this.selectedSamplesSubject.next([...samples]);
  }

  updateSelectedCategories(categories: any[]): void {
    this.selectedCategoriesSubject.next([...categories]);
  }


  updateExpandedCategories(expandedCategories: Set<number>): void {
    this.expandedCategoriesSubject.next(new Set(expandedCategories));
  }

  updateFilterStates(filterStates: FilterStates): void {
    this.filterStatesSubject.next({ ...filterStates });
  }

  updateSearchStatus(status: string): void {
    this.searchStatusSubject.next(status);
  }

  // Getter methods for current values
  getCurrentSelectedSamples(): any[] {
    return this.selectedSamplesSubject.value;
  }

  getCurrentSelectedCategories(): any[] {
    return this.selectedCategoriesSubject.value;
  }

  getCurrentSearchResults(): any[] {
    return this.searchResultsSubject.value;
  }

  getCurrentSearchString(): string {
    return this.searchStringSubject.value;
  }

  getCurrentExpandedCategories(): Set<number> {
    return this.expandedCategoriesSubject.value;
  }

  getCurrentFilterStates(): FilterStates {
    return this.filterStatesSubject.value;
  }

  // Global sample methods
  setCurrentSample(sample: any): void {
    this.currentSampleSubject.next(sample);
    // Update unified search context
    const currentContext = this.searchContextSubject.value;
    this.searchContextSubject.next({
      ...currentContext,
      currentSample: sample,
      searchType: currentContext.searches.length > 0 ? 'mixed' : 'questions'
    });
  }

  getCurrentSample(): any {
    return this.currentSampleSubject.value;
  }

  clearCurrentSample(): void {
    this.currentSampleSubject.next(null);
    const currentContext = this.searchContextSubject.value;
    this.searchContextSubject.next({
      ...currentContext,
      currentSample: null,
      searchType: currentContext.searches.length > 0 ? 'criteria' : 'none'
    });
  }

  // Unified search context methods
  getSearchContext(): SearchContext {
    return this.searchContextSubject.value;
  }

  setSearchContext(context: SearchContext): void {
    this.searchContextSubject.next(context);
    // Sync with legacy subjects for backward compatibility
    this.currentSampleSubject.next(context.currentSample);
    this.selectedSamplesSubject.next(context.selectedSamples);
    this.selectedCategoriesSubject.next(context.selectedQuestions);
    this.searchResultsSubject.next(context.searchResults);
    this.searchStatusSubject.next(context.searchStatus);
    this.searchStringSubject.next(context.searchString);
  }

  addSearchCriterion(criterion: SearchCriterion): void {
    const currentContext = this.searchContextSubject.value;
    const updatedCriteria = [...currentContext.searches, criterion];
    const updatedContext: SearchContext = {
      ...currentContext,
      searches: updatedCriteria,
      searchType: this.determineSearchType(currentContext.selectedQuestions, currentContext.selectedSamples, updatedCriteria)
    };
    this.searchContextSubject.next(updatedContext);
  }

  removeSearchCriterion(index: number): void {
    const currentContext = this.searchContextSubject.value;
    const updatedCriteria = currentContext.searches.filter((_, i) => i !== index);
    const updatedContext: SearchContext = {
      ...currentContext,
      searches: updatedCriteria,
      searchType: this.determineSearchType(currentContext.selectedQuestions, currentContext.selectedSamples, updatedCriteria)
    };
    this.searchContextSubject.next(updatedContext);
  }

  clearSearchCriteria(): void {
    const currentContext = this.searchContextSubject.value;
    const updatedContext: SearchContext = {
      ...currentContext,
      searches: [],
      searchType: this.determineSearchType(currentContext.selectedQuestions, currentContext.selectedSamples, [])
    };
    this.searchContextSubject.next(updatedContext);
  }

  hasSearchCriteria(): boolean {
    return this.searchContextSubject.value.searches.length > 0;
  }

  // Global audio management methods
  playAudio(audioUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Stop any currently playing audio
      this.stopCurrentAudio();

      // Create new audio instance
      this.currentAudio = new Audio(audioUrl);
      this.currentAudioUrlSubject.next(audioUrl);
      
      this.currentAudio.onloadstart = () => {
        this.isAudioPlayingSubject.next(true);
      };

      this.currentAudio.onended = () => {
        this.isAudioPlayingSubject.next(false);
        this.currentAudioUrlSubject.next(null);
        this.currentAudio = null;
        resolve();
      };

      this.currentAudio.onerror = () => {
        this.isAudioPlayingSubject.next(false);
        this.currentAudioUrlSubject.next(null);
        this.currentAudio = null;
        reject(new Error('Audio failed to load'));
      };

      this.currentAudio.play().catch((err: any) => {
        this.isAudioPlayingSubject.next(false);
        this.currentAudioUrlSubject.next(null);
        this.currentAudio = null;
        reject(err);
      });
    });
  }

  stopCurrentAudio(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
      this.isAudioPlayingSubject.next(false);
      this.currentAudioUrlSubject.next(null);
    }
  }

  getCurrentAudioUrl(): string | null {
    return this.currentAudioUrlSubject.value;
  }

  isAudioPlaying(): boolean {
    return this.isAudioPlayingSubject.value;
  }

  // Cache management methods
  getSamplesCache(): any[] | null {
    return this.samplesCache;
  }

  setSamplesCache(samples: any[]): void {
    this.samplesCache = samples;
  }

  getPhrasesCache(sampleRef: string): any[] | null {
    return this.phrasesCache.get(sampleRef) || null;
  }

  setPhrasesCache(sampleRef: string, phrases: any[]): void {
    this.phrasesCache.set(sampleRef, phrases);
  }

  getTranscriptionsCache(sampleRef: string): any[] | null {
    return this.transcriptionsCache.get(sampleRef) || null;
  }

  setTranscriptionsCache(sampleRef: string, transcriptions: any[]): void {
    this.transcriptionsCache.set(sampleRef, transcriptions);
  }

  getViewsCache(): any[] | null {
    return this.viewsCache;
  }

  setViewsCache(views: any[]): void {
    this.viewsCache = views;
  }

  getTranscriptionCountsCache(): any[] | null {
    return this.transcriptionCountsCache;
  }

  setTranscriptionCountsCache(counts: any[]): void {
    this.transcriptionCountsCache = counts;
  }

  getCategoryCache(questionId: number | string): any | null {
    return this.categoryCache[questionId.toString()] || null;
  }

  setCategoryCache(questionId: number | string, category: any): void {
    this.categoryCache[questionId.toString()] = category;
  }

  clearCache(): void {
    this.samplesCache = null;
    this.phrasesCache.clear();
    this.transcriptionsCache.clear();
    this.viewsCache = null;
    this.transcriptionCountsCache = null;
    this.categoryCache = {};
  }

  // Utility methods
  hasSearchResults(): boolean {
    return this.searchContextSubject.value.searchResults.length > 0;
  }

  hasSearchSelections(): boolean {
    const context = this.searchContextSubject.value;
    return context.selectedSamples.length > 0 || context.selectedQuestions.length > 0;
  }

  clearSearchState(): void {
    // Clear unified search context (primary)
    const clearedContext: SearchContext = {
      selectedQuestions: [],
      selectedSamples: [],
      searches: [],
      searchResults: [],
      searchStatus: '',
      searchString: '',
      isLoading: false,
      searchType: 'none',
      lastSearchMethod: null,
      selectedView: null,
      selectedCategory: null,
      currentSample: null
    };
    this.searchContextSubject.next(clearedContext);
    
    // Sync legacy subjects for backward compatibility
    this.selectedSamplesSubject.next([]);
    this.selectedCategoriesSubject.next([]);
    this.searchResultsSubject.next([]);
    this.searchStatusSubject.next('');
    this.searchStringSubject.next('');
    this.currentSampleSubject.next(null);
    
    // Clear other state
    this.expandedCategoriesSubject.next(new Set());
    this.filterStatesSubject.next({ pub: false, migrant: true });
    this.categoryCache = {};
  }

  // Method to clear all state and return samples array for UI cleanup
  clearAllSelectionsWithSamples(): { samples: any[] } {
    const currentSamples = this.getCurrentSelectedSamples();
    this.clearSearchState();
    return { samples: currentSamples };
  }
}
