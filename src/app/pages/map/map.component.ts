import { AfterViewInit, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import { DataService } from '../../api/data.service';

@Component({
  selector: 'app-map',
  imports: [CommonModule, FormsModule],
  templateUrl: './map.component.html',
  styleUrl: './map.component.scss'
})
export class MapComponent implements OnInit, AfterViewInit, OnDestroy {
  private map: L.Map | undefined;
  mapInitialized = false;
  samples: any[] = [];
  validSamples: any[] = [];
  isLoadingSamples = false;
  sampleCount = 0;
  errorMessage = '';
  
  // Filter toggles
  pub = false;
  migrant = true;

  constructor(private dataService: DataService, private router: Router) { }

  ngOnInit(): void {
    // Load samples data
    this.loadSamples();
    // Make component accessible globally for popup click handlers
    (window as any).mapComponent = this;
  }

  ngAfterViewInit(): void {
    // Initialize map after the view is initialized to ensure DOM is ready
    this.initMap();
  }

  private loadSamples(): void {
    this.isLoadingSamples = true;
    this.errorMessage = '';
    
    this.dataService.getSamples().subscribe({
      next: (samples) => {
        this.samples = samples;
        // Add migrant flag processing like in search component
        this.samples.forEach(sample => {
          sample.migrant = sample.migrant === "Yes" ? true : false;
        });
        this.filterAndDisplaySamples();
        this.isLoadingSamples = false;
      },
      error: (error) => {
        console.error('Error loading samples:', error);
        this.errorMessage = 'Failed to load sample data. Please try again later.';
        this.isLoadingSamples = false;
      }
    });
  }

  private filterAndDisplaySamples(): void {
    // Apply pub/migrant filters first
    let filtered = this.pub ? this.samples : this.samples.filter(sample => sample.sample_ref.substring(0, 3) !== 'PUB');
    filtered = this.migrant ? filtered : filtered.filter(sample => !sample.migrant);
    
    // Then filter for valid coordinates
    this.validSamples = this.filterValidCoordinates(filtered);
    this.sampleCount = this.validSamples.length;
    
    // Update map if it's initialized
    if (this.mapInitialized) {
      this.clearMarkersAndAddNew();
    }
  }

  private filterValidCoordinates(samples: any[]): any[] {
    return samples.filter(sample => {
      // Check if coordinates object exists
      if (!sample.coordinates) {
        return false;
      }
      
      const lat = sample.coordinates.latitude;
      const lng = sample.coordinates.longitude;
      
      // Check if coordinates are valid numbers and not zero
      return (
        typeof lat === 'number' && 
        typeof lng === 'number' && 
        !isNaN(lat) && 
        !isNaN(lng) && 
        lat !== 0 && 
        lng !== 0 &&
        lat >= -90 && lat <= 90 &&
        lng >= -180 && lng <= 180
      );
    });
  }

  togglePub(): void {
    this.pub = !this.pub;
    this.filterAndDisplaySamples();
  }

  toggleMigrant(): void {
    this.migrant = !this.migrant;
    this.filterAndDisplaySamples();
  }

  private clearMarkersAndAddNew(): void {
    if (!this.map) return;
    
    // Clear existing markers
    this.map.eachLayer((layer) => {
      if (layer instanceof L.Marker) {
        this.map!.removeLayer(layer);
      }
    });
    
    // Add new markers without refocusing the map
    this.addSampleMarkersWithoutRefocus();
  }

  private initMap(): void {
    if (this.mapInitialized) {
      return;
    }

    try {
      // Initialize map with default center (will be adjusted when samples load)
      this.map = L.map('map', {
        center: [48.2082, 16.3738], // Default to Vienna, will be updated
        zoom: 6,
        zoomControl: true
      });

      // Add OpenStreetMap tile layer
      const tiles = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          maxZoom: 18,
          minZoom: 2,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }
      );
      
      tiles.addTo(this.map);

      // Important: Invalidate size to ensure proper rendering
      // This is the "hack" mentioned - ensures map updates correctly
      setTimeout(() => {
        if (this.map) {
          this.map.invalidateSize();
          // Add sample markers if samples are already loaded
          if (this.validSamples.length > 0) {
            this.addSampleMarkers();
          }
        }
      }, 100);

      this.mapInitialized = true;
    } catch (error) {
      console.error('Error initializing map:', error);
    }
  }

  private addSampleMarkers(): void {
    if (!this.map || this.validSamples.length === 0) {
      return;
    }

    const bounds = L.latLngBounds([]);
    const europeanBounds = L.latLngBounds([]);

    // Add marker for each valid sample
    this.validSamples.forEach(sample => {
      const lat = sample.coordinates.latitude;
      const lng = sample.coordinates.longitude;
      
      // Create marker
      const marker = L.marker([lat, lng]).addTo(this.map!);
      
      // Add popup with sample information and clickable link
      const popupContent = `
        <div>
          <a href="/samples/${sample.sample_ref}" style="text-decoration: none; color: #0d6efd; font-weight: bold;" 
             onclick="window.mapComponent.navigateToSample('${sample.sample_ref}'); return false;">
            ${sample.sample_ref}
          </a><br>
          <span class="text-muted">${sample.dialect_name || 'Unknown dialect'}</span><br>
          <small>Location: ${sample.location || 'Unknown location'}</small>
        </div>
      `;
      marker.bindPopup(popupContent);
      
      // Add to overall bounds
      bounds.extend([lat, lng]);
      
      // Add to European bounds if within Europe (roughly)
      // Europe approximate bounds: North: 72°N, South: 35°N, West: -25°W, East: 45°E
      if (lat >= 35 && lat <= 72 && lng >= -25 && lng <= 45) {
        europeanBounds.extend([lat, lng]);
      }
    });

    // Fit map to European bounds if we have European samples, otherwise show all
    if (europeanBounds.isValid()) {
      this.map.fitBounds(europeanBounds, {
        padding: [20, 20], // Add some padding around the bounds
        maxZoom: 10 // Don't zoom in too much if all samples are close together
      });
    } else if (this.validSamples.length > 0) {
      // Fallback to all samples if no European samples found
      this.map.fitBounds(bounds, {
        padding: [20, 20],
        maxZoom: 10
      });
    }
  }

  private addSampleMarkersWithoutRefocus(): void {
    if (!this.map || this.validSamples.length === 0) {
      return;
    }

    // Add marker for each valid sample without changing map bounds
    this.validSamples.forEach(sample => {
      const lat = sample.coordinates.latitude;
      const lng = sample.coordinates.longitude;
      
      // Create marker
      const marker = L.marker([lat, lng]).addTo(this.map!);
      
      // Add popup with sample information and clickable link
      const popupContent = `
        <div>
          <a href="/samples/${sample.sample_ref}" style="text-decoration: none; color: #0d6efd; font-weight: bold;" 
             onclick="window.mapComponent.navigateToSample('${sample.sample_ref}'); return false;">
            ${sample.sample_ref}
          </a><br>
          <span class="text-muted">${sample.dialect_name || 'Unknown dialect'}</span><br>
          <small>Location: ${sample.location || 'Unknown location'}</small>
        </div>
      `;
      marker.bindPopup(popupContent);
    });
  }

  // Method to recenter map to show all samples (including non-European ones)
  recenterToSamples(): void {
    if (this.map && this.validSamples.length > 0) {
      const bounds = L.latLngBounds([]);
      
      this.validSamples.forEach(sample => {
        bounds.extend([sample.coordinates.latitude, sample.coordinates.longitude]);
      });
      
      this.map.fitBounds(bounds, {
        padding: [20, 20],
        maxZoom: 10
      });
    }
  }

  // Method to focus map on European samples only
  recenterToEurope(): void {
    if (this.map && this.validSamples.length > 0) {
      const europeanBounds = L.latLngBounds([]);
      
      this.validSamples.forEach(sample => {
        const lat = sample.coordinates.latitude;
        const lng = sample.coordinates.longitude;
        
        // Add to European bounds if within Europe (roughly)
        // Europe approximate bounds: North: 72°N, South: 35°N, West: -25°W, East: 45°E
        if (lat >= 35 && lat <= 72 && lng >= -25 && lng <= 45) {
          europeanBounds.extend([lat, lng]);
        }
      });
      
      if (europeanBounds.isValid()) {
        this.map.fitBounds(europeanBounds, {
          padding: [20, 20],
          maxZoom: 10
        });
      }
    }
  }

  // Navigation method for popup links
  navigateToSample(sampleRef: string): void {
    // Validate that sample_ref exists and is not empty
    if (!sampleRef || sampleRef.trim() === '') {
      console.error('Invalid sample reference:', sampleRef);
      return;
    }
    this.router.navigate(['/samples', sampleRef]);
  }

  ngOnDestroy(): void {
    // Clean up global reference
    if ((window as any).mapComponent === this) {
      delete (window as any).mapComponent;
    }
  }
}