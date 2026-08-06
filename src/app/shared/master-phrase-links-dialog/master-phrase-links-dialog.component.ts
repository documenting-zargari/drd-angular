import { Component, Input, OnChanges, Output, EventEmitter, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../api/data.service';
import { foldText } from '../text-utils';

/**
 * Tables page "Master Edit Mode" — links/unlinks MasterPhrases to a single
 * research question (question_ids), the inverse relationship from the
 * Phrases page's master editor (which edits one phrase's question_ids at a
 * time). Kept as its own small component rather than extended from either
 * CellEditDialogComponent (deeply per-sample/per-answer scoped — doesn't fit
 * a bare research-question id with no sample) or the Phrases page's edit
 * modal (wrong direction of the same many-to-many relationship).
 *
 * Reuses existing endpoints entirely — no server changes needed:
 * GET /master-phrases/ already returns question_ids per phrase (unlike the
 * size-trimmed per-sample phrase list), and PATCH /master-phrases/{ref}/
 * already validates/writes question_ids. Links/unlinks are a client-side
 * read-modify-write against that one field.
 */
@Component({
  selector: 'app-master-phrase-links-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './master-phrase-links-dialog.component.html'
})
export class MasterPhraseLinksDialogComponent implements OnChanges {
  @Input() show = false;
  @Input() questionId: number | null = null;
  @Input() questionName = '';
  @Output() closed = new EventEmitter<void>();

  private readonly dataService = inject(DataService);

  allPhrases: any[] = [];
  loading = false;
  error = '';
  filter = '';
  /** phrase_ref currently mid-PATCH, so its row can show a spinner and
   *  disable its own button without blocking the rest of the list. */
  pendingRef: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['show'] && this.show) {
      this.loadPhrases();
    }
  }

  private loadPhrases(): void {
    this.loading = true;
    this.error = '';
    this.filter = '';
    this.dataService.getAllMasterPhrases().subscribe({
      next: (phrases) => {
        this.allPhrases = phrases;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.error = 'Failed to load master phrases.';
      }
    });
  }

  get linkedPhrases(): any[] {
    if (this.questionId == null) return [];
    return this.allPhrases.filter(p => (p.question_ids || []).includes(this.questionId));
  }

  get availablePhrases(): any[] {
    if (this.questionId == null) return [];
    const q = foldText(this.filter.trim());
    return this.allPhrases
      .filter(p => !(p.question_ids || []).includes(this.questionId))
      .filter(p => !q || foldText(p.phrase_ref).includes(q) || foldText(p.english ?? '').includes(q));
  }

  link(phrase: any): void {
    this.setLink(phrase, [...(phrase.question_ids || []), this.questionId]);
  }

  unlink(phrase: any): void {
    this.setLink(phrase, (phrase.question_ids || []).filter((id: number) => id !== this.questionId));
  }

  private setLink(phrase: any, question_ids: number[]): void {
    if (this.questionId == null || this.pendingRef) return;
    this.pendingRef = phrase.phrase_ref;
    this.error = '';
    this.dataService.updateMasterPhrase(phrase.phrase_ref, { question_ids }).subscribe({
      next: (updated: any) => {
        phrase.question_ids = updated.question_ids ?? question_ids;
        this.pendingRef = null;
      },
      error: (err: any) => {
        this.pendingRef = null;
        this.error = err.error?.error || err.error?.detail || 'Failed to save changes.';
      }
    });
  }

  close(): void {
    this.closed.emit();
  }
}
