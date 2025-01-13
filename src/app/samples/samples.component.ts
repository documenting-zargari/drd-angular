import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DataService } from '../api/data.service';

@Component({
  selector: 'app-samples',
  imports: [CommonModule, RouterModule,],
  templateUrl: './samples.component.html',
  styleUrl: './samples.component.scss'
})
export class SamplesComponent implements OnInit {

  samples: any[] = []
  sample: any = null

  constructor(
    private dataService: DataService,
    private route: ActivatedRoute,
  ) { }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const sampleId = params.get('id')
      if (sampleId) {
        this.dataService.getSampleById(sampleId).subscribe(sample => {
          this.sample = sample
        })
      } else {
        this.dataService.getSamples().subscribe(samples => {
          this.samples = samples
        })
      }
    })
  }

}
