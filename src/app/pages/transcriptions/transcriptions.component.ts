import { environment } from '../../../environments/environment';
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../api/data.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { SearchStateService } from '../../api/search-state.service';
import { SampleSelectionComponent } from '../../shared/sample-selection/sample-selection.component';
import { inject } from '@angular/core';

@Component({
  selector: 'app-transcriptions',
  imports: [CommonModule, FormsModule, SampleSelectionComponent],
  templateUrl: './transcriptions.component.html',
  styleUrl: './transcriptions.component.scss'
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
  currentPlaybackIndex = -1;
  playbackTimeout: any = null;
  playAllErrorMessage: string = '';
  
  // Audio state
  currentAudioUrl: string | null = null;

  private searchStateService = inject(SearchStateService);

  constructor(
    private dataService: DataService, 
    private sanitizer: DomSanitizer
  ) {}

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
    this.currentPlaybackIndex = 0;
    this.playNextTranscription();
  }

  playNextTranscription(): void {
    if (this.currentPlaybackIndex >= this.filteredTranscriptions.length || !this.isPlayingAll) {
      this.stopAllPlayback();
      return;
    }

    const transcription = this.filteredTranscriptions[this.currentPlaybackIndex];
    if (!transcription.segment_no) {
      this.currentPlaybackIndex++;
      this.playNextTranscription();
      return;
    }

// Construct audio URL
const audioUrl = `${environment.audioUrl}/${this.selectedSample.sample_ref}/${this.selectedSample.sample_ref}_SEG_${transcription.segment_no}.mp3`;

// Use global audio service for sequential playback
this.searchStateService.playAudio(audioUrl).then(() => {
  // Audio finished successfully, move to next
  this.currentPlaybackIndex++;
  this.playbackTimeout = setTimeout(() => {
    this.playNextTranscription();
  }, 500);
}).catch((err: any) => {
  console.error('Error playing audio:', err);
  if (this.currentPlaybackIndex === 0) {
    // If this is the first audio file and it fails, show error
    this.playAllErrorMessage = 'Audio files not available for this sample';
    this.stopAllPlayback();
    return;
  }
  // Skip to next transcription if audio fails
  this.currentPlaybackIndex++;
  this.playbackTimeout = setTimeout(() => {
    this.playNextTranscription();
  }, 100);
});
