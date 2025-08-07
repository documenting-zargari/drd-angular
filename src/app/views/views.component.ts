import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SearchStateService } from '../api/search-state.service';
import { SearchContext, DataService } from '../api/data.service';
import { Subscription } from 'rxjs';
import * as L from 'leaflet';

@Component({
  selector: 'app-views',
  imports: [CommonModule, RouterModule],
  templateUrl: './views.component.html',
  styleUrl: './views.component.scss'
})
export class ViewsComponent implements OnInit, OnDestroy, AfterViewInit {
  selectedSamples: any[] = [];
  selectedCategories: any[] = [];
  searchResults: any[] = [];
  searchStatus: string = '';
  searchString: string = '';
  showComparisonTable: boolean = false;
  currentView: 'list' | 'comparison' | 'map' = 'list';
  
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
    this.searchStateService.clearSearchState();
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
    const hiddenFields = ['_id', 'question_id', 'sample', 'category', '_key', 'tag'];
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
        
        // Get color for this sample if using multiple search criteria
        const color = this.getSampleCombinationColor(sampleRef);
        
        // Create marker - colored or default
        const marker = color 
          ? this.createColoredMarker(lat, lng, color)
          : L.marker([lat, lng]);
        
        marker.addTo(this.map!);
        
        // Get search results for this sample
        const sampleResults = this.searchResults.filter(r => r.sample === sampleRef);
        
        // Create popup content
        const popupContent = this.createMapPopupContent(sample, sampleResults);
        marker.bindPopup(popupContent);
        
        bounds.extend([lat, lng]);
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
        <h6><strong>${sample.sample_ref}</strong></h6>
        <p class="mb-1">${sample.dialect_name || 'Unknown dialect'}</p>
        <p class="mb-2 text-muted small">${sample.location || 'Location unknown'}</p>
    `;

    if (sampleResults.length > 0) {
      content += '<div class="search-results-summary"><strong>Search Results:</strong><ul class="mb-2">';
      sampleResults.forEach(result => {
        const questionName = this.getQuestionHierarchy(result);
        const value = this.getAnswerValue(result);
        content += `<li class="small">${questionName}: ${value}</li>`;
      });
      content += '</ul></div>';
    }

    content += `
        <a href="/samples/${sample.sample_ref}" class="btn btn-sm btn-outline-primary">
          View Details
        </a>
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
      
      // Create human-readable description
      const description = uniqueQuestionIds.map((qId, index) => {
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

  private generateElegantColors(count: number): string[] {
    // Subdued, elegant color palette for academic/research use
    const baseColors = [
      '#64748B', // Slate Blue
      '#8B5CF6', // Muted Purple  
      '#10B981', // Forest Green
      '#78716C', // Warm Gray
      '#F59E0B', // Soft Amber
      '#06B6D4', // Ocean Blue
      '#F43F5E', // Dusty Rose
      '#8D4C32', // Terracotta
      '#6D7C2F', // Olive Green
      '#9F7AEA', // Lavender
      '#2D7D8A', // Teal
      '#B45309'  // Bronze
    ];

    if (count <= baseColors.length) {
      return baseColors.slice(0, count);
    }

    // Generate additional colors using HSL with subdued values
    const colors = [...baseColors];
    const additionalNeeded = count - baseColors.length;
    
    for (let i = 0; i < additionalNeeded; i++) {
      const hue = (i * 137.5) % 360; // Golden angle distribution
      const saturation = 45 + (i % 3) * 10; // 45-65% saturation
      const lightness = 50 + (i % 2) * 10;  // 50-60% lightness
      colors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
    }

    return colors;
  }

  buildLegendData(): {color: string, description: string, count: number}[] {
    const combinations = this.getUniqueCombinationsForMap();
    // Only show legend if there are multiple unique combinations (regardless of search type)
    if (combinations.size <= 1) {
      return [];
    }

    const colors = this.generateElegantColors(combinations.size);
    const legendData: {color: string, description: string, count: number}[] = [];
    
    let colorIndex = 0;
    combinations.forEach((combo, signature) => {
      legendData.push({
        color: colors[colorIndex],
        description: combo.description,
        count: combo.count
      });
      colorIndex++;
    });

    // Sort by count descending for better visual organization
    return legendData.sort((a, b) => b.count - a.count);
  }

  private getSampleCombinationColor(sampleRef: string): string | null {
    const combinations = this.getUniqueCombinationsForMap();
    // Only apply colors if there are multiple unique combinations
    if (combinations.size <= 1) {
      return null;
    }

    const colors = this.generateElegantColors(combinations.size);
    
    let colorIndex = 0;
    for (const [signature, combo] of combinations) {
      if (combo.samples.includes(sampleRef)) {
        return colors[colorIndex];
      }
      colorIndex++;
    }
    
    return null;
  }

  private createColoredMarker(lat: number, lng: number, color: string): L.Marker {
    const icon = L.divIcon({
      className: 'colored-marker',
      html: `
        <div class="marker-pin" style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); position: relative;">
          <div style="width: 6px; height: 6px; background-color: rgba(255,255,255,0.9); border-radius: 50%; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);"></div>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    return L.marker([lat, lng], { icon });
  }
}
