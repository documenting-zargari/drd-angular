import { Component, OnInit, OnDestroy, AfterViewInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SearchStateService } from '../api/search-state.service';
import { SearchContext, DataService } from '../api/data.service';
import { PhraseTranscriptionModalComponent } from '../shared/phrase-transcription-modal/phrase-transcription-modal.component';
import { Subscription } from 'rxjs';
import * as L from 'leaflet';

@Component({
  selector: 'app-views',
  imports: [CommonModule, RouterModule, PhraseTranscriptionModalComponent],
  templateUrl: './views.component.html',
  styleUrl: './views.component.scss'
})
export class ViewsComponent implements OnInit, OnDestroy, AfterViewInit {
  @Output() clearAllRequested = new EventEmitter<void>();
  
  selectedSamples: any[] = [];
  selectedCategories: any[] = [];
  searchResults: any[] = [];
  searchStatus: string = '';
  searchString: string = '';
  showComparisonTable: boolean = false;
  currentView: 'list' | 'comparison' | 'map' = 'list';
  
  // Modal properties
  showPhrasesModal: boolean = false;
  modalAnswer: any = null;
  modalTitle: string = 'Related Phrases and Connected Speech';
  
  // Map properties
  private map: L.Map | undefined;
  private samples: any[] = [];
  mapInitialized = false;
  searchContext: SearchContext = { 
    selectedQuestions: [],
    selectedSamples: [],
    searches: [], 
    searchResults: [],
    searchStatus: '',
    searchString: '',
    isLoading: false,
    searchType: 'none',
    lastSearchMethod: null,
    currentSample: null 
  };
  
  private subscriptions: Subscription[] = [];

  constructor(
    private searchStateService: SearchStateService,
    private dataService: DataService
  ) {}

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
      }),
      this.searchStateService.searchStatus$.subscribe(status => {
        this.searchStatus = status;
      }),
      this.searchStateService.searchString$.subscribe(searchString => {
        this.searchString = searchString;
        this.parseSearchString();
      }),
      // Subscribe to unified search context
      this.searchStateService.searchContext$.subscribe(context => {
        this.searchContext = context;
      })
    );
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

  private parseSearchString(): void {
    // This method is now less important since we have unified search context
    // but we keep it for backward compatibility with existing search strings
    if (!this.searchString) {
      return;
    }

    try {
      const parsed = JSON.parse(this.searchString);
      if (parsed.searches && Array.isArray(parsed.searches)) {
        // Update unified search context with parsed criteria
        const context = this.searchStateService.getSearchContext();
        this.searchStateService.setSearchContext({
          ...context,
          searches: parsed.searches,
          searchType: 'criteria'
        });
      }
    } catch (error) {
      // If parsing fails, it's probably a regular search string, not search criteria
      console.log('Regular search string, not search criteria');
    }
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
    const hiddenFields = ['_id', 'question_id', 'sample', 'category', '_key', 'tag', 'tags'];
    return hiddenFields.includes(fieldName);
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
      const hierarchyWithoutRMS = result.hierarchy.filter((item: string) => item !== 'RMS');
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
        const hierarchyWithoutRMS = cachedCategory.hierarchy.filter((item: string) => item !== 'RMS');
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
          const hierarchyWithoutRMS = category.hierarchy.filter((item: string) => item !== 'RMS');
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
    this.currentView = view;
    // Update legacy showComparisonTable for backward compatibility
    this.showComparisonTable = view === 'comparison';
    
    // Initialize map when switching to map view
    if (view === 'map') {
      // Let initializeMap handle everything with proper timing
      setTimeout(() => {
        this.initializeMap();
      }, 100);
    }
  }

  toggleComparisonView(): void {
    // Legacy method - redirect to new view system
    this.setView(this.showComparisonTable ? 'list' : 'comparison');
  }

  getAnswerValue(result: any): string {
    // Priority order: form, marker, then other fields
    if (result.form && result.form.toString().trim()) {
      return result.form.toString().trim();
    }
    if (result.marker && result.marker.toString().trim()) {
      return result.marker.toString().trim();
    }
    
    // Fallback to first non-hidden field value
    const fields = this.getDisplayFields(result);
    if (fields.length > 0) {
      return fields[0].value ? fields[0].value.toString() : '-';
    }
    
    return '-';
  }

  getComparisonTableData(): any[] {
    // Group results by sample_ref
    const sampleMap = new Map<string, any>();
    
    this.searchResults.forEach(result => {
      const sampleRef = result.sample;
      if (!sampleMap.has(sampleRef)) {
        sampleMap.set(sampleRef, { sample_ref: sampleRef, answers: new Map() });
      }
      
      const questionId = result.question_id || result.category;
      const answer = this.getAnswerValue(result);
      sampleMap.get(sampleRef)!.answers.set(questionId, answer);
    });
    
    // Convert to array format for table display
    return Array.from(sampleMap.values()).map(sample => ({
      sample_ref: sample.sample_ref,
      answers: sample.answers
    }));
  }

  getQuestionName(questionId: any): string {
    // First check the shared category cache
    const cachedCategory = this.searchStateService.getCategoryCache(questionId);
    if (cachedCategory) {
      // Return full hierarchy without "RMS" if available, otherwise just the name
      if (cachedCategory.hierarchy && cachedCategory.hierarchy.length > 0) {
        const hierarchyWithoutRMS = cachedCategory.hierarchy.filter((item: string) => item !== 'RMS');
        return hierarchyWithoutRMS.join(' > ');
      }
      return cachedCategory.name;
    }

    // Try to find in selected categories (regular search fallback)
    const category = this.selectedCategories.find(c => c.id == questionId);
    if (category) {
      // Return full hierarchy without "RMS" if available, otherwise just the name
      if (category.hierarchy && category.hierarchy.length > 0) {
        const hierarchyWithoutRMS = category.hierarchy.filter((item: string) => item !== 'RMS');
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
        const hierarchyWithoutRMS = cachedCategory.hierarchy.filter((item: string) => item !== 'RMS');
        return hierarchyWithoutRMS.join(' > ');
      }
      return cachedCategory.name;
    }

    // Try to find in selected categories (regular search fallback)
    const category = this.selectedCategories.find(c => c.id == questionId);
    if (category) {
      // Return full hierarchy without "RMS" if available, otherwise just the name
      if (category.hierarchy && category.hierarchy.length > 0) {
        const hierarchyWithoutRMS = category.hierarchy.filter((item: string) => item !== 'RMS');
        return hierarchyWithoutRMS.join(' > ');
      }
      return category.name;
    }

    // For search criteria results, we don't have category data readily available
    // Return a simple format - breadcrumb computation would require additional API calls
    return `Question ${questionId}`;
  }

  getAnswerForSample(sampleData: any, questionId: any): string {
    return sampleData.answers.get(questionId) || '-';
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
        return parts.slice(0, -1); // Return hierarchy without the final name
      }
      return [];
    } else {
      // For regular search results, use category hierarchy
      if (column.hierarchy && column.hierarchy.length > 1) {
        return column.hierarchy.slice(0, -1);
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

  private initializeMap(): void {
    if (this.mapInitialized && this.map) {
      // Map exists, invalidate size and update markers with proper timing
      this.map.invalidateSize();
      setTimeout(() => {
        this.updateMapMarkers();
      }, 100);
      return;
    }
    
    // Make sure samples are loaded
    if (this.samples.length === 0) {
      this.loadSamplesForMap();
    }

    // Initialize the map
    this.map = L.map('searchResultsMap').setView([46, 2], 4);
    
    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    this.mapInitialized = true;
    
    // Update markers with proper delay to ensure map is fully ready
    setTimeout(() => {
      this.updateMapMarkers();
    }, 100);
  }

  private updateMapMarkers(): void {
    if (!this.map) return;

    // Clear existing markers
    this.map.eachLayer((layer: any) => {
      if (layer instanceof L.Marker) {
        this.map!.removeLayer(layer);
      }
    });

    // Get unique samples from search results
    const searchResultSamples = this.getUniqueSearchResultSamples();
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

    // Fit map to markers if any were added
    if (markersAdded > 0) {
      this.map.fitBounds(bounds, { padding: [20, 20] });
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
        content += `<div class="clickable-result d-flex align-items-center mb-2" data-result-index="${index}" title="Click to view phrases and connected speech">
          <i class="bi bi-chat-text me-2 text-primary clickable-icon fs-5" data-result-index="${index}" title="Click to view phrases and connected speech"></i>
          <span class="question-name">${questionName}:</span> <span class="answer-value">${value}</span>
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

  buildLegendData(): {color: string, description: string, count: number, shape: string}[] {
    const combinations = this.getUniqueCombinationsForMap();
    // Only show legend if there are multiple unique combinations (regardless of search type)
    if (combinations.size <= 1) {
      return [];
    }

    const legendData: {color: string, description: string, count: number, shape: string}[] = [];
    
    let index = 0;
    combinations.forEach((combo, signature) => {
      const { shape, color } = this.getShapeAndColor(index);
      legendData.push({
        color,
        shape,
        description: combo.description,
        count: combo.count
      });
      index++;
    });

    // Sort by count descending for better visual organization
    return legendData.sort((a, b) => b.count - a.count);
  }

  private getSampleCombinationStyle(sampleRef: string): {shape: string, color: string} | null {
    const combinations = this.getUniqueCombinationsForMap();
    // Only apply styles if there are multiple unique combinations
    if (combinations.size <= 1) {
      return null;
    }
    
    let index = 0;
    for (const [signature, combo] of combinations) {
      if (combo.samples.includes(sampleRef)) {
        return this.getShapeAndColor(index);
      }
      index++;
    }
    
    return null;
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
    const result = this.searchResults.find(r => 
      r.sample === sampleRef && (r.question_id === questionId || r.category === questionId)
    );
    
    if (result) {
      this.openPhrasesModal(result);
    }
  }

  openPhrasesModal(result: any): void {
    // Create an answer object compatible with the modal component
    // The modal expects an answer with _key property
    this.modalAnswer = {
      _key: result._key,
      tags: result.tags
    };

    // Get the answer value for the title
    const answerValue = this.getAnswerValue(result);
    const questionHierarchy = this.getQuestionHierarchy(result);

    this.modalTitle = `Phrases for ${result.sample} - ${questionHierarchy}: "${answerValue}"`;
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
}
