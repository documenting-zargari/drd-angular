import { Component, Input, OnInit } from '@angular/core';
import { DataService } from '../../api/data.service';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { catchError, map, Observable, of } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EventEmitter, Output } from '@angular/core';

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
  
  @Output() sampleSelected = new EventEmitter<any>();
  
  /* By specifiying the link input, you can change the link 
  that is used to navigate to the detail page or manage selections. */
  @Input() link = 'detail'
  errorMessage = ''
  
  getLink(sample: any): string {
    if (this.link == 'detail') {
      return `/samples/${sample.id}`
    } else if (this.link == 'phrases') {
      return `/phrases/${sample.id}`
    } else if (this.link == 'select') {
      return ''
    }
    return ''
  }
  
  constructor(
    private dataService: DataService,
    private route: ActivatedRoute,
  ) { 
    this.samples$ = this.dataService.getSamples().pipe(
      catchError(error => {
        console.error('Error retrieving samples', error);
        this.errorMessage = error.message;
        return of([]);
      })
    );
    this.selectionEnabled = this.link == 'select'
  }
  
  ngOnInit(): void {
  }

  onSampleSelect(sample: any): void {
    sample.selected=!sample.selected;
    this.sampleSelected.emit(sample)
  }

  updateSelected(selectedSamples: any[]) {
    if (this.samples$) {
      this.samples$.subscribe(samples => {
        samples.forEach(sample => {
          sample.selected = selectedSamples.some(s => s.sample_ref == sample.sample_ref)
        })
      })    
    }
  }
}
