import { Component, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { SearchStateService } from '../../api/search-state.service';
import { UrlStateService } from '../../api/url-state.service';
import { SearchComponent } from '../../search/search.component';
import { ViewsComponent } from '../../views/views.component';

type SearchTab = 'search' | 'data-search' | 'results';

@Component({
  selector: 'app-search-page',
  imports: [CommonModule, SearchComponent, ViewsComponent],
  templateUrl: './search-page.component.html',
  styleUrl: './search-page.component.scss'
})
export class SearchPageComponent implements OnInit, OnDestroy {
  @ViewChild('searchComponent') searchComponent!: SearchComponent;

  private readonly searchStateService = inject(SearchStateService);
  private readonly urlState = inject(UrlStateService);

  activeTab: SearchTab = 'search';
  private subscriptions: Subscription[] = [];

  ngOnInit(): void {
    this.subscriptions.push(
      this.urlState.select<SearchTab>('tab', raw => {
        if (raw === 'data-search' || raw === 'results') return raw;
        return 'search';
      }).subscribe(tab => {
        this.activeTab = tab;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  setActiveTab(tab: SearchTab): void {
    this.urlState.patch({ tab: tab === 'search' ? null : tab }, { replaceUrl: false });
  }

  hasSearchData(): boolean {
    return this.searchStateService.hasSearchResults() || this.searchStateService.hasSearchSelections();
  }

  clearAllSelections(): void {
    if (this.searchComponent) {
      this.searchComponent.clearAllSelections();
    } else {
      this.searchStateService.clearSearchState();
    }
    this.urlState.patch({ tab: null }, { replaceUrl: false });
  }
}
