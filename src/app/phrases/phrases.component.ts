import { environment } from '../../environments/environment';
import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../api/data.service';
import { RouterModule } from '@angular/router';
import { SearchStateService } from '../api/search-state.service';
import { UserService } from '../api/user.service';
import { AudioService } from '../api/audio.service';
import { UrlStateService } from '../api/url-state.service';
import { PageTitleService } from '../api/page-title.service';
import { SampleSelectionComponent } from '../shared/sample-selection/sample-selection.component';
import { PaginationComponent } from '../shared/pagination/pagination.component';
import { ExportModalComponent } from '../shared/export-modal/export-modal.component';
import { PhrasePickerComponent } from '../shared/phrase-picker/phrase-picker.component';
import { HierarchyPickerComponent } from '../shared/hierarchy-picker/hierarchy-picker.component';
import { ExportService, ExportFormat } from '../api/export.service';
import { PhraseListItem } from '../api/data.service';
import { foldText } from '../shared/text-utils';
import { BehaviorSubject, Observable, Subject, Subscription, combineLatest, concat, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, finalize, map, shareReplay, switchMap } from 'rxjs/operators';

type PhraseMode = 'browse' | 'search' | 'master';
type PhraseField = 'both' | 'romani' | 'english';

interface PhraseViewState {
  sample: string | null;
  mode: PhraseMode;
  q: string;
  phrase_ref: string | null;
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
  imports: [CommonModule, FormsModule, RouterModule, SampleSelectionComponent, PaginationComponent, ExportModalComponent, PhrasePickerComponent, HierarchyPickerComponent],
  templateUrl: './phrases.component.html',
  styleUrl: './phrases.component.scss'
})
export class PhrasesComponent implements OnInit, OnDestroy {
  private readonly dataService = inject(DataService);
  private readonly exportService = inject(ExportService);
  private readonly searchStateService = inject(SearchStateService);
  private readonly audioService = inject(AudioService);
  private readonly urlState = inject(UrlStateService);
  private readonly userService = inject(UserService);
  private readonly pageTitleService = inject(PageTitleService);

  @ViewChild('exportModal') exportModalComponent!: ExportModalComponent;
  @ViewChild('phraseTextarea') phraseTextarea?: ElementRef<HTMLTextAreaElement>;

  readonly browsePageSize = 50;

  /** URL-derived view state. Source of truth for this component. */
  readonly vm$: Observable<PhraseViewState> = this.urlState.selectMany<PhraseViewState>({
    sample: raw => (raw && raw.length > 0 ? raw : null),
    mode: raw => (raw === 'search' ? 'search' : raw === 'master' ? 'master' : 'browse'),
    q: raw => raw ?? '',
    phrase_ref: raw => (raw && raw.length > 0 ? raw : null),
    page: raw => Math.max(1, this.urlState.parseInt(raw, 1)),
    samples: raw => this.urlState.parseCSV(raw),
    sort: raw => raw ?? 'phrase_ref',
    field: raw => (raw === 'romani' || raw === 'english' ? raw : 'both'),
  }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /** Bumped after a new sample phrase is added to force browseData$ to
   *  re-fetch (its switchMap otherwise only keys off mode/sample changes). */
  private readonly browseRefresh$ = new BehaviorSubject<void>(undefined);

  /** Server-loaded phrases for the current browse sample (cached; re-fetched
   *  on browseRefresh$ too, bypassing the cache via invalidatePhrasesCache). */
  readonly browseData$: Observable<BrowseData> = combineLatest([
    this.vm$.pipe(
      map(vm => ({ mode: vm.mode, sample: vm.sample })),
      distinctUntilChanged((a, b) => a.mode === b.mode && a.sample === b.sample)
    ),
    this.browseRefresh$,
  ]).pipe(
    switchMap(([{ mode, sample }]) => {
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
      const q = foldText(vm.q.trim());
      const filtered = !q
        ? data.phrases
        : data.phrases.filter(p =>
            foldText(p.phrase ?? '').includes(q) ||
            foldText(p.english ?? '').includes(q));
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

  /** Bumped after a new phrase concept is created to force masterListData$
   *  to re-fetch (its switchMap otherwise only keys off mode changes). */
  private readonly masterListRefresh$ = new BehaviorSubject<void>(undefined);

  /** All MasterPhrases (sample-agnostic), loaded once per master-mode entry
   *  (and again on masterListRefresh$). */
  readonly masterListData$: Observable<{ phrases: any[]; loading: boolean; error: boolean }> = combineLatest([
    this.vm$.pipe(map(vm => vm.mode), distinctUntilChanged()),
    this.masterListRefresh$,
  ]).pipe(
    switchMap(([mode]) => {
      if (mode !== 'master') {
        return of({ phrases: [], loading: false, error: false });
      }
      return concat(
        of({ phrases: [], loading: true, error: false }),
        this.dataService.getAllMasterPhrases().pipe(
          map(phrases => ({ phrases, loading: false, error: false })),
          catchError(() => of({ phrases: [], loading: false, error: true }))
        )
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Master list = all MasterPhrases + local q filter + pagination (mirrors browseView$). */
  readonly masterListView$ = combineLatest([this.vm$, this.masterListData$]).pipe(
    map(([vm, data]) => {
      const q = foldText(vm.q.trim());
      const filtered = !q
        ? data.phrases
        : data.phrases.filter(p =>
            foldText(p.phrase_ref ?? '').includes(q) ||
            foldText(p.english ?? '').includes(q));
      const start = (vm.page - 1) * this.browsePageSize;
      const paged = filtered.slice(start, start + this.browsePageSize);
      return {
        loading: data.loading,
        error: data.error,
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
      phrase_ref: vm.phrase_ref,
      samples: vm.samples.join(','),
      page: vm.page,
      sort: vm.sort,
      field: vm.field,
    })),
    distinctUntilChanged((a, b) =>
      a.mode === b.mode && a.q === b.q && a.phrase_ref === b.phrase_ref &&
      a.samples === b.samples && a.page === b.page && a.sort === b.sort && a.field === b.field
    ),
    switchMap(key => {
      const hasSearch = key.phrase_ref || key.q.length >= 2;
      if (key.mode !== 'search' || !hasSearch) {
        return of<SearchData>({ results: [], count: 0, loading: false, done: false });
      }
      const sampleRefs = key.samples ? key.samples.split(',') : undefined;
      return concat(
        of<SearchData>({ results: [], count: 0, loading: true, done: false }),
        this.dataService.searchPhrases(key.q, sampleRefs, key.page, key.sort, key.field, key.phrase_ref ?? undefined).pipe(
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

  /** Phrase picked from the picker but not yet searched (pending Search click). */
  pickedPhrase: PhraseListItem | null = null;

  /** Globally-played audio URL (for play/stop button state). */
  currentAudioUrl: string | null = null;

  /** Debounced stream for incremental browse-mode filtering. */
  private readonly browseQueryInput$ = new Subject<string>();

  /** Snapshot of latest vm, used by imperative handlers (export, audio). */
  private latestVm: PhraseViewState | null = null;

  /** Sample active in browse mode just before entering search mode; restored
   *  when the user exits search mode so they land back where they were. */
  private rememberedBrowseSample: string | null = null;

  /** Used by the export modal to know which dataset to export. */
  exportContext: PhraseMode = 'search';
  exportLoading = false;

  /** Cached view-model for template guards that need synchronous reads. */
  latestSearchData: SearchData = { results: [], count: 0, loading: false, done: false };

  // Sample-phrase edit modal state (phrase text + rare RQ exceptions —
  // any sample editor).
  showPhraseEditModal = false;
  editingPhrase: any = null;
  phraseEditData: any = {
    masterQuestionIds: [], question_overrides: { include: [], exclude: [] },
    masterCategoryIds: [], category_overrides: { include: [], exclude: [] },
  };
  phraseEditSaving = false;
  phraseEditError = '';
  phraseEditSuccess = '';
  /** True while GET /phrases/{key}/links/ is loading for the modal. */
  phraseLinksLoading = false;
  /** Inline "are you sure?" toggle for the Delete button below, rather than
   *  a separate modal — this only removes one sample's recording, much
   *  lower blast radius than deleting a phrase concept. */
  phraseDeleteConfirming = false;
  phraseDeleting = false;
  /** Pending confirmation for excluding a listed question/category link
   *  (rare, needs confirm). */
  excludeConfirmTarget: { kind: 'question' | 'category'; id: number } | null = null;
  showQuestionOverrides = false;
  /** Unified Category+ResearchQuestion picker for adding a sample-level
   *  exception of either kind — same component/mode ("any") as the master
   *  editor's link picker. */
  showLinkExceptionPicker = false;

  // Master-phrase edit modal state (english/conjugated/question_ids/
  // category_ids — global-admin/meta-editor only, never shown alongside
  // the sample-phrase modal above).
  showMasterEditModal = false;
  editingMasterPhrase: any = null;
  masterEditData: any = {};
  masterEditSaving = false;
  masterEditError = '';
  masterEditSuccess = '';
  /** True while GET /master-phrases/{phrase_ref}/ is loading for the modal. */
  masterLinksLoading = false;
  /** Ids staged for removal (strikethrough + Restore) but not yet saved —
   *  masterEditData.question_ids/category_ids stay untouched until save. */
  removedQuestionIds: Set<number> = new Set();
  removedCategoryIds: Set<number> = new Set();

  // Add-phrase-concept modal state (creates a new MasterPhrase). Kept
  // deliberately minimal — phrase_ref + english + conjugated; category/
  // research-question links are added afterward via the full edit modal,
  // which opens automatically once the new phrase is created.
  showAddMasterModal = false;
  addMasterData: { phrase_ref: string; english: string; conjugated: boolean } =
    { phrase_ref: '', english: '', conjugated: false };
  addMasterSaving = false;
  addMasterError = '';
  /** Synchronous snapshot of existing phrase_refs, kept in sync from
   *  masterListData$ (see ngOnInit) — backs suggestNextPhraseRef() and the
   *  duplicate check on every keystroke. */
  knownPhraseRefs: Set<string> = new Set();

  // Add-sample-phrase modal open flag (fields declared further down,
  // grouped with the rest of that flow's methods).
  showAddPhraseModal = false;

  /** Human-readable hierarchy labels for linked question_ids/category_ids,
   *  resolved on demand (batch) whenever an edit modal opens. */
  questionLabelById = new Map<number, string>();
  categoryLabelById = new Map<number, string>();

  /** Inline search-to-add for linking research questions/categories. */
  questionSearchInput = '';
  questionSearchResults: any[] = [];
  categorySearchInput = '';
  categorySearchResults: any[] = [];
  /** Unified Category+ResearchQuestion picker for the master editor. */
  showLinkPicker = false;
  private readonly questionSearchInput$ = new Subject<string>();
  private readonly categorySearchInput$ = new Subject<string>();

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

    this.subs.push(
      this.questionSearchInput$.pipe(debounceTime(250), distinctUntilChanged())
        .subscribe(q => this.dataService.searchResearchQuestions(q).subscribe(r => this.questionSearchResults = r))
    );
    this.subs.push(
      this.categorySearchInput$.pipe(debounceTime(250), distinctUntilChanged())
        .subscribe(q => this.dataService.searchCategories(q).subscribe(r => this.categorySearchResults = r))
    );

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
      this.pageTitleService.setDetail(vm.mode === 'search' ? (vm.q || 'Search') : vm.sample);
    }));

    this.subs.push(this.searchData$.subscribe(sd => this.latestSearchData = sd));

    // Synchronous set of known phrase_refs for the Add Phrase dialog's
    // duplicate check and next-ref suggestion (template can't await an
    // observable while the user is typing).
    this.subs.push(this.masterListData$.subscribe(d => {
      if (!d.loading && !d.error) {
        this.knownPhraseRefs = new Set(d.phrases.map((p: any) => p.phrase_ref));
      }
    }));

    this.subs.push(this.audioService.currentUrl$
      .subscribe(url => this.currentAudioUrl = url));

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
      // Leaving search mode: wipe search-only params and restore the sample
      // the user was browsing before they entered search mode, if any.
      this.pickedPhrase = null;
      const restore = this.rememberedBrowseSample;
      this.rememberedBrowseSample = null;
      this.urlState.patch({
        mode: null,
        q: null,
        phrase_ref: null,
        page: null,
        sort: null,
        field: null,
        samples: null,
        sample: restore,
      });
    } else {
      // Entering search mode: remember the current sample so we can restore
      // it on exit, then wipe browse-only params (sample has no meaning in
      // search mode) and any stale filter state.
      this.rememberedBrowseSample = this.latestVm?.sample ?? null;
      this.urlState.patch({
        mode: 'search',
        sample: null,
        q: null,
        phrase_ref: null,
        page: null,
        sort: null,
        field: null,
      });
    }
  }

  toggleMasterMode(): void {
    const now = this.latestVm?.mode ?? 'browse';
    if (now === 'master') {
      this.urlState.patch({ mode: null, q: null, page: null });
    } else {
      this.urlState.patch({ mode: 'master', q: null, page: null });
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

  onPhrasePicked(phrase: PhraseListItem): void {
    this.pickedPhrase = phrase;
  }

  executePhraseSearch(): void {
    if (!this.pickedPhrase) return;
    this.urlState.patch({
      mode: 'search',
      phrase_ref: this.pickedPhrase.phrase_ref,
      q: this.pickedPhrase.english ?? this.pickedPhrase.phrase_ref,
      field: 'english',
      page: null,
    });
    this.pickedPhrase = null;
  }

  clearPhraseFilter(): void {
    this.pickedPhrase = null;
    this.crossSearchInput = '';
    this.urlState.patch({ phrase_ref: null, q: null, field: null, page: null });
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

  phraseAudioUrl(phrase: any): string {
    return `${environment.audioUrl}/${phrase.sample}/${phrase.sample}_${phrase.phrase_ref}.mp3`;
  }

  playAudio(phrase: any): void {
    const audioUrl = this.phraseAudioUrl(phrase);
    if (this.currentAudioUrl === audioUrl) {
      this.audioService.stop();
      return;
    }
    this.audioService.play(audioUrl).catch((error: any) => {
      console.error('Error playing audio:', error);
      this.showNoAudioModal();
    });
  }

  isThisAudioPlaying(phrase: any): boolean {
    return !!this.currentAudioUrl && this.currentAudioUrl === this.phraseAudioUrl(phrase);
  }

  /** Grows the phrase-edit textarea to fit its content instead of scrolling. */
  autoGrowTextarea(el: EventTarget | null): void {
    const textarea = el as HTMLTextAreaElement;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
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

  // --- Phrase editing ---
  //
  // Editing is split across two collections: `phrase` text is per-sample
  // (SamplePhrases), while english/conjugated/question_ids/category_ids
  // are shared across every sample of this phrase_ref (MasterPhrases) — see
  // extract/master_phrases_migration/PLAN.md. canEditPhrase gates the
  // per-sample text; canEditMasterPhrase gates the shared fields, since a
  // master-level edit isn't scoped to any one sample.

  canEditPhrase(phrase: any): boolean {
    return this.userService.canEditSample(phrase.sample);
  }

  /** Gate for the "Add Phrase" button in browse mode — same editor
   *  privilege as editing an existing phrase, just not tied to one yet. */
  canAddPhraseForSample(sample: string | null): boolean {
    return !!sample && this.userService.canEditSample(sample);
  }

  /** Meta-editor/superadmin privilege: editing the phrase concept itself
   *  (english gloss, which research questions/categories it answers)
   *  affects every sample sharing this phrase_ref at once. Sample editors
   *  never see this — they can only make rare per-sample exceptions via
   *  question_overrides (see requestExcludeQuestion/openAddExceptionPicker). */
  canEditMasterPhrase(): boolean {
    return this.userService.isGlobalAdmin();
  }

  // --- Sample-phrase edit (phrase text + rare RQ exceptions) ---

  openPhraseEditModal(phrase: any): void {
    this.editingPhrase = phrase;
    this.phraseEditData = {
      phrase: phrase.phrase || '',
      masterQuestionIds: [],
      question_overrides: { include: [], exclude: [] },
      masterCategoryIds: [],
      category_overrides: { include: [], exclude: [] },
    };
    this.phraseEditError = '';
    this.phraseEditSuccess = '';
    this.questionSearchInput = '';
    this.questionSearchResults = [];
    this.categorySearchInput = '';
    this.categorySearchResults = [];
    this.showQuestionOverrides = false;
    this.excludeConfirmTarget = null;
    this.phraseLinksLoading = true;
    this.phraseDeleteConfirming = false;
    this.phraseDeleting = false;
    this.showPhraseEditModal = true;
    setTimeout(() => {
      if (this.phraseTextarea) this.autoGrowTextarea(this.phraseTextarea.nativeElement);
    });

    // question_ids/category_ids are bulky and omitted from list/search rows
    // — fetch them for this one phrase now that the modal actually needs them.
    this.dataService.getPhraseLinks(phrase._key).subscribe({
      next: ({ question_ids, category_ids, question_overrides, category_overrides }) => {
        // The endpoint returns the resolved set (master ∪ include − exclude)
        // for each of questions/categories. Reconstruct the master-only list
        // for display the same way for both: strip out anything the user
        // added themselves, then add back anything they excluded (which
        // resolved already omits) — see question_overrides/category_overrides
        // docs on the server.
        const q = question_overrides || { include: [], exclude: [] };
        const qInclude = [...(q.include || [])];
        const qExclude = [...(q.exclude || [])];
        const qIncludeSet = new Set(qInclude);
        const masterQuestionIds = Array.from(new Set([
          ...(question_ids || []).filter((id: number) => !qIncludeSet.has(id)),
          ...qExclude,
        ]));

        const c = category_overrides || { include: [], exclude: [] };
        const cInclude = [...(c.include || [])];
        const cExclude = [...(c.exclude || [])];
        const cIncludeSet = new Set(cInclude);
        const masterCategoryIds = Array.from(new Set([
          ...(category_ids || []).filter((id: number) => !cIncludeSet.has(id)),
          ...cExclude,
        ]));

        this.phraseEditData.masterQuestionIds = masterQuestionIds;
        this.phraseEditData.question_overrides = { include: qInclude, exclude: qExclude };
        this.phraseEditData.masterCategoryIds = masterCategoryIds;
        this.phraseEditData.category_overrides = { include: cInclude, exclude: cExclude };
        this.phraseLinksLoading = false;
        this.resolveLinkedLabels(Array.from(new Set([...masterQuestionIds, ...qInclude])));
        this.resolveLinkedCategoryLabels(Array.from(new Set([...masterCategoryIds, ...cInclude])));
      },
      error: () => {
        this.phraseLinksLoading = false;
      }
    });
  }

  closePhraseEditModal(): void {
    this.showPhraseEditModal = false;
    this.editingPhrase = null;
  }

  requestDeletePhrase(): void {
    this.phraseDeleteConfirming = true;
  }

  cancelDeletePhrase(): void {
    this.phraseDeleteConfirming = false;
  }

  confirmDeletePhrase(): void {
    if (!this.editingPhrase?._key) return;
    const sample = this.editingPhrase.sample;

    this.phraseDeleting = true;
    this.phraseEditError = '';
    this.dataService.deletePhrase(this.editingPhrase._key).subscribe({
      next: () => {
        this.phraseDeleting = false;
        if (sample) {
          this.dataService.invalidatePhrasesCache(sample);
          this.browseRefresh$.next();
        }
        this.closePhraseEditModal();
      },
      error: (err: any) => {
        this.phraseDeleting = false;
        this.phraseDeleteConfirming = false;
        this.phraseEditError = err.error?.error || err.error?.detail || 'Failed to delete phrase.';
      },
    });
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

  onQuestionSearchInput(value: string): void {
    this.questionSearchInput = value;
    this.questionSearchInput$.next(value);
  }

  onCategorySearchInput(value: string): void {
    this.categorySearchInput = value;
    this.categorySearchInput$.next(value);
  }

  // Rare-exception editing, generalized over both relation kinds — question
  // exceptions write to question_overrides, category exceptions to
  // category_overrides, otherwise identical logic (mirrors how the master
  // editor treats question_ids/category_ids as parallel arrays). Kept as
  // separate public methods per kind so the template doesn't need to know
  // about "kind" strings; each just delegates to the shared private helper.

  private overridesFor(kind: 'question' | 'category'): { include: number[]; exclude: number[] } {
    return kind === 'question' ? this.phraseEditData.question_overrides : this.phraseEditData.category_overrides;
  }

  private masterIdsFor(kind: 'question' | 'category'): number[] {
    return kind === 'question' ? this.phraseEditData.masterQuestionIds : this.phraseEditData.masterCategoryIds;
  }

  private labelMapFor(kind: 'question' | 'category'): Map<number, string> {
    return kind === 'question' ? this.questionLabelById : this.categoryLabelById;
  }

  /** Rare-exception UI: excluding one of the phrase concept's own linked
   *  research questions/categories requires confirmation rather than a
   *  plain delete button. The item stays listed (marked excluded, with an
   *  undo) rather than disappearing — this is different from
   *  removeAddedQuestion/Category, which just retracts something the
   *  sample editor added themselves. */
  requestExcludeQuestion(id: number): void {
    this.excludeConfirmTarget = { kind: 'question', id };
  }

  requestExcludeCategory(id: number): void {
    this.excludeConfirmTarget = { kind: 'category', id };
  }

  cancelExcludeLink(): void {
    this.excludeConfirmTarget = null;
  }

  confirmExcludeLink(): void {
    if (!this.excludeConfirmTarget) return;
    const { kind, id } = this.excludeConfirmTarget;
    const overrides = this.overridesFor(kind);
    if (!overrides.exclude.includes(id)) overrides.exclude.push(id);
    this.excludeConfirmTarget = null;
  }

  /** Restores a master-linked question/category that was excluded — no
   *  confirmation needed, this just undoes the exception above. */
  undoExcludeQuestion(id: number): void {
    const overrides = this.overridesFor('question');
    overrides.exclude = overrides.exclude.filter((x: number) => x !== id);
  }

  undoExcludeCategory(id: number): void {
    const overrides = this.overridesFor('category');
    overrides.exclude = overrides.exclude.filter((x: number) => x !== id);
  }

  /** Retracts a question/category the sample editor added themselves (not a
   *  listed master link) — a plain removal, not an "exclude", since it
   *  never represented an exception to the phrase concept's own linking. */
  removeAddedQuestion(id: number): void {
    const overrides = this.overridesFor('question');
    overrides.include = overrides.include.filter((x: number) => x !== id);
  }

  removeAddedCategory(id: number): void {
    const overrides = this.overridesFor('category');
    overrides.include = overrides.include.filter((x: number) => x !== id);
  }

  toggleQuestionOverrides(): void {
    this.showQuestionOverrides = !this.showQuestionOverrides;
    this.questionSearchInput = '';
    this.questionSearchResults = [];
    this.categorySearchInput = '';
    this.categorySearchResults = [];
  }

  /** Rare-exception UI: adding a research question not in the inherited
   *  list, reusing the same search-box widget as the master editor, but
   *  writing to this sample's question_overrides.include instead of the
   *  MasterPhrase's question_ids. */
  addQuestionException(question: any): void {
    this.addLinkException('question', question);
    this.questionSearchInput = '';
    this.questionSearchResults = [];
  }

  /** Same as addQuestionException, for categories — writes to
   *  category_overrides.include instead of MasterPhrase.category_ids. */
  addCategoryException(category: any): void {
    this.addLinkException('category', category);
    this.categorySearchInput = '';
    this.categorySearchResults = [];
  }

  private addLinkException(kind: 'question' | 'category', node: any): void {
    const id = Number(node.id);
    const overrides = this.overridesFor(kind);
    overrides.exclude = overrides.exclude.filter((x: number) => x !== id);
    if (!overrides.include.includes(id) && !this.masterIdsFor(kind).includes(id)) {
      overrides.include.push(id);
    }
    this.labelMapFor(kind).set(id, this.formatHierarchy(node.hierarchy, node.name));
  }

  openLinkExceptionPicker(): void {
    this.showLinkExceptionPicker = true;
  }

  closeLinkExceptionPicker(): void {
    this.showLinkExceptionPicker = false;
  }

  /** Seeds the unified picker with the union of currently-added exceptions
   *  of both kinds — mirrors the master editor's linkPickerSelectedIds. */
  get linkExceptionPickerSelectedIds(): number[] {
    return [...this.phraseEditData.question_overrides.include, ...this.phraseEditData.category_overrides.include];
  }

  /** Unified Category+ResearchQuestion picker: splits by is_leaf exactly
   *  like the master editor's onLinkPickerChange, but routes each pick to
   *  this sample's question_overrides/category_overrides instead of the
   *  MasterPhrase's own question_ids/category_ids. */
  onLinkExceptionPickerChange(nodes: any[]): void {
    if (nodes.length === 0) return;
    // Hierarchy picker emits the full current selection; treat the newest
    // pick as the exception being added (this picker isn't otherwise
    // seeded with the sample's overrides beyond linkExceptionPickerSelectedIds,
    // so any newly-selected node is the one to add).
    const newest = nodes[nodes.length - 1];
    this.addLinkException(newest.is_leaf ? 'question' : 'category', newest);
  }

  savePhrase(): void {
    this.phraseEditSaving = true;
    this.phraseEditError = '';
    this.phraseEditSuccess = '';

    this.dataService.updatePhrase(this.editingPhrase._key, {
      phrase: this.phraseEditData.phrase,
      question_overrides: this.phraseEditData.question_overrides,
      category_overrides: this.phraseEditData.category_overrides,
    }).subscribe({
      next: (updated: any) => {
        Object.assign(this.editingPhrase, updated);
        if (this.editingPhrase.sample) {
          this.dataService.invalidatePhrasesCache(this.editingPhrase.sample);
        }
        this.phraseEditSaving = false;
        this.phraseEditSuccess = 'Phrase updated successfully.';
        setTimeout(() => this.closePhraseEditModal(), 1200);
      },
      error: (err: any) => {
        this.phraseEditSaving = false;
        this.phraseEditError = err.error?.error || err.error?.detail || 'Failed to save changes.';
      },
    });
  }

  // --- Master-phrase edit (admin-only, phrase-concept-level) ---

  openMasterEditModal(phrase: any): void {
    this.editingMasterPhrase = phrase;
    this.masterEditData = { english: '', conjugated: false, question_ids: [], category_ids: [] };
    this.masterEditError = '';
    this.masterEditSuccess = '';
    this.categorySearchInput = '';
    this.categorySearchResults = [];
    this.removedQuestionIds = new Set();
    this.removedCategoryIds = new Set();
    this.masterLinksLoading = true;
    this.showMasterEditModal = true;

    // Fetch fresh rather than trusting the row's own english/conjugated —
    // question_ids/category_ids are omitted from list/search rows entirely
    // (bulky, unused there), so this is required, not just an optimization.
    this.dataService.getMasterPhrase(phrase.phrase_ref).subscribe({
      next: (master) => {
        this.masterEditData = {
          english: master.english || '',
          conjugated: !!master.conjugated,
          question_ids: master.question_ids ? [...master.question_ids] : [],
          category_ids: master.category_ids ? [...master.category_ids] : [],
        };
        this.masterLinksLoading = false;
        if (this.masterEditData.question_ids.length > 0) {
          this.dataService.getResearchQuestionsByIds(this.masterEditData.question_ids).subscribe(questions => {
            questions.forEach(q => this.questionLabelById.set(q.id, this.formatHierarchy(q.hierarchy, q.name)));
          });
        }
        if (this.masterEditData.category_ids.length > 0) {
          this.dataService.getCategoriesByIds(this.masterEditData.category_ids).subscribe(categories => {
            categories.forEach(c => this.categoryLabelById.set(c.id, this.formatHierarchy(c.hierarchy, c.name)));
          });
        }
      },
      error: () => {
        this.masterLinksLoading = false;
        this.masterEditError = 'Failed to load phrase concept.';
      }
    });
  }

  closeMasterEditModal(): void {
    this.showMasterEditModal = false;
    this.editingMasterPhrase = null;
    this.removedQuestionIds = new Set();
    this.removedCategoryIds = new Set();
  }

  addMasterQuestionId(question: any): void {
    if (this.removedQuestionIds.has(question.id)) {
      this.removedQuestionIds.delete(question.id);
    } else if (!this.masterEditData.question_ids.includes(question.id)) {
      this.masterEditData.question_ids.push(question.id);
      this.questionLabelById.set(question.id, this.formatHierarchy(question.hierarchy, question.name));
    }
    this.questionSearchInput = '';
    this.questionSearchResults = [];
  }

  /** Stages/unstages a linked question for removal (strikethrough + Restore)
   *  rather than deleting it immediately — nothing is actually unlinked
   *  until Save is clicked (saveMasterPhrase filters these out). */
  toggleRemoveQuestionId(id: number): void {
    if (this.removedQuestionIds.has(id)) this.removedQuestionIds.delete(id);
    else this.removedQuestionIds.add(id);
  }

  addMasterCategoryId(category: any): void {
    if (this.removedCategoryIds.has(category.id)) {
      this.removedCategoryIds.delete(category.id);
    } else if (!this.masterEditData.category_ids.includes(category.id)) {
      this.masterEditData.category_ids.push(category.id);
      this.categoryLabelById.set(category.id, this.formatHierarchy(category.hierarchy, category.name));
    }
    this.categorySearchInput = '';
    this.categorySearchResults = [];
  }

  toggleRemoveCategoryId(id: number): void {
    if (this.removedCategoryIds.has(id)) this.removedCategoryIds.delete(id);
    else this.removedCategoryIds.add(id);
  }

  openLinkPicker(): void {
    this.showLinkPicker = true;
  }

  closeLinkPicker(): void {
    this.showLinkPicker = false;
  }

  /** Seeds the unified picker with the union of currently-linked question
   *  and category ids (picker itself distinguishes leaf/branch per node). */
  get linkPickerSelectedIds(): number[] {
    return [...this.masterEditData.question_ids, ...this.masterEditData.category_ids];
  }

  /** Picker emits its full current selection on every toggle; split it back
   *  into question_ids/category_ids by each node's is_leaf flag. */
  onLinkPickerChange(nodes: any[]): void {
    const questionNodes = nodes.filter(n => !!n.is_leaf);
    const categoryNodes = nodes.filter(n => !n.is_leaf);
    this.masterEditData.question_ids = questionNodes.map(n => Number(n.id));
    this.masterEditData.category_ids = categoryNodes.map(n => Number(n.id));
    questionNodes.forEach(n => this.questionLabelById.set(Number(n.id), this.formatHierarchy(n.hierarchy, n.name)));
    categoryNodes.forEach(n => this.categoryLabelById.set(Number(n.id), this.formatHierarchy(n.hierarchy, n.name)));
    // The picker overwrote both arrays wholesale — drop any pending removal
    // that no longer refers to a linked id.
    for (const id of [...this.removedQuestionIds]) {
      if (!this.masterEditData.question_ids.includes(id)) this.removedQuestionIds.delete(id);
    }
    for (const id of [...this.removedCategoryIds]) {
      if (!this.masterEditData.category_ids.includes(id)) this.removedCategoryIds.delete(id);
    }
  }

  saveMasterPhrase(): void {
    this.masterEditSaving = true;
    this.masterEditError = '';
    this.masterEditSuccess = '';

    this.dataService.updateMasterPhrase(this.editingMasterPhrase.phrase_ref, {
      english: this.masterEditData.english,
      conjugated: this.masterEditData.conjugated,
      question_ids: this.masterEditData.question_ids.filter((id: number) => !this.removedQuestionIds.has(id)),
      category_ids: this.masterEditData.category_ids.filter((id: number) => !this.removedCategoryIds.has(id)),
    }).subscribe({
      next: (updated: any) => {
        Object.assign(this.editingMasterPhrase, updated);
        this.masterEditSaving = false;
        this.masterEditSuccess = 'Phrase concept updated successfully.';
        setTimeout(() => this.closeMasterEditModal(), 1200);
      },
      error: (err: any) => {
        this.masterEditSaving = false;
        this.masterEditError = err.error?.error || err.error?.detail || 'Failed to save changes.';
      },
    });
  }

  // --- Delete master phrase (rare, destructive — cascades to every
  // sample's recording of it). Confirmation is a second modal, stacked over
  // the edit modal, that first fetches impact() so the admin sees the
  // blast radius (count + affected sample_refs) before confirming. ---

  showDeleteMasterConfirm = false;
  deleteMasterImpactLoading = false;
  deleteMasterImpact: { count: number; samples: string[] } | null = null;
  deleteMasterSaving = false;
  deleteMasterError = '';

  openDeleteMasterConfirm(): void {
    if (!this.editingMasterPhrase) return;
    this.showDeleteMasterConfirm = true;
    this.deleteMasterImpact = null;
    this.deleteMasterError = '';
    this.deleteMasterSaving = false;
    this.deleteMasterImpactLoading = true;
    this.dataService.getMasterPhraseImpact(this.editingMasterPhrase.phrase_ref).subscribe({
      next: (impact) => {
        this.deleteMasterImpact = { count: impact.count, samples: impact.samples };
        this.deleteMasterImpactLoading = false;
      },
      error: (err: any) => {
        this.deleteMasterImpactLoading = false;
        this.deleteMasterError = err.error?.error || err.error?.detail || 'Failed to check affected samples.';
      },
    });
  }

  closeDeleteMasterConfirm(): void {
    this.showDeleteMasterConfirm = false;
  }

  confirmDeleteMasterPhrase(): void {
    if (!this.editingMasterPhrase || !this.deleteMasterImpact) return;
    const phraseRef = this.editingMasterPhrase.phrase_ref;
    const affectedSamples = this.deleteMasterImpact.samples;

    this.deleteMasterSaving = true;
    this.deleteMasterError = '';
    this.dataService.deleteMasterPhrase(phraseRef).subscribe({
      next: () => {
        this.deleteMasterSaving = false;
        this.knownPhraseRefs.delete(phraseRef);
        // Every sample whose SamplePhrase for this phrase_ref was just
        // cascade-deleted server-side may have a stale cached browse list.
        affectedSamples.forEach(sample => this.dataService.invalidatePhrasesCache(sample));
        this.masterListRefresh$.next();
        this.browseRefresh$.next();
        this.showDeleteMasterConfirm = false;
        this.closeMasterEditModal();
      },
      error: (err: any) => {
        this.deleteMasterSaving = false;
        this.deleteMasterError = err.error?.error || err.error?.detail || 'Failed to delete phrase.';
      },
    });
  }

  // --- Add master phrase (new phrase concept) ---

  /** One past the highest leading number among existing phrase_refs (e.g.
   *  "80", "80a", "81" → 82) — a reasonable next slot, still editable. */
  private suggestNextPhraseRef(): string {
    let max = 0;
    for (const ref of this.knownPhraseRefs) {
      const m = /^(\d+)/.exec(ref);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return String(max + 1);
  }

  openAddMasterModal(): void {
    this.addMasterData = { phrase_ref: this.suggestNextPhraseRef(), english: '', conjugated: false };
    this.addMasterError = '';
    this.addMasterSaving = false;
    this.showAddMasterModal = true;
  }

  closeAddMasterModal(): void {
    this.showAddMasterModal = false;
  }

  /** Drives the inline "already exists" warning as the admin edits the
   *  suggested phrase_ref — the server re-checks this at save time too. */
  get addMasterPhraseRefTaken(): boolean {
    const ref = this.addMasterData.phrase_ref.trim();
    return ref.length > 0 && this.knownPhraseRefs.has(ref);
  }

  saveNewMasterPhrase(): void {
    const phraseRef = this.addMasterData.phrase_ref.trim();
    const english = this.addMasterData.english.trim();
    if (!phraseRef) {
      this.addMasterError = 'Phrase number is required.';
      return;
    }
    if (!english) {
      this.addMasterError = 'English translation is required.';
      return;
    }
    if (this.knownPhraseRefs.has(phraseRef)) {
      this.addMasterError = `Phrase number "${phraseRef}" already exists.`;
      return;
    }

    this.addMasterSaving = true;
    this.addMasterError = '';
    this.dataService.createMasterPhrase({
      phrase_ref: phraseRef,
      english,
      conjugated: this.addMasterData.conjugated,
    }).subscribe({
      next: (created: any) => {
        this.addMasterSaving = false;
        this.knownPhraseRefs.add(created.phrase_ref);
        this.masterListRefresh$.next();
        this.closeAddMasterModal();
        // Jump straight into the full editor so questions/categories can be linked.
        this.openMasterEditModal(created);
      },
      error: (err: any) => {
        this.addMasterSaving = false;
        this.addMasterError = err.error?.error || err.error?.detail || 'Failed to create phrase.';
      },
    });
  }

  // --- Add sample phrase (per-sample recording of an existing phrase
  // concept) — only available once a sample is selected. Two-step: pick the
  // MasterPhrase this is a recording of, then enter the Romani text. Any
  // sample editor can do this (not meta-editor-gated like the master-phrase
  // flows above), since it doesn't touch the shared phrase concept.

  addPhraseAllMasters: PhraseListItem[] = [];
  addPhraseMastersLoading = false;
  addPhraseFilter = '';
  addPhraseSelectedMaster: PhraseListItem | null = null;
  addPhraseText = '';
  addPhraseSaving = false;
  addPhraseError = '';
  /** phrase_refs already recorded for the sample being added to — excluded
   *  from the picker (adding again would just 409) and refreshed whenever
   *  the modal opens. */
  existingSamplePhraseRefs: Set<string> = new Set();

  get addPhraseFilteredOptions(): PhraseListItem[] {
    const q = foldText(this.addPhraseFilter.trim());
    return this.addPhraseAllMasters
      .filter(p => !this.existingSamplePhraseRefs.has(p.phrase_ref))
      .filter(p => !q || foldText(p.phrase_ref).includes(q) || foldText(p.english ?? '').includes(q));
  }

  /** Expected audio filename for the phrase being added — shown as a
   *  not-yet-recorded placeholder since uploading audio isn't done here. */
  get addPhraseExpectedAudioFilename(): string {
    const sample = this.latestVm?.sample;
    if (!sample || !this.addPhraseSelectedMaster) return '';
    return `${sample}_${this.addPhraseSelectedMaster.phrase_ref}.mp3`;
  }

  openAddPhraseModal(): void {
    const sample = this.latestVm?.sample;
    if (!sample) return;
    this.addPhraseFilter = '';
    this.addPhraseSelectedMaster = null;
    this.addPhraseText = '';
    this.addPhraseError = '';
    this.addPhraseSaving = false;
    this.showAddPhraseModal = true;

    this.dataService.getPhrasesCached(sample).subscribe(phrases => {
      this.existingSamplePhraseRefs = new Set(phrases.map((p: any) => p.phrase_ref));
    });

    this.addPhraseMastersLoading = true;
    this.dataService.getPhraseList().subscribe({
      next: (list) => { this.addPhraseAllMasters = list; this.addPhraseMastersLoading = false; },
      error: () => { this.addPhraseMastersLoading = false; }
    });
  }

  closeAddPhraseModal(): void {
    this.showAddPhraseModal = false;
    this.addPhraseSelectedMaster = null;
  }

  selectAddPhraseMaster(p: PhraseListItem): void {
    this.addPhraseSelectedMaster = p;
    this.addPhraseFilter = '';
  }

  changeAddPhraseMaster(): void {
    this.addPhraseSelectedMaster = null;
  }

  saveNewPhrase(): void {
    const sample = this.latestVm?.sample;
    if (!sample || !this.addPhraseSelectedMaster) return;
    const text = this.addPhraseText.trim();
    if (!text) {
      this.addPhraseError = 'Phrase text is required.';
      return;
    }

    this.addPhraseSaving = true;
    this.addPhraseError = '';
    this.dataService.createPhrase({
      sample,
      phrase_ref: this.addPhraseSelectedMaster.phrase_ref,
      phrase: text,
    }).subscribe({
      next: () => {
        this.addPhraseSaving = false;
        this.dataService.invalidatePhrasesCache(sample);
        this.browseRefresh$.next();
        this.closeAddPhraseModal();
      },
      error: (err: any) => {
        this.addPhraseSaving = false;
        this.addPhraseError = err.error?.error || err.error?.detail || 'Failed to add phrase.';
      },
    });
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
    const phraseRef = vm.phrase_ref ?? undefined;
    this.exportService.downloadFromSource(
      this.dataService.exportPhrases(vm.q.trim(), sampleRefs, vm.sort, vm.field, phraseRef)
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
