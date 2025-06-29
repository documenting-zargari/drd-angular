import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../api/data.service';
import { ResultsComponent } from './results/results.component';

@Component({
  selector: 'app-search',
  imports: [CommonModule, FormsModule, ResultsComponent],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss'
})
export class SearchComponent {
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

  constructor(
    private dataService: DataService,
  ) {
    this.dataService.getSamples().subscribe(samples => {
      this.samples = samples
      this.samples.forEach(sample => sample.selected = false)
      this.samples.forEach(sample => sample.migrant = sample.migrant == "Yes" ? true : false)
      this.filteredSamples = this.samples
      this.filterSamples()
    })
    this.dataService.getCategories().subscribe(categories => {
      this.categories = this.initializeCategoriesHierarchy(categories)
    })
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
  }

  selectCategory(category: any): void {
    if (!this.selectedCategories.some(c => c.id === category.id)) {
      this.selectedCategories.push(category);
    }
    this.selectedCategories.sort((a, b) => a.id - b.id);
    
    // Update the selected property on the actual category object
    this.updateCategorySelectedState(category.id, true);

    this.updateSearchString();
  }

  deselectCategory(category: any): void {
    this.selectedCategories = this.selectedCategories.filter(c => c.id !== category.id)
    this.selectedCategories.sort((a, b) => a.id - b.id);
    
    // Update the selected property on the actual category object
    this.updateCategorySelectedState(category.id, false);
    
    this.updateSearchString();
  }

  private updateCategorySelectedState(categoryId: any, selected: boolean): void {
    this.findAndUpdateCategory(this.categories, categoryId, selected);
  }

  private findAndUpdateCategory(categories: any[], categoryId: any, selected: boolean): boolean {
    for (const category of categories) {
      if (category.id === categoryId) {
        category.selected = selected;
        return true;
      }
      if (category.children && category.children.length > 0) {
        if (this.findAndUpdateCategory(category.children, categoryId, selected)) {
          return true;
        }
      }
    }
    return false;
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
          console.log('Loaded children for category', category.name, ':', children);
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
    console.log('Selected categories:', this.selectedCategories.map(c=> parseInt(c.id, 10)));
  }

  pub = false;
  togglePub(): void {
    this.pub = !this.pub;
    this.filterSamples();
  }

  migrant = true;
  toggleMigrant(): void {
    this.migrant = !this.migrant;
    this.filterSamples();
  }

  filterSamples(): void {
    this.filteredSamples = this.pub ? this.samples : this.samples.filter(sample => sample.sample_ref.substring(0, 3) !== 'PUB');
    this.filteredSamples = this.migrant ? this.filteredSamples : this.filteredSamples.filter(sample => !sample.migrant);
    this.filteredSamples = this.filteredSamples.sort((a, b) => a.sample_ref.localeCompare(b.sample_ref));
  }

  updateSearchString() {
    if (this.selectedCategories.length === 0 && this.selectedSamples.length === 0) {
      this.searchString = '';
      return;
    }
    const questions = this.selectedCategories.map(c => parseInt(c.id, 10));
    const samples = this.selectedSamples.map(s => s.sample_ref);
    this.searchString = JSON.stringify({ questions, samples });
  }

  search(): void {
    this.results = [];
    this.status = '';
    
    const validationError = this.validateSearchString();
    if (validationError) {
      this.status = validationError;
      return;
    }
    
    const search = JSON.parse(this.searchString);
    const question_id = search.questions[0];
    const sample_ref = search.samples.length > 0 ? search.samples[0] : null;
    
    this.dataService.getAnswers(question_id, sample_ref).subscribe({
      next: (answers) => {
        if (answers.length === 0) {
          this.status = `No answers found for the selected questions and samples.`;
        } else {
          console.log('Search results:', answers);
          this.searchResult = JSON.stringify(answers, null, 2);
          this.results = answers;

          // transform this.searchString into an object and check the number of items in the "samples" array
          const search = JSON.parse(this.searchString);
          this.status = `Found ${answers.length} answers for question ID ${question_id}. `;
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
        }
      },
      error: (error) => {
        console.error('Error fetching search results:', error);
        this.status = 'Search failed. Please try again later.';
      }
    });

  }

  private validateSearchString(): string | null {
    // Check if search string is empty
    if (this.searchString.trim() === '') {
      return 'Please select at least one category and at least one sample to search.';
    }

    let search: any;
    try {
      search = JSON.parse(this.searchString);
    } catch (error) {
      return 'Invalid search parameters format.';
    }

    // Check if questions array exists and has at least one question
    if (!search.questions || !Array.isArray(search.questions) || search.questions.length === 0) {
      return 'Please select at least one category to search.';
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
}
