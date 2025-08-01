import { Component, OnDestroy, OnInit, ViewChild, ElementRef, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { DataService } from '../api/data.service';
import { SearchStateService } from '../api/search-state.service';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
declare var bootstrap: any;

@Component({
  selector: 'app-search',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss'
})
export class SearchComponent implements OnInit, OnDestroy {
  @ViewChild('categorySearchInput') categorySearchInput!: ElementRef;
  @Output() searchCompleted = new EventEmitter<void>();
  
  // Development: disable some categories which are not yet imported
  cutoff = 100000 // category ID

  samples : any[] = []
  selectedSamples: any[] = []
  filteredSamples: any[] = []
  categories : any[] = []
  selectedCategories: any[] = []
  searchString = ''
  expandedCategories: Set<number> = new Set()
  loadingCategories: Set<number> = new Set()
  searchResult = ''
  results: any[] = []
  status = ''
  categorySearchString = '';
  categorySearchResults: any[] = [];
  showAdvanced: boolean = false;
  private categorySearchSubject = new Subject<string>();
  private categorySearchSubscription?: Subscription;
  private subscriptions: Subscription[] = [];
  pub = false;
  migrant = true;
  sampleSearchTerm: string = '';

  constructor(
    private dataService: DataService,
    public searchStateService: SearchStateService,
    private router: Router
  ) {
    this.dataService.getSamples().subscribe(samples => {
      this.samples = samples
      this.samples.forEach(sample => sample.selected = false)
      this.samples.forEach(sample => sample.migrant = sample.migrant == "Yes" ? true : false)
      this.filteredSamples = this.samples
      
      // Restore state after samples are loaded
      this.restoreStateFromService()
      this.filterSamples()
    })
    this.dataService.getCategories().subscribe(categories => {
      this.categories = this.initializeCategoriesHierarchy(categories)
    })

    this.categorySearchSubscription = this.categorySearchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(searchTerm => {
        if (!searchTerm || searchTerm.trim() === '' || searchTerm.trim().length < 2) {
          this.categorySearchResults = [];
          return [];
        }
        return this.dataService.searchCategories(searchTerm);
      })
    ).subscribe({
      next: (categories) => {
        this.categorySearchResults = categories;
      },
      error: (error) => {
        console.error('Error fetching categories:', error);
        this.categorySearchResults = [];
      }
    });
  }

  ngOnInit(): void {
    // State restoration is now handled in constructor after samples load
  }

  private restoreStateFromService(): void {
    // Restore state from service
    this.selectedSamples = this.searchStateService.getCurrentSelectedSamples();
    this.selectedCategories = this.searchStateService.getCurrentSelectedCategories();
    this.results = this.searchStateService.getCurrentSearchResults();
    this.searchString = this.searchStateService.getCurrentSearchString();
    this.expandedCategories = this.searchStateService.getCurrentExpandedCategories();
    const filterStates = this.searchStateService.getCurrentFilterStates();
    this.pub = filterStates.pub;
    this.migrant = filterStates.migrant;
    
    // Get status from service - need to add this to service
    this.subscriptions.push(
      this.searchStateService.searchStatus$.subscribe(status => {
        this.status = status;
      })
    );
    
    // Update sample selection state to match restored selections
    this.samples.forEach(sample => {
      sample.selected = this.selectedSamples.some(s => s.sample_ref === sample.sample_ref);
    });
  }

  toggleSample(sample: any): void {
    sample.selected = !sample.selected
    if (sample.selected) {
      if (!this.selectedSamples.some(s => s.sample_ref === sample.sample_ref)) {
        this.selectedSamples.push(sample)
      }
    } else {
      this.selectedSamples = this.selectedSamples.filter(s => s.sample_ref !== sample.sample_ref)
    }
    this.updateSearchString()
    this.searchStateService.updateSampleSelection(this.selectedSamples)
  }

  selectCategory(category: any): void {
    if (!this.selectedCategories.some(c => c.id === category.id)) {
      this.selectedCategories.push(category);
    }
    this.selectedCategories.sort((a, b) => a.id - b.id);
    this.updateSearchString();
    this.searchStateService.updateQuestionSelection(this.selectedCategories);
  }

  deselectCategory(category: any): void {
    this.selectedCategories = this.selectedCategories.filter(c => c.id !== category.id)
    this.selectedCategories.sort((a, b) => a.id - b.id);
    this.updateSearchString();
    this.searchStateService.updateQuestionSelection(this.selectedCategories);
  }


  expandCategory(category: any): void {
    if (this.expandedCategories.has(category.id)) {
      this.expandedCategories.delete(category.id);
      this.collapseCategory(category);
    } else {
      this.expandedCategories.add(category.id);
      if (!category.children || category.children.length === 0) {
        this.loadChildCategories(category);
      }
    }
    this.searchStateService.updateExpandedCategories(this.expandedCategories);
  }

  private collapseCategory(category: any): void {
    if (category.children) {
      category.children.forEach((child: any) => {
        if (this.expandedCategories.has(child.id)) {
          this.expandedCategories.delete(child.id);
          this.collapseCategory(child);
        }
      });
    }
  }

  private loadChildCategories(category: any): void {
    if (this.loadingCategories.has(category.id)) {
      return;
    }
    
    this.loadingCategories.add(category.id);
    
    if (category.has_children) {
      this.dataService.getChildCategories(category.id).subscribe({
        next: (children) => {
          category.children = this.initializeCategoriesHierarchy(children);
          this.loadingCategories.delete(category.id);
        },
        error: (error) => {
          console.error('Error loading child categories:', error);
          this.loadingCategories.delete(category.id);
        }
      });
    } else {
      this.loadingCategories.delete(category.id);
    }
  }

  private initializeCategoriesHierarchy(categories: any[]): any[] {
    return categories.map(category => ({
      ...category,
      children: [],
      level: category.level || 0
    }));
  }

  isCategoryExpanded(category: any): boolean {
    return this.expandedCategories.has(category.id);
  }

  isCategoryLoading(category: any): boolean {
    return this.loadingCategories.has(category.id);
  }

  isCategorySelected(category: any): boolean {
    return this.selectedCategories.some(c => c.id === category.id);
  }

  getFlattenedCategories(categories: any[] = this.categories, level: number = 0): any[] {
    const result: any[] = [];
    
    for (const category of categories) {
      category.level = level;
      result.push(category);
      
      if (this.isCategoryExpanded(category) && category.children && category.children.length > 0) {
        result.push(...this.getFlattenedCategories(category.children, level + 1));
      }
    }
    
    return result;
  }

  toggleCategory(category: any): void {
    if (this.selectedCategories.some(c => c.id === category.id)) {
      this.deselectCategory(category);
    } else {
      this.selectCategory(category);
    }
  }

  togglePub(): void {
    this.pub = !this.pub;
    this.filterSamples();
    this.searchStateService.updateFilterStates({ pub: this.pub, migrant: this.migrant });
  }

  toggleMigrant(): void {
    this.migrant = !this.migrant;
    this.filterSamples();
    this.searchStateService.updateFilterStates({ pub: this.pub, migrant: this.migrant });
  }

  filterSamples(): void {
    let filtered = this.pub ? this.samples : this.samples.filter(sample => sample.sample_ref.substring(0, 3) !== 'PUB');
    filtered = this.migrant ? filtered : filtered.filter(sample => !sample.migrant);
    
    if (this.sampleSearchTerm.trim()) {
      const term = this.sampleSearchTerm.toLowerCase();
      filtered = filtered.filter(sample => 
        sample.sample_ref.toLowerCase().includes(term) ||
        sample.dialect_name.toLowerCase().includes(term) ||
        sample.location?.toLowerCase().includes(term)
      );
    }
    
    this.filteredSamples = filtered.sort((a, b) => a.sample_ref.localeCompare(b.sample_ref));
  }

  onSampleSearch(): void {
    this.filterSamples();
  }

  updateSearchString() {
    if (this.selectedCategories.length === 0 && this.selectedSamples.length === 0) {
      this.searchString = '';
    } else {
      const questions = this.selectedCategories.map(c => parseInt(c.id, 10));
      const samples = this.selectedSamples.map(s => s.sample_ref);
      this.searchString = JSON.stringify({ questions, samples });
    }
    this.searchStateService.updateSearchString(this.searchString);
  }

  onSearchStringChange() {
    // Clear previous status/error messages when input changes
    this.status = '';
    this.searchStateService.updateSearchStatus('');
    
    if (this.searchString.trim() === '') {
      this.clearSelections();
      return;
    }

    let search: any;
    try {
      search = JSON.parse(this.searchString);
    } catch (error) {
      // Don't show errors during typing, just return silently
      return;
    }

    if (!search.questions || !Array.isArray(search.questions) || 
        !search.samples || !Array.isArray(search.samples)) {
      return;
    }

    this.updateModelFromSearchString(search);
  }

  private clearSelections() {
    this.selectedSamples.forEach(sample => sample.selected = false);
    this.selectedSamples = [];
    this.selectedCategories = [];
  }

  private updateModelFromSearchString(search: any) {
    this.clearSelections();

    if (search.samples && Array.isArray(search.samples)) {
      search.samples.forEach((sampleRef: string) => {
        const sample = this.samples.find(s => s.sample_ref === sampleRef);
        if (sample) {
          sample.selected = true;
          if (!this.selectedSamples.some(s => s.sample_ref === sample.sample_ref)) {
            this.selectedSamples.push(sample);
          }
        }
      });
      // Update service with selected samples
      this.searchStateService.updateSampleSelection(this.selectedSamples);
    }

    if (search.questions && Array.isArray(search.questions)) {
      this.loadAndSelectCategories(search.questions);
    }
  }

  private loadAndSelectCategories(questionIds: number[]) {
    for (const questionId of questionIds) {
      this.dataService.getCategoryById(questionId).subscribe({
        next: (category) => {
          if (!category) {
            this.status = `Error: Category ${questionId} not found.`;
            return;
          }
          
          if (category.has_children === true || category.has_children === "true") {
            this.status = `Error: Category ${questionId} is not a leaf category and cannot be searched.`;
            return;
          }
          
          if (!this.selectedCategories.some(c => c.id === category.id)) {
            this.selectedCategories.push(category);
          }
          this.selectedCategories.sort((a, b) => a.id - b.id);
          
          // Update service with selected categories after each addition
          this.searchStateService.updateQuestionSelection(this.selectedCategories);
        },
        error: (error) => {
          this.status = `Error: Category ${questionId} not found or could not be loaded.`;
        }
      });
    }
  }

  private findCategoryById(categories: any[], id: number): any {
    for (const category of categories) {
      if (parseInt(category.id, 10) === id) {
        return category;
      }
      if (category.children && category.children.length > 0) {
        const found = this.findCategoryById(category.children, id);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  search(): void {
    this.results = [];
    this.status = '';
    
    const validationError = this.validateSearchString();
    if (validationError) {
      this.status = validationError;
      this.searchStateService.updateSearchResults([], this.status);
      return;
    }
    
    const search = JSON.parse(this.searchString);
    
    // Handle new searches format
    if (search.searches && Array.isArray(search.searches) && search.searches.length > 0) {
      this.dataService.searchAnswers(search.searches).subscribe({
        next: (answers) => {
          if (answers.length === 0) {
            this.status = `No answers found for the search criteria.`;
            this.searchStateService.updateSearchResults([], this.status, null);
          } else {
            this.searchResult = JSON.stringify(answers, null, 2);
            this.results = answers;

            const criteriaText = search.searches.length === 1 ? 'criterion' : 'criteria';
            this.status = `Found ${answers.length} answers for ${search.searches.length} search ${criteriaText}. `;

            // Calculate samples
            const uniqueSamples = [...new Set(answers.map((answer: any) => answer.sample))];
            const sampleText = uniqueSamples.length === 1 ? `sample ${uniqueSamples[0]}` : `${uniqueSamples.length} samples`;
            this.status += `Searched in ${sampleText}.`;

            this.searchStateService.updateSearchResults(answers, this.status, 'searchAnswers');
            this.searchStateService.updateSearchString(this.searchString);
            
            // Emit event to parent to switch to results tab
            this.searchCompleted.emit();
          }
        },
        error: (error) => {
          console.error('Search failed:', error);
          this.status = 'Search failed. Please try again later.';
          this.searchStateService.updateSearchResults([], this.status, null);
        }
      });
      return;
    }
    
    // Handle legacy questions format
    const questionIds = search.questions;
    const sampleRefs = search.samples.length > 0 ? search.samples : undefined;
    
    this.dataService.getAnswers(questionIds, sampleRefs).subscribe({
      next: (answers) => {
        if (answers.length === 0) {
          this.status = `No answers found for the selected questions and samples.`;
          this.searchStateService.updateSearchResults([], this.status, null);
        } else {
          this.searchResult = JSON.stringify(answers, null, 2);
          this.results = answers;

          // transform this.searchString into an object and check the number of items in the "samples" array
          const search = JSON.parse(this.searchString);
          const questionText = search.questions.length === 1 ? `question ID ${search.questions[0]}` : `${search.questions.length} questions`;
          this.status = `Found ${answers.length} answers for ${questionText}. `;
          if (search.samples.length == 1) {
            this.status += `Sample: ${search.samples[0]}`;
          } else if (search.samples.length > 1) {
            // find how many distinct samples there are in the answers array
            const distinctSamples = new Set(answers.map((answer: any) => answer.sample));
            this.status += `Samples: ${distinctSamples.size} distinct samples displayed.`;
          } else {
            const number = search.samples.length ? search.samples.length : "All";
            this.status += `${number} samples selected.`;
          }
          
          // Update service with results and status
          this.searchStateService.updateSearchResults(this.results, this.status, 'getAnswers');
          
          // Emit event to parent to switch to results tab
          this.searchCompleted.emit();
        }
      },
      error: (error) => {
        console.error('Error fetching search results:', error);
        this.status = 'Search failed. Please try again later.';
        this.searchStateService.updateSearchResults([], this.status);
      }
    });

  }

  private validateSearchString(): string | null {
    // Check if search string is empty
    if (this.searchString.trim() === '') {
      return 'Please provide search parameters.';
    }

    let search: any;
    try {
      search = JSON.parse(this.searchString);
    } catch (error) {
      return 'Invalid search parameters format.';
    }

    // Check for new searches format
    if (search.searches && Array.isArray(search.searches) && search.searches.length > 0) {
      // Validate search criteria format
      for (const criterion of search.searches) {
        if (!criterion.questionId || !criterion.fieldName || criterion.value === undefined) {
          return 'Invalid search criteria format. Each criterion must have questionId, fieldName, and value.';
        }
      }
      return null; // Valid search criteria format
    }

    // Check for legacy questions array format
    if (!search.questions || !Array.isArray(search.questions) || search.questions.length === 0) {
      return 'Please provide either search criteria or select at least one category to search.';
    }

    // Validate samples if any are provided
    if (search.samples && Array.isArray(search.samples) && search.samples.length > 0) {
      const validSampleRefs = this.samples.map(s => s.sample_ref);
      const invalidSamples = search.samples.filter((ref: string) => !validSampleRefs.includes(ref));
      if (invalidSamples.length > 0) {
        return `Invalid sample reference(s): ${invalidSamples.join(', ')} -- Please select valid samples.`;
      }
    }

    return null; // No validation errors
  }

  notImported() {
    alert('This category is not yet imported. We are on it.');
  }

  toggleAdvanced(): void {
    this.showAdvanced = !this.showAdvanced;
  }
  
  copySearchString() {
    if (!this.searchString || this.searchString.trim() === '') {
      return; // fail silently
    }
    navigator.clipboard.writeText(this.searchString).then(() => {
      const toast = new bootstrap.Toast(document.getElementById('copySuccessToast'));
      toast.show();
    }).catch(err => {
      console.error('Failed to copy search string:', err);
    });
  }


  searchCategories() {
    this.categorySearchSubject.next(this.categorySearchString);
  }

  focusCategorySearch() {
    setTimeout(() => {
      if (this.categorySearchInput) {
        this.categorySearchInput.nativeElement.focus();
      }
    }, 100);
  }

  clearAllSelections(): void {
    // Get current samples and clear all state through service
    const { samples } = this.searchStateService.clearAllSelectionsWithSamples();
    
    // Clear UI state - unselect samples in the samples array
    samples.forEach(selectedSample => {
      const sample = this.samples.find(s => s.sample_ref === selectedSample.sample_ref);
      if (sample) {
        sample.selected = false;
      }
    });
    
    // Clear local component state
    this.selectedSamples = [];
    this.selectedCategories = [];
    this.searchString = '';
    this.status = '';
    this.results = [];
    this.expandedCategories = new Set();
    
    // Clear category search results
    this.categorySearchString = '';
    this.categorySearchResults = [];
    
    // Re-apply filters to update the display
    this.filterSamples();
  }

  getStatusClass(): string {
    if (!this.status) return '';
    
    // Check if it's an error message
    if (this.status.includes('Invalid') || 
        this.status.includes('Please select') || 
        this.status.includes('failed') ||
        this.status.includes('No answers found') ||
        this.status.includes('Error')) {
      return 'alert-danger';
    }
    
    // Check if it's a success message
    if (this.status.includes('Found')) {
      return 'alert-success';
    }
    
    // Default info styling
    return 'alert-info';
  }

  ngOnDestroy() {
    if (this.categorySearchSubscription) {
      this.categorySearchSubscription.unsubscribe();
    }
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }
}

