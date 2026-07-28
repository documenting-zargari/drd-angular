import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { AnswerSuggestion, DataService } from '../../api/data.service';

/** Text input with a debounced dropdown of previously-entered values for
 *  the same (questionId, field) across all samples — e.g. typing into a
 *  yes/no field surfaces exactly "Yes"/"No" as one-click picks. Used by
 *  both the table cell editor and the search-criteria builder, which
 *  already know questionId/field by the time they render this. */
@Component({
  selector: 'app-value-suggest-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './value-suggest-input.component.html'
})
export class ValueSuggestInputComponent implements OnChanges, OnDestroy {
  @Input() value = '';
  @Input() questionId: string | number = '';
  @Input() field = '';
  @Input() placeholder = '';
  @Input() autofocus = false;

  @Output() valueChange = new EventEmitter<string>();
  @Output() enter = new EventEmitter<void>();
  @Output() escape = new EventEmitter<void>();

  suggestions: AnswerSuggestion[] = [];
  showSuggestions = false;

  private readonly input$ = new Subject<string>();
  private sub: Subscription;

  constructor(private dataService: DataService) {
    this.sub = this.input$.pipe(
      debounceTime(200),
      distinctUntilChanged(),
      switchMap(query => this.dataService.getAnswerSuggestions(Number(this.questionId), this.field, query))
    ).subscribe({
      next: results => { this.suggestions = results; this.showSuggestions = results.length > 0; },
      error: () => { this.suggestions = []; this.showSuggestions = false; }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['questionId'] || changes['field']) {
      this.suggestions = [];
      this.showSuggestions = false;
    }
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  onInput(newValue: string): void {
    this.value = newValue;
    this.valueChange.emit(newValue);
    if (!this.questionId || !this.field) return;
    this.input$.next(newValue.trim());
  }

  onFocus(): void {
    if (!this.questionId || !this.field) return;
    this.input$.next(this.value.trim());
  }

  selectSuggestion(suggestion: AnswerSuggestion): void {
    this.value = suggestion.value;
    this.valueChange.emit(suggestion.value);
    this.showSuggestions = false;
  }

  onBlur(): void {
    // Delay so a click on a dropdown item registers before the list closes.
    setTimeout(() => { this.showSuggestions = false; }, 150);
  }

  onEnter(): void {
    this.showSuggestions = false;
    this.enter.emit();
  }

  onEscape(): void {
    this.showSuggestions = false;
    this.escape.emit();
  }
}
