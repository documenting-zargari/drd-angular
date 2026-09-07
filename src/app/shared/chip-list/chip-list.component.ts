import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * One removable/display badge in a <app-chip-list>. `value` is the original
 * item (category, sample, country code, criterion, ...) so callers can pass
 * it straight to their existing remove/deselect handler via `$event.value`.
 */
export interface ChipItem<T = any> {
  value: T;
  /** Main text. */
  label: string;
  /** Muted leading text, e.g. a category's hierarchy trail. */
  prefix?: string;
  /** Muted trailing text, e.g. a sample's dialect name. */
  detail?: string;
  /** Small secondary badge, e.g. "Migrant". */
  badge?: string;
  title?: string;
}

/**
 * Shared chip/badge rendering for "selected X" lists (questions, samples,
 * countries, criteria) — used by both the search form (removable) and the
 * results summary (read-only) so the two look identical. See
 * search.component.ts / views.component.ts for the ChipItem[] mappings.
 */
@Component({
  selector: 'app-chip-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="d-flex flex-wrap gap-2" *ngIf="items?.length">
      <span *ngFor="let item of items" class="badge border text-dark fw-normal d-flex align-items-center py-2" [title]="item.title || ''">
        <span *ngIf="item.prefix" class="text-muted me-1">{{ item.prefix }}</span>
        {{ item.label }}
        <span *ngIf="item.detail" class="text-muted ms-1">{{ item.detail }}</span>
        <span *ngIf="item.badge" class="badge border border-secondary text-secondary fw-normal ms-2">{{ item.badge }}</span>
        <button *ngIf="removable" type="button" class="btn-close ms-2" style="font-size: 0.6rem;"
                (click)="remove.emit(item)" aria-label="Remove"></button>
      </span>
    </div>
  `,
})
export class ChipListComponent {
  @Input() items: ChipItem[] = [];
  @Input() removable = false;
  @Output() remove = new EventEmitter<ChipItem>();
}
