import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DataService } from '../../api/data.service';
import { PaginationComponent } from '../../shared/pagination/pagination.component';

@Component({
  selector: 'app-samples-page',
  imports: [CommonModule, FormsModule, RouterModule, PaginationComponent],
  templateUrl: './samples-page.component.html',
  styleUrl: './samples-page.component.scss'
})
export class SamplesPageComponent implements OnInit {
  // Sample properties
  samples: any[] = [];
  filteredSamples: any[] = [];
  pagedSamples: any[] = [];
  sampleSearchTerm: string = '';
  pub = false;
  migrant = true;
  loading = false;
  currentPage = 1;
  pageSize = 25;

  constructor(private dataService: DataService) {}

  ngOnInit(): void {
    this.loadSamples();
  }

  loadSamples(): void {
    this.loading = true;
    this.dataService.getSamples().subscribe({
      next: (samples) => {
        this.samples = samples;
        this.samples.forEach(sample => sample.migrant = sample.migrant == "Yes" ? true : false);
        this.filterSamples();
        this.loading = false;
      },
      error: (err) => {
        console.error('Error fetching samples:', err);
        this.loading = false;
      }
    });
  }

  // Search and filter methods
  onSampleSearch(): void {
    this.filterSamples();
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
    this.currentPage = 1;
    this.updatePagedSamples();
  }

  updatePagedSamples(): void {
    const start = (this.currentPage - 1) * this.pageSize;
    this.pagedSamples = this.filteredSamples.slice(start, start + this.pageSize);
  }

  onPageChange(page: number): void {
    this.currentPage = page;
    this.updatePagedSamples();
  }

  togglePub(): void {
    this.pub = !this.pub;
    this.filterSamples();
  }

  toggleMigrant(): void {
    this.migrant = !this.migrant;
    this.filterSamples();
  }
}
