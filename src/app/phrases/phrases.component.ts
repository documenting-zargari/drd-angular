import { environment } from '../../environments/environment';
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../api/data.service';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { SearchStateService } from '../api/search-state.service';
import { SampleSelectionComponent } from '../shared/sample-selection/sample-selection.component';
import { PaginationComponent } from '../shared/pagination/pagination.component';
import { ExportService, ExportFormat } from '../api/export.service';
import { finalize } from 'rxjs/operators';
import { inject } from '@angular/core';

@Component({
  selector: 'app-phrases',
  imports: [CommonModule, FormsModule, RouterModule, SampleSelectionComponent, PaginationComponent],
  templateUrl: './phrases.component.html',
  styleUrl: './phrases.component.scss'
})
export class PhrasesComponent implements OnInit {
  selectedSample: any = null;

  // Phrase properties
  phrases: any[] = [];
  filteredPhrases: any[] = [];
  phraseSearchTerm: string = '';
  loading = false;
  not_found = false;
  currentSampleRef = '';

  // Audio state
  currentAudioUrl: string | null = null;

  // Cross-sample search mode
  searchMode = false;
  crossSearchQuery = '';
  crossSearchResults: any[] = [];
  crossSearchCount = 0;
  crossSearchPage = 1;
  crossSearchLoading = false;
  crossSearchDone = false;
  crossSearchSort = 'phrase_ref';
  crossSearchField = 'both';
  selectedSearchSamples: any[] = [];
  exportLoading = false;
  exportFormat: ExportFormat = 'csv';
  exportContext: 'browse' | 'search' = 'search';

  private searchStateService = inject(SearchStateService);

  constructor(
    private dataService: DataService,
    private route: ActivatedRoute,
    private exportService: ExportService
  ) {}

  ngOnInit(): void {
    // Load current sample from global state
    this.selectedSample = this.searchStateService.getCurrentSample();
    if (this.selectedSample) {
      this.currentSampleRef = this.selectedSample.sample_ref;
      this.loadPhrasesForSample(this.selectedSample.sample_ref);
    }

    // Subscribe to global audio state
    this.searchStateService.currentAudioUrl$.subscribe(audioUrl => {
      this.currentAudioUrl = audioUrl;
    });

    // Keep existing route params handling for direct navigation
    this.route.params.subscribe(params => {
      if (!params.hasOwnProperty('sample')) {
        return;
      }
      const sampleRef = params['sample'];
      // Find sample in cache or wait for component to load it
      this.loadPhrasesForSample(sampleRef);
    });
  }

  loadPhrasesForSample(sampleRef: string): void {
    this.currentSampleRef = sampleRef;
    this.loading = true;
    this.not_found = false;
    
    // Check cache first
    const cachedPhrases = this.searchStateService.getPhrasesCache(sampleRef);
    if (cachedPhrases) {
      this.phrases = cachedPhrases;
      this.filterPhrases();
      this.loading = false;
      this.not_found = this.phrases.length === 0;
      return;
    }
    
    this.dataService.getPhrases(sampleRef).subscribe({
      next: (data: any) => {
        this.phrases = data;
        this.searchStateService.setPhrasesCache(sampleRef, data);
        this.filterPhrases(); // Filter phrases after loading
        this.loading = false;
        if (this.phrases.length === 0) {
          this.not_found = true;
        } else {
          this.not_found = false;
        }
      },
      error: (error) => {
        console.error('Error fetching phrases:', error);
        this.loading = false;
        this.not_found = true;
      }
    });
  }

  showNoAudioModal(): void {
    setTimeout(() => {
      const modalElement = document.getElementById('noAudioModal');
      if (modalElement) {
        const modal = new (window as any).bootstrap.Modal(modalElement);
        modal.show();
        
        modalElement.addEventListener('hidden.bs.modal', () => {
          document.body.classList.remove('modal-open');
          const backdrop = document.querySelector('.modal-backdrop');
          if (backdrop) {
            backdrop.remove();
          }
        });
      }
    }, 100);
  }

playAudio(phrase: any): void {
  const audioUrl = `${environment.audioUrl}/${phrase.sample}/${phrase.sample}_${phrase.phrase_ref}.mp3`;

  // If this specific button is playing, stop it
  if (this.currentAudioUrl === audioUrl) {
    this.searchStateService.stopCurrentAudio();
    return;
  }

  // Use global audio service
  this.searchStateService.playAudio(audioUrl).catch((error: any) => {
    console.error('Error playing audio:', error);
    this.showNoAudioModal();
  });
}

isThisAudioPlaying(phrase: any): boolean {
  if (!this.currentAudioUrl) {
    return false;
  }

  const audioUrl = `${environment.audioUrl}/${phrase.sample}/${phrase.sample}_${phrase.phrase_ref}.mp3`;
  return this.currentAudioUrl === audioUrl;
}

reload(): void {
  this.loading = false;
  this.not_found = false;
}

  // Sample selection event handlers
  onSampleSelected(sample: any): void {
    this.selectedSample = sample;
    this.loadPhrasesForSample(sample.sample_ref);
  }

  onSampleCleared(): void {
    this.selectedSample = null;
    this.phrases = [];
    this.filteredPhrases = [];
    this.phraseSearchTerm = '';
    this.loading = false;
    this.not_found = false;
    this.currentSampleRef = '';
  }

  // Phrase search methods
  onPhraseSearch(): void {
    this.filterPhrases();
  }

  filterPhrases(): void {
    if (!this.phraseSearchTerm.trim()) {
      this.filteredPhrases = this.phrases;
      return;
    }

    const term = this.phraseSearchTerm.toLowerCase();
    this.filteredPhrases = this.phrases.filter(phrase =>
      phrase.phrase.toLowerCase().includes(term) ||
      phrase.english.toLowerCase().includes(term)
    );
  }

  // Cross-sample search methods
  toggleSearchMode(): void {
    this.searchMode = !this.searchMode;
    if (!this.searchMode) {
      this.crossSearchResults = [];
      this.crossSearchCount = 0;
      this.crossSearchPage = 1;
      this.crossSearchDone = false;
      this.crossSearchQuery = '';
      this.crossSearchSort = 'phrase_ref';
      this.crossSearchField = 'both';
    }
  }

  executeCrossSearch(page: number = 1): void {
    if (!this.crossSearchQuery.trim() || this.crossSearchQuery.trim().length < 2) return;

    this.crossSearchLoading = true;
    this.crossSearchPage = page;
    const sampleRefs = this.selectedSearchSamples.length > 0
      ? this.selectedSearchSamples.map((s: any) => s.sample_ref)
      : undefined;

    this.dataService.searchPhrases(this.crossSearchQuery.trim(), sampleRefs, page, this.crossSearchSort, this.crossSearchField).subscribe({
      next: (data: any) => {
        this.crossSearchResults = data.results;
        this.crossSearchCount = data.count;
        this.crossSearchLoading = false;
        this.crossSearchDone = true;
      },
      error: (err: any) => {
        console.error('Error searching phrases:', err);
        this.crossSearchLoading = false;
        this.crossSearchResults = [];
        this.crossSearchCount = 0;
        this.crossSearchDone = true;
      }
    });
  }

  onCrossSearchPageChange(page: number): void {
    this.executeCrossSearch(page);
  }

  onCrossSearchSortChange(): void {
    if (this.crossSearchDone) {
      this.executeCrossSearch(1);
    }
  }

  onSearchSampleToggled(sample: any): void {
    const exists = this.selectedSearchSamples.find((s: any) => s.sample_ref === sample.sample_ref);
    if (exists) {
      this.selectedSearchSamples = this.selectedSearchSamples.filter(
        (s: any) => s.sample_ref !== sample.sample_ref
      );
    } else {
      this.selectedSearchSamples = [...this.selectedSearchSamples, sample];
    }
  }

  openExportModal(context: 'browse' | 'search' = 'search'): void {
    this.exportContext = context;
    const el = document.getElementById('phraseExportModal');
    if (el) new (window as any).bootstrap.Modal(el).show();
  }

  confirmExport(): void {
    if (this.exportContext === 'browse') {
      this.exportService.exportList(this.filteredPhrases, ['_id', '_key', '_rev'], [], this.exportFormat, 'phrases-' + this.currentSampleRef);
    } else {
      this.downloadExport(this.exportFormat);
    }
  }

  downloadExport(format: ExportFormat): void {
    this.exportLoading = true;
    const sampleRefs = this.selectedSearchSamples.length > 0
      ? this.selectedSearchSamples.map((s: any) => s.sample_ref)
      : undefined;
    this.exportService.downloadFromSource(
      this.dataService.exportPhrases(this.crossSearchQuery.trim(), sampleRefs, this.crossSearchSort, this.crossSearchField),
      format,
      'phrase-search-results'
    ).pipe(finalize(() => this.exportLoading = false))
     .subscribe({ error: () => {} });
  }

  removeSearchSample(sample: any): void {
    this.selectedSearchSamples = this.selectedSearchSamples.filter(
      (s: any) => s.sample_ref !== sample.sample_ref
    );
  }
}
