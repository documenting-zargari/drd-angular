import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-results',
  imports: [CommonModule, RouterModule],
  templateUrl: './results.component.html',
  styleUrl: './results.component.scss'
})
export class ResultsComponent {
  @Input() results: any[] = [];
  @Input() status: string = '';
 
  constructor() {
    // Initialize with some dummy data for demonstration
    
  }

  formatKey(key: unknown): string {
    const keyStr = String(key);
    return keyStr.replace(/_/g, ' ')
                 .split(' ')
                 .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                 .join(' ');
  }

  getStatusClass(): string {
    if (!this.status) return '';
    
    // Check if it's an error message
    if (this.status.includes('Invalid') || 
        this.status.includes('Please select') || 
        this.status.includes('failed') ||
        this.status.includes('No answers found')) {
      return 'alert alert-danger';
    }
    
    // Check if it's a success message
    if (this.status.includes('Found')) {
      return 'alert alert-success';
    }
    
    // Default info styling
    return 'alert alert-info';
  }
}
