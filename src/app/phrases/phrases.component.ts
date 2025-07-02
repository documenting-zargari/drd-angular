import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../api/data.service';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-phrases',
  imports: [CommonModule, FormsModule],
  templateUrl: './phrases.component.html',
  styleUrl: './phrases.component.scss'
})
export class PhrasesComponent implements OnInit {
  // Sample selection properties
  samples: any[] = [];
  filteredSamples: any[] = [];
  selectedSample: any = null;
  sampleSearchTerm: string = '';
  pub = false;
  migrant = true;

  // Phrase properties
  phrases: any[] = [];
  filteredPhrases: any[] = [];
  phraseSearchTerm: string = '';
  loading = false;
  not_found = false;
  currentSampleRef = '';

  constructor(
    private dataService: DataService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    // Load samples for modal
    this.dataService.getSamples().subscribe({
      next: (samples) => {
        this.samples = samples;
        this.samples.forEach(sample => sample.migrant = sample.migrant == "Yes" ? true : false);
        this.filterSamples();
      },
      error: (err) => {
        console.error('Error fetching samples:', err);
      }
    });

    // Keep existing route params handling for direct navigation
    this.route.params.subscribe(params => {
      if (!params.hasOwnProperty('sample')) {
        return;
      }
      const sampleRef = params['sample'];
      const sample = this.samples.find(s => s.sample_ref === sampleRef);
      if (sample) {
        this.selectedSample = sample;
      }
      this.loadPhrasesForSample(sampleRef);
    });
  }

  loadPhrasesForSample(sampleRef: string): void {
    this.currentSampleRef = sampleRef;
    this.loading = true;
    this.not_found = false;
    
    this.dataService.getPhrases(sampleRef).subscribe({
      next: (data: any) => {
        this.phrases = data;
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
    const audioUrl = "http://localhost:4200/mp3/" + phrase.sample + "/" + phrase.sample + "_" + phrase.phrase_ref + ".mp3"
    const audio = new Audio(audioUrl)
    
    audio.onerror = () => {
      this.showNoAudioModal();
    };
    
    audio.play().catch(error => {
      console.error('Error playing audio:', error);
      this.showNoAudioModal();
    });
  }

  reload() {
    this.loading = false;
    this.not_found = false;
  }

  // Sample selection methods
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
  }

  togglePub(): void {
    this.pub = !this.pub;
    this.filterSamples();
  }

  toggleMigrant(): void {
    this.migrant = !this.migrant;
    this.filterSamples();
  }

  selectSample(sample: any): void {
    this.selectedSample = sample;
    this.loadPhrasesForSample(sample.sample_ref);
  }

  clearSample(): void {
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
