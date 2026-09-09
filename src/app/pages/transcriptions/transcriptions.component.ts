import { environment } from '../../../environments/environment';
import { Component, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { BehaviorSubject, Observable, Subject, Subscription, combineLatest, concat, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, finalize, map, shareReplay, switchMap } from 'rxjs/operators';

import { DataService } from '../../api/data.service';
import { ExportService, ExportFormat } from '../../api/export.service';
import { SearchStateService } from '../../api/search-state.service';
import { AudioService } from '../../api/audio.service';
import { UrlStateService } from '../../api/url-state.service';
import { UserService } from '../../api/user.service';
import { PageTitleService } from '../../api/page-title.service';
import { SampleSelectionComponent } from '../../shared/sample-selection/sample-selection.component';
import { ExportModalComponent } from '../../shared/export-modal/export-modal.component';
import { PaginationComponent } from '../../shared/pagination/pagination.component';
import { HierarchyPickerComponent } from '../../shared/hierarchy-picker/hierarchy-picker.component';
import { foldText } from '../../shared/text-utils';

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
  imports: [CommonModule, FormsModule, RouterModule, SampleSelectionComponent, ExportModalComponent, PaginationComponent, HierarchyPickerComponent],
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
  private readonly userService = inject(UserService);
  private readonly pageTitleService = inject(PageTitleService);

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

  /** Bumped after a create/delete so the browse list re-fetches (the cache
   *  is invalidated first, so this pulls fresh data). */
  private readonly browseRefresh$ = new BehaviorSubject<void>(undefined);

  /** Server-loaded transcriptions for the current browse sample (cached). */
  readonly browseData$: Observable<BrowseData> = combineLatest([
    this.vm$.pipe(
      map(vm => ({ mode: vm.mode, sample: vm.sample })),
      distinctUntilChanged((a, b) => a.mode === b.mode && a.sample === b.sample),
    ),
    this.browseRefresh$,
  ]).pipe(
    map(([key]) => key),
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
      const q = foldText(vm.q.trim());
      const filtered = !q
        ? data.items
        : data.items.filter(t =>
            foldText(t.transcription ?? '').includes(q) ||
            foldText(t.english ?? '').includes(q) ||
            foldText(t.gloss ?? '').includes(q) ||
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

  // Transcription edit modal state
  showTranscriptionEditModal = false;
  editingTranscription: any = null;
  transcriptionEditData: any = {};
  transcriptionEditSaving = false;
  transcriptionEditError = '';
  transcriptionEditSuccess = '';
  transcriptionDeleteConfirming = false;
  transcriptionDeleting = false;

  // Transcription add modal state
  showTranscriptionAddModal = false;
  newTranscriptionData: any = {};
  transcriptionAddSaving = false;
  transcriptionAddError = '';
  transcriptionAddSuccess = '';

  /** Human-readable hierarchy labels for linked question_ids/category_ids,
   *  resolved on demand (batch) whenever an edit/add modal opens. */
  questionLabelById = new Map<number, string>();
  categoryLabelById = new Map<number, string>();

  /** Inline search-to-add for linking research questions/categories. */
  questionSearchInput = '';
  questionSearchResults: any[] = [];
  categorySearchInput = '';
  categorySearchResults: any[] = [];
  /** Unified Category + ResearchQuestion picker, shared by edit and add modals. */
  showLinkPicker = false;
  /** Which modal's link arrays the picker/typeahead currently target. */
  private linkEditTarget: 'edit' | 'add' = 'edit';
  private readonly questionSearchInput$ = new Subject<string>();
  private readonly categorySearchInput$ = new Subject<string>();
  /** Staged-for-removal linked ids in the edit modal (strikethrough + Restore);
   *  nothing is unlinked until Save. */
  removedQuestionIds = new Set<number>();
  removedCategoryIds = new Set<number>();

  /** Unfiltered browse-mode transcriptions for the current sample — used to
   *  suggest the next segment number and detect collisions when adding. */
  private latestBrowseItems: BrowseTranscription[] = [];

  private readonly subs: Subscription[] = [];

  ngOnInit(): void {
    // If the URL arrived here with no `sample` (e.g. via a plain routerLink
    // that doesn't propagate it, such as Home), restore the last one the
    // user picked anywhere in the app, rather than treating it as cleared.
    // An explicit `?sample=` in the URL always wins.
    if (!this.urlState.snapshot().get('sample')) {
      const lastSample = this.searchStateService.getCurrentSample();
      if (lastSample?.sample_ref) {
        this.urlState.patch({ sample: lastSample.sample_ref }, { replaceUrl: true });
      }
    }

    this.subs.push(this.vm$.subscribe(vm => {
      this.latestVm = vm;
      if (vm.mode === 'search' && vm.q !== this.crossSearchInput) {
        this.crossSearchInput = vm.q;
      } else if (vm.mode === 'browse') {
        this.crossSearchInput = '';
      }
      this.pageTitleService.setDetail(vm.mode === 'search' ? (vm.q || 'Search') : vm.sample);
    }));

    this.subs.push(this.searchData$.subscribe(sd => this.latestSearchData = sd));
    this.subs.push(this.browseView$.subscribe(bv => {
      this.latestBrowseView = { filteredCount: bv.filteredCount, items: bv.items };
    }));
    this.subs.push(this.browseData$.subscribe(bd => this.latestBrowseItems = bd.items));

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

    this.subs.push(
      this.questionSearchInput$.pipe(debounceTime(250), distinctUntilChanged())
        .subscribe(q => this.dataService.searchResearchQuestions(q).subscribe(r => this.questionSearchResults = r))
    );
    this.subs.push(
      this.categorySearchInput$.pipe(debounceTime(250), distinctUntilChanged())
        .subscribe(q => this.dataService.searchCategories(q).subscribe(r => this.categorySearchResults = r))
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

  segmentAudioUrl(transcription: any): string {
    const sample = transcription.sample ?? this.latestVm?.sample;
    return `${environment.audioUrl}/${sample}/${sample}_SEG_${transcription.segment_no}.mp3`;
  }

  fullTranscriptionAudioUrl(): string {
    const sample = this.latestVm?.sample;
    return `${environment.audioUrl}/${sample}/${sample}_TRANS.mp3`;
  }

  playAudio(transcription: any): void {
    const sample = this.latestVm?.sample;
    if (!sample || !transcription.segment_no) return;

    const audioUrl = this.segmentAudioUrl(transcription);

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
    return !!this.currentAudioUrl && this.currentAudioUrl === this.segmentAudioUrl(transcription);
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

    this.audioService.play(this.fullTranscriptionAudioUrl()).then(() => {
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

  // --- Transcription editing ---
  //
  // Unlike phrases (per-sample text over a shared MasterPhrase concept), a
  // transcription is wholly sample-specific: its linked research questions /
  // categories live directly on the doc as flat question_ids/category_ids
  // arrays, with no master layer and no overrides. So the connection editor
  // here mirrors the MasterPhrase editor on the Phrases page (directly
  // editable arrays, typeahead + remove/restore + hierarchy picker), just
  // gated by the sample-scoped canEditSample rather than global-admin.

  canEditTranscription(t: any): boolean {
    const sample = t.sample ?? this.latestVm?.sample;
    return !!sample && this.userService.canEditSample(sample);
  }

  /** Gate for the "Add Segment" button in browse mode — same editor
   *  privilege as editing an existing segment, just not tied to one yet. */
  canAddTranscriptionForSample(sample: string | null): boolean {
    return !!sample && this.userService.canEditSample(sample);
  }

  openTranscriptionEditModal(t: any): void {
    this.editingTranscription = t;
    this.transcriptionEditData = {
      transcription: t.transcription || '',
      english: t.english || '',
      gloss: t.gloss || '',
      segment_no: t.segment_no ?? '',
      question_ids: [...(t.question_ids ?? [])],
      category_ids: [...(t.category_ids ?? [])],
    };
    this.transcriptionEditError = '';
    this.transcriptionEditSuccess = '';
    this.transcriptionDeleteConfirming = false;
    this.transcriptionDeleting = false;
    this.removedQuestionIds = new Set();
    this.removedCategoryIds = new Set();
    this.questionSearchInput = '';
    this.questionSearchResults = [];
    this.categorySearchInput = '';
    this.categorySearchResults = [];
    this.linkEditTarget = 'edit';
    this.showTranscriptionEditModal = true;

    this.resolveLinkedLabels(this.transcriptionEditData.question_ids);
    this.resolveLinkedCategoryLabels(this.transcriptionEditData.category_ids);
  }

  closeTranscriptionEditModal(): void {
    this.showTranscriptionEditModal = false;
    this.editingTranscription = null;
    this.removedQuestionIds = new Set();
    this.removedCategoryIds = new Set();
  }

  saveTranscription(): void {
    this.transcriptionEditSaving = true;
    this.transcriptionEditError = '';
    this.transcriptionEditSuccess = '';

    const payload: any = {
      transcription: this.transcriptionEditData.transcription,
      english: this.transcriptionEditData.english,
      gloss: this.transcriptionEditData.gloss,
      question_ids: this.transcriptionEditData.question_ids.filter((id: number) => !this.removedQuestionIds.has(id)),
      category_ids: this.transcriptionEditData.category_ids.filter((id: number) => !this.removedCategoryIds.has(id)),
    };
    if (this.transcriptionEditData.segment_no !== '') {
      payload.segment_no = Number(this.transcriptionEditData.segment_no);
    }

    this.dataService.updateTranscription(this.editingTranscription._key, payload).subscribe({
      next: (updated: any) => {
        Object.assign(this.editingTranscription, updated);
        this.editingTranscription.glossSafe = updated.gloss
          ? this.sanitizer.bypassSecurityTrustHtml(updated.gloss)
          : null;
        const sample = updated.sample ?? this.latestVm?.sample;
        if (sample) {
          this.dataService.invalidateTranscriptionsCache(sample);
          this.browseRefresh$.next();
        }
        this.transcriptionEditSaving = false;
        this.transcriptionEditSuccess = 'Transcription updated successfully.';
        setTimeout(() => this.closeTranscriptionEditModal(), 1200);
      },
      error: (err: any) => {
        this.transcriptionEditSaving = false;
        this.transcriptionEditError = err.error?.error || err.error?.detail || 'Failed to save changes.';
      },
    });
  }

  // --- Delete a segment (inline confirm in the edit modal footer) ---

  requestDeleteTranscription(): void {
    this.transcriptionDeleteConfirming = true;
  }

  cancelDeleteTranscription(): void {
    this.transcriptionDeleteConfirming = false;
  }

  confirmDeleteTranscription(): void {
    if (!this.editingTranscription?._key) return;
    const sample = this.editingTranscription.sample ?? this.latestVm?.sample;

    this.transcriptionDeleting = true;
    this.transcriptionEditError = '';
    this.dataService.deleteTranscription(this.editingTranscription._key).subscribe({
      next: () => {
        this.transcriptionDeleting = false;
        if (sample) {
          this.dataService.invalidateTranscriptionsCache(sample);
          this.browseRefresh$.next();
        }
        this.closeTranscriptionEditModal();
      },
      error: (err: any) => {
        this.transcriptionDeleting = false;
        this.transcriptionDeleteConfirming = false;
        this.transcriptionEditError = err.error?.error || err.error?.detail || 'Failed to delete segment.';
      },
    });
  }

  // --- Add a new segment ---

  /** segment_no values already in use for the current browse sample
   *  (unfiltered — independent of any active browse search box). */
  private existingSegmentNos(): number[] {
    return (this.latestBrowseItems ?? [])
      .map(t => Number(t.segment_no))
      .filter(n => !isNaN(n));
  }

  /** True once the typed Add-modal segment number collides with an existing
   *  one — drives the inline invalid state and blocks save (the server also
   *  409s this, but catching it here is instant and clearer). */
  get addSegmentNoTaken(): boolean {
    const raw = this.newTranscriptionData?.segment_no;
    if (raw === '' || raw === null || raw === undefined) return false;
    const n = Number(raw);
    if (isNaN(n)) return false;
    return this.existingSegmentNos().includes(n);
  }

  openTranscriptionAddModal(): void {
    const used = this.existingSegmentNos();
    const nextSegmentNo = used.length ? Math.max(...used) + 1 : 1;
    this.newTranscriptionData = {
      segment_no: nextSegmentNo,
      transcription: '',
      english: '',
      gloss: '',
      question_ids: [],
      category_ids: [],
    };
    this.transcriptionAddError = '';
    this.transcriptionAddSuccess = '';
    this.questionSearchInput = '';
    this.questionSearchResults = [];
    this.categorySearchInput = '';
    this.categorySearchResults = [];
    this.linkEditTarget = 'add';
    this.showTranscriptionAddModal = true;
  }

  closeTranscriptionAddModal(): void {
    this.showTranscriptionAddModal = false;
  }

  saveNewTranscription(): void {
    const sample = this.latestVm?.sample;
    if (!sample) {
      this.transcriptionAddError = 'Pick a sample first.';
      return;
    }
    if (this.newTranscriptionData.segment_no === '' || isNaN(Number(this.newTranscriptionData.segment_no))) {
      this.transcriptionAddError = 'Segment number is required and must be a number.';
      return;
    }
    if (this.addSegmentNoTaken) {
      this.transcriptionAddError = `Segment ${Number(this.newTranscriptionData.segment_no)} already exists for this sample.`;
      return;
    }

    this.transcriptionAddSaving = true;
    this.transcriptionAddError = '';
    this.transcriptionAddSuccess = '';

    this.dataService.createTranscription({
      sample,
      segment_no: Number(this.newTranscriptionData.segment_no),
      transcription: this.newTranscriptionData.transcription || undefined,
      english: this.newTranscriptionData.english || undefined,
      gloss: this.newTranscriptionData.gloss || undefined,
      question_ids: this.newTranscriptionData.question_ids,
      category_ids: this.newTranscriptionData.category_ids,
    }).subscribe({
      next: () => {
        this.dataService.invalidateTranscriptionsCache(sample);
        this.browseRefresh$.next();
        this.transcriptionAddSaving = false;
        this.transcriptionAddSuccess = 'Segment added.';
        setTimeout(() => this.closeTranscriptionAddModal(), 1200);
      },
      error: (err: any) => {
        this.transcriptionAddSaving = false;
        this.transcriptionAddError = err.error?.error || err.error?.detail || 'Failed to add segment.';
      },
    });
  }

  // --- Research question / category link editing (shared by both modals) ---

  private linkData(): any {
    return this.linkEditTarget === 'add' ? this.newTranscriptionData : this.transcriptionEditData;
  }

  onQuestionSearchInput(value: string): void {
    this.questionSearchInput = value;
    this.questionSearchInput$.next(value);
  }

  onCategorySearchInput(value: string): void {
    this.categorySearchInput = value;
    this.categorySearchInput$.next(value);
  }

  addQuestionLink(question: any): void {
    const data = this.linkData();
    if (this.removedQuestionIds.has(question.id)) {
      this.removedQuestionIds.delete(question.id);
    } else if (!data.question_ids.includes(question.id)) {
      data.question_ids.push(question.id);
      this.questionLabelById.set(question.id, this.formatHierarchy(question.hierarchy, question.name));
    }
    this.questionSearchInput = '';
    this.questionSearchResults = [];
  }

  addCategoryLink(category: any): void {
    const data = this.linkData();
    if (this.removedCategoryIds.has(category.id)) {
      this.removedCategoryIds.delete(category.id);
    } else if (!data.category_ids.includes(category.id)) {
      data.category_ids.push(category.id);
      this.categoryLabelById.set(category.id, this.formatHierarchy(category.hierarchy, category.name));
    }
    this.categorySearchInput = '';
    this.categorySearchResults = [];
  }

  /** Edit modal only: stage/unstage a linked id for removal (strikethrough +
   *  Restore) — nothing is unlinked until Save (saveTranscription filters
   *  these out). In the add modal, links are dropped immediately instead. */
  toggleRemoveQuestionId(id: number): void {
    if (this.linkEditTarget === 'add') {
      this.newTranscriptionData.question_ids = this.newTranscriptionData.question_ids.filter((q: number) => q !== id);
      return;
    }
    if (this.removedQuestionIds.has(id)) this.removedQuestionIds.delete(id);
    else this.removedQuestionIds.add(id);
  }

  toggleRemoveCategoryId(id: number): void {
    if (this.linkEditTarget === 'add') {
      this.newTranscriptionData.category_ids = this.newTranscriptionData.category_ids.filter((c: number) => c !== id);
      return;
    }
    if (this.removedCategoryIds.has(id)) this.removedCategoryIds.delete(id);
    else this.removedCategoryIds.add(id);
  }

  openLinkPicker(target: 'edit' | 'add'): void {
    this.linkEditTarget = target;
    this.showLinkPicker = true;
  }

  closeLinkPicker(): void {
    this.showLinkPicker = false;
  }

  /** Seeds the unified picker with the union of currently-linked question
   *  and category ids (the picker itself distinguishes leaf/branch per node). */
  get linkPickerSelectedIds(): number[] {
    const data = this.linkData();
    return [...(data.question_ids ?? []), ...(data.category_ids ?? [])];
  }

  /** Picker emits its full current selection on every toggle; split it back
   *  into question_ids/category_ids by each node's is_leaf flag. */
  onLinkPickerChange(nodes: any[]): void {
    const data = this.linkData();
    const questionNodes = nodes.filter(n => !!n.is_leaf);
    const categoryNodes = nodes.filter(n => !n.is_leaf);
    data.question_ids = questionNodes.map(n => Number(n.id));
    data.category_ids = categoryNodes.map(n => Number(n.id));
    questionNodes.forEach(n => this.questionLabelById.set(Number(n.id), this.formatHierarchy(n.hierarchy, n.name)));
    categoryNodes.forEach(n => this.categoryLabelById.set(Number(n.id), this.formatHierarchy(n.hierarchy, n.name)));
    // The picker overwrote both arrays wholesale — drop any pending removal
    // that no longer refers to a linked id.
    for (const id of [...this.removedQuestionIds]) {
      if (!data.question_ids.includes(id)) this.removedQuestionIds.delete(id);
    }
    for (const id of [...this.removedCategoryIds]) {
      if (!data.category_ids.includes(id)) this.removedCategoryIds.delete(id);
    }
  }

  private resolveLinkedLabels(questionIds: number[]): void {
    if (questionIds.length > 0) {
      this.dataService.getResearchQuestionsByIds(questionIds).subscribe(questions => {
        questions.forEach(q => this.questionLabelById.set(q.id, this.formatHierarchy(q.hierarchy, q.name)));
      });
    }
  }

  private resolveLinkedCategoryLabels(categoryIds: number[]): void {
    if (categoryIds.length > 0) {
      this.dataService.getCategoriesByIds(categoryIds).subscribe(categories => {
        categories.forEach(c => this.categoryLabelById.set(c.id, this.formatHierarchy(c.hierarchy, c.name)));
      });
    }
  }

  /** Hierarchy breadcrumb for display, without the "RLB" root segment. */
  formatHierarchy(hierarchy: string[] | undefined, name: string): string {
    const parts = hierarchy && hierarchy.length > 0 ? hierarchy : [name];
    const withoutRoot = parts.length > 1 ? parts.slice(1) : parts;
    return withoutRoot.join(' › ');
  }

  getQuestionLabel(id: number): string {
    return this.questionLabelById.get(id) ?? '';
  }

  getCategoryLabel(id: number): string {
    return this.categoryLabelById.get(id) ?? '';
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
