import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../api/data.service';

@Component({
  selector: 'app-search',
  imports: [CommonModule, FormsModule,],
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
    this.updateSearchString();
  }

  deselectCategory(category: any): void {
    this.selectedCategories = this.selectedCategories.filter(c => c.id !== category.id)
    this.selectedCategories.sort((a, b) => a.id - b.id);
    this.updateSearchString();
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
    const categories = this.selectedCategories.map(c => c.category_name);
    const samples = this.selectedSamples.map(s => s.sample_ref);
    this.searchString = JSON.stringify({ categories, samples });
  }
}
