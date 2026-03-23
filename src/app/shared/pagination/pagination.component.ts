import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-pagination',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pagination.component.html',
  styles: [`
    .pagination-sticky {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: white;
      padding: 0.5rem 0;
      border-top: 1px solid #dee2e6;
      z-index: 1000;
    }
    .pagination-sticky .page-link {
      cursor: pointer;
    }
    .pagination-sticky .disabled .page-link {
      cursor: default;
    }
  `]
})
export class PaginationComponent implements OnChanges {
  @Input() currentPage = 1;
  @Input() count = 0;
  @Input() pageSize = 50;
  @Output() pageChange = new EventEmitter<number>();

  totalPages = 0;
  visiblePages: number[] = [];

  ngOnChanges(): void {
    this.totalPages = Math.ceil(this.count / this.pageSize) || 0;
    this.visiblePages = this.buildVisiblePages();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.pageChange.emit(page);
  }

  private buildVisiblePages(): number[] {
    const total = this.totalPages;
    if (total <= 10) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages: number[] = [1];
    const current = this.currentPage;

    if (current > 4) pages.push(-1); // ellipsis

    const start = Math.max(2, current - 2);
    const end = Math.min(total - 1, current + 2);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (current < total - 3) pages.push(-1); // ellipsis

    pages.push(total);
    return pages;
  }
}
