import { environment } from '../../environments/environment';
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../api/data.service';
import { ActivatedRoute } from '@angular/router';
import { SearchStateService } from '../api/search-state.service';
import { SampleSelectionComponent } from '../shared/sample-selection/sample-selection.component';
import { inject } from '@angular/core';

@Component({
  selector: 'app-phrases',
  imports: [CommonModule, FormsModule, SampleSelectionComponent],
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

  private searchStateService = inject(SearchStateService);

  constructor(
    private dataService: DataService,
    private route: ActivatedRoute
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
    const audioUrl = `${environment.audioUrl}/` + phrase.sample + "/" + phrase.sample + "_" + phrase.phrase_ref + ".mp3";
    
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
    const audioUrl = `${environment.audioUrl}/` + phrase.sample + "/" + phrase.sample + "_" + phrase.phrase_ref + ".mp3";
    return this.currentAudioUrl === audioUrl;
  }

  reload() {
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
}
