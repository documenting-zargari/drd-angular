import { Component, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Observable, Subscription, combineLatest, concat, forkJoin, of } from 'rxjs';
import { catchError, distinctUntilChanged, finalize, map, shareReplay, switchMap } from 'rxjs/operators';

import { DataService, ConcordanceOptions } from '../../api/data.service';
import { ExportService, ExportFormat } from '../../api/export.service';
import { UrlStateService } from '../../api/url-state.service';
import { PageTitleService } from '../../api/page-title.service';
import { SampleSelectionComponent } from '../../shared/sample-selection/sample-selection.component';
import { CountrySelectionComponent } from '../../shared/country-selection/country-selection.component';
import { ExportModalComponent } from '../../shared/export-modal/export-modal.component';
import { PaginationComponent } from '../../shared/pagination/pagination.component';
import { resolveCountry } from '../../shared/country-codes';
import { kwicSplit } from '../../shared/text-utils';

type Corpus = 'speech' | 'phrases' | 'both';
type MatchMode = 'substring' | 'whole_word';
type Field = 'romani' | 'english' | 'both';

interface ConcordanceViewState {
  q: string;
  corpus: Corpus;
  match: MatchMode;
  fold: boolean;
  field: Field;
  samples: string[];
  countries: string[];
  sort: string;
  page: number;
}

interface KwicLine {
  sample: string;
  sample_label: string;
  country_code: string | null;
  country_flag: string;
  segment_no: number;
  left: string;
  matchText: string;
  right: string;
  english: string;
  _key: string;
}

interface SpeechData {
  lines: KwicLine[];
  count: number;
  loading: boolean;
}

interface PhraseForm {
  form: string;
  samples: { sample: string; label: string; country_code: string | null; flag: string }[];
}

/** Single-word elicited phrases, grouped under their master phrase. */
interface MasterPhraseGroup {
  phrase_ref: string;
  english: string;
  forms: PhraseForm[];
  sampleCount: number;
}

/** Multi-word elicited phrases shown as keyword-in-context lines. */
interface PhraseKwicLine {
  sample: string;
  sample_label: string;
  country_code: string | null;
  country_flag: string;
  english: string;
  phrase_ref: string;
  left: string;
  matchText: string;
  right: string;
}

interface PhraseData {
  /** multi-word elicited phrases, as KWIC lines */
  kwic: PhraseKwicLine[];
  /** single-word elicited phrases, grouped by master phrase */
  groups: MasterPhraseGroup[];
  /** distinct master phrases across both sections */
  masterPhraseCount: number;
  /** total matching SamplePhrase rows (may exceed what was fetched) */
  count: number;
  /** rows returned by the server for this request */
  rowsFetched: number;
  /** true when the server capped the result set (more rows exist than were grouped) */
  truncated: boolean;
  loading: boolean;
}

interface FrequencyBlock {
  total_occurrences: number;
  document_matches: number;
  sample_count: number;
  dialect_count: number;
  country_count: number;
  concept_count?: number;
  by_country: { country_code: string; count: number }[];
  forms: { form: string; count: number }[];
}

interface FrequencyData {
  speech: FrequencyBlock | null;
  phrases: FrequencyBlock | null;
  loading: boolean;
}

const PAGE_SIZE = 50;

@Component({
  selector: 'app-concordance',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    SampleSelectionComponent, CountrySelectionComponent, ExportModalComponent, PaginationComponent,
  ],
  templateUrl: './concordance.component.html',
  styleUrls: ['./concordance.component.scss'],
})
export class ConcordanceComponent implements OnInit, OnDestroy {
  private readonly dataService = inject(DataService);
  private readonly exportService = inject(ExportService);
  private readonly urlState = inject(UrlStateService);
  private readonly pageTitleService = inject(PageTitleService);

  @ViewChild('exportModal') exportModalComponent!: ExportModalComponent;

  /** Editable search box; committed to the URL on submit. */
  queryInput = '';

  samples: any[] = [];
  exportLoading = false;
  exportIncludeSampleDetails = true;

  private latestVm: ConcordanceViewState | null = null;
  private readonly subs: Subscription[] = [];

  readonly vm$: Observable<ConcordanceViewState> = this.urlState.selectMany<ConcordanceViewState>({
    q: raw => raw ?? '',
    corpus: raw => (raw === 'speech' || raw === 'phrases' ? raw : 'both'),
    match: raw => (raw === 'word' ? 'whole_word' : 'substring'),
    fold: raw => this.urlState.parseBool(raw, true),
    field: raw => (raw === 'romani' || raw === 'english' ? raw : 'both'),
    samples: raw => this.urlState.parseCSV(raw),
    countries: raw => this.urlState.parseCSV(raw).map(c => (c === '__none__' ? c : c.toUpperCase())),
    sort: raw => raw ?? 'sample',
    page: raw => Math.max(1, this.urlState.parseInt(raw, 1)),
  }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /** Options object shared by every request the page makes. */
  private optsFor(vm: ConcordanceViewState, extra: Partial<ConcordanceOptions> = {}): ConcordanceOptions {
    return {
      match: vm.match,
      fold: vm.fold,
      field: vm.field,
      sampleRefs: vm.samples.length ? vm.samples : undefined,
      countryCodes: vm.countries.length ? vm.countries : undefined,
      ...extra,
    };
  }

  readonly speechData$: Observable<SpeechData> = this.vm$.pipe(
    distinctUntilChanged((a, b) => this.speechKey(a) === this.speechKey(b)),
    switchMap(vm => {
      const q = vm.q.trim();
      if (vm.corpus === 'phrases' || q.length < 2) {
        return of<SpeechData>({ lines: [], count: 0, loading: false });
      }
      return concat(
        of<SpeechData>({ lines: [], count: 0, loading: true }),
        this.dataService.concordanceSpeech(q, this.optsFor(vm, { sort: vm.sort, page: vm.page, pageSize: PAGE_SIZE })).pipe(
          map((res: any) => ({
            lines: (res.results ?? []).map((r: any) => this.toKwicLine(r, q, vm.field)),
            count: res.count ?? 0,
            loading: false,
          })),
          catchError(err => {
            console.error('Concordance speech search failed:', err);
            return of<SpeechData>({ lines: [], count: 0, loading: false });
          }),
        ),
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private readonly PHRASE_ROW_CAP = 200;

  readonly phraseData$: Observable<PhraseData> = this.vm$.pipe(
    distinctUntilChanged((a, b) => this.phraseKey(a) === this.phraseKey(b)),
    switchMap(vm => {
      const empty: PhraseData = { kwic: [], groups: [], masterPhraseCount: 0, count: 0, rowsFetched: 0, truncated: false, loading: false };
      const q = vm.q.trim();
      if (vm.corpus === 'speech' || q.length < 2) {
        return of<PhraseData>(empty);
      }
      return concat(
        of<PhraseData>({ ...empty, loading: true }),
        this.dataService.concordancePhrases(q, this.optsFor(vm, { sort: 'phrase_ref', pageSize: this.PHRASE_ROW_CAP })).pipe(
          map((res: any) => {
            const rows: any[] = res.results ?? [];
            const count = res.count ?? rows.length;
            const multiWord = (p: string) => (p ?? '').trim().split(/\s+/).filter(Boolean).length > 1;
            return {
              kwic: rows.filter(r => multiWord(r.phrase)).map(r => this.toPhraseKwicLine(r, q)),
              groups: this.groupPhraseRows(rows.filter(r => !multiWord(r.phrase))),
              masterPhraseCount: new Set(rows.map(r => r.phrase_ref)).size,
              count,
              rowsFetched: rows.length,
              truncated: rows.length >= this.PHRASE_ROW_CAP && count > rows.length,
              loading: false,
            };
          }),
          catchError(err => {
            console.error('Concordance phrase search failed:', err);
            return of<PhraseData>(empty);
          }),
        ),
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly freqData$: Observable<FrequencyData> = this.vm$.pipe(
    distinctUntilChanged((a, b) => this.freqKey(a) === this.freqKey(b)),
    switchMap(vm => {
      const q = vm.q.trim();
      if (q.length < 2) return of<FrequencyData>({ speech: null, phrases: null, loading: false });
      const opts = this.optsFor(vm);
      const speech$ = vm.corpus === 'phrases'
        ? of(null)
        : this.dataService.concordanceSpeechFrequency(q, opts).pipe(catchError(() => of(null)));
      const phrases$ = vm.corpus === 'speech'
        ? of(null)
        : this.dataService.concordancePhrasesFrequency(q, opts).pipe(catchError(() => of(null)));
      return concat(
        of<FrequencyData>({ speech: null, phrases: null, loading: true }),
        combineLatest([speech$, phrases$]).pipe(
          map(([speech, phrases]) => ({ speech, phrases, loading: false })),
        ),
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  ngOnInit(): void {
    this.dataService.getSamples().subscribe(s => (this.samples = s ?? []));

    this.subs.push(this.vm$.subscribe(vm => {
      this.latestVm = vm;
      if (vm.q !== this.queryInput) this.queryInput = vm.q;
      this.pageTitleService.setDetail(vm.q || 'Concordance');
    }));
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  // --- URL writes ---

  runSearch(): void {
    const q = this.queryInput.trim();
    if (q.length < 2) return;
    this.urlState.patch({ q, page: null });
  }

  setCorpus(corpus: Corpus): void {
    this.urlState.patch({ corpus: corpus !== 'both' ? corpus : null, page: null }, { replaceUrl: true });
  }

  setField(field: Field): void {
    this.urlState.patch({ field: field !== 'both' ? field : null, page: null }, { replaceUrl: true });
  }

  setMatch(whole: boolean): void {
    this.urlState.patch({ match: whole ? 'word' : null, page: null }, { replaceUrl: true });
  }

  setFold(fold: boolean): void {
    // fold defaults to true, so only persist the param when it's off.
    this.urlState.patch({ fold: fold ? null : '0', page: null }, { replaceUrl: true });
  }

  setSort(sort: string): void {
    this.urlState.patch({ sort: sort !== 'sample' ? sort : null, page: null }, { replaceUrl: true });
  }

  onPageChange(page: number): void {
    this.urlState.patch({ page: page > 1 ? page : null }, { replaceUrl: true });
  }

  onSampleToggled(sample: any): void {
    const set = new Set(this.latestVm?.samples ?? []);
    set.has(sample.sample_ref) ? set.delete(sample.sample_ref) : set.add(sample.sample_ref);
    this.urlState.patch({ samples: this.urlState.toCSV([...set]), page: null });
  }

  removeSample(ref: string): void {
    const next = (this.latestVm?.samples ?? []).filter(r => r !== ref);
    this.urlState.patch({ samples: this.urlState.toCSV(next), page: null });
  }

  onCountryToggled(code: string): void {
    const set = new Set(this.latestVm?.countries ?? []);
    set.has(code) ? set.delete(code) : set.add(code);
    this.urlState.patch({ countries: this.urlState.toCSV([...set]), page: null });
  }

  clearAll(): void {
    this.urlState.patch({
      samples: null, countries: null, corpus: null, match: null, fold: null, field: null, sort: null, page: null,
    });
  }

  runFormSearch(form: string): void {
    this.queryInput = form;
    this.urlState.patch({ q: form, match: 'word', page: null });
  }

  // --- adapters for the shared selection components ---

  selectedSamplesAsObjects(refs: string[]): { sample_ref: string }[] {
    return refs.map(sample_ref => ({ sample_ref }));
  }

  countryLabel(code: string): string {
    return resolveCountry(code)?.name ?? code;
  }

  countryFlag(code: string | null | undefined): string {
    return resolveCountry(code ?? undefined)?.flag ?? '';
  }

  // --- export ---

  openExportModal(): void {
    this.exportModalComponent.open();
  }

  confirmExport(format: ExportFormat): void {
    const vm = this.latestVm;
    if (!vm) return;
    const q = vm.q.trim();
    if (q.length < 2) return;
    this.exportLoading = true;
    const opts = this.optsFor(vm, { sort: vm.sort });

    const speech$ = this.dataService.exportConcordanceSpeech(q, opts).pipe(
      map(rows => rows.map(r => ({ source: 'speech', ...r }))),
      catchError(() => of<any[]>([])),
    );
    const phrases$ = this.dataService.exportConcordancePhrases(q, opts).pipe(
      map(rows => rows.map(r => ({ source: 'phrase', ...r }))),
      catchError(() => of<any[]>([])),
    );

    let source$: Observable<any[]>;
    if (vm.corpus === 'speech') {
      source$ = speech$;
    } else if (vm.corpus === 'phrases') {
      source$ = phrases$;
    } else {
      source$ = forkJoin([speech$, phrases$]).pipe(map(([s, p]) => [...s, ...p]));
    }

    const sampleDetails = this.exportIncludeSampleDetails
      ? this.exportService.buildSampleDetailsMap(this.samples)
      : undefined;

    source$.pipe(finalize(() => (this.exportLoading = false))).subscribe({
      next: rows => this.exportService.exportList(
        rows, ['_id', '_key', '_rev'], [], format, `concordance-${q}`, sampleDetails,
      ),
      error: () => {},
    });
  }

  // --- internal helpers ---

  private speechKey(vm: ConcordanceViewState): string {
    return JSON.stringify([
      vm.q.trim(), vm.corpus, vm.match, vm.fold, vm.field,
      [...vm.samples].sort(), [...vm.countries].sort(), vm.sort, vm.page,
    ]);
  }

  private phraseKey(vm: ConcordanceViewState): string {
    return JSON.stringify([
      vm.q.trim(), vm.corpus, vm.match, vm.fold, vm.field,
      [...vm.samples].sort(), [...vm.countries].sort(),
    ]);
  }

  private freqKey(vm: ConcordanceViewState): string {
    return this.phraseKey(vm);
  }

  private toKwicLine(row: any, q: string, field: Field): KwicLine {
    const text = field === 'english' ? (row.english ?? '') : (row.transcription ?? '');
    const k = kwicSplit(text, q);
    const cc = this.sampleCountry(row.sample);
    return {
      sample: row.sample,
      sample_label: row.sample_label ?? row.sample,
      country_code: cc,
      country_flag: this.countryFlag(cc),
      segment_no: row.segment_no,
      left: k.hit ? k.left : text,
      matchText: k.hit ? k.match : '',
      right: k.hit ? k.right : '',
      english: row.english ?? '',
      _key: row._key,
    };
  }

  private toPhraseKwicLine(row: any, q: string): PhraseKwicLine {
    const k = kwicSplit(row.phrase ?? '', q);
    const cc = this.sampleCountry(row.sample);
    return {
      sample: row.sample,
      sample_label: row.sample_label ?? row.sample,
      country_code: cc,
      country_flag: this.countryFlag(cc),
      english: row.english ?? '',
      phrase_ref: row.phrase_ref,
      left: k.hit ? k.left : (row.phrase ?? ''),
      matchText: k.hit ? k.match : '',
      right: k.hit ? k.right : '',
    };
  }

  private groupPhraseRows(rows: any[]): MasterPhraseGroup[] {
    const byRef = new Map<string, MasterPhraseGroup>();
    for (const r of rows) {
      let group = byRef.get(r.phrase_ref);
      if (!group) {
        group = { phrase_ref: r.phrase_ref, english: r.english ?? '', forms: [], sampleCount: 0 };
        byRef.set(r.phrase_ref, group);
      }
      const formKey = (r.phrase ?? '').trim();
      let form = group.forms.find(f => f.form === formKey);
      if (!form) {
        form = { form: formKey, samples: [] };
        group.forms.push(form);
      }
      const cc = this.sampleCountry(r.sample);
      form.samples.push({ sample: r.sample, label: r.sample_label ?? r.sample, country_code: cc, flag: this.countryFlag(cc) });
      group.sampleCount++;
    }
    const groups = [...byRef.values()];
    for (const g of groups) {
      g.forms.sort((a, b) => b.samples.length - a.samples.length || a.form.localeCompare(b.form));
    }
    groups.sort((a, b) => b.sampleCount - a.sampleCount);
    return groups;
  }

  private sampleCountry(sampleRef: string): string | null {
    const s = this.samples.find(x => x.sample_ref === sampleRef);
    return s?.country_code ?? null;
  }

  readonly pageSize = PAGE_SIZE;
}
