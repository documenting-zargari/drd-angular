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

  constructor(private dataService: DataService,
              private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      if (!params.hasOwnProperty('sample')) {
        return;
      }
      this.loading = true
      this.dataService.getPhrases(params['sample']).subscribe((data: any) => {
        this.phrases = data
        this.loading = false
      })
    })
  }

  playAudio(phrase: any): void {
    const audioUrl = "http://localhost:4200/mp3/" + phrase.sample + "/" + phrase.sample + "_" + phrase.phrase_ref + ".mp3"
    console.log(audioUrl)
    const audio = new Audio(audioUrl)
    audio.play()
  }
}
