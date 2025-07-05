import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../api/data.service';
import { SearchStateService } from '../../api/search-state.service';
import { inject } from '@angular/core';

@Component({
  selector: 'app-sample-selection',
  imports: [CommonModule, FormsModule],
  templateUrl: './sample-selection.component.html',
  styleUrl: './sample-selection.component.scss'
})
export class SampleSelectionComponent implements OnInit {
  @Input() pageTitle: string = 'Page';
  @Input() showTranscriptionCounts: boolean = false;
  @Output() sampleSelected = new EventEmitter<any>();
  @Output() sampleCleared = new EventEmitter<void>();

  // Sample properties
  samples: any[] = [];
  filteredSamples: any[] = [];
  selectedSample: any = null;
  sampleSearchTerm: string = '';
  pub = false;
  migrant = true;
  transcriptionCounts: Map<string, number> = new Map();

  private searchStateService = inject(SearchStateService);

  constructor(private dataService: DataService) {}

  ngOnInit(): void {
    this.loadSamples();
    if (this.showTranscriptionCounts) {
      this.loadTranscriptionCounts();
    }
    // Load current sample from global state
    this.selectedSample = this.searchStateService.getCurrentSample();
  }

  loadSamples(): void {
    // Check cache first
    const cachedSamples = this.searchStateService.getSamplesCache();
    if (cachedSamples) {
      this.samples = cachedSamples;
      this.samples.forEach(sample => sample.migrant = sample.migrant == "Yes" ? true : false);
      this.filterSamples();
      return;
    }
    
    this.dataService.getSamples().subscribe({
      next: (samples) => {
        this.samples = samples;
        this.samples.forEach(sample => sample.migrant = sample.migrant == "Yes" ? true : false);
        this.searchStateService.setSamplesCache(samples);
        this.filterSamples();
      },
      error: (err: any) => {
        console.error('Error fetching samples:', err);
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
    
    // Sort samples: those with transcriptions first if counts are enabled
    if (this.showTranscriptionCounts) {
      this.filteredSamples = filtered.sort((a, b) => {
        const aHasTranscriptions = this.transcriptionCounts.has(a.sample_ref);
        const bHasTranscriptions = this.transcriptionCounts.has(b.sample_ref);
        
        // Sort by transcription availability first, then alphabetically
        if (aHasTranscriptions && !bHasTranscriptions) return -1;
        if (!aHasTranscriptions && bHasTranscriptions) return 1;
        return a.sample_ref.localeCompare(b.sample_ref);
      });
    } else {
      this.filteredSamples = filtered.sort((a, b) => a.sample_ref.localeCompare(b.sample_ref));
    }
  }

  selectSample(sample: any): void {
    this.selectedSample = sample;
    this.searchStateService.setCurrentSample(sample);
    this.sampleSelected.emit(sample);
  }

  clearSample(): void {
    this.selectedSample = null;
    this.searchStateService.clearCurrentSample();
    this.sampleCleared.emit();
  }

  togglePub(): void {
    this.pub = !this.pub;
    this.filterSamples();
  }

  toggleMigrant(): void {
    this.migrant = !this.migrant;
    this.filterSamples();
  }

  loadTranscriptionCounts(): void {
    // Check cache first
    const cachedCounts = this.searchStateService.getTranscriptionCountsCache();
    if (cachedCounts) {
      this.processTranscriptionCounts(cachedCounts);
      return;
    }

    this.dataService.getSamplesWithTranscriptions().subscribe({
      next: (counts) => {
        this.searchStateService.setTranscriptionCountsCache(counts);
        this.processTranscriptionCounts(counts);
      },
      error: (err: any) => {
        console.error('Error fetching transcription counts:', err);
      }
    });
  }

  processTranscriptionCounts(counts: any[]): void {
    this.transcriptionCounts.clear();
    counts.forEach(item => {
      this.transcriptionCounts.set(item.sample_ref, item.transcription_count);
    });
    // Re-filter to apply new sorting
    this.filterSamples();
  }

  getTranscriptionCount(sampleRef: string): number {
    return this.transcriptionCounts.get(sampleRef) || 0;
  }

  hasTranscriptions(sampleRef: string): boolean {
    return this.transcriptionCounts.has(sampleRef);
  }
}