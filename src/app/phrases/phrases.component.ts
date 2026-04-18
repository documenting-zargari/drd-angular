import { environment } from '../../environments/environment';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../api/data.service';
import { RouterModule } from '@angular/router';
import { SearchStateService } from '../api/search-state.service';
import { UrlStateService } from '../api/url-state.service';
import { SampleSelectionComponent } from '../shared/sample-selection/sample-selection.component';
import { PaginationComponent } from '../shared/pagination/pagination.component';
import { ExportModalComponent } from '../shared/export-modal/export-modal.component';
import { ExportService, ExportFormat } from '../api/export.service';
import { BehaviorSubject, Observable, Subject, Subscription, combineLatest, concat, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, finalize, map, shareReplay, switchMap } from 'rxjs/operators';

type PhraseMode = 'browse' | 'search';
type PhraseField = 'both' | 'romani' | 'english';

interface PhraseViewState {
  sample: string | null;
  mode: PhraseMode;
  q: string;
  page: number;
  samples: string[];
  sort: string;
  field: PhraseField;
}

interface BrowseData {
  phrases: any[];
  loading: boolean;
  notFound: boolean;
  sample: string | null;
}

interface SearchData {
  results: any[];
  count: number;
  loading: boolean;
  done: boolean;
}

@Component({
  selector: 'app-phrases',
  imports: [CommonModule, FormsModule, RouterModule, SampleSelectionComponent, PaginationComponent, ExportModalComponent],
  templateUrl: './phrases.component.html',
  styleUrl: './phrases.component.scss'
})
export class PhrasesComponent implements OnInit, OnDestroy {
  private readonly dataService = inject(DataService);
  private readonly exportService = inject(ExportService);
  private readonly searchStateService = inject(SearchStateService);
  private readonly urlState = inject(UrlStateService);

  @ViewChild('exportModal') exportModalComponent!: ExportModalComponent;

  readonly browsePageSize = 50;

  /** URL-derived view state. Source of truth for this component. */
  readonly vm$: Observable<PhraseViewState> = this.urlState.selectMany<PhraseViewState>({
    sample: raw => (raw && raw.length > 0 ? raw : null),
    mode: raw => (raw === 'search' ? 'search' : 'browse'),
    q: raw => raw ?? '',
    page: raw => Math.max(1, this.urlState.parseInt(raw, 1)),
    samples: raw => this.urlState.parseCSV(raw),
    sort: raw => raw ?? 'phrase_ref',
    field: raw => (raw === 'romani' || raw === 'english' ? raw : 'both'),
  }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /** Server-loaded phrases for the current browse sample (cached). */
  readonly browseData$: Observable<BrowseData> = this.vm$.pipe(
    map(vm => ({ mode: vm.mode, sample: vm.sample })),
    distinctUntilChanged((a, b) => a.mode === b.mode && a.sample === b.sample),
    switchMap(({ mode, sample }) => {
      if (mode !== 'browse' || !sample) {
        return of<BrowseData>({ phrases: [], loading: false, notFound: false, sample });
      }
      return concat(
        of<BrowseData>({ phrases: [], loading: true, notFound: false, sample }),
        this.dataService.getPhrasesCached(sample).pipe(
          map(phrases => ({ phrases, loading: false, notFound: phrases.length === 0, sample })),
          catchError(() => of<BrowseData>({ phrases: [], loading: false, notFound: true, sample }))
        )
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Browse view = server phrases + local q filter + pagination. */
  readonly browseView$ = combineLatest([this.vm$, this.browseData$]).pipe(
    map(([vm, data]) => {
      const q = vm.q.trim().toLowerCase();
      const filtered = !q
        ? data.phrases
        : data.phrases.filter(p =>
            (p.phrase ?? '').toLowerCase().includes(q) ||
            (p.english ?? '').toLowerCase().includes(q));
      const start = (vm.page - 1) * this.browsePageSize;
      const paged = filtered.slice(start, start + this.browsePageSize);
      return {
        loading: data.loading,
        notFound: data.notFound,
        allCount: data.phrases.length,
        filteredCount: filtered.length,
        paged,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Cross-sample search results; re-executes when search-mode URL params change. */
  readonly searchData$: Observable<SearchData> = this.vm$.pipe(
    map(vm => ({
      mode: vm.mode,
      q: vm.q.trim(),
      samples: vm.samples.join(','),
      page: vm.page,
      sort: vm.sort,
      field: vm.field,
    })),
    distinctUntilChanged((a, b) =>
      a.mode === b.mode && a.q === b.q && a.samples === b.samples &&
      a.page === b.page && a.sort === b.sort && a.field === b.field
    ),
    switchMap(key => {
      if (key.mode !== 'search' || key.q.length < 2) {
        return of<SearchData>({ results: [], count: 0, loading: false, done: false });
      }
      const sampleRefs = key.samples ? key.samples.split(',') : undefined;
      return concat(
        of<SearchData>({ results: [], count: 0, loading: true, done: false }),
        this.dataService.searchPhrases(key.q, sampleRefs, key.page, key.sort, key.field).pipe(
          map((data: any) => ({
            results: data.results,
            count: data.count,
            loading: false,
            done: true,
          })),
          catchError(err => {
            console.error('Error searching phrases:', err);
            return of<SearchData>({ results: [], count: 0, loading: false, done: true });
          })
        )
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Locally-edited cross-search input; only committed to URL on submit. */
  crossSearchInput = '';

  /** Globally-played audio URL (for play/stop button state). */
  currentAudioUrl: string | null = null;

  /** Debounced stream for incremental browse-mode filtering. */
  private readonly browseQueryInput$ = new Subject<string>();

  /** Snapshot of latest vm, used by imperative handlers (export, audio). */
  private latestVm: PhraseViewState | null = null;

  /** Used by the export modal to know which dataset to export. */
  exportContext: PhraseMode = 'search';
  exportLoading = false;

  /** Cached view-model for template guards that need synchronous reads. */
  latestSearchData: SearchData = { results: [], count: 0, loading: false, done: false };

  private readonly subs: Subscription[] = [];

  ngOnInit(): void {
    // Keep a synchronous copy of vm for imperative methods (export, audio).
    this.subs.push(this.vm$.subscribe(vm => {
      this.latestVm = vm;
      // Sync the local cross-search input when the URL changes externally
      // (navigation, back button, bookmark) but not while the user is typing.
      if (vm.mode === 'search' && vm.q !== this.crossSearchInput) {
        this.crossSearchInput = vm.q;
      } else if (vm.mode === 'browse') {
        this.crossSearchInput = '';
      }
    }));

    this.subs.push(this.searchData$.subscribe(sd => this.latestSearchData = sd));

    this.subs.push(this.searchStateService.currentAudioUrl$
      .subscribe(audioUrl => this.currentAudioUrl = audioUrl));

    // Debounced URL patching for the browse-mode filter input.
    this.subs.push(
      this.browseQueryInput$
        .pipe(debounceTime(250), distinctUntilChanged())
        .subscribe(q => this.urlState.patch(
          { q: q || null, page: null },
          { replaceUrl: true }
        ))
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  // --- Sample selection ---

  onSampleSelected(sample: any): void {
    this.urlState.patch({
      sample: sample.sample_ref,
      page: null,
      q: null,
    });
  }

  onSampleCleared(): void {
    this.urlState.patch({
      sample: null,
      page: null,
      q: null,
      mode: null,
      samples: null,
      sort: null,
      field: null,
    });
  }

  // --- Browse mode filtering + pagination ---

  onBrowseQueryChange(value: string): void {
    this.browseQueryInput$.next(value);
  }

  clearBrowseQuery(): void {
    this.urlState.patch({ q: null, page: null }, { replaceUrl: true });
  }

  onBrowsePageChange(page: number): void {
    this.urlState.patch({ page: page > 1 ? page : null }, { replaceUrl: true });
  }

  // --- Cross-sample search mode ---

  toggleSearchMode(): void {
    const now = this.latestVm?.mode ?? 'browse';
    if (now === 'search') {
      // Leaving search mode: wipe search-only params.
      this.urlState.patch({
        mode: null,
        q: null,
        page: null,
        sort: null,
        field: null,
        samples: null,
      });
    } else {
      this.urlState.patch({
        mode: 'search',
        q: null,
        page: null,
        sort: null,
        field: null,
      });
    }
  }

  executeCrossSearch(): void {
    const q = this.crossSearchInput.trim();
    if (q.length < 2) return;
    this.urlState.patch({
      mode: 'search',
      q,
      page: null,
    });
  }

  onCrossSearchPageChange(page: number): void {
    this.urlState.patch({ page: page > 1 ? page : null }, { replaceUrl: true });
  }

  onCrossSearchSortChange(sort: string): void {
    this.urlState.patch(
      { sort: sort !== 'phrase_ref' ? sort : null, page: null },
      { replaceUrl: true }
    );
  }

  onCrossSearchFieldChange(field: PhraseField): void {
    this.urlState.patch(
      { field: field !== 'both' ? field : null, page: null },
      { replaceUrl: true }
    );
  }

  onSearchSampleToggled(sample: any): void {
    const current = new Set(this.latestVm?.samples ?? []);
    if (current.has(sample.sample_ref)) current.delete(sample.sample_ref);
    else current.add(sample.sample_ref);
    const next = Array.from(current);
    this.urlState.patch({
      samples: this.urlState.toCSV(next),
      page: null,
    });
  }

  removeSearchSample(sample: any): void {
    const next = (this.latestVm?.samples ?? []).filter(ref => ref !== sample.sample_ref);
    this.urlState.patch({
      samples: this.urlState.toCSV(next),
      page: null,
    });
  }

  /** Adapter for sample-selection multi-select's `selectedSamples` input. */
  selectedSearchSamplesAsObjects(refs: string[]): { sample_ref: string }[] {
    return refs.map(sample_ref => ({ sample_ref }));
  }

  // --- Audio ---

  playAudio(phrase: any): void {
    const audioUrl = `${environment.audioUrl}/${phrase.sample}/${phrase.sample}_${phrase.phrase_ref}.mp3`;
    if (this.currentAudioUrl === audioUrl) {
      this.searchStateService.stopCurrentAudio();
      return;
    }
    this.searchStateService.playAudio(audioUrl).catch((error: any) => {
      console.error('Error playing audio:', error);
      this.showNoAudioModal();
    });
  }

  isThisAudioPlaying(phrase: any): boolean {
    if (!this.currentAudioUrl) return false;
    const audioUrl = `${environment.audioUrl}/${phrase.sample}/${phrase.sample}_${phrase.phrase_ref}.mp3`;
    return this.currentAudioUrl === audioUrl;
  }

  private showNoAudioModal(): void {
    setTimeout(() => {
      const modalElement = document.getElementById('noAudioModal');
      if (!modalElement) return;
      const modal = new (window as any).bootstrap.Modal(modalElement);
      modal.show();
      modalElement.addEventListener('hidden.bs.modal', () => {
        document.body.classList.remove('modal-open');
        document.querySelector('.modal-backdrop')?.remove();
      });
    }, 100);
  }

  // --- Export ---

  openExportModal(context: PhraseMode = 'search'): void {
    this.exportContext = context;
    this.exportModalComponent.open();
  }

  confirmExport(format: ExportFormat): void {
    const vm = this.latestVm;
    if (!vm) return;
    if (this.exportContext === 'browse') {
      // Re-derive the filtered browse list for export.
      // (Can't grab it from browseView$ synchronously without race.)
      this.dataService.getPhrasesCached(vm.sample ?? '').subscribe(phrases => {
        const q = vm.q.trim().toLowerCase();
        const filtered = !q
          ? phrases
          : phrases.filter(p =>
              (p.phrase ?? '').toLowerCase().includes(q) ||
              (p.english ?? '').toLowerCase().includes(q));
        this.exportService.exportList(
          this.renamePhraseFields(filtered),
          ['_id', '_key', '_rev'],
          [],
          format,
          'phrases-' + (vm.sample ?? 'export')
        );
      });
    } else {
      this.downloadCrossSearchExport(format, vm);
    }
  }

  private downloadCrossSearchExport(format: ExportFormat, vm: PhraseViewState): void {
    this.exportLoading = true;
    const sampleRefs = vm.samples.length > 0 ? vm.samples : undefined;
    this.exportService.downloadFromSource(
      this.dataService.exportPhrases(vm.q.trim(), sampleRefs, vm.sort, vm.field)
        .pipe(map(phrases => this.renamePhraseFields(phrases))),
      format,
      'phrase-search-results'
    ).pipe(finalize(() => this.exportLoading = false))
     .subscribe({ error: () => {} });
  }

  private renamePhraseFields(phrases: any[]): Record<string, any>[] {
    return phrases.map(p => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(p)) {
        out[k === 'conjugated' ? 'verb conjugation' : k] = v;
      }
      return out;
    });
  }
}
