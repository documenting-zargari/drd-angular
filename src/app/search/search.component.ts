import { Component, ViewChild } from '@angular/core';
import { SamplesListComponent } from "../samples/samples-list/samples-list.component";
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-search',
  imports: [SamplesListComponent, CommonModule, FormsModule,],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss'
})
export class SearchComponent {

  @ViewChild(SamplesListComponent) samplesListComponent!: SamplesListComponent;
  selectedSamples: any[] = [];

  onSampleSelected(sample: any): void {
    console.log(sample.selected ? 'Sample selected' : 'Sample unselected', sample)
    if (sample.selected) {
      this.selectedSamples.push(sample)
    } else {
      this.selectedSamples = this.selectedSamples.filter(s => s.sample_ref != sample.sample_ref)
    }
  }
  
  deselect(sample:any) {
    this.selectedSamples = this.selectedSamples.filter(s => s.sample_ref != sample.sample_ref)
    if (this.samplesListComponent) {
      this.samplesListComponent.updateSelected(this.selectedSamples);
    }
  }
}

