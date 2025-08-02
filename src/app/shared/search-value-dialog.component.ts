import { Component, EventEmitter, Input, Output, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SearchCriterion } from '../api/data.service';

@Component({
  selector: 'app-search-value-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- Search Value Modal -->
    <div class="modal fade" [class.show]="show" [style.display]="show ? 'block' : 'none'" 
         tabindex="-1" role="dialog" *ngIf="show">
      <div class="modal-dialog modal-sm" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="bi bi-search me-2 text-primary"></i>
              Search Value
            </h5>
            <button type="button" class="btn-close" (click)="close()"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label fw-bold">Question:</label>
              <p class="text-muted mb-2">{{ questionName }}</p>
              <label class="form-label fw-bold">Field:</label>
              <p class="text-muted mb-3">{{ fieldName }}</p>
              <label for="searchValue" class="form-label fw-bold">Search for:</label>
              <input type="text" 
                     id="searchValue"
                     class="form-control" 
                     [(ngModel)]="searchValue" 
                     placeholder="Enter value to search for..."
                     (keyup.enter)="confirm()"
                     #searchInput>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" (click)="close()">Cancel</button>
            <button type="button" class="btn btn-primary" (click)="confirm()" [disabled]="!searchValue.trim()">
              <i class="bi bi-plus-circle me-1"></i>Add Search
            </button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Modal backdrop -->
    <div class="modal-backdrop fade" [class.show]="show" *ngIf="show" (click)="close()"></div>
  `
})
export class SearchValueDialogComponent implements AfterViewInit {
  @Input() show: boolean = false;
  @Input() questionId: number = 0;
  @Input() questionName: string = '';
  @Input() fieldName: string = '';
  @Input() hierarchy: string[] = [];
  
  @Output() confirmed = new EventEmitter<SearchCriterion>();
  @Output() cancelled = new EventEmitter<void>();
  
  @ViewChild('searchInput') searchInput!: ElementRef;
  
  searchValue: string = '';

  ngAfterViewInit(): void {
    if (this.show && this.searchInput) {
      setTimeout(() => this.searchInput.nativeElement.focus(), 100);
    }
  }

  confirm(): void {
    if (this.searchValue.trim()) {
      const criterion: SearchCriterion = {
        questionId: this.questionId,
        fieldName: this.fieldName,
        value: this.searchValue.trim()
      };
      this.confirmed.emit(criterion);
      this.reset();
    }
  }

  close(): void {
    this.cancelled.emit();
    this.reset();
  }

  private reset(): void {
    this.searchValue = '';
    this.questionId = 0;
    this.questionName = '';
    this.fieldName = '';
    this.hierarchy = [];
  }
}