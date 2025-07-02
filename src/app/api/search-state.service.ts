import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

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

  // Observables for components to subscribe to
  selectedSamples$: Observable<any[]> = this.selectedSamplesSubject.asObservable();
  selectedCategories$: Observable<any[]> = this.selectedCategoriesSubject.asObservable();
  searchResults$: Observable<any[]> = this.searchResultsSubject.asObservable();
  searchStatus$: Observable<string> = this.searchStatusSubject.asObservable();
  searchString$: Observable<string> = this.searchStringSubject.asObservable();
  expandedCategories$: Observable<Set<number>> = this.expandedCategoriesSubject.asObservable();
  filterStates$: Observable<FilterStates> = this.filterStatesSubject.asObservable();

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
  }

  // Method to clear all state and return samples array for UI cleanup
  clearAllSelectionsWithSamples(): { samples: any[] } {
    const currentSamples = this.getCurrentSelectedSamples();
    this.clearSearchState();
    return { samples: currentSamples };
  }
}
