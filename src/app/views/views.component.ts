import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SearchStateService } from '../api/search-state.service';
import { SearchContext } from '../api/data.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-views',
  imports: [CommonModule, RouterModule],
  templateUrl: './views.component.html',
  styleUrl: './views.component.scss'
})
export class ViewsComponent implements OnInit, OnDestroy {
  selectedSamples: any[] = [];
  selectedCategories: any[] = [];
  searchResults: any[] = [];
  searchStatus: string = '';
  searchString: string = '';
  showComparisonTable: boolean = false;
  searchContext: SearchContext = { currentSample: null, searchCriteria: [], type: 'simple' };
  
  private subscriptions: Subscription[] = [];

  constructor(private searchStateService: SearchStateService) {}

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

  ngOnDestroy(): void {
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
      if (parsed.searchCriteria && Array.isArray(parsed.searchCriteria)) {
        // Update unified search context with parsed criteria
        const context = this.searchStateService.getSearchContext();
        this.searchStateService.setSearchContext({
          ...context,
          searchCriteria: parsed.searchCriteria,
          type: 'criteria'
        });
      }
    } catch (error) {
      // If parsing fails, it's probably a regular search string, not search criteria
      console.log('Regular search string, not search criteria');
    }
  }

  isSearchCriteriaResults(): boolean {
    return this.searchContext.searchCriteria.length > 0;
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
    if (!result || !this.selectedCategories) return '';
    
    // Try to find the category by question_id or category field
    const questionId = result.question_id || result.category;
    if (!questionId) return '';
    
    const category = this.selectedCategories.find(c => c.id == questionId);
    if (!category) return questionId.toString();
    
    // Build hierarchy like in search page
    if (category.hierarchy && category.hierarchy.length > 1) {
      return category.hierarchy.slice(0, -1).join(' > ') + ' > ' + category.name;
    }
    
    return category.name || questionId.toString();
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

  toggleComparisonView(): void {
    this.showComparisonTable = !this.showComparisonTable;
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
    // First try to find in selected categories (regular search)
    const category = this.selectedCategories.find(c => c.id == questionId);
    if (category) {
      // Return full hierarchy if available, otherwise just the name
      if (category.hierarchy && category.hierarchy.length > 0) {
        return category.hierarchy.join(' > ');
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
}
