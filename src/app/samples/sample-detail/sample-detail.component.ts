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
  sample: any = null
  countryInfo: any = null

  private map: L.Map | undefined

  constructor(
    private dataService: DataService,
    private route: ActivatedRoute,
  ) { }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const sampleId = params.get('id')
      if (sampleId) {
        this.dataService.getSampleById(sampleId).subscribe({
          next: (sample) => {
            this.sample = sample
            this.getCountryInfo()
            const lat = sample.latitude
            const lon = sample.longitude
            this.map?.setView([lat, lon], 10)
            if (this.map) {
              var marker = L.marker([lat, lon]).addTo(this.map)
              marker.bindPopup(`${sample.dialect_name}`)
            }
            // hack to force map to update
            timer(500).subscribe(() => {
              window.dispatchEvent(new Event("resize"))
            })
          },
          error: (err) => {
            console.error('Error fetching sample:', err)
          }
        })
      }
    })
  }

  ngAfterViewInit(): void {
    this.initMap()
  }

  getCountryInfo() {
    this.dataService.getCountryInfo(this.sample?.country_code).subscribe((info) => {
      this.countryInfo = info
    })
  }

  initMap() {
      this.map = L.map('map', {
        center: [48.231, 16.45], // Vienna
        //center: [40.776676, -73.971321], // New York
        zoom: 13,
      })

      const tiles = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          maxZoom: 18,
          minZoom: 3,
          attribution: '',
        }
      )
      tiles.addTo(this.map)
    }

    recenter() {
      if (this.map) {
        this.map.panTo([this.sample.latitude, this.sample.longitude])
      }
    }
}
