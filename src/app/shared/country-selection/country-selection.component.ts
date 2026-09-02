import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { resolveCountry } from '../country-codes';

interface CountryRow {
  code: string;
  name: string;
  flag: string;
  count: number;
}

/**
 * Multi-select country picker, following the same modal/checkbox paradigm as
 * app-sample-selection. The list of countries is derived from the `samples`
 * input (their normalised country_code), so it always reflects what is
 * actually in the data, with a per-country sample count.
 *
 * Purely presentational w.r.t. state: the parent owns `selectedCodes`
 * (typically a URL param) and receives (countryToggled) events.
 */
@Component({
  selector: 'app-country-selection',
  imports: [CommonModule, FormsModule],
  templateUrl: './country-selection.component.html',
})
export class CountrySelectionComponent {
  @Input() modalId = 'countryModal';
  @Input() selectedCodes: string[] = [];
  @Input() set samples(value: any[]) {
    this._samples = value ?? [];
    this.rebuildRows();
  }
  get samples(): any[] { return this._samples; }

  @Output() countryToggled = new EventEmitter<string>();

  private _samples: any[] = [];
  rows: CountryRow[] = [];
  searchTerm = '';

  private rebuildRows(): void {
    const byCode = new Map<string, CountryRow>();
    let unknown = 0;
    for (const s of this._samples) {
      const info = resolveCountry(s?.country_code);
      if (!info) { unknown++; continue; }
      const existing = byCode.get(info.code);
      if (existing) {
        existing.count++;
      } else {
        byCode.set(info.code, { code: info.code, name: info.name, flag: info.flag, count: 1 });
      }
    }
    const rows = [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (unknown > 0) {
      rows.push({ code: '__none__', name: 'Unknown', flag: '', count: unknown });
    }
    this.rows = rows;
  }

  get filteredRows(): CountryRow[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return this.rows;
    return this.rows.filter(r =>
      r.name.toLowerCase().includes(term) || r.code.toLowerCase().includes(term)
    );
  }

  isSelected(code: string): boolean {
    return this.selectedCodes.includes(code);
  }

  toggle(code: string): void {
    this.countryToggled.emit(code);
  }
}
