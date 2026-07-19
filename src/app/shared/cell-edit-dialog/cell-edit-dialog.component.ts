import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface CellEditField {
  name: string;
  value: string;
}

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
  /** When set (combined/pipe-separated fields, e.g. "source|language"),
   *  renders one labeled input per underlying field instead of a single
   *  input, and confirms via confirmedFields instead of confirmed. */
  @Input() fields: CellEditField[] | null = null;
  @Output() confirmed = new EventEmitter<{ fieldName: string; newValue: string }>();
  @Output() confirmedFields = new EventEmitter<{ name: string; newValue: string }[]>();
  @Output() cancelled = new EventEmitter<void>();

  editValue = '';
  editValues: Record<string, string> = {};

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['currentValue'] || changes['show']) {
      this.editValue = this.currentValue ?? '';
    }
    if (changes['fields'] || changes['show']) {
      this.editValues = {};
      (this.fields ?? []).forEach(f => this.editValues[f.name] = f.value ?? '');
    }
  }

  get isMultiField(): boolean {
    return !!this.fields && this.fields.length > 0;
  }

  onConfirm(): void {
    if (this.isMultiField) {
      this.confirmedFields.emit((this.fields ?? []).map(f => ({ name: f.name, newValue: this.editValues[f.name] ?? '' })));
    } else {
      this.confirmed.emit({ fieldName: this.fieldName, newValue: this.editValue });
    }
  }

  onCancel(): void {
    this.cancelled.emit();
  }
}
