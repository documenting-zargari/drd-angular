import { environment } from '../../../environments/environment';
import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DataService } from '../../api/data.service';
import { ExportService, ExportFormat } from '../../api/export.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { SearchStateService } from '../../api/search-state.service';
import { SampleSelectionComponent } from '../../shared/sample-selection/sample-selection.component';
import { ExportModalComponent } from '../../shared/export-modal/export-modal.component';
import { PaginationComponent } from '../../shared/pagination/pagination.component';
import { inject } from '@angular/core';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-transcriptions',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SampleSelectionComponent, ExportModalComponent, PaginationComponent],
  templateUrl: './transcriptions.component.html',
  styleUrls: ['./transcriptions.component.scss']
})
export class TranscriptionsComponent implements OnInit {
  selectedSample: any = null;

  // Transcription properties
  transcriptions: any[] = [];
  filteredTranscriptions: any[] = [];
  transcriptionSearchTerm: string = '';
  loading = false;
  not_found = false;
  currentSampleRef: string = '';

  // Play all functionality
  isPlayingAll = false;
  playAllErrorMessage: string = '';

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
  crossSearchSort = 'segment_no';
  crossSearchField = 'both';
  selectedSearchSamples: any[] = [];
  exportLoading = false;
  exportContext: 'browse' | 'search' = 'browse';

  @ViewChild('exportModal') exportModalComponent!: ExportModalComponent;

  private searchStateService = inject(SearchStateService);

  constructor(
    private dataService: DataService,
    private sanitizer: DomSanitizer,
    private exportService: ExportService,
  ) {}

  openExportModal(context: 'browse' | 'search' = 'browse'): void {
    this.exportContext = context;
    this.exportModalComponent.open();
  }

  confirmExport(format: ExportFormat): void {
    if (this.exportContext === 'browse') {
      const ordered = this.filteredTranscriptions.map(t => {
        const { gloss, glossSafe, transcription, ...rest } = t;
        return { transcription, gloss, ...rest };
      });
      this.exportService.exportList(
        ordered,
        ['_id', '_key', '_rev', 'glossSafe'],
        [],
        format,
        'transcriptions-' + this.currentSampleRef,
      );
    } else {
      this.downloadExport(format);
    }
  }

  downloadExport(format: ExportFormat): void {
    this.exportLoading = true;
    const sampleRefs = this.selectedSearchSamples.length > 0
      ? this.selectedSearchSamples.map((s: any) => s.sample_ref)
      : undefined;
    this.exportService.downloadFromSource(
      this.dataService.exportTranscriptions(this.crossSearchQuery.trim(), sampleRefs, this.crossSearchSort, this.crossSearchField),
      format,
      'transcription-search-results'
    ).pipe(finalize(() => this.exportLoading = false))
     .subscribe({ error: () => {} });
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
      this.crossSearchSort = 'segment_no';
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

    this.dataService.searchTranscriptions(this.crossSearchQuery.trim(), sampleRefs, page, this.crossSearchSort, this.crossSearchField).subscribe({
      next: (data: any) => {
        this.crossSearchResults = data.results;
        this.crossSearchCount = data.count;
        this.crossSearchLoading = false;
        this.crossSearchDone = true;
      },
      error: (err: any) => {
        console.error('Error searching transcriptions:', err);
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

  removeSearchSample(sample: any): void {
    this.selectedSearchSamples = this.selectedSearchSamples.filter(
      (s: any) => s.sample_ref !== sample.sample_ref
    );
  }

  ngOnInit(): void {
    // Load current sample from global state
    this.selectedSample = this.searchStateService.getCurrentSample();
    if (this.selectedSample) {
      this.currentSampleRef = this.selectedSample.sample_ref;
      this.loadTranscriptions();
    }

    // Subscribe to global audio state
    this.searchStateService.currentAudioUrl$.subscribe(audioUrl => {
      this.currentAudioUrl = audioUrl;
    });
  }

  // Sample selection event handlers
  onSampleSelected(sample: any): void {
    this.selectedSample = sample;
    this.currentSampleRef = sample.sample_ref;
    this.loadTranscriptions();
  }

  onSampleCleared(): void {
    this.selectedSample = null;
    this.transcriptions = [];
    this.filteredTranscriptions = [];
    this.transcriptionSearchTerm = '';
    this.not_found = false;
  }

  loadTranscriptions(): void {
    if (!this.selectedSample) return;
    
    this.loading = true;
    this.not_found = false;
    
    // Check cache first
    const cachedTranscriptions = this.searchStateService.getTranscriptionsCache(this.selectedSample.sample_ref);
    if (cachedTranscriptions) {
      this.transcriptions = cachedTranscriptions.map(t => ({
        ...t,
        transcription: t.transcription ? this.stripHtmlTags(t.transcription) : t.transcription,
        glossSafe: t.gloss ? this.sanitizer.bypassSecurityTrustHtml(t.gloss) : null
      }));
      this.filterTranscriptions();
      this.loading = false;
      this.not_found = this.transcriptions.length === 0;
      return;
    }
    
    this.dataService.getTranscriptions(this.selectedSample.sample_ref).subscribe({
      next: (transcriptions) => {
        this.searchStateService.setTranscriptionsCache(this.selectedSample.sample_ref, transcriptions);
        this.transcriptions = transcriptions.map(t => ({
          ...t,
          transcription: t.transcription ? this.stripHtmlTags(t.transcription) : t.transcription,
          glossSafe: t.gloss ? this.sanitizer.bypassSecurityTrustHtml(t.gloss) : null
        }));
        this.filterTranscriptions();
        this.loading = false;
        this.not_found = transcriptions.length === 0;
      },
      error: (err: any) => {
        console.error('Error fetching transcriptions:', err);
        this.loading = false;
        this.not_found = true;
      }
    });
  }

  onTranscriptionSearch(): void {
    this.filterTranscriptions();
  }

  filterTranscriptions(): void {
    if (this.transcriptionSearchTerm.trim()) {
      const term = this.transcriptionSearchTerm.toLowerCase();
      this.filteredTranscriptions = this.transcriptions.filter(transcription => 
        (transcription.transcription && transcription.transcription.toLowerCase().includes(term)) ||
        (transcription.english && transcription.english.toLowerCase().includes(term)) ||
        (transcription.gloss && transcription.gloss.toLowerCase().includes(term)) ||
        (transcription.segment_no && transcription.segment_no.toString().includes(term))
      );
    } else {
      this.filteredTranscriptions = [...this.transcriptions];
    }
    
    // Sort by segment_no for proper ordering
    this.filteredTranscriptions.sort((a, b) => {
      return (a.segment_no || 0) - (b.segment_no || 0);
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

playAudio(transcription: any): void {
  if (!this.selectedSample || !transcription.segment_no) {
    return;
  }

  // Construct audio URL: sample_ref/sample_ref_SEG_segment_no.mp3
  const audioUrl = `${environment.audioUrl}/${this.selectedSample.sample_ref}/${this.selectedSample.sample_ref}_SEG_${transcription.segment_no}.mp3`;

  // If this specific button is playing, stop it
  if (this.currentAudioUrl === audioUrl) {
    this.searchStateService.stopCurrentAudio();
    return;
  }

  // If "Play All" is active, stop it when individual button is pressed
  if (this.isPlayingAll) {
    this.stopAllPlayback();
  }

  // Use global audio service
  this.searchStateService.playAudio(audioUrl).catch((err: any) => {
    console.error('Error playing audio:', err);
    this.showNoAudioModal();
  });
}

isThisAudioPlaying(transcription: any): boolean {
  if (!this.selectedSample || !transcription.segment_no || !this.currentAudioUrl) {
    return false;
  }

  const audioUrl = `${environment.audioUrl}/${this.selectedSample.sample_ref}/${this.selectedSample.sample_ref}_SEG_${transcription.segment_no}.mp3`;
  return this.currentAudioUrl === audioUrl;
}

  playAllTranscriptions(): void {
    if (!this.selectedSample || this.filteredTranscriptions.length === 0) {
      return;
    }

    if (this.isPlayingAll) {
      this.stopAllPlayback();
      return;
    }

    // Don't start if individual audio is playing
    if (this.currentAudioUrl) {
      return;
    }

    this.playAllErrorMessage = '';
    this.isPlayingAll = true;
    
    // Construct URL for the full transcription audio file
    const audioUrl = `${environment.audioUrl}/${this.selectedSample.sample_ref}/${this.selectedSample.sample_ref}_TRANS.mp3`;

    // Play the single _TRANS.mp3 file containing all phrases
    this.searchStateService.playAudio(audioUrl).then(() => {
      // Audio finished successfully
      this.stopAllPlayback();
    }).catch((err: any) => {
      console.error('Error playing full transcription audio:', err);
      this.playAllErrorMessage = 'Full transcription audio file not available for this sample';
      this.stopAllPlayback();
    });
  }

  stopAllPlayback(): void {
    this.isPlayingAll = false;
    this.searchStateService.stopCurrentAudio();
  }

  stripHtmlTags(input: string): string {
    if (!input) return '';
    return input.replace(/<[^>]*>/g, '');
  }

}
