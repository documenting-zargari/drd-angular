import { Component } from '@angular/core';
import { SamplesListComponent } from '../../samples/samples-list/samples-list.component';
import { CommonModule } from '@angular/common';
import { DataService } from '../../api/data.service';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-transcriptions',
  imports: [CommonModule, SamplesListComponent, ],
  templateUrl: './transcriptions.component.html',
  styleUrl: './transcriptions.component.scss'
})
export class TranscriptionsComponent {

  constructor( private dataService: DataService,
               private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      if (!params.hasOwnProperty('sample')) {
        return;
      }
      this.loading = true
      this.dataService.getTranscriptions(params['sample']).subscribe((data: any) => {
        this.transcriptions = data
        this.loading = false
      })
    })
  }

  transcriptions: any[] = []
  loading = false


}
