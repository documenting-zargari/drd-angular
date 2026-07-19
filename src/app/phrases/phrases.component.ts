import { environment } from '../../environments/environment';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../api/data.service';
import { RouterModule } from '@angular/router';
import { SearchStateService } from '../api/search-state.service';
import { UserService } from '../api/user.service';
import { AudioService } from '../api/audio.service';
import { UrlStateService } from '../api/url-state.service';
import { SampleSelectionComponent } from '../shared/sample-selection/sample-selection.component';
import { PaginationComponent } from '../shared/pagination/pagination.component';
import { ExportModalComponent } from '../shared/export-modal/export-modal.component';
import { PhrasePickerComponent } from '../shared/phrase-picker/phrase-picker.component';
import { HierarchyPickerComponent } from '../shared/hierarchy-picker/hierarchy-picker.component';
import { ExportService, ExportFormat } from '../api/export.service';
import { PhraseListItem } from '../api/data.service';
import { BehaviorSubject, Observable, Subject, Subscription, combineLatest, concat, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, finalize, map, shareReplay, switchMap } from 'rxjs/operators';

type PhraseMode = 'browse' | 'search';
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

  @ViewChild('exportModal') exportModalComponent!: ExportModalComponent;

  readonly browsePageSize = 50;

  /** URL-derived view state. Source of truth for this component. */
  readonly vm$: Observable<PhraseViewState> = this.urlState.selectMany<PhraseViewState>({
    sample: raw => (raw && raw.length > 0 ? raw : null),
    mode: raw => (raw === 'search' ? 'search' : 'browse'),
    q: raw => raw ?? '',
    phrase_ref: raw => (raw && raw.length > 0 ? raw : null),
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
  phraseEditData: any = { masterQuestionIds: [], question_overrides: { include: [], exclude: [] } };
  phraseEditSaving = false;
  phraseEditError = '';
  phraseEditSuccess = '';
  /** True while GET /phrases/{key}/links/ is loading for the modal. */
  phraseLinksLoading = false;
  /** Pending confirmation for excluding a listed RQ (rare, needs confirm). */
  excludeConfirmTarget: number | null = null;
  showQuestionOverrides = false;
  showQuestionExceptionPicker = false;

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

  /** Human-readable hierarchy labels for linked question_ids/category_ids,
   *  resolved on demand (batch) whenever an edit modal opens. */
  questionLabelById = new Map<number, string>();
  categoryLabelById = new Map<number, string>();

  /** Inline search-to-add for linking research questions/categories. */
  questionSearchInput = '';
  questionSearchResults: any[] = [];
  categorySearchInput = '';
  categorySearchResults: any[] = [];
  showQuestionPicker = false;
  showCategoryPicker = false;
  private readonly questionSearchInput$ = new Subject<string>();
  private readonly categorySearchInput$ = new Subject<string>();

  private readonly subs: Subscription[] = [];

  ngOnInit(): void {
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
    }));

    this.subs.push(this.searchData$.subscribe(sd => this.latestSearchData = sd));

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
    };
    this.phraseEditError = '';
    this.phraseEditSuccess = '';
    this.questionSearchInput = '';
    this.questionSearchResults = [];
    this.showQuestionOverrides = false;
    this.excludeConfirmTarget = null;
    this.phraseLinksLoading = true;
    this.showPhraseEditModal = true;

    // question_ids are bulky and omitted from list/search rows — fetch
    // them for this one phrase now that the modal actually needs them.
    this.dataService.getPhraseLinks(phrase._key).subscribe({
      next: ({ question_ids, question_overrides }) => {
        const overrides = question_overrides || { include: [], exclude: [] };
        const include = [...(overrides.include || [])];
        const exclude = [...(overrides.exclude || [])];
        const resolved = question_ids || [];
        // The endpoint returns the resolved set (master ∪ include − exclude).
        // Reconstruct the master-only list for display: strip out anything
        // the user added themselves, then add back anything they excluded
        // (which resolved already omits) — see question_overrides docs on
        // the server.
        const includeSet = new Set(include);
        const masterQuestionIds = Array.from(new Set([
          ...resolved.filter((id: number) => !includeSet.has(id)),
          ...exclude,
        ]));

        this.phraseEditData.masterQuestionIds = masterQuestionIds;
        this.phraseEditData.question_overrides = { include, exclude };
        this.phraseLinksLoading = false;
        this.resolveLinkedLabels(Array.from(new Set([...masterQuestionIds, ...include])));
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

  private resolveLinkedLabels(questionIds: number[]): void {
    if (questionIds.length > 0) {
      this.dataService.getResearchQuestionsByIds(questionIds).subscribe(questions => {
        questions.forEach(q => this.questionLabelById.set(q.id, this.formatHierarchy(q.hierarchy, q.name)));
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

  /** Rare-exception UI: excluding one of the phrase concept's own linked
   *  research questions requires confirmation rather than a plain delete
   *  button. The item stays listed (marked excluded, with an undo) rather
   *  than disappearing — this is different from removeAddedQuestion, which
   *  just retracts something the sample editor added themselves. */
  requestExcludeQuestion(id: number): void {
    this.excludeConfirmTarget = id;
  }

  cancelExcludeQuestion(): void {
    this.excludeConfirmTarget = null;
  }

  confirmExcludeQuestion(): void {
    const id = this.excludeConfirmTarget;
    if (id == null) return;
    const overrides = this.phraseEditData.question_overrides;
    if (!overrides.exclude.includes(id)) overrides.exclude.push(id);
    this.excludeConfirmTarget = null;
  }

  /** Restores a master-linked question that was excluded — no confirmation
   *  needed, this just undoes the exception above. */
  undoExcludeQuestion(id: number): void {
    const overrides = this.phraseEditData.question_overrides;
    overrides.exclude = overrides.exclude.filter((qid: number) => qid !== id);
  }

  /** Retracts a question the sample editor added themselves (not a listed
   *  master link) — a plain removal, not an "exclude", since it never
   *  represented an exception to the phrase concept's own linking. */
  removeAddedQuestion(id: number): void {
    const overrides = this.phraseEditData.question_overrides;
    overrides.include = overrides.include.filter((qid: number) => qid !== id);
  }

  toggleQuestionOverrides(): void {
    this.showQuestionOverrides = !this.showQuestionOverrides;
    this.questionSearchInput = '';
    this.questionSearchResults = [];
  }

  /** Rare-exception UI: adding a research question not in the inherited
   *  list, reusing the same search-box/hierarchy-picker widgets as the
   *  master editor, but writing to this sample's question_overrides.include
   *  instead of the MasterPhrase's question_ids. */
  addQuestionException(question: any): void {
    const id = Number(question.id);
    const overrides = this.phraseEditData.question_overrides;
    overrides.exclude = overrides.exclude.filter((qid: number) => qid !== id);
    if (!overrides.include.includes(id) && !this.phraseEditData.masterQuestionIds.includes(id)) {
      overrides.include.push(id);
    }
    this.questionLabelById.set(id, this.formatHierarchy(question.hierarchy, question.name));
    this.questionSearchInput = '';
    this.questionSearchResults = [];
  }

  openQuestionExceptionPicker(): void {
    this.showQuestionExceptionPicker = true;
  }

  closeQuestionExceptionPicker(): void {
    this.showQuestionExceptionPicker = false;
  }

  onQuestionExceptionPickerChange(nodes: any[]): void {
    if (nodes.length === 0) return;
    // Hierarchy picker emits the full current selection; treat the newest
    // pick as the exception being added (this picker isn't otherwise
    // seeded with the sample's overrides, so any selected node is new).
    const newest = nodes[nodes.length - 1];
    this.addQuestionException(newest);
  }

  savePhrase(): void {
    this.phraseEditSaving = true;
    this.phraseEditError = '';
    this.phraseEditSuccess = '';

    this.dataService.updatePhrase(this.editingPhrase._key, {
      phrase: this.phraseEditData.phrase,
      question_overrides: this.phraseEditData.question_overrides,
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
  }

  addMasterQuestionId(question: any): void {
    if (!this.masterEditData.question_ids.includes(question.id)) {
      this.masterEditData.question_ids.push(question.id);
      this.questionLabelById.set(question.id, this.formatHierarchy(question.hierarchy, question.name));
    }
    this.questionSearchInput = '';
    this.questionSearchResults = [];
  }

  removeMasterQuestionId(index: number): void {
    this.masterEditData.question_ids.splice(index, 1);
  }

  addMasterCategoryId(category: any): void {
    if (!this.masterEditData.category_ids.includes(category.id)) {
      this.masterEditData.category_ids.push(category.id);
      this.categoryLabelById.set(category.id, this.formatHierarchy(category.hierarchy, category.name));
    }
    this.categorySearchInput = '';
    this.categorySearchResults = [];
  }

  removeMasterCategoryId(index: number): void {
    this.masterEditData.category_ids.splice(index, 1);
  }

  openQuestionPicker(): void {
    this.showQuestionPicker = true;
  }

  closeQuestionPicker(): void {
    this.showQuestionPicker = false;
  }

  openCategoryPicker(): void {
    this.showCategoryPicker = true;
  }

  closeCategoryPicker(): void {
    this.showCategoryPicker = false;
  }

  onMasterQuestionPickerChange(nodes: any[]): void {
    this.masterEditData.question_ids = nodes.map(n => Number(n.id));
    nodes.forEach(n => this.questionLabelById.set(Number(n.id), this.formatHierarchy(n.hierarchy, n.name)));
  }

  onCategoryPickerChange(nodes: any[]): void {
    this.masterEditData.category_ids = nodes.map(n => Number(n.id));
    nodes.forEach(n => this.categoryLabelById.set(Number(n.id), this.formatHierarchy(n.hierarchy, n.name)));
  }

  saveMasterPhrase(): void {
    this.masterEditSaving = true;
    this.masterEditError = '';
    this.masterEditSuccess = '';

    this.dataService.updateMasterPhrase(this.editingMasterPhrase.phrase_ref, {
      english: this.masterEditData.english,
      conjugated: this.masterEditData.conjugated,
      question_ids: this.masterEditData.question_ids,
      category_ids: this.masterEditData.category_ids,
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
