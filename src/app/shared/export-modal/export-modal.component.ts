import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExportFormat } from '../../api/export.service';

declare var bootstrap: any;

@Component({
  selector: 'app-export-modal',
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal fade" [id]="modalId" tabindex="-1" [attr.aria-labelledby]="modalId + 'Label'" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" [id]="modalId + 'Label'">{{ title }}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label fw-semibold">Format</label>
              <div>
                <div class="form-check form-check-inline">
                  <input type="radio" class="form-check-input" [name]="modalId + 'Format'" [id]="modalId + 'Csv'"
                         [checked]="format === 'csv'" (change)="format = 'csv'">
                  <label class="form-check-label" [for]="modalId + 'Csv'">CSV</label>
                </div>
                <div class="form-check form-check-inline">
                  <input type="radio" class="form-check-input" [name]="modalId + 'Format'" [id]="modalId + 'Json'"
                         [checked]="format === 'json'" (change)="format = 'json'">
                  <label class="form-check-label" [for]="modalId + 'Json'">JSON</label>
                </div>
              </div>
            </div>
            <ng-content></ng-content>
            <div class="text-muted small mt-2">
              {{ message }}
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" data-bs-dismiss="modal" (click)="onExport()">
              <i class="bi bi-download me-1"></i>Download
            </button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class ExportModalComponent {
  @Input() modalId = 'exportModal';
  @Input() title = 'Export';
  @Input() message = '';
  @Output() export = new EventEmitter<ExportFormat>();

  format: ExportFormat = 'csv';

  open(): void {
    const el = document.getElementById(this.modalId);
    if (el) new bootstrap.Modal(el).show();
  }

  onExport(): void {
    this.export.emit(this.format);
  }
}
