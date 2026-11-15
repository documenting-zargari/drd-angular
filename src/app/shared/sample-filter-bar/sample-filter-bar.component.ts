import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CountrySelectionComponent } from '../country-selection/country-selection.component';
import { ContactLanguageSelectionComponent } from '../contact-language-selection/contact-language-selection.component';
import { ChipItem, ChipListComponent } from '../chip-list/chip-list.component';
import {
  EMPTY_SAMPLE_FILTERS, MigrantMode, SOURCE_TYPES, SampleFilterChip, SampleFilters,
  dialectGroupOptions, hasSampleFilters, sampleFilterChips, toggleSampleFilter,
} from '../sample-filters';

/**
 * Country / contact language / dialect group / source type / migrant
 * filters for a cross-sample search (see shared/sample-filters.ts).
 *
 * Stateless: the parent owns `filters` (normally URL params, via
 * sampleFiltersFromParams / sampleFiltersToParams) and gets every change as a
 * whole new SampleFilters from (filtersChange). Modal ids are prefixed with
 * `idPrefix` so a page can host the bar next to other modals.
 */
@Component({
  selector: 'app-sample-filter-bar',
  imports: [CommonModule, CountrySelectionComponent, ContactLanguageSelectionComponent, ChipListComponent],
  templateUrl: './sample-filter-bar.component.html',
})
export class SampleFilterBarComponent {
  @Input() idPrefix = 'sampleFilter';
  @Input() filters: SampleFilters = EMPTY_SAMPLE_FILTERS;
  @Input() set samples(value: any[]) {
    this._samples = value ?? [];
    this.groupOptions = dialectGroupOptions(this._samples);
  }
  get samples(): any[] { return this._samples; }

  @Output() filtersChange = new EventEmitter<SampleFilters>();

  readonly sourceOptions: { value: string | null; label: string }[] = [{ value: null, label: 'All' }, ...SOURCE_TYPES];
  readonly migrantModes: { value: MigrantMode; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'exclude', label: 'Exclude' },
  ];
  groupOptions: { value: string; label: string; count: number }[] = [];
  private _samples: any[] = [];

  get active(): boolean {
    return hasSampleFilters(this.filters);
  }

  get chips(): ChipItem<SampleFilterChip>[] {
    return sampleFilterChips(this.filters).map(c => ({ value: c, label: c.label }));
  }

  toggle(kind: SampleFilterChip['kind'], value: string): void {
    this.filtersChange.emit(toggleSampleFilter(this.filters, kind, value));
  }

  setMigrant(migrant: MigrantMode): void {
    if (migrant !== this.filters.migrant) this.filtersChange.emit({ ...this.filters, migrant });
  }

  setSource(source: string | null): void {
    if (source !== this.filters.source) this.filtersChange.emit({ ...this.filters, source });
  }

  removeChip(chip: ChipItem<SampleFilterChip>): void {
    this.toggle(chip.value.kind, chip.value.value);
  }

  clear(): void {
    this.filtersChange.emit(EMPTY_SAMPLE_FILTERS);
  }
}
