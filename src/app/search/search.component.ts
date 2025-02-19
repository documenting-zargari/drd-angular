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
      this.categories = categories
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
    if (!this.selectedCategories.some(c => c.category_id === category.category_id)) {
      this.selectedCategories.push(category);
    }
    this.selectedCategories.sort((a, b) => a.category_id - b.category_id);
    this.updateSearchString();
  }

  deselectCategory(category: any): void {
    this.selectedCategories = this.selectedCategories.filter(c => c.category_id !== category.category_id)
    this.selectedCategories.sort((a, b) => a.category_id - b.category_id);
    this.updateSearchString();
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
