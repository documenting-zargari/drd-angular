import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ANY_LEVEL, L2_LEVELS, contactLanguageOptions, contactLanguageToken } from '../contact-languages';

/**
 * Multi-select contact-language picker ("Current L2 = Russian"), the sibling
 * of app-country-selection: same modal/checkbox paradigm, options derived
 * from the `samples` input with per-language sample counts. The parent owns
 * `selectedTokens` (a URL param) and receives (toggled) tokens — see
 * shared/contact-languages.ts for the token format.
 */
@Component({
  selector: 'app-contact-language-selection',
  imports: [CommonModule, FormsModule],
  templateUrl: './contact-language-selection.component.html',
})
export class ContactLanguageSelectionComponent {
  @Input() modalId = 'contactLanguageModal';
  @Input() selectedTokens: string[] = [];
  @Input() set samples(value: any[]) {
    this._samples = value ?? [];
    this.rebuildRows();
  }
  get samples(): any[] { return this._samples; }

  @Output() toggled = new EventEmitter<string>();

  readonly levels = [ANY_LEVEL, ...L2_LEVELS];
  level: string = ANY_LEVEL;
  searchTerm = '';
  rows: { language: string; count: number }[] = [];
  private _samples: any[] = [];

  levelLabel(level: string): string {
    return level === ANY_LEVEL ? 'Any L2' : level;
  }

  setLevel(level: string): void {
    this.level = level;
    this.rebuildRows();
  }

  private rebuildRows(): void {
    this.rows = contactLanguageOptions(this._samples, this.level);
  }

  get filteredRows(): { language: string; count: number }[] {
    const term = this.searchTerm.trim().toLowerCase();
    return term ? this.rows.filter(r => r.language.toLowerCase().includes(term)) : this.rows;
  }

  isSelected(language: string): boolean {
    return this.selectedTokens.includes(contactLanguageToken(this.level, language));
  }

  toggle(language: string): void {
    this.toggled.emit(contactLanguageToken(this.level, language));
  }
}
