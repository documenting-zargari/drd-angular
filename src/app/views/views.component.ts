import { Component, OnInit, OnDestroy, AfterViewInit, Output, EventEmitter, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SearchStateService } from '../api/search-state.service';
import { UrlStateService } from '../api/url-state.service';
import { SearchContext, DataService, ANSWER_VALUE_FIELDS, PhraseListItem } from '../api/data.service';
import { UserService } from '../api/user.service';
import { ExportService, ExportFormat, SampleDetails } from '../api/export.service';
import { ExportModalComponent } from '../shared/export-modal/export-modal.component';
import { PaginationComponent } from '../shared/pagination/pagination.component';
import { PhraseTranscriptionModalComponent } from '../shared/phrase-transcription-modal/phrase-transcription-modal.component';
import { CellEditDialogComponent, PhraseAssociationChange } from '../shared/cell-edit-dialog/cell-edit-dialog.component';
import { PageTitleService } from '../api/page-title.service';
import { Subscription, forkJoin } from 'rxjs';
import { cleanHierarchy } from '../shared/hierarchy-utils';
import * as L from 'leaflet';

type RankedCombination = {
  signature: string, samples: string[], description: string, count: number, rank: number
};

@Component({
  selector: 'app-views',
  imports: [CommonModule, FormsModule, RouterModule, PhraseTranscriptionModalComponent, ExportModalComponent, PaginationComponent, CellEditDialogComponent],
  templateUrl: './views.component.html',
  styleUrl: './views.component.scss'
})
export class ViewsComponent implements OnInit, OnDestroy, AfterViewInit {
  @Output() clearAllRequested = new EventEmitter<void>();

  selectedSamples: any[] = [];
  selectedCategories: any[] = [];
  searchResults: any[] = [];
  searchStatus: string = '';
  showComparisonTable: boolean = false;
  currentView: 'list' | 'comparison' | 'map' = 'list';

  // Pagination (shared by list + comparison views)
  readonly pageSize: number = 50;
  currentPage: number = 1;

  // Sorting properties (URL-driven)
  sortColumn: string = 'sample_ref';  // 'sample_ref' or a column id
  sortDirection: 'asc' | 'desc' = 'asc';
  private readonly defaultSortColumn = 'sample_ref';

  // Match mode used for the current search (URL-driven, 'op' param).
  // 'OR' (match any) is the default and intentionally not called out in the UI;
  // 'AND' (match all) yields a structurally different result set, so it's surfaced.
  matchMode: 'AND' | 'OR' = 'OR';

  // Export properties
  exportIncludeSampleDetails: boolean = true;
  @ViewChild('exportModal') exportModalComponent!: ExportModalComponent;

  // Modal properties
  showPhrasesModal: boolean = false;
  modalAnswer: any = null;
  modalTitle: string = 'Related Phrases and Connected Speech';

  // Edit modal properties
  showEditModal: boolean = false;
  editModalFieldName: string = '';
  editModalQuestionName: string = '';
  editModalCurrentValue: string = '';
  editModalAnswerKey: string = '';
  editModalSampleRef: string = '';
  editModalQuestionId: string = '';
  private editModalResult: any = null;
  editModalStandardPhrases: PhraseListItem[] = [];
  editModalResolvedPhrases: PhraseListItem[] = [];
  editModalPhrasesLoading = false;
  private allPhrasesCache = new Map<string, PhraseListItem[]>();
  private pendingPhraseAssociationChanges: PhraseAssociationChange[] | null = null;

  // Map properties
  private map: L.Map | undefined;
  private tileLayer: L.TileLayer | undefined;
  private samples: any[] = [];
  mapInitialized = false;
  /** True while we're moving the map ourselves (invalidateSize's re-center,
   *  the empty-results view reset) — the moveend handler uses this to avoid
   *  persisting our own programmatic moves as if the user had panned. */
  private suppressMoveendSync = false;
  searchContext: SearchContext = {
    selectedQuestions: [],
    selectedSamples: [],
    searches: [],
    searchResults: [],
    searchStatus: '',
    isLoading: false,
    searchType: 'none',
    lastSearchMethod: null,
    currentSample: null
  };

  private subscriptions: Subscription[] = [];

  private readonly urlState = inject(UrlStateService);
  private readonly pageTitleService = inject(PageTitleService);

  constructor(
    private searchStateService: SearchStateService,
    private dataService: DataService,
    public userService: UserService,
    private exportService: ExportService
  ) {}

  /** Reuses the same question-name/result-count lookups already used for
   *  in-page labels (getSingleQuestionName/getQuestionName) to keep the
   *  Search tab's browser title distinguishable across searches. */
  private updatePageTitle(): void {
    const single = this.getSingleQuestionName();
    if (single) {
      this.pageTitleService.setDetail(single);
      return;
    }
    if (this.selectedCategories.length === 1) {
      this.pageTitleService.setDetail(this.getQuestionName(this.selectedCategories[0].id));
      return;
    }
    if (this.searchResults.length > 0) {
      this.pageTitleService.setDetail(`${this.searchResults.length} results`);
      return;
    }
    this.pageTitleService.setDetail(null);
  }

  ngOnInit(): void {
    // Subscribe to search state changes
    this.subscriptions.push(
      this.searchStateService.selectedSamples$.subscribe(samples => {
        this.selectedSamples = samples;
      }),
      this.searchStateService.selectedCategories$.subscribe(categories => {
        this.selectedCategories = categories;
      }),
      this.searchStateService.searchResults$.subscribe(results => {
        this.searchResults = results;
        this.hydrateMapExtraFromUrl();
        if (this.currentView === 'map' && results.length > 0) {
          setTimeout(() => this.initializeMap(), 50);
        }
        this.updatePageTitle();
      }),
      this.searchStateService.searchStatus$.subscribe(status => {
        this.searchStatus = status;
      }),
      // Subscribe to unified search context
      this.searchStateService.searchContext$.subscribe(context => {
        this.searchContext = context;
        this.updatePageTitle();
        // The map section (including #searchResultsMap) lives behind
        // *ngIf="hasSearchData()" in the template. When that flips false
        // (e.g. Clear All), Angular destroys the whole subtree — but our
        // Leaflet `map` is a plain field that survives, now pointing at a
        // detached DOM node. Left alone, the next time results come back
        // Angular builds a brand-new empty div while initializeMap() takes
        // the "already initialized" fast path and keeps operating on the
        // orphaned map: everything succeeds internally (markers, fitBounds)
        // but nothing is visible, since it's not the div on screen. Tear
        // the map down here so a fresh one gets created against the new div.
        if (!this.hasSearchData() && this.mapInitialized) {
          this.map?.remove();
          this.map = undefined;
          this.tileLayer = undefined;
          this.mapInitialized = false;
        }
      }),
      // URL-driven view mode (list | comparison | map)
      this.urlState.select<'list' | 'comparison' | 'map'>('view', raw =>
        raw === 'comparison' || raw === 'map' ? raw : 'list'
      ).subscribe(view => {
        this.currentView = view;
        this.showComparisonTable = view === 'comparison';
        if (view === 'map') {
          setTimeout(() => this.initializeMap(), 100);
        }
      }),
      // URL-driven page number (list view only)
      this.urlState.select<number>('page', raw =>
        Math.max(1, this.urlState.parseInt(raw, 1))
      ).subscribe(page => {
        this.currentPage = page;
      }),
      // URL-driven sort state (comparison view)
      this.urlState.selectMany<{ sort: string; sortDir: 'asc' | 'desc' }>({
        sort: raw => raw && raw.length > 0 ? raw : this.defaultSortColumn,
        sortDir: raw => raw === 'desc' ? 'desc' : 'asc',
      }).subscribe(s => {
        this.sortColumn = s.sort;
        this.sortDirection = s.sortDir;
      }),
      // URL-driven match mode (op=AND|OR), set by the search form
      this.urlState.select<'AND' | 'OR'>('op', raw =>
        raw === 'AND' ? 'AND' : 'OR'
      ).subscribe(op => {
        this.matchMode = op;
      })
    );
  }

  onPageChange(page: number): void {
    this.urlState.patch({ page: page > 1 ? page : null }, { replaceUrl: true });
  }

  /** Paged slice of list-view results. */
  get pagedListResults(): any[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.searchResults.slice(start, start + this.pageSize);
  }

  ngAfterViewInit(): void {
    // Load samples data for map
    this.loadSamplesForMap();
  }

  ngOnDestroy(): void {
    // Clean up map
    if (this.map) {
      this.map.remove();
    }
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  hasSearchData(): boolean {
    return this.searchStateService.hasSearchSelections() || this.searchStateService.hasSearchResults();
  }

  clearAllSelections(): void {
    this.clearAllRequested.emit();
  }

  isSearchCriteriaResults(): boolean {
    return this.searchContext.searches.length > 0;
  }

  getDisplayFields(result: any): {key: string, value: any}[] {
    if (!result) return [];

    return Object.keys(result)
      .filter(key => !this.shouldHideField(key))
      .map(key => ({key, value: result[key]}));
  }

  shouldHideField(fieldName: string): boolean {
    const hiddenFields = ['_id', '_key', '_rev', 'question_id', 'sample', 'category', 'tags'];
    if (hiddenFields.includes(fieldName)) return true;
    // Hide internal ID fields (e.g. category_id, inflection_id, form_id, meaning_id)
    if (fieldName.endsWith('_id')) return true;
    return false;
  }

  formatKey(key: string): string {
    return key.replace(/_/g, ' ')
             .split(' ')
             .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
             .join(' ');
  }

  getStatusClass(): string {
    if (!this.searchStatus) return '';

    // Check if it's an error message
    if (this.searchStatus.includes('Invalid') ||
        this.searchStatus.includes('Please select') ||
        this.searchStatus.includes('failed') ||
        this.searchStatus.includes('No answers found') ||
        this.searchStatus.includes('Error')) {
      return 'text-danger';
    }

    // Check if it's a success message
    if (this.searchStatus.includes('Found')) {
      return 'text-success';
    }

    // Default styling
    return '';
  }


  getQuestionHierarchy(result: any): string {
    if (!result) return '';

    // Check if the result itself contains hierarchy information
    if (result.hierarchy && Array.isArray(result.hierarchy) && result.hierarchy.length > 0) {
      const hierarchyWithoutRMS = cleanHierarchy(result.hierarchy);
      return hierarchyWithoutRMS.join(' > ');
    }

    // Try to find the category by question_id or category field
    const questionId = result.question_id || result.category;
    if (!questionId) return '';

    // First check the shared category cache
    const cachedCategory = this.searchStateService.getCategoryCache(questionId);
    if (cachedCategory) {
      // Build full hierarchy without "RMS"
      if (cachedCategory.hierarchy && cachedCategory.hierarchy.length > 0) {
        const hierarchyWithoutRMS = cleanHierarchy(cachedCategory.hierarchy);
        return hierarchyWithoutRMS.join(' > ');
      }
      return cachedCategory.name;
    }

    // Try to find in selected categories (regular search fallback)
    if (this.selectedCategories && this.selectedCategories.length > 0) {
      const category = this.selectedCategories.find(c => c.id == questionId);
      if (category) {
        // Build full hierarchy without "RMS"
        if (category.hierarchy && category.hierarchy.length > 0) {
          const hierarchyWithoutRMS = cleanHierarchy(category.hierarchy);
          return hierarchyWithoutRMS.join(' > ');
        }
        return category.name;
      }
    }

    // Fallback to question ID
    return `Question ${questionId}`;
  }

  // Comparison table methods
  canShowComparisonTable(): boolean {
    if (this.searchResults.length === 0) {
      return false;
    }

    // For search criteria results, check the number of unique questions
    if (this.isSearchCriteriaResults()) {
      const uniqueQuestions = this.getUniqueQuestionsFromResults();
      return uniqueQuestions.length > 0 && uniqueQuestions.length < 5;
    }

    // For regular search results, use selected categories
    return this.selectedCategories.length > 0 &&
           this.selectedCategories.length < 5;
  }

  private getUniqueQuestionsFromResults(): number[] {
    const questionIds = new Set<number>();
    this.searchResults.forEach(result => {
      const questionId = result.question_id || result.category;
      if (questionId) {
        questionIds.add(Number(questionId));
      }
    });
    return Array.from(questionIds);
  }

  setView(view: 'list' | 'comparison' | 'map'): void {
    this.urlState.patch({ view: view === 'list' ? null : view }, { replaceUrl: false });
  }

  toggleComparisonView(): void {
    // Legacy method - redirect to new view system
    this.setView(this.showComparisonTable ? 'list' : 'comparison');
  }

  getAnswerValue(result: any): string {
    for (const field of ANSWER_VALUE_FIELDS) {
      if (result[field] && result[field].toString().trim()) {
        return result[field].toString().trim();
      }
    }

    // Fallback to first non-hidden field value
    const fields = this.getDisplayFields(result);
    if (fields.length > 0) {
      return fields[0].value ? fields[0].value.toString() : '-';
    }

    return '-';
  }

  getComparisonTableData(): any[] {
    // Group results by sample_ref, collecting all answers per question
    const sampleMap = new Map<string, any>();

    this.searchResults.forEach(result => {
      const sampleRef = result.sample;
      if (!sampleMap.has(sampleRef)) {
        sampleMap.set(sampleRef, { sample_ref: sampleRef, answers: new Map() });
      }

      const questionId = result.question_id || result.category;
      const answer = this.getAnswerValue(result);
      const answers = sampleMap.get(sampleRef)!.answers;
      if (!answers.has(questionId)) {
        answers.set(questionId, [answer]);
      } else {
        const arr = answers.get(questionId);
        if (answer !== '-' && !arr.includes(answer)) {
          arr.push(answer);
        }
      }
    });

    // Convert to array format for table display
    const data = Array.from(sampleMap.values()).map(sample => ({
      sample_ref: sample.sample_ref,
      answers: sample.answers
    }));

    // Sort
    const dir = this.sortDirection === 'asc' ? 1 : -1;
    data.sort((a, b) => {
      let valA: string, valB: string;
      if (this.sortColumn === 'sample_ref') {
        valA = a.sample_ref;
        valB = b.sample_ref;
      } else {
        // Map keys may be numbers or strings depending on backend; accept either.
        const num = Number(this.sortColumn);
        const arrA = a.answers.get(this.sortColumn) ?? a.answers.get(num);
        const arrB = b.answers.get(this.sortColumn) ?? b.answers.get(num);
        valA = arrA ? arrA.join(', ') : '-';
        valB = arrB ? arrB.join(', ') : '-';
      }
      // Put '-' (empty) values last
      if (valA === '-' && valB !== '-') return 1;
      if (valA !== '-' && valB === '-') return -1;
      return valA.localeCompare(valB) * dir;
    });

    return data;
  }

  sortBy(column: string | number): void {
    const colKey = String(column);
    let nextDir: 'asc' | 'desc' = 'asc';
    if (this.sortColumn === colKey) {
      nextDir = this.sortDirection === 'asc' ? 'desc' : 'asc';
    }
    this.urlState.patch({
      sort: colKey === this.defaultSortColumn ? null : colKey,
      sortDir: nextDir === 'asc' ? null : 'desc',
    }, { replaceUrl: true });
  }

  isSortedBy(column: string | number): boolean {
    return this.sortColumn === String(column);
  }

  getQuestionName(questionId: any): string {
    // First check the shared category cache
    const cachedCategory = this.searchStateService.getCategoryCache(questionId);
    if (cachedCategory) {
      // Return full hierarchy without "RMS" if available, otherwise just the name
      if (cachedCategory.hierarchy && cachedCategory.hierarchy.length > 0) {
        const hierarchyWithoutRMS = cleanHierarchy(cachedCategory.hierarchy);
        return hierarchyWithoutRMS.join(' > ');
      }
      return cachedCategory.name;
    }

    // Try to find in selected categories (regular search fallback)
    const category = this.selectedCategories.find(c => c.id == questionId);
    if (category) {
      // Return full hierarchy without "RMS" if available, otherwise just the name
      if (category.hierarchy && category.hierarchy.length > 0) {
        const hierarchyWithoutRMS = cleanHierarchy(category.hierarchy);
        return hierarchyWithoutRMS.join(' > ');
      }
      return category.name;
    }

    // For search criteria results, we don't have category data readily available
    // Return a simple format - breadcrumb computation would require additional API calls
    return `Question ${questionId}`;
  }

  getQuestionHierarchyForCriterion(questionId: any): string {
    // First check the shared category cache
    const cachedCategory = this.searchStateService.getCategoryCache(questionId);
    if (cachedCategory) {
      // Return full hierarchy without "RMS" if available, otherwise just the name
      if (cachedCategory.hierarchy && cachedCategory.hierarchy.length > 0) {
        const hierarchyWithoutRMS = cleanHierarchy(cachedCategory.hierarchy);
        return hierarchyWithoutRMS.join(' > ');
      }
      return cachedCategory.name;
    }

    // Try to find in selected categories (regular search fallback)
    const category = this.selectedCategories.find(c => c.id == questionId);
    if (category) {
      // Return full hierarchy without "RMS" if available, otherwise just the name
      if (category.hierarchy && category.hierarchy.length > 0) {
        const hierarchyWithoutRMS = cleanHierarchy(category.hierarchy);
        return hierarchyWithoutRMS.join(' > ');
      }
      return category.name;
    }

    // For search criteria results, we don't have category data readily available
    // Return a simple format - breadcrumb computation would require additional API calls
    return `Question ${questionId}`;
  }

  getAnswerForSample(sampleData: any, questionId: any): string {
    const answers = sampleData.answers.get(questionId);
    if (!answers || answers.length === 0) return '-';
    return answers.join(', ');
  }

  getComparisonTableColumns(): any[] {
    if (this.isSearchCriteriaResults()) {
      // For search criteria results, create column objects from unique questions
      const uniqueQuestions = this.getUniqueQuestionsFromResults();
      return uniqueQuestions.map(questionId => ({
        id: questionId,
        name: this.getQuestionName(questionId),
        questionName: this.getQuestionName(questionId)
      }));
    } else {
      // For regular search results, use selected categories
      return this.selectedCategories;
    }
  }

  getComparisonTableColumnId(column: any): any {
    if (this.isSearchCriteriaResults()) {
      return column.id;
    } else {
      return column.id;
    }
  }

  getComparisonTableColumnName(column: any): string {
    if (this.isSearchCriteriaResults()) {
      return column.questionName || column.name;
    } else {
      return column.name;
    }
  }

  getComparisonTableColumnHierarchy(column: any): string[] {
    if (this.isSearchCriteriaResults()) {
      // For search criteria, the questionName might already contain the full hierarchy
      const fullName = column.questionName || column.name;
      if (fullName.includes(' > ')) {
        const parts = fullName.split(' > ');
        return cleanHierarchy(parts.slice(0, -1));
      }
      return [];
    } else {
      // For regular search results, use category hierarchy
      if (column.hierarchy && column.hierarchy.length > 1) {
        return cleanHierarchy(column.hierarchy.slice(0, -1));
      }
      return [];
    }
  }

  getComparisonTableColumnDisplayName(column: any): string {
    if (this.isSearchCriteriaResults()) {
      const fullName = column.questionName || column.name;
      if (fullName.includes(' > ')) {
        const parts = fullName.split(' > ');
        return parts[parts.length - 1]; // Return just the final name
      }
      return fullName;
    } else {
      return column.name;
    }
  }

  // Map methods
  private loadSamplesForMap(): void {
    if (this.samples.length > 0) {
      return; // Already loaded
    }

    this.dataService.getSamples().subscribe({
      next: (samples) => {
        this.samples = samples;
        // Process migrant flag like other components
        this.samples.forEach(sample => {
          sample.migrant = sample.migrant === "Yes" ? true : false;
        });

        // If map is initialized and we're in map view, update markers
        if (this.mapInitialized && this.currentView === 'map') {
          this.updateMapMarkers();
        }
      },
      error: (error) => {
        console.error('Error loading samples for map:', error);
      }
    });
  }

  /** Reads mapExtra=rank,... and mapHidden=rank,... from the URL and
   *  resolves them against the current result set's ranked combinations,
   *  then refreshes every legend/marker field derived from them. Called
   *  whenever searchResults changes, so a fresh search naturally drops
   *  stale/out-of-range ranks. */
  private hydrateMapExtraFromUrl(): void {
    const ranked = this.computeRankedCombinations();
    const signaturesForRanks = (raw: string | null): Set<string> => {
      if (!raw) return new Set();
      const wantedRanks = new Set(this.urlState.parseCSV(raw).map(r => Number(r)));
      return new Set(ranked.filter(c => wantedRanks.has(c.rank)).map(c => c.signature));
    };

    this.activeExtraSignatures = signaturesForRanks(this.urlState.snapshot().get('mapExtra'));
    this.hiddenDefaultSignatures = signaturesForRanks(this.urlState.snapshot().get('mapHidden'));

    this.refreshMapCombinations();
    // refreshMapCombinations may have pruned activeExtraSignatures (an extra
    // that bubbled into the default fill) — keep the URL honest about that.
    this.syncMapExtraToUrl();
  }

  private initializeMap(): void {
    // Map div is display:none when there are no results — Leaflet can't initialize there.
    if (this.searchResults.length === 0) return;

    if (this.mapInitialized && this.map) {
      // invalidateSize() must run after the container has actually finished
      // laying out as visible (the display:none -> block flip above happens
      // via change detection, which the caller's setTimeout(..., 50) doesn't
      // guarantee has been painted yet). Calling it while the container is
      // still 0x0 makes Leaflet believe nothing changed, so it never loads
      // tiles for the new viewport — a blank/white map that a later
      // fitBounds (from updateMapMarkers) doesn't fix, since it's the same
      // stale size. Deferring both calls together to the same later tick
      // keeps them working off one consistent, settled container size.
      setTimeout(() => {
        // invalidateSize() can itself re-center the map to keep the same
        // point under the (now different-sized) container, which fires a
        // synchronous moveend — the handler below would persist that as the
        // "current" viewport before updateMapMarkers()'s fitBounds gets a
        // chance to move to the new results. Suppress the URL write for
        // just that one, programmatic move.
        this.suppressMoveendSync = true;
        this.map?.invalidateSize();
        this.suppressMoveendSync = false;
        this.updateMapMarkers();
      }, 100);
      return;
    }

    if (this.samples.length === 0) {
      this.loadSamplesForMap();
    }

    const snap = this.urlState.snapshot();
    const savedLat  = this.urlState.parseFloat(snap.get('lat'),  46);
    const savedLng  = this.urlState.parseFloat(snap.get('lng'),   2);
    const savedZoom = this.urlState.parseFloat(snap.get('zoom'),  4);
    const hasViewport = snap.get('lat') != null;

    this.map = L.map('searchResultsMap', {
      zoomSnap: 0,
      zoomDelta: 0.25,
      wheelDebounceTime: 80,
      wheelPxPerZoomLevel: 200,
    }).setView([savedLat, savedLng], savedZoom);

    this.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    // Write viewport to URL on every pan/zoom so it can be bookmarked / shared.
    // Skipped while suppressMoveendSync is set — i.e. for moves we triggered
    // ourselves (invalidateSize's re-center, the empty-results reset below)
    // rather than the user actually panning/zooming.
    this.map.on('moveend', () => {
      if (!this.map || this.suppressMoveendSync) return;
      const c = this.map.getCenter();
      this.urlState.patch({
        lat:  c.lat.toFixed(4),
        lng:  c.lng.toFixed(4),
        zoom: this.map.getZoom().toFixed(2),
      }, { replaceUrl: true });
    });

    this.mapInitialized = true;

    setTimeout(() => this.updateMapMarkers(hasViewport), 100);
  }

  private updateMapMarkers(skipFitBounds = false): void {
    if (!this.map) return;

    // Clear existing markers
    this.map.eachLayer((layer: any) => {
      if (layer instanceof L.Marker) {
        this.map!.removeLayer(layer);
      }
    });

    // Get unique samples from search results, restricted to combinations
    // currently shown in the legend (top 5, plus any activated overflow ones).
    const visibleSamples = this.getVisibleCombinationSamples();
    const searchResultSamples = this.getUniqueSearchResultSamples().filter(s => visibleSamples.has(s));
    const bounds = L.latLngBounds([]);
    let markersAdded = 0;

    searchResultSamples.forEach(sampleRef => {
      const sample = this.samples.find(s => s.sample_ref === sampleRef);
      if (sample && sample.coordinates && this.hasValidCoordinates(sample)) {
        const lat = sample.coordinates.latitude;
        const lng = sample.coordinates.longitude;

        // Get style for this sample if using multiple search criteria
        const style = this.getSampleCombinationStyle(sampleRef);

        // Create marker - styled or default
        const marker = style
          ? this.createStyledMarker(lat, lng, style.shape, style.color)
          : L.marker([lat, lng]);

        marker.addTo(this.map!);

        // Get search results for this sample
        const sampleResults = this.searchResults.filter(r => r.sample === sampleRef);

        // Create popup content
        const popupContent = this.createMapPopupContent(sample, sampleResults);
        marker.bindPopup(popupContent);

        // Add click event listeners to popup content
        marker.on('popupopen', () => {
          this.addMapPopupEventListeners(sample, sampleResults);
        });

        // Exclude MX-001 from bounds calculation to prevent zoom-out due to outlier location
        if (sample.sample_ref !== 'MX-001') {
          bounds.extend([lat, lng]);
        }
        markersAdded++;
      }
    });

    if (markersAdded > 0 && !skipFitBounds) {
      this.map.fitBounds(bounds, { padding: [20, 20] });
    } else if (markersAdded === 0 && !skipFitBounds) {
      // Nothing to show for this result set under the current legend
      // visibility — leaving the map at wherever it happened to be (e.g. a
      // tight zoom left over from an earlier, unrelated search) renders as a
      // misleading blank view. Fall back to the same wide default a fresh
      // map starts at, and drop any stale viewport from the URL so a reload
      // doesn't resurrect it either.
      this.suppressMoveendSync = true;
      this.map.setView([46, 2], 4);
      this.suppressMoveendSync = false;
      this.urlState.patch({ lat: null, lng: null, zoom: null }, { replaceUrl: true });
    }
  }

  private hasValidCoordinates(sample: any): boolean {
    if (!sample.coordinates) return false;

    const lat = sample.coordinates.latitude;
    const lng = sample.coordinates.longitude;

    // More lenient coordinate validation - allow 0,0 coordinates for testing
    const isValidLat = typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90;
    const isValidLng = typeof lng === 'number' && !isNaN(lng) && lng >= -180 && lng <= 180;

    return isValidLat && isValidLng;
  }

  private createMapPopupContent(sample: any, sampleResults: any[]): string {
    let content = `
      <div class="map-popup">
        <h6 class="sample-cell">
          ${sample.sample_ref}
          <a href="/samples/${sample.sample_ref}" class="sample-info-icon ms-2" title="View sample details">
            <i class="bi bi-info-circle"></i>
          </a>
        </h6>
        <div class="sample-info">
          <span class="dialect-name">${sample.dialect_name || 'Unknown dialect'}</span>
          <span class="location text-muted">${sample.location || 'Location unknown'}</span>
        </div>
    `;

    if (sampleResults.length > 0) {
      content += '<div class="search-results-summary">';
      sampleResults.forEach((result, index) => {
        const questionName = this.getQuestionHierarchy(result);
        const value = this.getAnswerValue(result);
        const editIcon = this.userService.canEditSample(result.sample)
          ? '<i class="bi bi-pencil ms-2 text-muted" style="opacity: 0.5;" title="Edit this answer"></i>'
          : '';
        content += `<div class="clickable-result d-flex align-items-center mb-2" data-result-index="${index}" title="Click to view phrases and connected speech">
          <i class="bi bi-chat-text me-2 text-primary clickable-icon fs-5" data-result-index="${index}" title="Click to view phrases and connected speech"></i>
          <span class="question-name">${questionName}:</span> <span class="answer-value">${value}</span>${editIcon}
        </div>`;
      });
      content += '</div>';
    }

    content += `
      </div>
    `;

    return content;
  }

  getUniqueSearchResultSamples(): string[] {
    const uniqueSamples = new Set<string>();
    this.searchResults.forEach(result => {
      uniqueSamples.add(result.sample);
    });
    return Array.from(uniqueSamples);
  }

  // Helper method to check if all results are for a single question
  private isSingleQuestionSearch(): boolean {
    const uniqueQuestions = this.getUniqueQuestionsFromResults();
    return uniqueQuestions.length === 1;
  }

  // Get the single question name for single-question searches
  getSingleQuestionName(): string {
    if (!this.isSingleQuestionSearch()) {
      return '';
    }
    const uniqueQuestions = this.getUniqueQuestionsFromResults();
    return this.getQuestionName(uniqueQuestions[0]);
  }

  // Color coding methods for all search result types

  /** How many top combinations are shown on the map/legend by default. */
  private readonly maxDefaultCombinations = 5;

  /** Signatures the user has explicitly pulled in from the "more" overflow list. */
  activeExtraSignatures = new Set<string>();

  /** Signatures the user removed from the default top-5 (via the legend's
   *  ×). These are excluded from the automatic top-5 fill, so the
   *  next-ranked combination bubbles up to take the freed slot — and the
   *  removed one reappears, unchecked, in the "+more" list for undo. */
  hiddenDefaultSignatures = new Set<string>();

  private getUniqueCombinationsForMap(): Map<string, {samples: string[], description: string, count: number}> {
    if (this.searchResults.length === 0) {
      return new Map();
    }

    // Group results by sample similar to comparison table logic
    const sampleMap = new Map<string, Map<string, string>>();

    this.searchResults.forEach(result => {
      const sampleRef = result.sample;
      const questionId = result.question_id || result.category;
      const value = this.getAnswerValue(result);

      if (!sampleMap.has(sampleRef)) {
        sampleMap.set(sampleRef, new Map());
      }
      sampleMap.get(sampleRef)!.set(String(questionId), value);
    });

    // Get unique question IDs in consistent order
    const uniqueQuestionIds = this.getUniqueQuestionsFromResults();

    // Create combination signatures
    const combinations = new Map<string, {samples: string[], description: string, count: number}>();

    sampleMap.forEach((answers, sampleRef) => {
      // Create ordered signature based on question IDs
      const values = uniqueQuestionIds.map(qId => answers.get(String(qId)) || '-');
      const signature = values.join(' | ');

      // Create human-readable description based on single vs multi-question context
      let description: string;
      if (this.isSingleQuestionSearch()) {
        // For single-question searches, show only the answer value
        description = values[0] || '-';
      } else {
        // For multi-question searches, show question name and value
        description = uniqueQuestionIds.map((qId, index) => {
          const fullQuestionName = this.getQuestionName(qId);
          // Extract just the final question name (consistent with table display)
          const finalQuestionName = fullQuestionName.includes(' > ')
            ? fullQuestionName.split(' > ').pop()
            : fullQuestionName;
          const questionName = this.getComparisonTableColumnDisplayName({
            id: qId,
            questionName: fullQuestionName,
            name: finalQuestionName  // Use only final name for consistency
          });
          return `${questionName}: ${values[index]}`;
        }).join(', ');
      }

      if (!combinations.has(signature)) {
        combinations.set(signature, {
          samples: [],
          description: description,
          count: 0
        });
      }

      const combo = combinations.get(signature)!;
      combo.samples.push(sampleRef);
      combo.count = combo.samples.length;
    });

    return combinations;
  }

  private generateStrongColors(): string[] {
    // Strong, high-contrast color palette for better distinguishability
    return [
      '#DC2626', // Red
      '#2563EB', // Blue
      '#059669', // Green
      '#7C3AED', // Purple
      '#EA580C', // Orange
    ];
  }

  private getMarkerShapes(): string[] {
    return ['circle', 'square', 'triangle', 'diamond', 'cross'];
  }

  private getShapeAndColor(index: number): {shape: string, color: string} {
    const colors = this.generateStrongColors();
    const shapes = this.getMarkerShapes();

    // Mixed distribution: different shape and color for consecutive items
    const shape = shapes[index % 5];
    const color = colors[(index + Math.floor(index / 5)) % 5];

    return { shape, color };
  }

  // Cached once per real state change (new search results, or a toggle) —
  // NOT recomputed inline in the template. Angular's *ngFor/*ngIf diff these
  // by reference; calling a method that returns a fresh array/object on every
  // change-detection tick (e.g. from clicking something inside the list)
  // makes Angular tear down and rebuild the DOM nodes mid-interaction —
  // that's what caused the "click flickers, nothing happens" bug.
  private rankedCombinations: RankedCombination[] = [];
  legendData: {color: string, shape: string, description: string, count: number, isExtra: boolean, signature: string}[] = [];
  overflowCombinations: {color: string, shape: string, description: string, count: number, signature: string, active: boolean}[] = [];
  totalCombinationsCount = 0;
  visibleMapSampleCount = 0;

  /** Raw ranking, independent of activeExtraSignatures — count desc,
   *  signature asc tiebreak. The rank is what colors/shapes and the top-5
   *  cutoff key off, so a combination's styling never shifts just because a
   *  sibling was toggled on/off. */
  private computeRankedCombinations(): RankedCombination[] {
    const combinations = this.getUniqueCombinationsForMap();
    return Array.from(combinations.entries())
      .map(([signature, combo]) => ({ signature, ...combo }))
      .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature))
      .map((combo, rank) => ({ ...combo, rank }));
  }

  /** Which signatures fill the default (auto) slots right now — the top
   *  `maxDefaultCombinations` combinations in rank order, skipping any the
   *  user has explicitly removed. Skipping a rank lets the next one bubble
   *  up to fill its slot, so removing a default item never just leaves a gap. */
  private computeDefaultVisibleSignatures(ranked: RankedCombination[]): Set<string> {
    const defaultVisible = new Set<string>();
    for (const combo of ranked) {
      if (defaultVisible.size >= this.maxDefaultCombinations) break;
      if (this.hiddenDefaultSignatures.has(combo.signature)) continue;
      defaultVisible.add(combo.signature);
    }
    return defaultVisible;
  }

  /** Recomputes rankedCombinations plus every field derived from it. Call
   *  whenever searchResults, activeExtraSignatures or hiddenDefaultSignatures
   *  actually changes — never from the template (see the caching note above). */
  private refreshMapCombinations(): void {
    this.rankedCombinations = this.computeRankedCombinations();
    const ranked = this.rankedCombinations;
    this.totalCombinationsCount = ranked.length;

    let visibleSignatures: Set<string>;

    if (ranked.length <= 1) {
      this.legendData = [];
      this.overflowCombinations = [];
      // No combination styling in play — every sample counts as "visible".
      visibleSignatures = new Set(ranked.map(c => c.signature));
    } else {
      const defaultVisible = this.computeDefaultVisibleSignatures(ranked);

      // An extra that has naturally bubbled into the default fill (e.g. its
      // higher-ranked sibling was removed) doesn't need to be tracked as an
      // "extra" anymore — keeps state minimal and mapExtra URL param short.
      for (const sig of Array.from(this.activeExtraSignatures)) {
        if (defaultVisible.has(sig)) this.activeExtraSignatures.delete(sig);
      }

      this.legendData = ranked
        .filter(combo => defaultVisible.has(combo.signature) || this.activeExtraSignatures.has(combo.signature))
        .map(combo => ({
          ...this.getShapeAndColor(combo.rank),
          description: combo.description,
          count: combo.count,
          isExtra: !defaultVisible.has(combo.signature),
          signature: combo.signature,
        }));

      this.overflowCombinations = ranked
        .filter(combo => !defaultVisible.has(combo.signature))
        .map(combo => ({
          ...this.getShapeAndColor(combo.rank),
          description: combo.description,
          count: combo.count,
          signature: combo.signature,
          active: this.activeExtraSignatures.has(combo.signature),
        }));

      // Reuse defaultVisible instead of having getVisibleCombinationSamples
      // recompute the identical skip-hidden-take-5 scan a second time.
      visibleSignatures = new Set([...defaultVisible, ...this.activeExtraSignatures]);
    }

    const visibleSamples = this.getVisibleCombinationSamples(ranked, visibleSignatures);
    this.visibleMapSampleCount = this.getUniqueSearchResultSamples().filter(s => visibleSamples.has(s)).length;
  }

  trackBySignature(_index: number, item: { signature: string }): string {
    return item.signature;
  }

  /** Toggles a combination from the "+more" checklist — covers both
   *  never-shown overflow items and any default top-5 item the user
   *  previously removed via ×. */
  toggleExtraCombination(signature: string): void {
    if (this.activeExtraSignatures.has(signature)) {
      this.activeExtraSignatures.delete(signature);
    } else {
      this.activeExtraSignatures.add(signature);
      this.hiddenDefaultSignatures.delete(signature);
    }
    this.refreshMapCombinations();
    this.syncMapExtraToUrl();
    if (this.mapInitialized) {
      this.updateMapMarkers(true);
    }
  }

  /** Removes a currently-visible combination — works for both the default
   *  top 5 and any activated extra, unlike toggleExtraCombination which only
   *  covers the overflow checklist. Reversible via the "+more" checklist. */
  removeCombination(signature: string): void {
    if (this.activeExtraSignatures.has(signature)) {
      this.activeExtraSignatures.delete(signature);
    } else {
      this.hiddenDefaultSignatures.add(signature);
    }
    this.refreshMapCombinations();
    this.syncMapExtraToUrl();
    if (this.mapInitialized) {
      this.updateMapMarkers(true);
    }
  }

  /** Persists activeExtraSignatures/hiddenDefaultSignatures as rank indices
   *  (stable within this result set) so the customized map legend can be
   *  bookmarked/shared. Safe to call whenever either Set might have changed
   *  (including as a side effect of refreshMapCombinations pruning stale
   *  extras) — a no-op navigation when the URL already matches is skipped,
   *  so hydrateMapExtraFromUrl can call this on every search-results
   *  refresh without spamming redundant router navigations. */
  private syncMapExtraToUrl(): void {
    const ranksFor = (signatures: Set<string>) => this.rankedCombinations
      .filter(c => signatures.has(c.signature))
      .map(c => c.rank)
      .join(',');
    const extra = ranksFor(this.activeExtraSignatures);
    const hidden = ranksFor(this.hiddenDefaultSignatures);
    const snap = this.urlState.snapshot();
    if ((snap.get('mapExtra') ?? '') === extra && (snap.get('mapHidden') ?? '') === hidden) {
      return;
    }
    this.urlState.patch({
      mapExtra: extra || null,
      mapHidden: hidden || null,
    }, { replaceUrl: true });
  }

  private getSampleCombinationStyle(sampleRef: string): {shape: string, color: string} | null {
    // Only apply styles if there are multiple unique combinations
    if (this.rankedCombinations.length <= 1) {
      return null;
    }

    const combo = this.rankedCombinations.find(c => c.samples.includes(sampleRef));
    return combo ? this.getShapeAndColor(combo.rank) : null;
  }

  /** Samples belonging to a combination currently shown (default top 5,
   *  minus removed ones, plus activated extras). Accepts an already-ranked
   *  list and visible-signature set when the caller has one on hand
   *  (refreshMapCombinations) to avoid re-scanning; recomputes both when
   *  called standalone (e.g. from updateMapMarkers). */
  private getVisibleCombinationSamples(
    ranked: RankedCombination[] = this.rankedCombinations,
    visibleSignatures?: Set<string>,
  ): Set<string> {
    if (ranked.length <= 1) {
      // No combination styling in play — every sample is "visible".
      return new Set(this.getUniqueSearchResultSamples());
    }
    if (!visibleSignatures) {
      const defaultVisible = this.computeDefaultVisibleSignatures(ranked);
      visibleSignatures = new Set([...defaultVisible, ...this.activeExtraSignatures]);
    }
    const visible = new Set<string>();
    ranked
      .filter(combo => visibleSignatures!.has(combo.signature))
      .forEach(combo => combo.samples.forEach(s => visible.add(s)));
    return visible;
  }

  private createStyledMarker(lat: number, lng: number, shape: string, color: string): L.Marker {
    let html: string;

    // Create different HTML based on shape
    switch (shape) {
      case 'triangle':
        html = `<div style="width: 0; height: 0; border-left: 10px solid transparent; border-right: 10px solid transparent; border-bottom: 16px solid ${color}; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));"></div>`;
        break;
      case 'cross':
        html = `<div style="position: relative; width: 16px; height: 16px;">
                  <div style="position: absolute; width: 16px; height: 3px; top: 6px; left: 0; background-color: ${color}; border: 1px solid white; box-shadow: 0 1px 2px rgba(0,0,0,0.3);"></div>
                  <div style="position: absolute; width: 3px; height: 16px; top: 0; left: 6px; background-color: ${color}; border: 1px solid white; box-shadow: 0 1px 2px rgba(0,0,0,0.3);"></div>
                </div>`;
        break;
      case 'diamond':
        html = `<div style="width: 16px; height: 16px; background-color: ${color}; transform: rotate(45deg); border-radius: 3px; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`;
        break;
      case 'square':
        html = `<div style="width: 16px; height: 16px; background-color: ${color}; border-radius: 3px; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`;
        break;
      default: // circle
        html = `<div style="width: 16px; height: 16px; background-color: ${color}; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`;
        break;
    }

    const icon = L.divIcon({
      className: 'styled-marker',
      html: html,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -10]
    });

    return L.marker([lat, lng], { icon });
  }

  // Modal methods
  openPhrasesModalFromComparison(sampleRef: string, questionId: any): void {
    // Find the search result that matches this sample and question
    // Use string comparison to avoid type mismatches (number vs string)
    const qid = String(questionId);
    const result = this.searchResults.find(r =>
      r.sample === sampleRef && (String(r.question_id) === qid || String(r.category) === qid)
    );

    if (result) {
      this.openPhrasesModal(result);
    }
  }

  openPhrasesModal(result: any): void {
    // Pass the full answer/search-result object through — the modal needs
    // more than _key now (question_id, sample, and any phrase_overrides/
    // transcription_overrides) to use the cheaper by-category lookup.
    this.modalAnswer = result;

    // Get the answer value for the title
    const answerValue = this.getAnswerValue(result);
    const questionHierarchy = this.getQuestionHierarchy(result);

    this.modalTitle = `Phrases for ${result.sample} - ${questionHierarchy}`;
    this.showPhrasesModal = true;
  }

  private addMapPopupEventListeners(sample: any, sampleResults: any[]): void {
    // Use setTimeout to ensure DOM is ready
    setTimeout(() => {
      // Only target clickable-result elements within map popups, not the entire page
      const mapPopups = document.querySelectorAll('.leaflet-popup-content .clickable-result');
      mapPopups.forEach((element: Element) => {
        element.addEventListener('click', (event: Event) => {
          event.preventDefault();
          event.stopPropagation();

          const target = event.currentTarget as HTMLElement;
          const resultIndex = parseInt(target.getAttribute('data-result-index') || '0', 10);
          const result = sampleResults[resultIndex];

          if (result) {
            this.openPhrasesModal(result);
          }
        });
      });
    }, 100);
  }

  closePhrasesModal(): void {
    this.showPhrasesModal = false;
    this.modalAnswer = null;
    this.modalTitle = 'Related Phrases and Connected Speech';
  }

  // Edit dialog methods
  openEditDialog(result: any): void {
    const { fieldName, currentValue } = this.getPrimaryFieldForResult(result);
    this.editModalAnswerKey = result._key ?? '';
    this.editModalFieldName = fieldName;
    this.editModalCurrentValue = currentValue;
    this.editModalQuestionName = this.getQuestionHierarchy(result);
    this.editModalSampleRef = result.sample;
    this.editModalQuestionId = String(result.question_id || result.category || '');
    this.editModalResult = result;
    this.showEditModal = true;

    const sampleRef = this.editModalSampleRef;
    const categoryId = Number(this.editModalQuestionId);
    const toPhraseList = (phrases: any[]): PhraseListItem[] =>
      (phrases ?? []).map((p: any) => ({ phrase_ref: p.phrase_ref, english: p.english, phrase: p.phrase }));

    this.pendingPhraseAssociationChanges = null;
    this.editModalStandardPhrases = [];
    this.editModalResolvedPhrases = [];
    this.editModalPhrasesLoading = true;
    forkJoin([
      this.dataService.getMasterPhrasesByCategory(categoryId, sampleRef),
      this.dataService.getRelatedContent(categoryId, sampleRef)
    ]).subscribe({
      next: ([standard, { phrases: resolved }]) => {
        this.editModalStandardPhrases = toPhraseList(standard);
        this.editModalResolvedPhrases = toPhraseList(resolved);
        this.editModalPhrasesLoading = false;
      },
      error: (err) => { console.error('Error loading associated phrases:', err); this.editModalPhrasesLoading = false; }
    });

    if (!this.allPhrasesCache.has(sampleRef)) {
      this.dataService.getAllPhrasesForSample(sampleRef).subscribe({
        next: (list) => { this.allPhrasesCache.set(sampleRef, list); },
        error: (err) => console.error('Error loading phrase list for sample:', err)
      });
    }
  }

  get editModalAllPhrases(): PhraseListItem[] {
    return this.allPhrasesCache.get(this.editModalSampleRef) ?? [];
  }

  onPhraseAssociationsConfirmed(changes: PhraseAssociationChange[] | null): void {
    this.pendingPhraseAssociationChanges = changes;
  }

  private applyPhraseAssociationChanges(changes: PhraseAssociationChange[], sampleRef: string, categoryId: number): void {
    changes.forEach(change => {
      const key = `${sampleRef}_${change.phrase_ref}`;
      this.dataService.getPhraseLinks(key).subscribe({
        next: (links) => {
          const overrides = links.question_overrides ?? { include: [], exclude: [] };
          const include = new Set(overrides.include ?? []);
          const exclude = new Set(overrides.exclude ?? []);
          switch (change.action) {
            case 'exclude': exclude.add(categoryId); include.delete(categoryId); break;
            case 'restore': exclude.delete(categoryId); break;
            case 'add': include.add(categoryId); exclude.delete(categoryId); break;
            case 'remove': include.delete(categoryId); break;
          }
          this.dataService.updatePhrase(key, { question_overrides: { include: [...include], exclude: [...exclude] } })
            .subscribe({
              next: () => this.dataService.invalidatePhrasesCache(sampleRef),
              error: (err) => console.error(`Error saving phrase association for ${change.phrase_ref}:`, err)
            });
        },
        error: (err) => console.error(`Error loading phrase links for ${change.phrase_ref}:`, err)
      });
    });
  }

  openEditDialogFromComparison(sampleRef: string, questionId: any, event: Event): void {
    event.stopPropagation();
    const qid = String(questionId);
    const result = this.searchResults.find(r =>
      r.sample === sampleRef && (String(r.question_id) === qid || String(r.category) === qid)
    );
    if (result) {
      this.openEditDialog(result);
    }
  }

  onEditConfirmed({ fieldName, newValue }: { fieldName: string; newValue: string }): void {
    this.showEditModal = false;
    const answerKey = this.editModalAnswerKey;
    const result = this.editModalResult;
    const phraseChanges = this.pendingPhraseAssociationChanges;
    this.pendingPhraseAssociationChanges = null;
    if (phraseChanges) {
      this.applyPhraseAssociationChanges(phraseChanges, this.editModalSampleRef, Number(this.editModalQuestionId));
    }

    if (!answerKey) {
      if (!newValue) return;
      this.dataService.createAnswer(Number(this.editModalQuestionId), this.editModalSampleRef, fieldName, newValue).subscribe({
        next: (created) => this.updateResultInPlace(result, created),
        error: (err) => console.error('Error creating answer:', err)
      });
      return;
    }

    if (!newValue) {
      this.dataService.deleteAnswer(answerKey).subscribe({
        next: () => this.updateResultInPlace(result, { ...result, [fieldName]: null }),
        error: (err) => console.error('Error deleting answer:', err)
      });
      return;
    }

    this.dataService.patchAnswer(answerKey, { [fieldName]: newValue }).subscribe({
      next: () => this.updateResultInPlace(result, { ...result, [fieldName]: newValue }),
      error: (err) => console.error('Error saving answer:', err)
    });
  }

  onEditCancelled(): void {
    this.showEditModal = false;
    this.pendingPhraseAssociationChanges = null;
    this.editModalStandardPhrases = [];
    this.editModalResolvedPhrases = [];
  }

  private getPrimaryFieldForResult(result: any): { fieldName: string; currentValue: string } {
    for (const field of ANSWER_VALUE_FIELDS) {
      if (result[field] !== undefined && result[field] !== null && result[field] !== '') {
        return { fieldName: field, currentValue: String(result[field]) };
      }
    }
    const fields = this.getDisplayFields(result);
    if (fields.length > 0) {
      return { fieldName: fields[0].key, currentValue: String(fields[0].value ?? '') };
    }
    return { fieldName: ANSWER_VALUE_FIELDS[0], currentValue: '' };
  }

  private updateResultInPlace(result: any, updated: any): void {
    const index = this.searchResults.indexOf(result);
    if (index >= 0) {
      this.searchResults = [
        ...this.searchResults.slice(0, index),
        { ...result, ...updated },
        ...this.searchResults.slice(index + 1)
      ];
    }
  }

  // Export methods
  openExportModal(): void {
    this.exportModalComponent.open();
  }

  confirmExport(format: ExportFormat): void {
    const details = this.exportIncludeSampleDetails ? this.buildSampleDetailsMap() : undefined;

    if (this.currentView === 'comparison') {
      this.exportComparison(format, details);
    } else {
      this.exportList(format, details);
    }
  }

  private exportList(format: ExportFormat, sampleDetails?: Map<string, SampleDetails>): void {
    const hiddenFields = ['_id', '_key', '_rev', 'question_id', 'category', 'tags'];
    this.exportService.exportList(this.searchResults, hiddenFields, ANSWER_VALUE_FIELDS, format, undefined, sampleDetails);
  }

  private exportComparison(format: ExportFormat, sampleDetails?: Map<string, SampleDetails>): void {
    const questionColumns = this.getComparisonTableColumns().map(col => ({
      id: this.getComparisonTableColumnId(col),
      displayName: this.getComparisonTableColumnDisplayName(col),
      hierarchy: this.getComparisonTableColumnHierarchy(col)
    }));
    this.exportService.exportComparison(
      this.searchResults,
      questionColumns,
      (result: any) => this.getAnswerValue(result),
      format,
      undefined,
      sampleDetails
    );
  }

  private buildSampleDetailsMap(): Map<string, SampleDetails> {
    const map = new Map<string, SampleDetails>();
    for (const sample of this.samples) {
      const langsBySource: Record<string, string[]> = {};
      if (Array.isArray(sample.contact_languages)) {
        for (const l of sample.contact_languages) {
          const source = l.source ?? '';
          if (!langsBySource[source]) langsBySource[source] = [];
          langsBySource[source].push(l.language);
        }
      }
      map.set(sample.sample_ref, {
        dialect_group_name: sample.dialect_group_name ?? '',
        location: sample.location ?? '',
        latitude: sample.coordinates?.latitude?.toString() ?? '',
        longitude: sample.coordinates?.longitude?.toString() ?? '',
        'Current-L2': (langsBySource['Current-L2'] ?? []).join(', '),
        'Recent-L2': (langsBySource['Recent-L2'] ?? []).join(', '),
        'Old-L2': (langsBySource['Old-L2'] ?? []).join(', ')
      });
    }
    return map;
  }
}
