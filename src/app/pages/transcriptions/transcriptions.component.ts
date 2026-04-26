import { environment } from '../../../environments/environment';
import { Component, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Observable, Subject, Subscription, combineLatest, concat, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, finalize, map, shareReplay, switchMap } from 'rxjs/operators';

import { DataService } from '../../api/data.service';
import { ExportService, ExportFormat } from '../../api/export.service';
import { SearchStateService } from '../../api/search-state.service';
import { AudioService } from '../../api/audio.service';
import { UrlStateService } from '../../api/url-state.service';
import { SampleSelectionComponent } from '../../shared/sample-selection/sample-selection.component';
import { ExportModalComponent } from '../../shared/export-modal/export-modal.component';
import { PaginationComponent } from '../../shared/pagination/pagination.component';

type TranscriptionMode = 'browse' | 'search';
type TranscriptionField = 'both' | 'romani' | 'english';

interface TranscriptionViewState {
  sample: string | null;
  mode: TranscriptionMode;
  q: string;
  page: number;
  samples: string[];
  sort: string;
  field: TranscriptionField;
}

interface BrowseTranscription {
  transcription: string;
  english?: string;
  gloss?: string;
  glossSafe?: SafeHtml | null;
  segment_no?: number;
  [key: string]: any;
}

interface BrowseData {
  items: BrowseTranscription[];
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
  selector: 'app-transcriptions',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SampleSelectionComponent, ExportModalComponent, PaginationComponent],
  templateUrl: './transcriptions.component.html',
  styleUrls: ['./transcriptions.component.scss']
})
export class TranscriptionsComponent implements OnInit, OnDestroy {
  private readonly dataService = inject(DataService);
  private readonly exportService = inject(ExportService);
  private readonly searchStateService = inject(SearchStateService);
  private readonly audioService = inject(AudioService);
  private readonly urlState = inject(UrlStateService);
  private readonly sanitizer = inject(DomSanitizer);

  @ViewChild('exportModal') exportModalComponent!: ExportModalComponent;

  /** URL-derived view state. Source of truth for this component. */
  readonly vm$: Observable<TranscriptionViewState> = this.urlState.selectMany<TranscriptionViewState>({
    sample: raw => (raw && raw.length > 0 ? raw : null),
    mode: raw => (raw === 'search' ? 'search' : 'browse'),
    q: raw => raw ?? '',
    page: raw => Math.max(1, this.urlState.parseInt(raw, 1)),
    samples: raw => this.urlState.parseCSV(raw),
    sort: raw => raw ?? 'segment_no',
    field: raw => (raw === 'romani' || raw === 'english' ? raw : 'both'),
  }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /** Server-loaded transcriptions for the current browse sample (cached). */
  readonly browseData$: Observable<BrowseData> = this.vm$.pipe(
    map(vm => ({ mode: vm.mode, sample: vm.sample })),
    distinctUntilChanged((a, b) => a.mode === b.mode && a.sample === b.sample),
    switchMap(({ mode, sample }) => {
      if (mode !== 'browse' || !sample) {
        return of<BrowseData>({ items: [], loading: false, notFound: false, sample });
      }
      return concat(
        of<BrowseData>({ items: [], loading: true, notFound: false, sample }),
        this.dataService.getTranscriptionsCached(sample).pipe(
          map(transcriptions => {
            const items: BrowseTranscription[] = transcriptions.map(t => ({
              ...t,
              transcription: t.transcription ? this.stripHtmlTags(t.transcription) : t.transcription,
              glossSafe: t.gloss ? this.sanitizer.bypassSecurityTrustHtml(t.gloss) : null,
            }));
            return { items, loading: false, notFound: items.length === 0, sample };
          }),
          catchError(() => of<BrowseData>({ items: [], loading: false, notFound: true, sample }))
        )
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Browse view = local q filter + segment_no sort on server data. */
  readonly browseView$ = combineLatest([this.vm$, this.browseData$]).pipe(
    map(([vm, data]) => {
      const q = vm.q.trim().toLowerCase();
      const filtered = !q
        ? data.items
        : data.items.filter(t =>
            (t.transcription ?? '').toLowerCase().includes(q) ||
            (t.english ?? '').toLowerCase().includes(q) ||
            (t.gloss ?? '').toLowerCase().includes(q) ||
            (t.segment_no !== undefined && t.segment_no !== null && t.segment_no.toString().includes(q)));
      const sorted = [...filtered].sort((a, b) => (a.segment_no ?? 0) - (b.segment_no ?? 0));
      return {
        loading: data.loading,
        notFound: data.notFound,
        allCount: data.items.length,
        filteredCount: sorted.length,
        items: sorted,
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
        this.dataService.searchTranscriptions(key.q, sampleRefs, key.page, key.sort, key.field).pipe(
          map((data: any) => ({
            results: data.results,
            count: data.count,
            loading: false,
            done: true,
          })),
          catchError(err => {
            console.error('Error searching transcriptions:', err);
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

  /** Play-all state; ephemeral, not URL-controlled. */
  isPlayingAll = false;
  playAllErrorMessage = '';

  /** Debounced stream for incremental browse-mode filtering. */
  private readonly browseQueryInput$ = new Subject<string>();

  /** Snapshot of latest vm, used by imperative handlers (export, audio). */
  private latestVm: TranscriptionViewState | null = null;

  /** Sample active in browse mode just before entering search mode; restored
   *  when the user exits search mode so they land back where they were. */
  private rememberedBrowseSample: string | null = null;

  /** Used by the export modal to know which dataset to export. */
  exportContext: TranscriptionMode = 'browse';
  exportLoading = false;

  /** Cached view-model for template guards that need synchronous reads. */
  latestSearchData: SearchData = { results: [], count: 0, loading: false, done: false };
  latestBrowseView: { filteredCount: number; items: BrowseTranscription[] } = { filteredCount: 0, items: [] };

  private readonly subs: Subscription[] = [];

  ngOnInit(): void {
    this.subs.push(this.vm$.subscribe(vm => {
      this.latestVm = vm;
      if (vm.mode === 'search' && vm.q !== this.crossSearchInput) {
        this.crossSearchInput = vm.q;
      } else if (vm.mode === 'browse') {
        this.crossSearchInput = '';
      }
    }));

    this.subs.push(this.searchData$.subscribe(sd => this.latestSearchData = sd));
    this.subs.push(this.browseView$.subscribe(bv => {
      this.latestBrowseView = { filteredCount: bv.filteredCount, items: bv.items };
    }));

    this.subs.push(this.audioService.currentUrl$
      .subscribe(url => this.currentAudioUrl = url));

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

  // --- Browse mode filtering ---

  onBrowseQueryChange(value: string): void {
    this.browseQueryInput$.next(value);
  }

  clearBrowseQuery(): void {
    this.urlState.patch({ q: null, page: null }, { replaceUrl: true });
  }

  // --- Cross-sample search mode ---

  toggleSearchMode(): void {
    const now = this.latestVm?.mode ?? 'browse';
    if (now === 'search') {
      const restore = this.rememberedBrowseSample;
      this.rememberedBrowseSample = null;
      this.urlState.patch({
        mode: null,
        q: null,
        page: null,
        sort: null,
        field: null,
        samples: null,
        sample: restore,
      });
    } else {
      this.rememberedBrowseSample = this.latestVm?.sample ?? null;
      this.urlState.patch({
        mode: 'search',
        sample: null,
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
      { sort: sort !== 'segment_no' ? sort : null, page: null },
      { replaceUrl: true }
    );
  }

  onCrossSearchFieldChange(field: TranscriptionField): void {
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

  playAudio(transcription: any): void {
    const sample = this.latestVm?.sample;
    if (!sample || !transcription.segment_no) return;

    const audioUrl = `${environment.audioUrl}/${sample}/${sample}_SEG_${transcription.segment_no}.mp3`;

    if (this.currentAudioUrl === audioUrl) {
      this.audioService.stop();
      return;
    }

    if (this.isPlayingAll) {
      this.stopAllPlayback();
    }

    this.audioService.play(audioUrl).catch((err: any) => {
      console.error('Error playing audio:', err);
      this.showNoAudioModal();
    });
  }

  isThisAudioPlaying(transcription: any): boolean {
    const sample = this.latestVm?.sample;
    if (!sample || !transcription.segment_no || !this.currentAudioUrl) return false;
    const audioUrl = `${environment.audioUrl}/${sample}/${sample}_SEG_${transcription.segment_no}.mp3`;
    return this.currentAudioUrl === audioUrl;
  }

  playAllTranscriptions(): void {
    const sample = this.latestVm?.sample;
    if (!sample || this.latestBrowseView.items.length === 0) return;

    if (this.isPlayingAll) {
      this.stopAllPlayback();
      return;
    }

    if (this.currentAudioUrl) return;

    this.playAllErrorMessage = '';
    this.isPlayingAll = true;

    const audioUrl = `${environment.audioUrl}/${sample}/${sample}_TRANS.mp3`;

    this.audioService.play(audioUrl).then(() => {
      this.stopAllPlayback();
    }).catch((err: any) => {
      console.error('Error playing full transcription audio:', err);
      this.playAllErrorMessage = 'Full transcription audio file not available for this sample';
      this.stopAllPlayback();
    });
  }

  stopAllPlayback(): void {
    this.isPlayingAll = false;
    this.audioService.stop();
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

  openExportModal(context: TranscriptionMode = 'browse'): void {
    this.exportContext = context;
    this.exportModalComponent.open();
  }

  confirmExport(format: ExportFormat): void {
    const vm = this.latestVm;
    if (!vm) return;
    if (this.exportContext === 'browse') {
      const ordered = this.latestBrowseView.items.map(t => {
        const { gloss, glossSafe, transcription, ...rest } = t;
        return { transcription, gloss, ...rest };
      });
      this.exportService.exportList(
        ordered,
        ['_id', '_key', '_rev', 'glossSafe'],
        [],
        format,
        'transcriptions-' + (vm.sample ?? 'export'),
      );
    } else {
      this.downloadCrossSearchExport(format, vm);
    }
  }

  private downloadCrossSearchExport(format: ExportFormat, vm: TranscriptionViewState): void {
    this.exportLoading = true;
    const sampleRefs = vm.samples.length > 0 ? vm.samples : undefined;
    this.exportService.downloadFromSource(
      this.dataService.exportTranscriptions(vm.q.trim(), sampleRefs, vm.sort, vm.field),
      format,
      'transcription-search-results'
    ).pipe(finalize(() => this.exportLoading = false))
     .subscribe({ error: () => {} });
  }

  private stripHtmlTags(input: string): string {
    if (!input) return '';
    return input.replace(/<[^>]*>/g, '');
  }
}
