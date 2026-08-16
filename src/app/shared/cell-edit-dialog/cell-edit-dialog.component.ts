import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PhraseListItem } from '../../api/data.service';
import { ValueSuggestInputComponent } from '../value-suggest-input/value-suggest-input.component';

export interface CellEditField {
  name: string;
  value: string;
}

/** One phrase-association edit to apply on save. Each is independent and
 *  targets a single SamplePhrase's own question_overrides — 'exclude'/
 *  'restore' toggle this cell's question id in/out of that phrase's
 *  question_overrides.exclude, 'add'/'remove' do the same for .include. */
export interface PhraseAssociationChange {
  phrase_ref: string;
  action: 'exclude' | 'restore' | 'add' | 'remove';
}

@Component({
  selector: 'app-cell-edit-dialog',
  imports: [CommonModule, FormsModule, ValueSuggestInputComponent],
  templateUrl: './cell-edit-dialog.component.html'
})
export class CellEditDialogComponent implements OnChanges {
  @Input() show = false;
  @Input() fieldName = '';
  @Input() questionName = '';
  @Input() questionId: string | number = '';
  @Input() currentValue = '';
  /** When set (combined/pipe-separated fields, e.g. "source|language"),
   *  renders one labeled input per underlying field instead of a single
   *  input, and confirms via confirmedFields instead of confirmed. */
  @Input() fields: CellEditField[] | null = null;
  /** Whether there's an underlying answer document to delete outright
   *  (as opposed to just clearing a field's value). */
  @Input() canDelete = false;
  /** Phrases that naturally match this question/sample via each phrase's
   *  own question_overrides — i.e. what's associated with no per-answer
   *  exceptions in play. Fixed for the dialog's lifetime; a phrase excluded
   *  during this session stays visible here (struck through, restorable)
   *  instead of disappearing. */
  @Input() standardPhrases: PhraseListItem[] = [];
  /** Phrases actually associated with this specific answer right now
   *  (standardPhrases with this answer's overrides already applied).
   *  Diffed against standardPhrases to seed which items start excluded,
   *  and which were already added on top of the standard set. */
  @Input() resolvedPhrases: PhraseListItem[] = [];
  /** Every MasterPhrase for this sample (with Romani text where recorded),
   *  used only to resolve the "add a phrase" search box — never rendered
   *  as a full browsable list (the catalog can run to 1000+ entries). Only
   *  phrases with a recording for this sample (`phrase` set) can be added,
   *  since adding writes to that phrase's own SamplePhrase document, which
   *  only exists once the phrase has been recorded for this sample. */
  @Input() allPhrases: PhraseListItem[] = [];
  /** True while standardPhrases/resolvedPhrases are still being fetched. */
  @Input() phrasesLoading = false;
  @Output() confirmed = new EventEmitter<{ fieldName: string; newValue: string }>();
  @Output() confirmedFields = new EventEmitter<{ name: string; newValue: string }[]>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() deleted = new EventEmitter<void>();
  /** Emitted alongside confirmed/confirmedFields on Save: the net set of
   *  phrase-association edits to apply, or null if nothing changed. */
  @Output() phraseAssociationsConfirmed = new EventEmitter<PhraseAssociationChange[] | null>();

  editValue = '';
  editValues: Record<string, string> = {};
  showDeleteConfirm = false;

  /** Expands the dialog for more room while actively editing associations;
   *  collapses back to the compact view otherwise. */
  showPhraseOverrides = false;

  /** Temporarily disabled: opting a standard phrase out for a single answer
   *  is confusing in practice and rarely the right fix. The exclude/restore
   *  logic (requestExcludePhrase/confirmExcludePhrase/undoExcludePhrase)
   *  stays intact for when this is re-enabled — only the entry point is
   *  hidden. */
  readonly allowPhraseExclusion = false;

  /** Working set of standardPhrases refs the user has excluded this session
   *  (seeded from resolvedPhrases missing a standard phrase, i.e. already
   *  excluded from a prior save). */
  excludedRefs = new Set<string>();
  /** Phrases added on top of the standard set this session (seeded from
   *  resolvedPhrases entries not in standardPhrases, i.e. already added
   *  from a prior save). Kept as full items, not just refs, for display. */
  addedPhrases: PhraseListItem[] = [];
  /** Standard-list phrase_ref pending the exclude confirmation prompt. */
  excludeConfirmTarget: string | null = null;

  phraseSearchInput = '';
  phraseSearchResults: PhraseListItem[] = [];

  private initialExcludedRefs = new Set<string>();
  private initialAddedRefs = new Set<string>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['currentValue'] || changes['show']) {
      this.editValue = this.currentValue ?? '';
    }
    if (changes['fields'] || changes['show']) {
      this.editValues = {};
      (this.fields ?? []).forEach(f => this.editValues[f.name] = f.value ?? '');
    }
    if (changes['show']) {
      this.showDeleteConfirm = false;
    }
    if (changes['standardPhrases'] || changes['resolvedPhrases'] || changes['show']) {
      const standardRefs = new Set(this.standardPhrases.map(p => p.phrase_ref));
      const resolvedRefs = new Set(this.resolvedPhrases.map(p => p.phrase_ref));
      this.excludedRefs = new Set([...standardRefs].filter(r => !resolvedRefs.has(r)));
      this.addedPhrases = this.resolvedPhrases.filter(p => !standardRefs.has(p.phrase_ref));
      this.initialExcludedRefs = new Set(this.excludedRefs);
      this.initialAddedRefs = new Set(this.addedPhrases.map(p => p.phrase_ref));
      this.showPhraseOverrides = false;
      this.excludeConfirmTarget = null;
      this.phraseSearchInput = '';
      this.phraseSearchResults = [];
    }
  }

  get isMultiField(): boolean {
    return !!this.fields && this.fields.length > 0;
  }

  /** Last segment of the " > "-joined questionName hierarchy, i.e. the
   *  actual question being answered — shown in the header so the user
   *  doesn't have to scan the whole breadcrumb to see what they're editing. */
  get questionLeafName(): string {
    if (!this.questionName) return '';
    const parts = this.questionName.split(' > ');
    return parts[parts.length - 1];
  }

  isExcluded(ref: string): boolean {
    return this.excludedRefs.has(ref);
  }

  toggleShowPhraseOverrides(): void {
    this.showPhraseOverrides = !this.showPhraseOverrides;
    this.phraseSearchInput = '';
    this.phraseSearchResults = [];
  }

  /** Excluding a standard phrase needs confirmation (it stays listed,
   *  struck through, with a restore option) — mirrors requestExcludeQuestion
   *  in phrases.component.ts. */
  requestExcludePhrase(ref: string): void {
    this.excludeConfirmTarget = ref;
  }

  cancelExcludePhrase(): void {
    this.excludeConfirmTarget = null;
  }

  confirmExcludePhrase(): void {
    const ref = this.excludeConfirmTarget;
    if (ref == null) return;
    this.excludedRefs.add(ref);
    this.excludeConfirmTarget = null;
  }

  undoExcludePhrase(ref: string): void {
    this.excludedRefs.delete(ref);
  }

  removeAddedPhrase(ref: string): void {
    this.addedPhrases = this.addedPhrases.filter(p => p.phrase_ref !== ref);
  }

  onPhraseSearchInput(value: string): void {
    this.phraseSearchInput = value;
    const term = value.trim().toLowerCase();
    if (term.length === 0) {
      this.phraseSearchResults = [];
      return;
    }
    const alreadyShown = new Set([
      ...this.standardPhrases.map(p => p.phrase_ref),
      ...this.addedPhrases.map(p => p.phrase_ref)
    ]);
    this.phraseSearchResults = this.allPhrases
      // Only phrases already recorded for this sample can be linked — adding
      // one writes to that SamplePhrase's own question_overrides, which
      // needs the document to already exist.
      .filter(p => !!p.phrase && !alreadyShown.has(p.phrase_ref) && (
        p.phrase_ref?.toLowerCase().includes(term)
        || p.english?.toLowerCase().includes(term)
        || p.phrase?.toLowerCase().includes(term)
      ))
      .slice(0, 20);
  }

  addPhraseException(p: PhraseListItem): void {
    this.addedPhrases = [...this.addedPhrases, p];
    this.phraseSearchInput = '';
    this.phraseSearchResults = [];
  }

  onConfirm(): void {
    // Emitted before confirmed/confirmedFields: EventEmitter.emit() calls
    // subscribers synchronously, and tables.component.ts's onEditConfirmed/
    // onEditConfirmedMulti (triggered by confirmed/confirmedFields) reads
    // the phrase-association changes at the top of its handler — if this
    // emitted after, that handler would still see the *previous* save's
    // (stale) value instead of this one.
    const addedRefs = new Set(this.addedPhrases.map(p => p.phrase_ref));
    const changes: PhraseAssociationChange[] = [];
    for (const ref of this.excludedRefs) {
      if (!this.initialExcludedRefs.has(ref)) changes.push({ phrase_ref: ref, action: 'exclude' });
    }
    for (const ref of this.initialExcludedRefs) {
      if (!this.excludedRefs.has(ref)) changes.push({ phrase_ref: ref, action: 'restore' });
    }
    for (const ref of addedRefs) {
      if (!this.initialAddedRefs.has(ref)) changes.push({ phrase_ref: ref, action: 'add' });
    }
    for (const ref of this.initialAddedRefs) {
      if (!addedRefs.has(ref)) changes.push({ phrase_ref: ref, action: 'remove' });
    }
    this.phraseAssociationsConfirmed.emit(changes.length > 0 ? changes : null);

    if (this.isMultiField) {
      this.confirmedFields.emit((this.fields ?? []).map(f => ({ name: f.name, newValue: this.editValues[f.name] ?? '' })));
    } else {
      this.confirmed.emit({ fieldName: this.fieldName, newValue: this.editValue });
    }
  }

  onCancel(): void {
    this.cancelled.emit();
  }

  onDeleteClick(): void {
    this.showDeleteConfirm = true;
  }

  onDeleteCancel(): void {
    this.showDeleteConfirm = false;
  }

  onDeleteConfirm(): void {
    this.showDeleteConfirm = false;
    this.deleted.emit();
  }
}
