import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../api/data.service';
import { SearchStateService } from '../../api/search-state.service';
import { UserService } from '../../api/user.service';
import { inject } from '@angular/core';

@Component({
  selector: 'app-sample-selection',
  imports: [CommonModule, FormsModule],
  templateUrl: './sample-selection.component.html',
  styleUrl: './sample-selection.component.scss'
})
export class SampleSelectionComponent implements OnInit, OnChanges {
  @Input() pageTitle: string = '';
  @Input() modalId: string = 'sampleModal';
  @Input() multiSelect: boolean = false;
  @Input() selectedSamples: any[] = [];
  @Input() showTranscriptionCounts: boolean = false;
  /**
   * When true, this component does not read/write SearchStateService.currentSample.
   * Parent passes the current sample ref via `currentSampleRef` and owns the
   * source of truth (typically a URL query param). Used by views migrated to
   * URL-driven state (Phase 1+).
   */
  @Input() urlControlled: boolean = false;
  /** Current sample ref, used only when urlControlled=true. */
  @Input() currentSampleRef: string | null = null;
  @Output() sampleSelected = new EventEmitter<any>();
  @Output() sampleCleared = new EventEmitter<void>();
  @Output() sampleToggled = new EventEmitter<any>();

  // Sample properties
  samples: any[] = [];
  filteredSamples: any[] = [];
  selectedSample: any = null;
  sampleSearchTerm: string = '';
  pub = false;
  migrant = true;
  transcriptionCounts: Map<string, number> = new Map();

  // Admin: show hidden samples
  isGlobalAdmin = false;
  showHiddenSamples = false;
  togglingHidden = false;

  private searchStateService = inject(SearchStateService);

  constructor(private dataService: DataService, private userService: UserService) {}

  ngOnInit(): void {
    const info = this.userService.getUserInfo();
    this.isGlobalAdmin = info?.is_global_admin ?? false;
    this.showHiddenSamples = info?.show_hidden_samples ?? false;
    this.loadSamples();
    if (this.showTranscriptionCounts) {
      this.loadTranscriptionCounts();
    }
    if (!this.urlControlled) {
      // TODO(url-refactor): remove after all views migrate to urlControlled mode.
      this.selectedSample = this.searchStateService.getCurrentSample();
    } else {
      this.resolveCurrentSampleFromRef();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.urlControlled && changes['currentSampleRef']) {
      this.resolveCurrentSampleFromRef();
    }
  }

  private resolveCurrentSampleFromRef(): void {
    if (!this.currentSampleRef) {
      this.selectedSample = null;
      return;
    }
    if (this.samples.length === 0) {
      // Samples not loaded yet; keep a minimal placeholder so the header still
      // renders. resolveCurrentSampleFromRef is called again after loadSamples.
      this.selectedSample = { sample_ref: this.currentSampleRef, dialect_name: '' };
      return;
    }
    this.selectedSample = this.samples.find(s => s.sample_ref === this.currentSampleRef)
      ?? { sample_ref: this.currentSampleRef, dialect_name: '' };
  }

  toggleShowHiddenSamples(enabled: boolean): void {
    this.togglingHidden = true;
    this.userService.setShowHiddenSamples(enabled).subscribe({
      next: () => {
        this.showHiddenSamples = enabled;
        this.togglingHidden = false;
        this.searchStateService.clearSamplesCache();
        this.loadSamples();
      },
      error: () => {
        this.showHiddenSamples = !enabled;
        this.togglingHidden = false;
      },
    });
  }

  loadSamples(): void {
    // Check cache first
    const cachedSamples = this.searchStateService.getSamplesCache();
    if (cachedSamples) {
      this.samples = cachedSamples;
      this.samples.forEach(sample => sample.migrant = sample.migrant == "Yes" ? true : false);
      this.filterSamples();
      if (this.urlControlled) this.resolveCurrentSampleFromRef();
      return;
    }

    this.dataService.getSamples().subscribe({
      next: (samples) => {
        this.samples = samples;
        this.samples.forEach(sample => sample.migrant = sample.migrant == "Yes" ? true : false);
        this.searchStateService.setSamplesCache(samples);
        this.filterSamples();
        if (this.urlControlled) this.resolveCurrentSampleFromRef();
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
    if (this.multiSelect) {
      this.sampleToggled.emit(sample);
      return;
    }
    this.selectedSample = sample;
    if (!this.urlControlled) {
      // TODO(url-refactor): remove after all views migrate to urlControlled mode.
      this.searchStateService.setCurrentSample(sample);
    }
    this.sampleSelected.emit(sample);
  }

  isSampleSelected(sample: any): boolean {
    return this.selectedSamples.some((s: any) => s.sample_ref === sample.sample_ref);
  }

  clearSample(): void {
    this.selectedSample = null;
    if (!this.urlControlled) {
      // TODO(url-refactor): remove after all views migrate to urlControlled mode.
      this.searchStateService.clearCurrentSample();
    }
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
