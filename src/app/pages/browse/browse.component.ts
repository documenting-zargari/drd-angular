import { Component, OnInit } from '@angular/core';
import { DataService } from '../../api/data.service';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';


@Component({
  selector: 'app-browse',
  imports: [CommonModule],
  templateUrl: './browse.component.html',
  styleUrl: './browse.component.scss'
})
export class BrowseComponent implements OnInit {

  samples: any[] = []
  sample: any = null

  constructor(
    private dataService: DataService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.dataService.getSamples().subscribe(samples => {
      this.samples = samples
    })
  }
}
