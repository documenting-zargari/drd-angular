import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
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
  
  // Unified search context
  private searchContextSubject = new BehaviorSubject<SearchContext>({
    currentSample: null,
    searchCriteria: [],
    type: 'simple',
    selectedView: null,
    selectedCategory: null
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

  // Observables for components to subscribe to
  selectedSamples$: Observable<any[]> = this.selectedSamplesSubject.asObservable();
  selectedCategories$: Observable<any[]> = this.selectedCategoriesSubject.asObservable();
  searchResults$: Observable<any[]> = this.searchResultsSubject.asObservable();
  searchStatus$: Observable<string> = this.searchStatusSubject.asObservable();
  searchString$: Observable<string> = this.searchStringSubject.asObservable();
  expandedCategories$: Observable<Set<number>> = this.expandedCategoriesSubject.asObservable();
  filterStates$: Observable<FilterStates> = this.filterStatesSubject.asObservable();
  currentSample$: Observable<any> = this.currentSampleSubject.asObservable();
  searchContext$: Observable<SearchContext> = this.searchContextSubject.asObservable();
  isAudioPlaying$: Observable<boolean> = this.isAudioPlayingSubject.asObservable();
  currentAudioUrl$: Observable<string | null> = this.currentAudioUrlSubject.asObservable();

  constructor() { }

  // Update methods
  updateSelectedSamples(samples: any[]): void {
    this.selectedSamplesSubject.next([...samples]);
  }

  updateSelectedCategories(categories: any[]): void {
    this.selectedCategoriesSubject.next([...categories]);
  }

  updateSearchResults(results: any[], status: string = ''): void {
    this.searchResultsSubject.next([...results]);
    this.searchStatusSubject.next(status);
  }

  updateSearchString(searchString: string): void {
    this.searchStringSubject.next(searchString);
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
      type: currentContext.searchCriteria.length > 0 ? 'mixed' : 'simple'
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
      type: currentContext.searchCriteria.length > 0 ? 'criteria' : 'simple'
    });
  }

  // Unified search context methods
  getSearchContext(): SearchContext {
    return this.searchContextSubject.value;
  }

  setSearchContext(context: SearchContext): void {
    this.searchContextSubject.next(context);
    // Sync with legacy currentSample for backward compatibility
    this.currentSampleSubject.next(context.currentSample);
  }

  addSearchCriterion(criterion: SearchCriterion): void {
    const currentContext = this.searchContextSubject.value;
    const updatedCriteria = [...currentContext.searchCriteria, criterion];
    
    this.searchContextSubject.next({
      ...currentContext,
      searchCriteria: updatedCriteria,
      type: currentContext.currentSample ? 'mixed' : 'criteria'
    });
  }

  removeSearchCriterion(index: number): void {
    const currentContext = this.searchContextSubject.value;
    const updatedCriteria = currentContext.searchCriteria.filter((_, i) => i !== index);
    
    this.searchContextSubject.next({
      ...currentContext,
      searchCriteria: updatedCriteria,
      type: updatedCriteria.length === 0 ? 'simple' : (currentContext.currentSample ? 'mixed' : 'criteria')
    });
  }

  clearSearchCriteria(): void {
    const currentContext = this.searchContextSubject.value;
    this.searchContextSubject.next({
      ...currentContext,
      searchCriteria: [],
      type: currentContext.currentSample ? 'simple' : 'simple'
    });
  }

  hasSearchCriteria(): boolean {
    return this.searchContextSubject.value.searchCriteria.length > 0;
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
    return this.searchResultsSubject.value.length > 0;
  }

  hasSearchSelections(): boolean {
    return this.selectedSamplesSubject.value.length > 0 || this.selectedCategoriesSubject.value.length > 0;
  }

  clearSearchState(): void {
    this.selectedSamplesSubject.next([]);
    this.selectedCategoriesSubject.next([]);
    this.searchResultsSubject.next([]);
    this.searchStatusSubject.next('');
    this.searchStringSubject.next('');
    this.expandedCategoriesSubject.next(new Set());
    this.filterStatesSubject.next({ pub: false, migrant: true });
    this.currentSampleSubject.next(null);
    // Clear unified search context
    this.searchContextSubject.next({
      currentSample: null,
      searchCriteria: [],
      type: 'simple',
      selectedView: null,
      selectedCategory: null
    });
    // Clear category cache
    this.categoryCache = {};
  }

  // Method to clear all state and return samples array for UI cleanup
  clearAllSelectionsWithSamples(): { samples: any[] } {
    const currentSamples = this.getCurrentSelectedSamples();
    this.clearSearchState();
    return { samples: currentSamples };
  }
}
