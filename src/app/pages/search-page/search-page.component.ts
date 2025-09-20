import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SearchStateService } from '../../api/search-state.service';
import { SearchComponent } from '../../search/search.component';
import { ViewsComponent } from '../../views/views.component';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-search-page',
  imports: [CommonModule, SearchComponent, ViewsComponent],
  templateUrl: './search-page.component.html',
  styleUrl: './search-page.component.scss'
})
export class SearchPageComponent implements OnInit, OnDestroy {
  @ViewChild('searchComponent') searchComponent!: SearchComponent;
  
  activeTab: 'search' | 'data-search' | 'results' = 'search';
  private subscriptions: Subscription[] = [];

  constructor(private searchStateService: SearchStateService) {}

  ngOnInit(): void {
    // Subscribe to search results to auto-switch to results tab
    this.subscriptions.push(
      this.searchStateService.searchResults$.subscribe(results => {
        if (results.length > 0) {
          this.activeTab = 'results';
        }
      })
    );

    // Check if we already have search data and should show results tab
    if (this.searchStateService.hasSearchResults() || this.searchStateService.hasSearchSelections()) {
      this.activeTab = 'results';
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  setActiveTab(tab: 'search' | 'data-search' | 'results'): void {
    this.activeTab = tab;
  }

  onSearchCompleted(): void {
    // Switch to results tab when search is completed
    this.activeTab = 'results';
  }

  hasSearchData(): boolean {
    return this.searchStateService.hasSearchResults() || this.searchStateService.hasSearchSelections();
  }

  clearAllSelections(): void {
    // Clear the search component's UI state and service state
    if (this.searchComponent) {
      this.searchComponent.clearAllSelections();
    } else {
      // Fallback: clear service state if search component not available
      this.searchStateService.clearSearchState();
    }
    
    // Switch back to search tab
    this.activeTab = 'search';
  }
}