import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-cell-edit-dialog',
  imports: [CommonModule, FormsModule],
  templateUrl: './cell-edit-dialog.component.html'
})
export class CellEditDialogComponent implements OnChanges {
  @Input() show = false;
  @Input() fieldName = '';
  @Input() questionName = '';
  @Input() currentValue = '';
  @Output() confirmed = new EventEmitter<{ fieldName: string; newValue: string }>();
  @Output() cancelled = new EventEmitter<void>();

  editValue = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['currentValue'] || changes['show']) {
      this.editValue = this.currentValue ?? '';
    }
  }

  onConfirm(): void {
    this.confirmed.emit({ fieldName: this.fieldName, newValue: this.editValue });
  }

  onCancel(): void {
    this.cancelled.emit();
  }
}
