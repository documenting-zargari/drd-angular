import { Component, OnInit } from '@angular/core';
import { DataService } from '../../api/data.service';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { map, Observable } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-samples-list',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './samples-list.component.html',
  styleUrl: './samples-list.component.scss'
})
export class SamplesListComponent implements OnInit {
  samples$: Observable<any[]>;
  selectionEnabled = false
  selectedSamples: any[] = []

  constructor(
    private dataService: DataService,
    private route: ActivatedRoute,
  ) { 
    this.samples$ = this.dataService.getSamples().pipe(
      map(samples => samples.map((sample: any) => ({
      ...sample,
      dialect_name: sample.dialect_name ? sample.dialect_name : '(No Dialect Specified)'
      })))
    );
  }

  ngOnInit(): void {
  }
}
