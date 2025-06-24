import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { DataService } from '../api/data.service';
import { ActivatedRoute } from '@angular/router';
import { SamplesListComponent } from '../samples/samples-list/samples-list.component';

@Component({
  selector: 'app-phrases',
  imports: [CommonModule, SamplesListComponent],
  templateUrl: './phrases.component.html',
  styleUrl: './phrases.component.scss'
})
export class PhrasesComponent implements OnInit {

  phrases: any[] = []
  loading = false
  not_found = false
  currentSampleRef = ''

  constructor(private dataService: DataService,
              private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      if (!params.hasOwnProperty('sample')) {
        return;
      }
      this.currentSampleRef = params['sample'];
      console.log('Fetching phrases for sample:', this.currentSampleRef);
      this.loading = true
      this.dataService.getPhrases(params['sample']).subscribe((data: any) => {
        this.phrases = data
        this.loading = false
        if (this.phrases.length === 0) {
          this.not_found = true
        } else {
          this.not_found = false
        }
      }, (error) => {
        console.error('Error fetching phrases:', error);
        this.loading = false;
        this.not_found = true;
      })
    })
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
    console.log(audioUrl)
    const audio = new Audio(audioUrl)
    
    audio.onerror = () => {
      console.error('Error loading audio:', audioUrl);
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
}
