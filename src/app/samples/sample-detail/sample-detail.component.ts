import { AfterViewInit, Component, OnDestroy, OnInit } from '@angular/core';
import * as L from 'leaflet';
import { timer } from 'rxjs';
import { DataService } from '../../api/data.service';
import { SearchStateService } from '../../api/search-state.service';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sample-detail',
  imports: [CommonModule],
  templateUrl: './sample-detail.component.html',
  styleUrl: './sample-detail.component.scss'
})
export class SampleDetailComponent implements OnInit, AfterViewInit, OnDestroy {
  sample: any = null;
  countryInfo: any = null;
  mapInitialized = false;
  errorMessage: string = '';
  showErrorModal: boolean = false;

  private map: L.Map | undefined;

  constructor(
    private dataService: DataService,
    private searchStateService: SearchStateService,
    private route: ActivatedRoute,
    private router: Router,
  ) { }

  goBackToSamples(): void {
    this.router.navigate(['/samples']);
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const sampleId = params.get('id');
      if (sampleId) {
        this.dataService.getSampleById(sampleId).subscribe({
          next: (sample) => {
            this.sample = sample;
            // Update the search state service with the current sample
            this.searchStateService.setCurrentSample(sample);
            this.getCountryInfo();
            if (!this.mapInitialized) {
              this.initMap(); // Initialize map if not already done
              this.mapInitialized = true;
            }
            this.updateMapWithSample(sample);
          },
          error: (err) => {
            console.error('Error fetching sample:', err);
            if (err.status === 404) {
              this.errorMessage = `Sample "${sampleId}" not found. It may have been removed or the reference is incorrect.`;
            } else {
              this.errorMessage = 'Failed to fetch sample data. Please try again later.';
            }
            this.showErrorModal = true;
          }
        });
      }
    });
  }

  ngAfterViewInit(): void {
    // Ensure the map is initialized if sample data is already available
    if (this.sample && !this.mapInitialized) {
      this.initMap();
      this.mapInitialized = true;
    }
  } 

  getCountryInfo() {
    this.dataService.getCountryInfo(this.sample?.country_code).subscribe((info) => {
      this.countryInfo = info;
    });
  }

  initMap() {
    this.map = L.map('map', {
      center: [48.231, 16.45], // Vienna
      //center: [40.776676, -73.971321], // New York
      zoom: 13,
    });
  }

  private updateMapWithSample(sample: any) {
    const lat = sample.coordinates.latitude;
    const lon = sample.coordinates.longitude;
    this.map?.setView([lat, lon], 10);
    const tiles = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 18,
        minZoom: 3,
        attribution: '',
      }
    );
    tiles.addTo(this.map!);
    const marker = L.marker([lat, lon]).addTo(this.map!);
    marker.bindPopup(`${sample.dialect_name}`);
    this.map!.invalidateSize(); // Ensure the map updates correctly
  }

  recenter() {
    if (this.map) {
      this.map.flyTo([this.sample.coordinates.latitude, this.sample.coordinates.longitude]);
    }
  }

  closeErrorModal() {
    this.showErrorModal = false;
  }

  goBackFromError() {
    this.showErrorModal = false;
    this.goBackToSamples();
  }

  ngOnDestroy(): void {
    // Don't clear current sample - let it persist for other components to use
  }

  getSourceFields(source: any): {key: string, value: any, displayName: string}[] {
    if (!source) return [];
    
    const fields = Object.keys(source)
      .filter(key => source[key] !== null && source[key] !== undefined && source[key] !== '')
      .map(key => ({
        key,
        value: source[key],
        displayName: this.formatFieldName(key)
      }));
    
    // Separate ID fields (ending with "_id") from other fields
    const idFields = fields.filter(field => field.key.endsWith('_id'));
    const nonIdFields = fields.filter(field => !field.key.endsWith('_id'));
    
    // Return non-ID fields first, then ID fields at the end
    return [...nonIdFields, ...idFields];
  }

  formatFieldName(fieldName: string): string {
    // Convert snake_case or camelCase to proper display names
    return fieldName
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }
}
