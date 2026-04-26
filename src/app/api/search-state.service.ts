import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SearchCriterion, SearchContext } from './data.service';

@Injectable({
  providedIn: 'root'
})
export class SearchStateService {
  // Unified search context - single source of truth
  private searchContextSubject = new BehaviorSubject<SearchContext>({
    // Search Configuration
    selectedQuestions: [],
    selectedSamples: [],
    searches: [],
    
    // Search Execution State
    searchResults: [],
    searchStatus: '',
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
  private transcriptionCountsCache: any[] | null = null;
  private categoryCache: { [key: string]: any } = {};

  // Unified context observable - primary interface
  searchContext$: Observable<SearchContext> = this.searchContextSubject.asObservable();

  // Computed observables for backward compatibility
  selectedSamples$: Observable<any[]> = this.searchContext$.pipe(map(ctx => ctx.selectedSamples));
  selectedCategories$: Observable<any[]> = this.searchContext$.pipe(map(ctx => ctx.selectedQuestions));
  searchResults$: Observable<any[]> = this.searchContext$.pipe(map(ctx => ctx.searchResults));
  searchStatus$: Observable<string> = this.searchContext$.pipe(map(ctx => ctx.searchStatus));
  currentSample$: Observable<any> = this.searchContext$.pipe(map(ctx => ctx.currentSample));

  isAudioPlaying$: Observable<boolean> = this.isAudioPlayingSubject.asObservable();
  currentAudioUrl$: Observable<string | null> = this.currentAudioUrlSubject.asObservable();

  constructor() { }

  // UNIFIED UPDATE METHODS - Use these for new code
  updateQuestionSelection(questions: any[]): void {
    const currentContext = this.searchContextSubject.value;
    this.searchContextSubject.next({
      ...currentContext,
      selectedQuestions: [...questions],
      searchType: this.determineSearchType([...questions], currentContext.selectedSamples, currentContext.searches)
    });
  }

  updateSampleSelection(samples: any[]): void {
    const currentContext = this.searchContextSubject.value;
    this.searchContextSubject.next({
      ...currentContext,
      selectedSamples: [...samples],
      searchType: this.determineSearchType(currentContext.selectedQuestions, [...samples], currentContext.searches)
    });
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
    this.searchContextSubject.next({
      ...currentContext,
      searchResults: [...results],
      searchStatus: status,
      lastSearchMethod: method,
      isLoading: false
    });
  }

  private determineSearchType(questions: any[], samples: any[], criteria: SearchCriterion[]): 'questions' | 'criteria' | 'mixed' | 'none' {
    const hasQuestions = questions.length > 0;
    const hasCriteria = criteria.length > 0;
    
    if (hasQuestions && hasCriteria) return 'mixed';
    if (hasCriteria) return 'criteria';
    if (hasQuestions) return 'questions';
    return 'none';
  }

  // Getter methods for current values
  getCurrentSelectedCategories(): any[] {
    return this.searchContextSubject.value.selectedQuestions;
  }

  // TODO(url-refactor): currentSample*/currentSample$ are superseded by the
  // ?sample= query param. Phrases has migrated (Phase 1). Tables, transcriptions,
  // and sample-detail still call these; remove after their phases complete.
  // Global sample methods
  setCurrentSample(sample: any): void {
    const ctx = this.searchContextSubject.value;
    this.searchContextSubject.next({
      ...ctx,
      currentSample: sample,
      searchType: ctx.searches.length > 0 ? 'mixed' : 'questions'
    });
  }

  getCurrentSample(): any {
    return this.searchContextSubject.value.currentSample;
  }

  clearCurrentSample(): void {
    const ctx = this.searchContextSubject.value;
    this.searchContextSubject.next({
      ...ctx,
      currentSample: null,
      searchType: ctx.searches.length > 0 ? 'criteria' : 'none'
    });
  }

  // Unified search context methods
  getSearchContext(): SearchContext {
    return this.searchContextSubject.value;
  }

  setSearchContext(context: SearchContext): void {
    this.searchContextSubject.next(context);
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

  clearSamplesCache(): void {
    this.samplesCache = null;
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
    this.searchContextSubject.next({
      selectedQuestions: [],
      selectedSamples: [],
      searches: [],
      searchResults: [],
      searchStatus: '',
      isLoading: false,
      searchType: 'none',
      lastSearchMethod: null,
      selectedView: null,
      selectedCategory: null,
      currentSample: null
    });
    this.categoryCache = {};
  }

}
