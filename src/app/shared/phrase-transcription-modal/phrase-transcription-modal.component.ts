import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DataService } from '../../api/data.service';
import { SearchStateService } from '../../api/search-state.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-phrase-transcription-modal',
  imports: [CommonModule, FormsModule],
  templateUrl: './phrase-transcription-modal.component.html',
  styleUrl: './phrase-transcription-modal.component.scss'
})
export class PhraseTranscriptionModalComponent implements OnChanges, AfterViewInit {
  @Input() show: boolean = false;
  @Input() answer: any = null;
  @Input() title: string = 'Related Phrases and Connected Speech';
  @Output() close = new EventEmitter<void>();

  // Modal data
  modalPhrases: any[] = [];
  modalTranscriptions: any[] = [];
  isLoadingPhrases: boolean = false;
  isLoadingTranscriptions: boolean = false;
  phraseSearchTerm: string = '';

  get filteredPhrases(): any[] {
    if (!this.phraseSearchTerm.trim()) {
      return this.modalPhrases;
    }
    const term = this.phraseSearchTerm.toLowerCase();
    return this.modalPhrases.filter(p =>
      (p.phrase && p.phrase.toLowerCase().includes(term)) ||
      (p.english && p.english.toLowerCase().includes(term))
    );
  }

  constructor(
    private dataService: DataService,
    private searchStateService: SearchStateService,
    private sanitizer: DomSanitizer,
    private elementRef: ElementRef
  ) {}

  ngAfterViewInit(): void {
    // Prevent Bootstrap modal JavaScript from interfering with our Angular-controlled modal
    const modalElement = this.elementRef.nativeElement.querySelector('.modal');
    if (modalElement) {
      // Remove any Bootstrap modal event listeners and data attributes
      modalElement.removeAttribute('data-bs-toggle');
      modalElement.removeAttribute('data-bs-target');
      
      // Prevent Bootstrap modal events from bubbling up
      modalElement.addEventListener('click', (event: Event) => {
        event.stopPropagation();
      });
      
      // Override any Bootstrap modal disposal attempts to prevent backdrop errors
      if ((window as any).bootstrap && (window as any).bootstrap.Modal) {
        const originalGetOrCreateInstance = (window as any).bootstrap.Modal.getOrCreateInstance;
        (window as any).bootstrap.Modal.getOrCreateInstance = (element: any) => {
          if (element === modalElement) {
            // Return a mock instance that safely handles disposal
            return {
              dispose: () => {}, // Safe no-op disposal
              hide: () => {},
              show: () => {},
              _backdrop: null
            };
          }
          return originalGetOrCreateInstance ? originalGetOrCreateInstance(element) : null;
        };
      }
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // When show becomes true and we have an answer, load the data
    if (changes['show'] && this.show && this.answer) {
      this.loadModalData();
    }
    // When answer changes and modal is shown, reload data
    if (changes['answer'] && this.show && this.answer) {
      this.loadModalData();
    }
  }

  private loadModalData(): void {
    if (!this.answer || !this.answer._key) {
      return;
    }

    // Reset data and start loading
    this.modalPhrases = [];
    this.modalTranscriptions = [];
    this.phraseSearchTerm = '';
    this.isLoadingPhrases = true;
    this.isLoadingTranscriptions = true;

    // Load phrases
    this.dataService.getPhrasesByAnswer(this.answer._key).subscribe({
      next: (phrases) => {
        this.modalPhrases = phrases;
        this.isLoadingPhrases = false;
      },
      error: (err) => {
        this.isLoadingPhrases = false;
      }
    });
    
    // Load transcriptions
    this.dataService.getTranscriptionsByAnswer(this.answer._key).subscribe({
      next: (transcriptions) => {
        this.modalTranscriptions = transcriptions.map((t: any) => ({
          ...t,
          glossSafe: t.gloss ? this.sanitizer.bypassSecurityTrustHtml(t.gloss) : null
        }));
        this.isLoadingTranscriptions = false;
      },
      error: (err) => {
        this.isLoadingTranscriptions = false;
      }
    });
  }

  playAudio(phrase: any): void {
    console.log('playAudio called with phrase:', phrase);

    const audioUrl = `${environment.audioUrl}/${phrase.sample}/${phrase.sample}_${phrase.phrase_ref}.mp3`;
    console.log('Constructed audio URL:', audioUrl);

    // Use global audio service
    this.searchStateService.playAudio(audioUrl).catch((error: any) => {
      console.error('Error playing audio:', error);
    });
  }

  playTranscriptionAudio(transcription: any): void {
    console.log('playTranscriptionAudio called with transcription:', transcription);
    if (!transcription.sample || !transcription.segment_no) {
      console.error('Missing sample or segment_no for transcription audio');
      return;
    }
    const audioUrl = `${environment.audioUrl}/${transcription.sample}/${transcription.sample}_SEG_${transcription.segment_no}.mp3`;
    console.log('Constructed transcription audio URL:', audioUrl);
    // Use global audio service
    this.searchStateService.playAudio(audioUrl).catch((error: any) => {
      console.error('Error playing transcription audio:', error);
    });
  }

  closeModal(): void {
    this.close.emit();
  }
}