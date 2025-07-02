import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../api/data.service';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-transcriptions',
  imports: [CommonModule, FormsModule],
  templateUrl: './transcriptions.component.html',
  styleUrl: './transcriptions.component.scss'
})
export class TranscriptionsComponent {
  // Sample selection properties
  samples: any[] = [];
  filteredSamples: any[] = [];
  selectedSample: any = null;
  sampleSearchTerm: string = '';
  pub = false;
  migrant = true;

  // Transcription properties
  transcriptions: any[] = [];
  loading = false;

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

    this.route.params.subscribe(params => {
      if (!params.hasOwnProperty('sample')) {
        return;
      }
      this.loading = true;
      this.dataService.getTranscriptions(params['sample']).subscribe((data: any) => {
        this.transcriptions = data;
        this.loading = false;
      });
    });
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
    // Here you can add logic to load transcriptions for the selected sample
    // this.loadTranscriptions(sample.sample_ref);
  }
}
