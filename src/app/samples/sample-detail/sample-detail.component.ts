import { AfterViewInit, Component, OnInit } from '@angular/core';
import * as L from 'leaflet';
import { timer } from 'rxjs';
import { DataService } from '../../api/data.service';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sample-detail',
  imports: [CommonModule],
  templateUrl: './sample-detail.component.html',
  styleUrl: './sample-detail.component.scss'
})
export class SampleDetailComponent implements OnInit, AfterViewInit {
  sample: any = null;
  countryInfo: any = null;
  mapInitialized = false;

  private map: L.Map | undefined;

  constructor(
    private dataService: DataService,
    private route: ActivatedRoute,
  ) { }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const sampleId = params.get('id');
      console.log('Sample ID:', sampleId); // Added console log to check sampleId
      if (sampleId) {
        this.dataService.getSampleById(sampleId).subscribe({
          next: (sample) => {
            this.sample = sample;
            this.getCountryInfo();
            if (!this.mapInitialized) {
              this.initMap(); // Initialize map if not already done
              this.mapInitialized = true;
            }
            this.updateMapWithSample(sample);
          },
          error: (err) => {
            console.error('Error fetching sample:', err);
            alert('Failed to fetch sample data. Please try again later.');
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
}
