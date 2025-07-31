import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SearchStateService } from '../api/search-state.service';
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
    return this.selectedCategories.length > 0 && 
           this.selectedCategories.length < 5 && 
           this.searchResults.length > 0;
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
    const category = this.selectedCategories.find(c => c.id == questionId);
    return category ? category.name : questionId.toString();
  }

  getAnswerForSample(sampleData: any, questionId: any): string {
    return sampleData.answers.get(questionId) || '-';
  }
}
