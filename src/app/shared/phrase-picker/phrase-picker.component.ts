import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, OnInit, Output, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService, PhraseListItem } from '../../api/data.service';

const CACHE_KEY = 'phraseList';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-phrase-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal fade" id="phrasePickerModal" tabindex="-1"
         (shown.bs.modal)="searchInput.focus()">
      <div class="modal-dialog modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header py-2">
            <input #searchInput type="text" class="form-control form-control-sm"
                   placeholder="Filter by phrase number or English..."
                   [(ngModel)]="filter">
            <button type="button" class="btn-close ms-2" data-bs-dismiss="modal"
                    (click)="filter = ''"></button>
          </div>
          <div class="modal-body p-0">
            <div *ngIf="loading" class="text-center py-4">
              <div class="spinner-border spinner-border-sm" role="status"></div>
            </div>
            <div *ngIf="!loading" class="list-group list-group-flush"
                 style="max-height: 65vh; overflow-y: auto;">
              <button *ngFor="let p of filtered" type="button"
                      class="list-group-item list-group-item-action py-2 px-3"
                      (click)="select(p)">
                <span class="text-muted me-2" style="font-size:0.8em; min-width:3em; display:inline-block;">
                  {{ p.phrase_ref }}
                </span>
                {{ p.english }}
              </button>
              <div *ngIf="!loading && filtered.length === 0"
                   class="text-muted text-center py-3">No matches</div>
            </div>
          </div>
          <div class="modal-footer py-1">
            <small class="text-muted">{{ filtered.length }} of {{ phrases.length }} phrases</small>
          </div>
        </div>
      </div>
    </div>
  `
})
export class PhrasePickerComponent implements OnInit {
  @Output() phraseSelected = new EventEmitter<PhraseListItem>();
  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  private readonly dataService = inject(DataService);

  phrases: PhraseListItem[] = [];
  filter = '';
  loading = false;

  get filtered(): PhraseListItem[] {
    const q = this.filter.trim().toLowerCase();
    if (!q) return this.phrases;
    return this.phrases.filter(p =>
      p.phrase_ref.toLowerCase().includes(q) ||
      (p.english ?? '').toLowerCase().includes(q)
    );
  }

  ngOnInit(): void {
    this.loadPhrases();
  }

  open(): void {
    const el = document.getElementById('phrasePickerModal');
    if (el) new (window as any).bootstrap.Modal(el).show();
  }

  select(phrase: PhraseListItem): void {
    this.phraseSelected.emit(phrase);
    this.filter = '';
    const el = document.getElementById('phrasePickerModal');
    if (el) (window as any).bootstrap.Modal.getInstance(el)?.hide();
  }

  private loadPhrases(): void {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { data, timestamp } = JSON.parse(raw);
        if (Date.now() - timestamp < CACHE_TTL_MS) {
          this.phrases = data;
          return;
        }
      }
    } catch {}

    this.loading = true;
    this.dataService.getPhraseList().subscribe({
      next: phrases => {
        this.phrases = phrases;
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ data: phrases, timestamp: Date.now() }));
        } catch {}
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }
}
