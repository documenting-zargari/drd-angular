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
          glossSafe: t.gloss ? this.sanitizer.bypassSecurityTrustHtml(t.gloss) : null
        }));
        this.filterTranscriptions();
        this.loading = false;
        this.not_found = transcriptions.length === 0;
      },
      error: (err) => {
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


  playAudio(transcription: any): void {
    if (!this.selectedSample || !transcription.segment_no) {
      console.log('No sample selected or segment number missing');
      return;
    }

    // Construct audio URL: sample_ref/sample_ref_SEG_segment_no.mp3
    const audioUrl = `http://localhost:4200/mp3/${this.selectedSample.sample_ref}/${this.selectedSample.sample_ref}_SEG_${transcription.segment_no}.mp3`;
    
    console.log('Playing audio:', audioUrl);
    
    // Create and play audio
    const audio = new Audio(audioUrl);
    audio.onerror = () => {
      console.error('Audio file not found:', audioUrl);
      // Could show a modal or toast here indicating no audio available
    };
    audio.play().catch(err => {
      console.error('Error playing audio:', err);
    });
  }
}