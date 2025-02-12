import { Component } from '@angular/core';
import { SamplesListComponent } from '../../samples/samples-list/samples-list.component';


@Component({
  selector: 'app-samples-page',
  imports: [SamplesListComponent],
  templateUrl: './samples-page.component.html',
  styleUrl: './samples-page.component.scss'
})
export class SamplesPageComponent {

}
