import { environment } from '../../environments/environment';
import { Component, NgZone, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DataService, SearchCriterion, SearchContext, PhraseListItem } from '../api/data.service';
import { ExportService, ExportFormat } from '../api/export.service';
import { ExportModalComponent } from '../shared/export-modal/export-modal.component';
import { SearchStateService } from '../api/search-state.service';
import { UrlStateService } from '../api/url-state.service';
import { SampleSelectionComponent } from '../shared/sample-selection/sample-selection.component';
import { SearchValueDialogComponent } from '../shared/search-value-dialog.component';
import { PhraseTranscriptionModalComponent } from '../shared/phrase-transcription-modal/phrase-transcription-modal.component';
import { CellEditDialogComponent, CellEditField, PhraseAssociationChange } from '../shared/cell-edit-dialog/cell-edit-dialog.component';
import { MasterPhraseLinksDialogComponent } from '../shared/master-phrase-links-dialog/master-phrase-links-dialog.component';
import { PageTitleService } from '../api/page-title.service';
import { UserService } from '../api/user.service';
import { inject, ViewChild } from '@angular/core';
import { forkJoin, of, Subject, Subscription } from 'rxjs';
import { tap, catchError, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { cleanHierarchy } from '../shared/hierarchy-utils';

interface TablesViewState {
  sample: string | null;
  /** URL form of the view filename (no ".php" suffix) —
   *  e.g. "browse-adjectivederivation-prefixes". Converted to the backend
   *  filename on the way out via toBackendFilename(). */
  view: string | null;
  cat: number | null;    // originating category id (for breadcrumbs)
  q: string;             // hierarchy-filter search term
  expand: number[];      // expanded category IDs
}

/** URL-side view id (no `.php`) → backend filename (with `.php`). */
function toBackendFilename(urlView: string): string {
  return /\.php$/i.test(urlView) ? urlView : urlView + '.php';
}

/** Category path like "browse/foo/bar.php" → URL-side view id "browse-foo-bar". */
function pathToUrlView(path: string): string {
  return String(path).replace(/\//g, '-').replace(/\.php$/i, '');
}

/** Hard cap so the URL doesn't grow unbounded with a large hierarchy. */
const EXPAND_MAX = 15;

/** RLB has a single root node (name "RLB", conventionally id 1). It's always
 *  implicitly expanded, so we never track it in the URL or the expand Set. */
const ROOT_CATEGORY_ID = 1;
const ROOT_CATEGORY_NAME = 'RLB';

function isRootCategory(cat: any): boolean {
  return cat?.id === ROOT_CATEGORY_ID || cat?.name === ROOT_CATEGORY_NAME;
}

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function findCategoryById(roots: any[], id: number): any | null {
  for (const c of roots) {
    if (c?.id === id) return c;
    if (c?.children?.length) {
      const nested = findCategoryById(c.children, id);
      if (nested) return nested;
    }
  }
  return null;
}

@Component({
  selector: 'app-tables',
  imports: [CommonModule, FormsModule, SampleSelectionComponent, SearchValueDialogComponent, PhraseTranscriptionModalComponent, ExportModalComponent, CellEditDialogComponent, MasterPhraseLinksDialogComponent],
  templateUrl: './tables.component.html',
  styleUrl: './tables.component.scss'
})
export class TablesComponent implements OnInit, OnDestroy {
  categories: any[] = [];
  filteredCategories: any[] = [];
  expandedCategories: Set<number> = new Set();
  loadingCategories: Set<number> = new Set();
  selectedView: any = null;
  selectedCategory: any = null; // Store the category that was clicked to load this table
  tableData: { mainHeading?: string; sections: any[] } | null = null;

  selectedSample: any = null;
  searchTerm: string = '';
  private viewCategories: any[] = []; // All categories with a view (path)

  // Answer data properties
  cellMetadata: any[] = [];
  answerData: { [key: string]: any } = {};
  categoryData: { [key: string]: any } = {};
  isLoadingAnswers: boolean = false;
  currentCategoryIds: number[] = []; // Store category IDs for current table

  // Modal properties
  showModal: boolean = false;
  modalAnswer: any = null;
  modalTitle: string = '';
  
  // Table not found modal
  showTableNotFoundModal: boolean = false;

  // Edit mode properties
  editMode: boolean = false;
  showEditModal: boolean = false;
  /** Error toast shown when a save/create/delete triggered from the edit
   *  dialog fails after the dialog has already closed — without this the
   *  dialog just closes as if the edit succeeded while nothing persisted. */
  saveErrorMessage: string | null = null;
  private saveErrorTimeout: any = null;
  editModalAnswerKey: string = '';
  editModalFieldName: string = '';
  editModalQuestionName: string = '';
  editModalCurrentValue: string = '';
  editModalQuestionId: string = '';
  /** Set instead of editModalFieldName/editModalCurrentValue when the cell's
   *  field spec is pipe-separated (e.g. "source|language") — combined
   *  fields edit as separate inputs rather than one concatenated string. */
  editModalFields: CellEditField[] | null = null;
  /** Phrases naturally matching this question/sample via each phrase's own
   *  question_overrides (fetched via /related/ without answer_key) — the
   *  fixed "standard" list shown in the edit dialog. */
  editModalStandardPhrases: PhraseListItem[] = [];
  /** Phrases actually associated with this answer right now (fetched via
   *  /related/ with answer_key, i.e. standardPhrases with this answer's
   *  overrides already applied). Diffed against editModalStandardPhrases by
   *  the dialog to seed excluded/added state. */
  editModalResolvedPhrases: PhraseListItem[] = [];
  editModalPhrasesLoading = false;
  /** All MasterPhrases with this sample's Romani text where recorded, for
   *  the edit dialog's override picker — cached per sample_ref since the
   *  Romani text is sample-scoped (getAllPhrasesForSample). */
  private allPhrasesCache = new Map<string, PhraseListItem[]>();
  /** Phrase-association edits from the dialog's phraseAssociationsConfirmed
   *  output, consumed (and cleared) by the save handler that follows. */
  private pendingPhraseAssociationChanges: PhraseAssociationChange[] | null = null;

  // Master Edit Mode properties (admin, cross-sample question↔phrase links —
  // see toggleMasterEditMode/MasterPhraseLinksDialogComponent)
  masterEditMode: boolean = false;
  showMasterLinksModal = false;
  masterLinksQuestionId: number | null = null;
  masterLinksQuestionName = '';

  // Search mode properties
  searchMode: boolean = false;
  searchOperator: 'AND' | 'OR' = 'OR';
  searchContext: SearchContext = {
    selectedQuestions: [],
    selectedSamples: [],
    searches: [],
    searchResults: [],
    searchStatus: '',
    isLoading: false,
    searchType: 'none',
    lastSearchMethod: null,
    currentSample: null 
  };
  
  // Search value modal properties  
  showSearchModal: boolean = false;
  searchModalQuestionId: number = 0;
  searchModalQuestionName: string = '';
  searchModalFieldName: string = '';
  searchModalHierarchy: string[] = [];
  
  // Export
  @ViewChild('exportModal') exportModalComponent!: ExportModalComponent;

  // Subscription management
  private subscriptions: Subscription[] = [];

  private searchStateService = inject(SearchStateService);
  private urlState = inject(UrlStateService);
  private userService = inject(UserService);
  private ngZone = inject(NgZone);

  /** Debounced stream for the hierarchy-filter input (URL patches only fire after 250ms). */
  private readonly qInput$ = new Subject<string>();

  /** Latest URL-derived view state, kept for imperative reads inside handlers. */
  private vm: TablesViewState = { sample: null, view: null, cat: null, q: '', expand: [] };

  /** Filename currently loaded in selectedView (guards against double-loads). */
  private loadedViewFilename: string | null = null;

  /** Scroll offset to restore when returning to the hierarchy list, captured
   *  right before leaving it for a table view. Null when there's nothing to
   *  restore (fresh reset, deep link, or a breadcrumb jump in progress). */
  private savedListScrollY: number | null = null;

  /** Category id to scroll into view once the list re-renders, set by a
   *  breadcrumb click. Takes priority over savedListScrollY. */
  private pendingScrollToCategoryId: number | null = null;

  constructor(
    private dataService: DataService,
    private exportService: ExportService,
    private router: Router,
    private pageTitleService: PageTitleService,
  ) { }

  /** Builds "Table title — sample" while a view is loaded, else falls back to
   *  the browsed category name, else clears to the bare "Tables" base. */
  private updatePageTitle(): void {
    if (this.selectedView) {
      const tableTitle = this.getSelectedViewTitle();
      const sampleRef = this.selectedSample?.sample_ref;
      this.pageTitleService.setDetail(sampleRef ? `${tableTitle} — ${sampleRef}` : tableTitle);
    } else if (this.selectedCategory) {
      this.pageTitleService.setDetail(this.getCategoryTitle(this.selectedCategory));
    } else {
      this.pageTitleService.setDetail(null);
    }
  }

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

    // Initialise search context from SearchStateService.
    this.searchContext = this.searchStateService.getSearchContext();

    // Keep searchContext in sync with service updates (criteria building, clear, etc.).
    // searchMode is NOT driven here — only the toggle button controls it.
    this.subscriptions.push(
      this.searchStateService.searchContext$.subscribe(context => {
        this.searchContext = context;
      })
    );

    // Load top-level categories.
    this.dataService.getCategories().subscribe({
      next: (categories) => {
        this.categories = this.initializeCategoriesHierarchy(categories);
        this.filteredCategories = this.categories;
        this.applyHierarchyFilter(this.vm.q);
        if (this.vm.cat != null) this.resolveSelectedCategoryFromVm();
        // URL may say "these categories are expanded" before their descendants
        // are loaded. Walk the tree and fetch the children we're missing.
        this.ensureExpandedChildrenLoaded(this.categories);
      },
      error: (err: any) => {
        console.error('Error fetching categories:', err);
      }
    });

    // Load all categories that have views (for hierarchy search).
    this.dataService.getViewCategories().subscribe({
      next: (categories) => {
        this.viewCategories = categories;
        this.applyHierarchyFilter(this.vm.q);
      },
      error: (err: any) => {
        console.error('Error fetching view categories:', err);
      }
    });

    // Nav-bar "Tables" link clicked: [mergeLink] already handles navigation
    // (it drops view/cat, leaving only `sample`, which applyVm's "no view"
    // branch below turns into a hierarchy reset); this just clears the
    // hierarchy-nav bookkeeping so a stale saved scroll position from a
    // previous table visit doesn't get applied to this fresh reset.
    this.subscriptions.push(
      this.dataService.tablesReset$.subscribe(() => {
        this.savedListScrollY = null;
        this.pendingScrollToCategoryId = null;
      })
    );

    // Debounced URL patching for the filter input.
    this.subscriptions.push(
      this.qInput$.pipe(debounceTime(250), distinctUntilChanged())
        .subscribe(q => this.urlState.patch(
          { q: q || null },
          { replaceUrl: true }
        ))
    );

    // URL-derived view state subscription — this drives everything browse-mode.
    this.subscriptions.push(
      this.urlState.selectMany<TablesViewState>({
        sample: raw => (raw && raw.length > 0 ? raw : null),
        view: raw => (raw && raw.length > 0 ? raw.replace(/\.php$/i, '') : null),
        cat: raw => {
          if (raw == null || raw === '') return null;
          const n = Number.parseInt(raw, 10);
          return Number.isFinite(n) ? n : null;
        },
        q: raw => raw ?? '',
        expand: raw => this.urlState.parseCSV(raw)
          .map(s => Number.parseInt(s, 10))
          .filter(n => Number.isFinite(n) && n !== ROOT_CATEGORY_ID)
          .slice(0, EXPAND_MAX),
      }).subscribe(vm => this.applyVm(vm))
    );
  }

  /** Apply a new URL-derived view state to local fields. */
  private applyVm(next: TablesViewState): void {
    const prev = this.vm;
    this.vm = next;

    // Sample change: update selectedSample and trigger answer refresh.
    if (next.sample !== prev.sample) {
      if (next.sample) {
        this.selectedSample = { sample_ref: next.sample };
        // Master Edit Mode requires no sample selected — see toggleMasterEditMode.
        this.masterEditMode = false;
      } else {
        this.selectedSample = null;
      }
      if (this.selectedView) {
        // Re-parse template so foreach rows reset for the new sample.
        this.parseTableContent(this.selectedView.content);
        if (this.cellMetadata.length > 0 && !this.searchMode) {
          this.fetchAnswersForTable();
        } else if (this.searchMode) {
          this.answerData = {};
        }
      }
    }

    // Expanded categories: mirror URL's expand list into the Set, and
    // lazy-load descendants for any newly-expanded branch.
    if (!arraysEqual(next.expand, prev.expand)) {
      this.expandedCategories = new Set(next.expand);
      if (this.categories.length > 0) {
        this.ensureExpandedChildrenLoaded(this.categories);
      }
    }

    // Filter term: re-run hierarchy filter.
    if (next.q !== prev.q) {
      this.applyHierarchyFilter(next.q);
    }

    // View change: load the referenced view if needed; clear if removed.
    if (next.view !== prev.view) {
      if (next.view) {
        if (this.loadedViewFilename !== next.view) {
          this.loadedViewFilename = next.view;
          this.dataService.getViewByFilenameCached(toBackendFilename(next.view)).subscribe({
            next: (views) => {
              const view = Array.isArray(views) ? views[0] : views;
              if (view) {
                this.applyView(view);
              } else {
                this.showTableNotFoundModal = true;
                this.loadedViewFilename = null;
              }
            },
            error: (err: any) => {
              console.error('Error fetching view:', err);
              this.loadedViewFilename = null;
            },
          });
        }
      } else {
        // URL no longer has a view → reset to hierarchy list.
        this.loadedViewFilename = null;
        this.selectedView = null;
        this.selectedCategory = null;
        this.tableData = null;
        this.cellMetadata = [];
        this.currentCategoryIds = [];
        this.answerData = {};
        this.editMode = false;
        this.masterEditMode = false;
        this.restoreListPosition();
      }
    }

    // Category id: resolve to breadcrumb object once categories are loaded.
    if (next.cat !== prev.cat) {
      this.resolveSelectedCategoryFromVm();
    }

    this.updatePageTitle();
  }

  private resolveSelectedCategoryFromVm(): void {
    if (this.vm.cat == null) {
      this.selectedCategory = null;
    } else {
      const found = findCategoryById(this.categories, this.vm.cat)
        ?? findCategoryById(this.viewCategories, this.vm.cat);
      this.selectedCategory = found ?? { id: this.vm.cat };
    }
    this.updatePageTitle();
  }

  private applyHierarchyFilter(term: string): void {
    this.searchTerm = term;
    if (!term || term.trim() === '') {
      this.filteredCategories = this.categories;
      return;
    }
    const t = term.toLowerCase();
    this.filteredCategories = this.viewCategories.filter((c: any) => {
      if (c.name?.toLowerCase().includes(t)) return true;
      if (c.hierarchy && c.hierarchy.join(' ').toLowerCase().includes(t)) return true;
      return false;
    });
  }
  
  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  // Category hierarchy navigation methods
  expandCategory(category: any): void {
    // Root is always implicitly expanded; don't track in URL or Set.
    if (isRootCategory(category)) {
      if (!category.children || category.children.length === 0) {
        this.loadChildCategories(category);
      }
      return;
    }
    const next = new Set(this.expandedCategories);
    if (next.has(category.id)) {
      next.delete(category.id);
      this.collectDescendantIds(category).forEach(id => next.delete(id));
    } else {
      next.add(category.id);
      if (!category.children || category.children.length === 0) {
        this.loadChildCategories(category);
      }
    }
    const csv = this.urlState.toCSV(
      Array.from(next).slice(0, EXPAND_MAX).map(String)
    );
    this.urlState.patch({ expand: csv }, { replaceUrl: true });
  }

  private collectDescendantIds(category: any): number[] {
    const ids: number[] = [];
    const walk = (c: any) => {
      if (c?.children?.length) {
        for (const child of c.children) {
          ids.push(child.id);
          walk(child);
        }
      }
    };
    walk(category);
    return ids;
  }

  private loadChildCategories(category: any): void {
    if (this.loadingCategories.has(category.id)) {
      return;
    }

    this.loadingCategories.add(category.id);

    if (category.has_children) {
      this.dataService.getChildCategories(category.id).subscribe({
        next: (children) => {
          category.children = this.initializeCategoriesHierarchy(children);
          this.loadingCategories.delete(category.id);
          // After loading children, recurse to lazy-load any of them that
          // are themselves in the expand set (URL says they should be open).
          this.ensureExpandedChildrenLoaded(category.children);
        },
        error: (error) => {
          console.error('Error loading child categories:', error);
          this.loadingCategories.delete(category.id);
        }
      });
    } else {
      this.loadingCategories.delete(category.id);
    }
  }

  /** Walk the tree and lazy-load children for any category that should be
   *  rendered as expanded (per URL + root rule) but hasn't loaded descendants yet. */
  private ensureExpandedChildrenLoaded(roots: any[]): void {
    for (const cat of roots) {
      const shouldBeOpen = this.isCategoryExpanded(cat);
      const needsLoad = cat.has_children && (!cat.children || cat.children.length === 0);
      if (shouldBeOpen && needsLoad) {
        this.loadChildCategories(cat);
      } else if (cat.children && cat.children.length > 0) {
        this.ensureExpandedChildrenLoaded(cat.children);
      }
    }
  }

  private initializeCategoriesHierarchy(categories: any[]): any[] {
    return categories.map(category => ({
      ...category,
      children: [],
      level: category.level || 0
    }));
  }

  isCategoryExpanded(category: any): boolean {
    // Root (RMS) is implicitly always expanded.
    return isRootCategory(category) || this.expandedCategories.has(category.id);
  }

  isCategoryLoading(category: any): boolean {
    return this.loadingCategories.has(category.id);
  }

  isEndLeaf(category: any): boolean {
    // End leaf is determined by existence of 'path' field
    return category.path && category.path.trim() !== '';
  }

  getFlattenedCategories(categories: any[] = this.filteredCategories, level: number = 0): any[] {
    const result: any[] = [];

    for (const category of categories) {
      category.level = level;
      result.push(category);

      if (this.isCategoryExpanded(category) && category.children && category.children.length > 0) {
        result.push(...this.getFlattenedCategories(category.children, level + 1));
      }
    }

    return result;
  }

  selectCategory(category: any): void {
    if (!this.isEndLeaf(category)) return;
    // Capture scroll position so "Back to List" can restore it itself
    // (see restoreListPosition) — "Back to List" always does a forward
    // patch now, never a history pop (see onBackToListClick).
    this.savedListScrollY = window.scrollY;
    this.urlState.patch(
      { view: pathToUrlView(category.path), cat: category.id },
      { replaceUrl: false }
    );
  }

  /** Apply a fetched view document: parse its HTML and trigger answer fetching.
   *  In search mode the cells must stay empty (no data overlay on the yellow
   *  click-targets), so we skip the fetch and clear any stale data. */
  private applyView(view: any): void {
    this.selectedView = view;
    this.parseTableContent(view.content);
    if (this.cellMetadata.length > 0 && !this.searchMode) {
      this.fetchAnswersForTable();
    } else if (this.searchMode) {
      this.answerData = {};
    }
    this.updatePageTitle();
  }

  /** Ancestor category ids of the currently selected table's category, root
   *  and self excluded — same set used for both the breadcrumb ids and the
   *  `expand` list a breadcrumb jump restores. */
  private getAncestorChainIds(): number[] {
    const ids = this.selectedCategory?.hierarchy_ids;
    if (!Array.isArray(ids) || ids.length < 2) return [];
    return ids.slice(1, -1).slice(0, EXPAND_MAX);
  }

  /** Breadcrumb entries for the table view header: ancestor names paired
   *  with their category ids so each segment can be clicked. */
  getSelectedViewBreadcrumbs(): { id: number; name: string }[] {
    const names = this.getSelectedViewHierarchy();
    const ids = this.getAncestorChainIds();
    if (names.length !== ids.length) return [];
    return names.map((name, i) => ({ id: ids[i], name }));
  }

  /** Clicked a breadcrumb segment: jump back to the hierarchy list with the
   *  full ancestor chain expanded (as if the user had drilled down to the
   *  original table) and scroll the clicked ancestor's row into view. */
  navigateToBreadcrumb(categoryId: number): void {
    this.savedListScrollY = null;
    this.pendingScrollToCategoryId = categoryId;
    this.urlState.patch(
      { view: null, cat: null, expand: this.urlState.toCSV(this.getAncestorChainIds().map(String)) },
      { replaceUrl: false }
    );
  }

  /** Runs `action` once Angular has finished this navigation's pending work —
   *  lazy category-children fetches (HTTP, zone-tracked) *and* the change
   *  detection that renders their rows — so scroll/scrollIntoView lands on
   *  the DOM the way it will actually look, not a stale or not-yet-rendered
   *  snapshot. `NgZone.isStable` is false while we're still mid-navigation,
   *  so this always defers to the next stable point rather than resolving
   *  synchronously and racing the CD cycle that's about to happen. An extra
   *  rAF after that guarantees layout/paint has caught up too. */
  private scheduleAfterCategoriesStable(action: () => void): void {
    if (this.ngZone.isStable) {
      requestAnimationFrame(action);
      return;
    }
    const sub = this.ngZone.onStable.subscribe(() => {
      sub.unsubscribe();
      requestAnimationFrame(action);
    });
  }

  /** Restores the hierarchy list's scroll position after returning to it —
   *  either a breadcrumb jump target or the spot the user scrolled away
   *  from (selectCategory). No-ops if neither is pending. */
  private restoreListPosition(): void {
    if (this.pendingScrollToCategoryId != null) {
      const targetId = this.pendingScrollToCategoryId;
      this.pendingScrollToCategoryId = null;
      this.scheduleAfterCategoriesStable(() => {
        document.getElementById('cat-row-' + targetId)?.scrollIntoView({ block: 'center' });
      });
    } else if (this.savedListScrollY != null) {
      const y = this.savedListScrollY;
      this.savedListScrollY = null;
      this.scheduleAfterCategoriesStable(() => window.scrollTo(0, y));
    }
  }

  /** Called from the in-view "Back to List" button. Always a forward patch
   *  (never location.back()) so it merges the CURRENT query params — in
   *  particular the current `sample`. `location.back()` used to pop to the
   *  hierarchy-list history entry as it was at the moment selectCategory()
   *  pushed it, silently reverting any sample change made afterward (that
   *  change only replaced the table's own entry, not the list entry
   *  sitting underneath it in history) — see the "changing sample then
   *  loading a new table reverts to the old sample" bug report. `expand`
   *  is preserved for free since selectCategory() never touches it, so the
   *  merge naturally reproduces what location.back() used to restore.
   *  restoreListPosition() (triggered by applyVm's view→null branch) still
   *  does the scroll-position restore either way. */
  onBackToListClick(): void {
    this.editMode = false;
    this.masterEditMode = false;
    this.urlState.patch({ view: null, cat: null }, { replaceUrl: false });
  }

  parseTableContent(htmlContent: string): void {
    if (!htmlContent) {
      this.tableData = null;
      this.cellMetadata = [];
      return;
    }

    try {
      // Preprocess HTML to mark tables with foreach-row patterns
      // This must be done BEFORE DOM parsing because the browser's HTML parser
      // will "foster parent" text nodes (like [foreach]) out of <table> elements
      const preprocessedHtml = this.markForeachRowTables(htmlContent);

      // Create a temporary DOM element to parse the HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = preprocessedHtml;

      // Process all elements in sequence, grouping tables by their sections
      const allElements = tempDiv.children;
      const sections: any[] = [];
      const allMetadata: any[] = [];
      
      let mainHeading = '';
      let currentSectionHeading = '';
      let currentSubsectionHeading = '';
      let currentSectionTables: any[] = [];
      let currentSectionMetadata: any[] = [];
      
      const flushCurrentSection = () => {
        if (currentSectionTables.length > 0) {
          // Build full heading including subsection if present
          let fullHeading = currentSectionHeading;
          if (currentSubsectionHeading) {
            fullHeading = currentSubsectionHeading; // Use H3 as the section heading if present
          }
          
          sections.push({
            type: 'section-group',
            heading: fullHeading,
            h2Heading: currentSectionHeading,
            h3Heading: currentSubsectionHeading,
            tables: currentSectionTables
          });
          
          allMetadata.push({
            type: 'section-group',
            metadata: currentSectionMetadata
          });
          
          currentSectionTables = [];
          currentSectionMetadata = [];
        }
      };
      
      for (let i = 0; i < allElements.length; i++) {
        const element = allElements[i];
        
        if (element.tagName.toLowerCase() === 'h1') {
          mainHeading = element.textContent?.trim() || '';
          
        } else if (element.tagName.toLowerCase() === 'h2') {
          // Flush previous section before starting new one
          flushCurrentSection();
          currentSectionHeading = element.textContent?.trim() || '';
          currentSubsectionHeading = ''; // Reset H3 when we encounter H2
          
        } else if (element.tagName.toLowerCase() === 'h3') {
          // Flush previous subsection before starting new one
          flushCurrentSection();
          currentSubsectionHeading = element.textContent?.trim() || '';
          
        } else if (element.tagName.toLowerCase() === 'table') {
          // Extract table caption if present
          const caption = this.extractTableCaption(element);
          const tableResult = this.parseTableElement(element);
          
          currentSectionTables.push({
            type: 'table',
            caption: caption,
            headers: tableResult.headers,
            headerSpans: tableResult.headerSpans,
            rows: tableResult.rows
          });
          
          currentSectionMetadata.push({
            type: 'table',
            metadata: tableResult.metadata,
            // Pristine, never-expanded rows (1:1 with `metadata`), kept
            // alongside it so updateTableWithAnswers() can always rebuild
            // from the original template instead of the live `table.rows`,
            // which after the first render is already the *expanded* output
            // of a previous pass and no longer lines up 1:1 with `metadata`.
            templateRows: tableResult.rows
          });
        }
      }
      
      // Flush any remaining section
      flushCurrentSection();

      this.tableData = { mainHeading, sections };
      this.cellMetadata = allMetadata;
    } catch (error) {
      console.error('Error parsing table content:', error);
      this.tableData = null;
      this.cellMetadata = [];
    }
  }

  /**
   * Preprocess HTML to mark tables that have [foreach]<tr>...</tr>[endforeach] patterns.
   * This must be done before DOM parsing because the browser's HTML parser
   * will move text nodes like [foreach] outside of <table> elements (foster parenting).
   */
  private markForeachRowTables(html: string): string {
    // Check if the HTML contains the foreach-row pattern anywhere
    const hasForeachRowPattern = /\[foreach\]\s*<tr/i.test(html) && /<\/tr>\s*\[endforeach\]/i.test(html);

    if (!hasForeachRowPattern) {
      return html; // No foreach-row patterns, return unchanged
    }

    // Mark only tables that actually contain the [foreach] pattern
    // We need to check each table individually, not mark all tables globally
    return html.replace(/<table([^>]*)>([\s\S]*?)<\/table>/gi, (match, attrs, content) => {
      // Check if THIS specific table has the foreach-row pattern
      const tableHasForeach = /\[foreach\]\s*<tr/i.test(content) && /<\/tr>\s*\[endforeach\]/i.test(content);
      if (tableHasForeach) {
        return `<table${attrs} data-foreach-row="true">${content}</table>`;
      }
      return match; // Return unchanged if no foreach pattern in this table
    });
  }

  private extractTableCaption(table: Element): string {
    const caption = table.querySelector('caption');
    return caption ? caption.textContent?.trim() || '' : '';
  }

  private parseTableElement(table: Element): { headers: string[], headerSpans: any[], rows: any[], metadata: any[] } {
    const allRows = table.querySelectorAll('tbody tr') || table.querySelectorAll('tr');
    const headers: string[] = [];
    const headerSpans: any[] = [];
    const rows: any[] = [];
    const metadata: any[] = [];

    let startIndex = 0;
    let hasHeaders = true;

    // Check if table was marked with foreach-row pattern during preprocessing
    const hasForeachRowPattern = table.hasAttribute('data-foreach-row');

    // Check if we have proper headers
    if (allRows.length > 0) {
      const firstRow = allRows[0];
      const firstRowCells = firstRow.querySelectorAll('th, td');

      // Check if first row contains JSON data (indicating no headers)
      let hasJsonInFirstRow = false;
      firstRowCells.forEach(cell => {
        const cellText = cell.textContent?.trim() || '';
        if (this.containsJsonPattern(cellText) || this.containsForeachPattern(cellText)) {
          hasJsonInFirstRow = true;
        }
      });

      hasHeaders = !hasJsonInFirstRow;
      startIndex = hasHeaders ? 1 : 0;
    }

    // Extract headers if they exist, including colspan/rowspan
    if (hasHeaders && allRows.length > 0) {
      const headerRows = table.querySelectorAll('thead tr') || [allRows[0]];

      // Process all header rows to handle complex headers
      for (let headerRowIndex = 0; headerRowIndex < headerRows.length; headerRowIndex++) {
        const headerRow = headerRows[headerRowIndex];
        const headerCells = headerRow.querySelectorAll('th, td');

        headerCells.forEach(cell => {
          const cellText = cell.textContent?.trim() || '';
          const colspan = parseInt(cell.getAttribute('colspan') || '1');
          const rowspan = parseInt(cell.getAttribute('rowspan') || '1');

          headers.push(cellText);
          headerSpans.push({ colspan, rowspan });
        });
      }

      // Adjust start index if we have multiple header rows
      if (table.querySelector('thead')) {
        startIndex = 0; // tbody rows start from 0
      } else {
        startIndex = headerRows.length;
      }
    }

    // Track active rowspans from previous rows
    // Key: column index, Value: { rowsRemaining: number, data: any, metadata: any, span: any }
    const activeRowspans: Map<number, { rowsRemaining: number, data: any, metadata: any, span: any }> = new Map();

    // Process data rows
    for (let i = startIndex; i < allRows.length; i++) {
      const row = allRows[i];
      const cells = row.querySelectorAll('td, th');
      const rowData: any[] = [];
      const rowMetadata: any[] = [];
      const rowSpans: any[] = [];
      let rowQuestionId: string | null = null;

      let cellIndex = 0;
      let colIndex = 0;

      // Process cells, accounting for rowspan coverage
      while (cellIndex < cells.length || activeRowspans.has(colIndex)) {
        // Check if this column is covered by a rowspan from a previous row
        if (activeRowspans.has(colIndex)) {
          const spanInfo = activeRowspans.get(colIndex)!;
          // Add a placeholder for the spanned cell
          rowData.push(spanInfo.data);
          rowMetadata.push(spanInfo.metadata);
          rowSpans.push({ ...spanInfo.span, skip: true }); // Mark as skip for rendering

          spanInfo.rowsRemaining--;
          if (spanInfo.rowsRemaining <= 0) {
            activeRowspans.delete(colIndex);
          }
          colIndex++;
          continue;
        }

        if (cellIndex >= cells.length) break;

        const cell = cells[cellIndex];
        const cellContent = cell.innerHTML?.trim() || '';
        const needsHtml = cellContent.includes('[foreach]');
        const cellText = needsHtml ? cellContent : (cell.textContent?.trim() || '');
        const cellResult = this.parseCellContent(cellText);
        const colspan = parseInt(cell.getAttribute('colspan') || '1');
        const rowspan = parseInt(cell.getAttribute('rowspan') || '1');
        const isHeader = cell.tagName.toLowerCase() === 'th';
        // data-rowspan can be 'true', 'start', or 'continue'
        const dataRowspan = cell.getAttribute('data-rowspan');

        rowData.push(cellResult.data);
        rowMetadata.push(cellResult.metadata);
        rowSpans.push({ colspan, rowspan, isHeader, dataRowspan });

        // If rowspan > 1, track it for subsequent rows
        if (rowspan > 1) {
          activeRowspans.set(colIndex, {
            rowsRemaining: rowspan - 1,
            data: cellResult.data,
            metadata: cellResult.metadata,
            span: { colspan, rowspan, isHeader, dataRowspan }
          });
        }

        // Extract question ID from cell metadata for foreach-row
        if (!rowQuestionId && cellResult.metadata.id) {
          rowQuestionId = cellResult.metadata.id;
        }

        cellIndex++;
        colIndex++;
      }

      if (rowData.length > 0) {
        // If table has foreach-row pattern, mark data rows as foreach-row templates
        if (hasForeachRowPattern && rowQuestionId) {
          rows.push({ type: 'foreach-row', cells: rowData, spans: rowSpans });
          metadata.push({
            type: 'foreach-row',
            questionId: rowQuestionId,
            cells: rowMetadata
          });
        } else {
          rows.push({ type: 'data', cells: rowData, spans: rowSpans });
          metadata.push({ type: 'data', cells: rowMetadata });
        }
      }
    }

    return { headers, headerSpans, rows, metadata };
  }

  private parseCellContent(cellText: string): { data: any, metadata: any } {
    // Check for [foreach] pattern
    if (this.containsForeachPattern(cellText)) {
      return this.parseForeachCell(cellText);
    }

    // Check for simple JSON pattern
    if (this.containsJsonPattern(cellText)) {
      const jsonData = this.extractJsonFromCell(cellText);
      if (jsonData.id && jsonData.field) {
        const metadata: any = { type: 'simple', id: jsonData.id, field: jsonData.field };
        if (jsonData.tableField) {
          metadata.tableField = jsonData.tableField;
        }
        if (jsonData.rowspan) {
          metadata.rowspan = true;
        }
        return {
          data: '', // Will be filled by answers
          metadata
        };
      }
    }

    // Regular cell content
    return {
      data: cellText,
      metadata: { type: 'static' }
    };
  }

  private containsForeachPattern(text: string): boolean {
    return text.includes('[foreach]') && text.includes('[endforeach]');
  }

  private containsJsonPattern(text: string): boolean {
    return /\{[^}]*id[^}]*:[^}]*field[^}]*:[^}]*\}/i.test(text);
  }

  private parseForeachCell(cellText: string): { data: any, metadata: any } {
    // Extract content between [foreach] and [endforeach]
    const foreachMatch = cellText.match(/\[foreach\](.*?)\[endforeach\]/s);
    if (!foreachMatch) {
      // Remove any remaining [foreach] or [endforeach] tags
      const cleanedText = cellText.replace(/\[foreach\]|\[endforeach\]/g, '').trim();
      return { data: cleanedText, metadata: { type: 'static' } };
    }

    const foreachContent = foreachMatch[1].trim();
    
    // Parse the nested table structure
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = foreachContent;
    
    const nestedTable = tempDiv.querySelector('table');
    if (nestedTable) {
      const nestedResult = this.parseTableElement(nestedTable);
      return {
        data: {
          type: 'nested',
          headers: nestedResult.headers,
          rows: nestedResult.rows
        },
        metadata: {
          type: 'foreach',
          nestedMetadata: nestedResult.metadata
        }
      };
    }

    // Handle divs with metadata for vertical answer display
    const divs = tempDiv.querySelectorAll('div');
    if (divs.length > 0) {
      const firstDiv = divs[0];
      const divText = firstDiv.textContent?.trim() || '';

      if (this.containsJsonPattern(divText)) {
        const jsonData = this.extractJsonFromCell(divText);
        if (jsonData.id && jsonData.field) {
          // Store the div as an HTML template for later substitution
          const metadata: any = {
            type: 'foreach-div',
            id: jsonData.id,
            field: jsonData.field,
            template: '<div></div>'  // Simple div template for wrapping values
          };
          if (jsonData.tableField) {
            metadata.tableField = jsonData.tableField;
          }
          return {
            data: '',  // Will be replaced with HTML content
            metadata
          };
        }
      }
    }

    // If no table found, return cleaned content without tags
    return { data: foreachContent, metadata: { type: 'static' } };
  }

  private extractJsonFromCell(cellText: string): { id: string, field: string, tableField?: string, rowspan?: boolean } {
    let cellId = '';
    let cellField = '';
    let cellTableField = '';
    let cellRowspan = false;

    try {
      // Look for JSON-like pattern in cell content
      const jsonMatch = cellText.match(/\{[^}]*id[^}]*:[^}]*,?[^}]*field[^}]*:[^}]*\}/i);
      if (jsonMatch) {
        // Try to parse as JSON
        const jsonStr = jsonMatch[0].replace(/(\w+):/g, '"$1":'); // Add quotes around keys
        const parsed = JSON.parse(jsonStr);

        cellId = String(parsed.id || '');
        cellField = String(parsed.field || '');
        cellTableField = String(parsed.tableField || '');
        cellRowspan = parsed.rowspan === true;
      }
    } catch (error) {
      // If JSON parsing fails, try regex extraction
      const idMatch = cellText.match(/id\s*:\s*([^,}\s]+)/i);
      const fieldMatch = cellText.match(/field\s*:\s*([^,}\s]+)/i);
      const tableFieldMatch = cellText.match(/tableField\s*:\s*([^,}\s]+)/i);
      const rowspanMatch = cellText.match(/rowspan\s*:\s*(true)/i);

      if (idMatch) cellId = idMatch[1].trim();
      if (fieldMatch) cellField = fieldMatch[1].trim();
      if (tableFieldMatch) cellTableField = tableFieldMatch[1].trim();
      if (rowspanMatch) cellRowspan = true;
    }

    const result: { id: string, field: string, tableField?: string, rowspan?: boolean } = { id: cellId, field: cellField };
    if (cellTableField) {
      result.tableField = cellTableField;
    }
    if (cellRowspan) {
      result.rowspan = true;
    }
    return result;
  }

  // Sample selection event handlers — URL is source of truth; applyVm() does the work.
  onSampleSelected(sample: any): void {
    this.urlState.patch({ sample: sample.sample_ref });
  }

  onSampleCleared(): void {
    this.urlState.patch({ sample: null });
  }

  isNestedTable(cell: any): boolean {
    return cell && typeof cell === 'object' && cell.type === 'nested';
  }

  isHtmlContent(cell: any): boolean {
    return typeof cell === 'object' && cell !== null && cell.type === 'html' && cell.content;
  }

  containsHtmlTags(cell: any): boolean {
    return typeof cell === 'string' && /<[^>]+>/.test(cell);
  }

  isCellClickable(table: any, row: any, cellIndex: number): boolean {
    // Header cells (e.g. the "Target Word" column) carry the row's
    // _questionId/metadata for rowspan/grouping purposes, but they aren't an
    // answer cell in their own right and must never be clickable.
    if (row.spans?.[cellIndex]?.isHeader) {
      return false;
    }

    if (this.editMode) {
      return this.isEditableCell(table, row, cellIndex);
    }

    if (this.masterEditMode) {
      return this.isMasterEditableCell(table, row, cellIndex);
    }

    // For foreach-row expanded rows: clickable whenever there's an answer to
    // look up related phrases/transcriptions for. Related-phrase matching
    // now happens via the answer's research question (question_ids/
    // category_ids on MasterPhrases/Transcriptions), not a per-answer tags
    // flag, so there's no cheap local signal for "definitely has results" —
    // the modal itself reports "no related phrases" when the lookup is
    // empty. See extract/master_phrases_migration/PLAN.md.
    if (row._questionId !== undefined) {
      if (this.searchMode) {
        return true;
      }
      const answer = this.answerData[row._questionId];
      if (answer) {
        const specificAnswer = this.resolveCombinedAnswer(answer, row);
        if (specificAnswer && specificAnswer._key) {
          return true;
        }
      }
      return false;
    }

    // Find the corresponding metadata for this cell
    const metadata = this.getCellMetadata(table, row, cellIndex);

    if (!metadata || !metadata.id || !metadata.field) {
      return false;
    }

    // Only simple and foreach-div cells are clickable
    if (metadata.type !== 'simple' && metadata.type !== 'foreach-div') {
      return false;
    }

    if (metadata.field === 'question') {
      return false;
    }

    // In search mode, answerData is cleared (see toggleSearchMode), so there's
    // no answer to look up here; clickability is driven by metadata alone.
    if (this.searchMode) {
      return true;
    }

    // Same rule in both modes now: clickable whenever there's answer data
    // to look up (the modal reports "no related phrases" if none exist).
    const answer = this.answerData[metadata.id];
    if (!answer) {
      return false;
    }
    if (answer._isCombined && answer._answers) {
      return answer._answers.some((a: any) => a._key);
    }
    return !!answer._key;
  }

  onCellClick(table: any, row: any, cellIndex: number): void {
    if (!this.isCellClickable(table, row, cellIndex)) {
      return;
    }

    if (this.editMode) {
      this.onEditCellClick(table, row, cellIndex);
      return;
    }

    if (this.masterEditMode) {
      this.onMasterEditCellClick(table, row, cellIndex);
      return;
    }

    // Check if we're in search mode
    if (this.searchMode) {
      this.onSearchCellClick(table, row, cellIndex);
      return;
    }

    // For foreach-row expanded rows, use row._questionId directly
    if (row._questionId !== undefined) {
      const answer = this.resolveCombinedAnswer(this.answerData[row._questionId], row);
      if (answer && answer._key) {
        this.openPhrasesModal(answer);
      }
      return;
    }

    // Normal mode - open phrases modal
    const metadata = this.getCellMetadata(table, row, cellIndex);
    if (metadata && metadata.id) {
      let answer = this.answerData[metadata.id];

      // If this is a combined answer, get the correct answer based on row context
      if (answer && answer._isCombined && answer._answers) {
        const resolved = this.resolveCombinedAnswer(answer, row);
        // Fallback to first answer if this row doesn't map to a specific one
        answer = resolved !== answer ? resolved : answer._answers[0];
      }

      if (answer && answer._key) {
        this.openPhrasesModal(answer);
      }
    }
  }

  // Helper method to select the most appropriate answer based on the clicked field
  private selectAnswerByField(answers: any[], fieldName: string): any | null {
    if (!answers || answers.length === 0 || !fieldName) {
      return null;
    }

    // Find answers where the specific field is non-empty
    const matchingAnswers = answers.filter(answer => {
      const value = answer[fieldName];
      return value !== null && value !== undefined && value !== '' && value !== 'null';
    });

    // Return first matching answer, or null if none found
    return matchingAnswers.length > 0 ? matchingAnswers[0] : null;
  }

  openPhrasesModal(answer: any): void {
    // Generate detailed title with sample, question, and answer information
    const sampleRef = this.selectedSample?.sample_ref || 'Unknown Sample';
    
    // Get question hierarchy using the same logic as views component
    const questionHierarchy = this.getQuestionHierarchy(answer);
    
    // Get answer value using the same logic as views component
    const answerValue = this.getAnswerValue(answer);
    
    this.modalTitle = `Phrases for ${sampleRef} - ${questionHierarchy}`;
    this.modalAnswer = answer;
    this.showModal = true;
  }

  getQuestionHierarchy(answer: any): string {
    if (!answer) return 'Unknown Question';
    
    // Check if the answer itself contains hierarchy information
    if (answer.hierarchy && Array.isArray(answer.hierarchy) && answer.hierarchy.length > 0) {
      const hierarchyWithoutRMS = cleanHierarchy(answer.hierarchy);
      return hierarchyWithoutRMS.join(' > ');
    }
    
    // Try to find the category by question_id or category field
    const questionId = answer.question_id || answer.category;
    if (!questionId) return 'Unknown Question';
    
    // First check the shared category cache
    const cachedCategory = this.searchStateService.getCategoryCache(questionId);
    if (cachedCategory) {
      // Build full hierarchy without "RMS"
      if (cachedCategory.hierarchy && cachedCategory.hierarchy.length > 0) {
        const hierarchyWithoutRMS = cleanHierarchy(cachedCategory.hierarchy);
        return hierarchyWithoutRMS.join(' > ');
      }
      return cachedCategory.name || `Question ${questionId}`;
    }
    
    // Fallback to local categoryData (tables component specific)
    if (answer.category && this.categoryData[answer.category]) {
      const category = this.categoryData[answer.category];
      if (category.hierarchy && category.hierarchy.length > 0) {
        const hierarchyWithoutRMS = cleanHierarchy(category.hierarchy);
        return hierarchyWithoutRMS.join(' > ');
      }
      return category.name || `Question ${answer.category}`;
    }
    
    // Final fallback
    return `Question ${questionId}`;
  }

  getDisplayFields(result: any): {key: string, value: any}[] {
    if (!result) return [];
    
    return Object.keys(result)
      .filter(key => !this.shouldHideField(key))
      .map(key => ({key, value: result[key]}));
  }

  shouldHideField(fieldName: string): boolean {
    const hiddenFields = ['_id', 'question_id', 'sample', 'category', '_key', 'tags'];
    return hiddenFields.includes(fieldName);
  }

  getAnswerValue(result: any): string {
    // Priority order: form, marker, then other fields
    if (result.form && result.form.toString().trim()) {
      return result.form.toString().trim();
    }
    if (result.marker && result.marker.toString().trim()) {
      return result.marker.toString().trim();
    }
    
    // Fallback to first non-hidden field value
    const fields = this.getDisplayFields(result);
    if (fields.length > 0) {
      return fields[0].value ? fields[0].value.toString() : '-';
    }
    
    return '-';
  }

  closeModal(): void {
    this.showModal = false;
    this.modalAnswer = null;
    this.modalTitle = '';
  }

  closeTableNotFoundModal(): void {
    this.showTableNotFoundModal = false;
  }

  private findSectionIndex(table: any): number {
    if (!this.tableData) return -1;
    for (let i = 0; i < this.tableData.sections.length; i++) {
      if (this.tableData.sections[i].tables.some((t: any) => t === table)) return i;
    }
    return -1;
  }

  private findTableIndex(table: any, sectionIndex: number): number {
    if (!this.tableData || sectionIndex === -1) return -1;
    return this.tableData.sections[sectionIndex].tables.indexOf(table);
  }

  /** Full per-column metadata array for one row — the shared lookup behind
   *  getCellMetadata/getForeachRowCellMetadata (single cellIndex) and
   *  getRowFieldGroups (the whole row, for consolidating an edit dialog —
   *  see onEditCellClick). Handles both a normal row (indexed by position
   *  in the table) and a foreach-row expanded row (row._questionId set —
   *  metadata lives on the template row instead, matched by questionId). */
  private getRowCellsMetadata(table: any, row: any): any[] {
    if (!this.tableData || !this.cellMetadata) return [];

    const sectionIndex = this.findSectionIndex(table);
    const tableIndex = this.findTableIndex(table, sectionIndex);
    if (sectionIndex === -1 || tableIndex === -1) return [];
    const tableMetadata = this.cellMetadata[sectionIndex]?.metadata?.[tableIndex]?.metadata;
    if (!tableMetadata) return [];

    if (row._questionId !== undefined) {
      const templateMeta = tableMetadata.find((m: any) => m?.type === 'foreach-row' && m.questionId == row._questionId);
      return templateMeta?.cells ?? [];
    }

    const rowIndex = table.rows.indexOf(row);
    if (rowIndex === -1) return [];
    let rowMetadata = tableMetadata[rowIndex];
    // Handle foreach-row expanded tables: if rowMetadata doesn't exist at this index,
    // check if the first row was a foreach-row template and use its cell metadata
    if (!rowMetadata && this.tableHasForeachRows({ metadata: tableMetadata })) {
      rowMetadata = tableMetadata[0];
    }
    return rowMetadata?.cells ?? [];
  }

  private getCellMetadata(table: any, row: any, cellIndex: number): any {
    return this.getRowCellsMetadata(table, row)[cellIndex] ?? null;
  }

  /** For foreach-row expanded rows (row._questionId set): getCellMetadata's
   *  rowIndex lookup doesn't apply — the cell's real metadata lives on the
   *  template row instead. Resolves it by matching row._questionId back to
   *  the foreach-row template's questionId. */
  private getForeachRowCellMetadata(table: any, row: any, cellIndex: number): any {
    return this.getRowCellsMetadata(table, row)[cellIndex] ?? null;
  }

  getCategoryTitle(category: any): string {
    return category.name || 'Untitled';
  }

  getCategoryHierarchy(category: any, options: { skipFirst?: boolean, excludeCurrent?: boolean } = {}): string[] {
    if (!category.hierarchy || category.hierarchy.length === 0) {
      return [];
    }

    let hierarchy = cleanHierarchy(category.hierarchy);

    // Exclude current category name (last element) by default for breadcrumbs
    if (options.excludeCurrent !== false) {
      hierarchy = hierarchy.slice(0, -1);
    }

    // Skip first element if requested
    if (options.skipFirst && hierarchy.length > 0) {
      return hierarchy.slice(1);
    }

    return hierarchy;
  }

  getSelectedViewTitle(): string {
    if (!this.selectedView || !this.selectedView.content) {
      return 'Untitled';
    }
    
    // Extract H1 title from content
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = this.selectedView.content;
    const h1Element = tempDiv.querySelector('h1');
    
    if (h1Element) {
      return h1Element.textContent?.trim() || 'Untitled';
    }
    
    return 'Untitled';
  }

  getSelectedViewHierarchy(): string[] {
    if (!this.selectedCategory) {
      return [];
    }
    
    // Use the exact same logic as in the category list
    return this.getCategoryHierarchy(this.selectedCategory);
  }

  /** Called on ngModelChange from the hierarchy-filter input. Debounced → URL. */
  onSearchTermChange(term: string): void {
    this.qInput$.next(term);
  }

  clearSearchTerm(): void {
    this.urlState.patch({ q: null }, { replaceUrl: true });
  }

  fetchAnswersForTable(): void {
    if (this.cellMetadata.length === 0) {
      return;
    }
    
    // Always load category data for headers (question fields)
    this.loadCategoryDataForHeaders();
    
    // If no sample is selected, just clear the answer data and return
    // This will show the table structure with populated headers but empty data cells
    if (!this.selectedSample) {
      this.answerData = {};
      this.isLoadingAnswers = false;
      this.updateTableWithAnswers(); // This will update the table with empty data but populated headers
      return;
    }

    // Collect unique category IDs from all cells (including nested)
    const categoryIds: number[] = [];
    this.collectCategoryIds(this.cellMetadata, categoryIds);

    if (categoryIds.length === 0) {
      console.warn('No valid category IDs found in table cells');
      return;
    }

    // Store category IDs for potential reuse
    this.currentCategoryIds = categoryIds;

    this.fetchAnswersWithCurrentIds();
  }

  private collectCategoryIds(metadata: any[], categoryIds: number[]): void {
    metadata.forEach(section => {
      if (section.type === 'section-group' && section.metadata) {
        section.metadata.forEach((tableMetadata: any) => {
          if (tableMetadata.type === 'table' && tableMetadata.metadata) {
            tableMetadata.metadata.forEach((item: any) => {
              // Handle both 'data' and 'foreach-row' types
              if ((item.type === 'data' || item.type === 'foreach-row') && item.cells) {
                item.cells.forEach((cell: any) => {
                  if (cell.type === 'simple' && cell.id && !isNaN(Number(cell.id))) {
                    const id = Number(cell.id);
                    if (!categoryIds.includes(id)) {
                      categoryIds.push(id);
                    }
                  } else if (cell.type === 'foreach-div' && cell.id && !isNaN(Number(cell.id))) {
                    const id = Number(cell.id);
                    if (!categoryIds.includes(id)) {
                      categoryIds.push(id);
                    }
                  } else if (cell.type === 'foreach' && cell.nestedMetadata) {
                    this.collectNestedCategoryIds(cell.nestedMetadata, categoryIds);
                  }
                });
              }
              // Also collect from foreach-row's questionId directly
              if (item.type === 'foreach-row' && item.questionId && !isNaN(Number(item.questionId))) {
                const id = Number(item.questionId);
                if (!categoryIds.includes(id)) {
                  categoryIds.push(id);
                }
              }
            });
          }
        });
      }
    });
  }

  private collectNestedCategoryIds(nestedMetadata: any[], categoryIds: number[]): void {
    nestedMetadata.forEach(item => {
      if (item.type === 'data' && item.cells) {
        item.cells.forEach((cell: any) => {
          if (cell.type === 'simple' && cell.id && !isNaN(Number(cell.id))) {
            const id = Number(cell.id);
            if (!categoryIds.includes(id)) {
              categoryIds.push(id);
            }
          }
        });
      }
    });
  }

  fetchAnswersWithCurrentIds(): void {
    if (!this.selectedSample || this.currentCategoryIds.length === 0) {
      return;
    }

    this.isLoadingAnswers = true;
    this.answerData = {};
    this.categoryData = {};

    const categoryBatchRequest = this.dataService.getCategoriesByIds(this.currentCategoryIds).pipe(
      tap(categories => {
        categories.forEach((category: any) => {
          if (category && !category.has_children) {
            this.categoryData[category.id] = category;
            this.searchStateService.setCategoryCache(category.id, category);
          }
        });
      }),
      catchError(err => {
        console.error('Error fetching categories:', err);
        return of([]);
      })
    );

    const answerRequest = this.dataService.getAnswers(this.currentCategoryIds, [this.selectedSample.sample_ref]).pipe(
      tap(answers => this.processAnswers(answers)),
      catchError(err => {
        console.error('Error fetching answers:', err);
        return of([]);
      })
    );

    forkJoin([categoryBatchRequest, answerRequest]).subscribe({
      next: () => {
        this.updateTableWithAnswers();
        this.isLoadingAnswers = false;
      },
      error: (err) => {
        console.error('Error in forkJoin:', err);
        this.isLoadingAnswers = false;
      }
    });
  }


  processAnswers(answers: any[]): void {
    // Clear previous answer data
    this.answerData = {};

    // Group answers by question_id/category
    const groupedAnswers: { [key: string]: any[] } = {};
    answers.forEach(answer => {
      const key = `${answer.question_id || answer.category}`;
      if (!groupedAnswers[key]) {
        groupedAnswers[key] = [];
      }
      groupedAnswers[key].push(answer);
    });

    // Store answers - keep as array for field-specific selection, or single object if only one
    Object.keys(groupedAnswers).forEach(key => {
      const answersForKey = groupedAnswers[key];

      if (answersForKey.length === 1) {
        // Single answer - use as is
        this.answerData[key] = answersForKey[0];
      } else {
        // Multiple answers - store the array AND create a combined display object
        // The array will be used for field-specific selection
        this.answerData[key] = {
          _answers: answersForKey, // Store original answers for filtering
          _isCombined: true,       // Flag to indicate this is combined
          question_id: answersForKey[0].question_id,
          category: answersForKey[0].category,
          sample: answersForKey[0].sample,
          // Create combined display values for each field
          ...this.createCombinedDisplayValues(answersForKey)
        };
      }
    });

  }

  // Helper method to create combined display values from multiple answers
  private createCombinedDisplayValues(answers: any[]): any {
    const combined: any = {};
    const firstAnswer = answers[0];

    Object.keys(firstAnswer).forEach(field => {
      if (field !== 'question_id' && field !== 'category' && field !== 'sample' && field !== '_key' && field !== 'tag' && field !== 'tags') {
        const values = answers
          .map(answer => answer[field])
          .filter(value => value !== null && value !== undefined && value !== '' && value !== 'null')
          .map(value => {
            // Handle object with source property (language may be null)
            if (typeof value === 'object' && !Array.isArray(value) && value.source !== undefined) {
              if (value.language && value.language !== 'null') {
                return `${value.source}: ${value.language}`;
              }
              return String(value.source);
            }
            // Handle array of objects with source property
            if (Array.isArray(value) && value.length > 0 && value[0].source !== undefined) {
              return value.map((obj: any) => {
                if (obj.language && obj.language !== 'null') {
                  return `${obj.source}: ${obj.language}`;
                }
                return String(obj.source);
              }).join(', ');
            }
            // Handle arrays of primitives
            if (Array.isArray(value)) {
              return value.join(', ');
            }
            // Handle other objects - avoid [object Object]
            if (typeof value === 'object') {
              return '';
            }
            return String(value).trim();
          })
          .filter(value => value.length > 0);

        // Remove duplicates and join with commas for display
        const uniqueValues = [...new Set(values)];
        combined[field] = uniqueValues.join(', ');
      }
    });

    return combined;
  }

  updateTableWithAnswers(): void {
    if (!this.tableData || this.cellMetadata.length === 0) {
      return;
    }

    // Update each section with answer data
    const updatedSections = this.tableData.sections.map((section, sectionIndex) => {
      const sectionMetadata = this.cellMetadata[sectionIndex];

      if (sectionMetadata.type === 'section-group') {
        const updatedTables = section.tables.map((table: any, tableIndex: number) => {
          const tableMetadata = sectionMetadata.metadata[tableIndex];

          if (tableMetadata.type === 'table') {
            // tableMetadata.metadata is the fixed, one-entry-per-template-block
            // list from the original parse, and tableMetadata.templateRows is
            // the matching pristine, never-expanded row for each of those
            // blocks. Always rebuild from that pristine pair rather than from
            // `table.rows` — which after the first render is already the
            // *expanded* output of a previous call and no longer lines up
            // 1:1 with `metadata` (a block can occupy more than one live row).
            const templateRows = tableMetadata.templateRows || table.rows;
            const updatedRows = tableMetadata.metadata.flatMap((rowMetadata: any, rowIndex: number) => {
              const row = templateRows[rowIndex];
              if (!row) {
                return [];
              }

              if (rowMetadata.type === 'foreach-row') {
                // Expand foreach-row template into multiple rows based on answers
                return this.expandForeachRow(row, rowMetadata);
              } else if (rowMetadata.type === 'data') {
                const updatedCells = row.cells.map((cell: any, cellIndex: number) => {
                  return this.updateCellWithAnswers(cell, rowMetadata.cells[cellIndex]);
                });
                return [{ ...row, cells: updatedCells }];
              }
              return [row];
            });

            // Merge start/continue spans across foreach blocks
            const finalRows = this.mergeStartContinueSpans(updatedRows);

            return { ...table, rows: finalRows };
          }

          return table;
        });

        return { ...section, tables: updatedTables };
      }

      return section;
    });

    this.tableData = { ...this.tableData, sections: updatedSections };
  }

  /**
   * Expand a foreach-row template into multiple rows based on available answers.
   * Each answer creates a complete row with all cells populated from that specific answer.
   *
   * Rowspan behavior:
   * - Column 0 (verb/question): Rowspan ALL rows for the same question
   * - Column 1 (root): Rowspan rows that share the same root value
   * - Header cells (th) and cells with rowspan:true: Rowspan all rows
   */
  private expandForeachRow(row: any, rowMetadata: any): any[] {
    const questionId = rowMetadata.questionId;
    if (!questionId) {
      return [row]; // No question ID, return as-is
    }

    // Get answers for this question
    const answerData = this.answerData[questionId];
    if (!answerData) {
      // No answers - return template row with _questionId so click handlers use it
      // instead of falling back to index-based metadata lookup (which gives wrong results after expansion)
      const templateRow = this.applySpanFlagsToTemplateRow(row);
      return [{ ...templateRow, _questionId: questionId }];
    }

    // Get individual answers (handle combined answers)
    const answers = answerData._isCombined && answerData._answers
      ? answerData._answers
      : [answerData];

    const answerCount = answers.length;
    if (answerCount === 0) {
      const templateRow = this.applySpanFlagsToTemplateRow(row);
      return [{ ...templateRow, _questionId: questionId }];
    }

    // Get the grouping field from column 1 metadata (typically 'root')
    const groupingField = rowMetadata.cells[1]?.field;

    // Resolve pipe-separated field spec (e.g. "source|language") to a combined string value
    const resolveGroupValue = (answer: any): string => {
      if (!groupingField) return '';
      const fields = groupingField.split('|').map((f: string) => f.trim().replace(/"/g, ''));
      const values = fields
        .map((f: string) => answer[f])
        .filter((v: any) => v !== null && v !== undefined && v !== '');
      return values.join(': ');
    };

    // Sort answers by the grouping field to cluster same values together
    const sortedAnswers = [...answers].sort((a, b) => {
      const valA = resolveGroupValue(a);
      const valB = resolveGroupValue(b);
      return valA.localeCompare(valB);
    });

    // Calculate group boundaries for column 1 (root grouping)
    const groupInfo: { startIndex: number, size: number }[] = [];
    let currentGroup = { startIndex: 0, size: 1, value: resolveGroupValue(sortedAnswers[0]) };

    for (let i = 1; i < sortedAnswers.length; i++) {
      const val = resolveGroupValue(sortedAnswers[i]);
      if (val === currentGroup.value) {
        currentGroup.size++;
      } else {
        groupInfo.push({ startIndex: currentGroup.startIndex, size: currentGroup.size });
        currentGroup = { startIndex: i, size: 1, value: val };
      }
    }
    groupInfo.push({ startIndex: currentGroup.startIndex, size: currentGroup.size });

    // Create rows with proper rowspans
    return sortedAnswers.map((answer: any, answerIndex: number) => {
      const updatedCells = row.cells.map((cell: any, cellIndex: number) => {
        const cellMetadata = rowMetadata.cells[cellIndex];
        return this.updateCellWithSingleAnswer(cell, cellMetadata, answer);
      });

      let updatedSpans = row.spans ? [...row.spans] : row.cells.map(() => ({}));

      updatedSpans = updatedSpans.map((span: any, cellIndex: number) => {
        const cellMeta = rowMetadata.cells[cellIndex];

        // Check for data-rowspan attribute (set on static th cells in template)
        // Values: 'true', 'start' (first occurrence), 'continue' (merge with above)
        // 'true' on column 1: group-based rowspan (groups by resolved field value)
        // 'start' or 'true' on other columns: span entire foreach block
        if (span?.dataRowspan) {
          if (span.dataRowspan === 'continue') {
            // Always skip - this cell merges with the span from above
            return { ...span, skip: true, continueSpan: true };
          } else if (span.dataRowspan === 'true' && cellIndex === 1 && groupInfo.length > 1) {
            // Group-based rowspan for column 1
            const group = groupInfo.find((g: any) => answerIndex >= g.startIndex && answerIndex < g.startIndex + g.size);
            if (group && answerIndex === group.startIndex) {
              return { ...span, rowspan: group.size, startSpan: true };
            } else {
              return { ...span, skip: true };
            }
          } else {
            // 'start' or 'true' (no grouping) - span entire foreach block
            if (answerIndex === 0) {
              return { ...span, rowspan: answerCount, startSpan: true };
            } else {
              return { ...span, skip: true };
            }
          }
        }

        // Cells with rowspan: true in JAML metadata
        if (cellMeta?.rowspan === true) {
          if (answerIndex === 0) {
            return { ...span, rowspan: answerCount };
          } else {
            return { ...span, skip: true };
          }
        }

        return span;
      });

      // _answerKey identifies which specific Answer document this row
      // corresponds to. It must be the document's own _key rather than
      // `answerIndex` (a position in this *sorted* display list) — the
      // backing `answerData[questionId]._answers` array is unsorted, so an
      // index into the sorted order does not generally match the same
      // position there, which previously caused rows to resolve to the
      // WRONG sibling answer whenever the sort reordered them (e.g. a
      // 2-answer row where display order was swapped relative to fetch order).
      return { ...row, type: 'data', cells: updatedCells, spans: updatedSpans, _answerIndex: answerIndex, _answerKey: answer._key, _questionId: questionId };
    });
  }

  /**
   * Merge start/continue spans across foreach blocks.
   * Cells with startSpan flag start a new span, cells with continueSpan extend it.
   * This allows parent hierarchy cells to span across multiple child foreach blocks.
   */
  private mergeStartContinueSpans(rows: any[]): any[] {
    if (rows.length <= 1) return rows;

    // Create deep copies of rows and spans to avoid mutation issues
    const result = rows.map(row => ({
      ...row,
      spans: row.spans ? row.spans.map((s: any) => ({ ...s })) : []
    }));

    // Find maximum column count across all rows (rows may have different cell counts due to colspan variations)
    const numCols = Math.max(...result.map(row => row.cells?.length || 0));

    for (let colIndex = 0; colIndex < numCols; colIndex++) {
      let activeSpanStartRow: number | null = null;
      let spanRowCount = 0;  // Count only rows that have cells at this column index

      for (let rowIndex = 0; rowIndex < result.length; rowIndex++) {
        const span = result[rowIndex]?.spans?.[colIndex];

        // If row doesn't have a cell at this column index, finalize any active span
        // (rows with different cell counts due to colspan shouldn't be part of the same span)
        if (!span || span.dataRowspan === undefined) {
          if (activeSpanStartRow !== null && spanRowCount > 1) {
            result[activeSpanStartRow].spans[colIndex].rowspan = spanRowCount;
          }
          activeSpanStartRow = null;
          spanRowCount = 0;
          continue;
        }

        if (span.startSpan) {
          // Finalize previous span if any
          if (activeSpanStartRow !== null && spanRowCount > 1) {
            result[activeSpanStartRow].spans[colIndex].rowspan = spanRowCount;
          }
          // Start new span
          activeSpanStartRow = rowIndex;
          spanRowCount = 1;
        } else if (span.dataRowspan) {
          // This row continues or is part of the current span
          spanRowCount++;
        }
      }

      // Finalize last span
      if (activeSpanStartRow !== null && spanRowCount > 1) {
        result[activeSpanStartRow].spans[colIndex].rowspan = spanRowCount;
      }
    }

    return result;
  }

  /**
   * Apply span flags to a template row that has no answers.
   * This ensures mergeStartContinueSpans can properly handle rows with no data.
   */
  private applySpanFlagsToTemplateRow(row: any): any {
    if (!row.spans) {
      return row;
    }

    const updatedSpans = row.spans.map((span: any) => {
      if (span?.dataRowspan) {
        if (span.dataRowspan === 'continue') {
          // Continue cells should be skipped, covered by span from above
          return { ...span, skip: true, continueSpan: true };
        } else {
          // 'start' or 'true' - this is the start of a new span (single row since no answers)
          return { ...span, rowspan: 1, startSpan: true };
        }
      }
      return span;
    });

    return { ...row, spans: updatedSpans };
  }

  /**
   * Check if a table's metadata contains foreach-row templates.
   * Used to determine if we need special handling for expanded rows.
   */
  private tableHasForeachRows(tableMetadata: any): boolean {
    return tableMetadata?.metadata?.some((m: any) => m?.type === 'foreach-row') ?? false;
  }

  /**
   * Update a cell with a specific single answer (not the combined answerData).
   * Used for foreach-row expansion where each row gets one specific answer.
   */
  private updateCellWithSingleAnswer(cell: any, cellMetadata: any, answer: any): any {
    if (!cellMetadata || !answer) {
      return cell;
    }

    if (cellMetadata.type === 'simple' && cellMetadata.field) {
      const fieldSpec = cellMetadata.field;
      const tableFieldSpec = cellMetadata.tableField;

      // Handle pipe-separated field names (e.g., "source|language|origin")
      // Display format: first two values joined with ": ", remaining values joined with " "
      if (fieldSpec && fieldSpec.includes('|')) {
        const fieldNames = fieldSpec.split('|').map((f: string) => f.trim());
        const fieldValues = fieldNames
          .map((f: string) => answer[f])
          .filter((v: any) => v !== null && v !== undefined && v !== '' && v !== 'null');

        if (fieldValues.length === 0) return '';
        if (fieldValues.length <= 2) {
          return fieldValues.join(': ');
        }
        // Join first two with ": ", then append rest with ", "
        const firstPart = fieldValues.slice(0, 2).join(': ');
        const restPart = fieldValues.slice(2).join(', ');
        return `${firstPart}, ${restPart}`;
      }

      // Get field value from this specific answer
      const value = answer[fieldSpec];
      if (value === null || value === undefined || value === 'null') {
        return '';
      }

      // Handle nested object with tableField
      if (typeof value === 'object' && !Array.isArray(value) && tableFieldSpec) {
        return this.extractNestedValue(value, tableFieldSpec);
      }

      // Handle arrays
      if (Array.isArray(value)) {
        if (tableFieldSpec) {
          // Array of objects - extract tableField from each
          const values = value.map((item: any) => this.extractNestedValue(item, tableFieldSpec))
            .filter((v: string) => v !== '');
          return values.join(', ');
        }
        return value.join(', ');
      }

      return String(value);
    } else if (cellMetadata.type === 'foreach-div') {
      // Handle nested foreach within cell (e.g., markers array)
      const fieldSpec = cellMetadata.field;
      const tableFieldSpec = cellMetadata.tableField;
      const fieldValue = answer[fieldSpec];

      if (!fieldValue) return '';

      if (Array.isArray(fieldValue)) {
        const values = fieldValue
          .map((item: any) => {
            if (tableFieldSpec) {
              return this.extractNestedValue(item, tableFieldSpec);
            }
            return typeof item === 'object' ? '' : String(item);
          })
          .filter((v: string) => v !== '');

        if (values.length === 0) return '';
        const html = values.map((v: string) => `<div>${v}</div>`).join('');
        return { type: 'html', content: html };
      }

      if (tableFieldSpec) {
        return this.extractNestedValue(fieldValue, tableFieldSpec);
      }

      return typeof fieldValue === 'object' ? '' : String(fieldValue);
    }

    return cell;
  }

  /**
   * Extract value from an object using a tableFieldSpec (supports dot notation and pipe-separated paths).
   * E.g., "origin.source|origin.language" extracts origin.source and origin.language, joining non-null values.
   */
  private extractNestedValue(obj: any, tableFieldSpec: string): string {
    if (!obj || typeof obj !== 'object') {
      return '';
    }

    const getNestedValue = (o: any, path: string): any => {
      const parts = path.split('.');
      let current = o;
      for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
      }
      return current;
    };

    const fieldPaths = tableFieldSpec.split('|').map((f: string) => f.trim());
    const fieldValues = fieldPaths
      .map((path: string) => getNestedValue(obj, path))
      .filter((v: any) => v !== null && v !== undefined && v !== '' && v !== 'null');

    return fieldValues.length > 0 ? fieldValues.join(': ') : '';
  }

  private updateCellWithAnswers(cell: any, cellMetadata: any): any {
    if (cellMetadata.type === 'simple' && cellMetadata.id && cellMetadata.field) {
      if (cellMetadata.field === 'question') {
        // For question fields (table headers), always try to populate from category data
        // These should be loaded regardless of sample selection
        const category = this.categoryData[cellMetadata.id];
        if (category && category.name !== undefined && !category.has_children) {
          const value = category.name;

          if (value === null || value === 'null') {
            return '';
          }

          return String(value);
        } else {
          // If category data is not loaded, try to load it
          this.loadCategoryForHeader(cellMetadata.id);
          return '';
        }
      } else {
        // For answer fields, only populate if we have a selected sample and answer data
        if (!this.selectedSample) {
          return ''; // Empty cell when no sample selected
        }

        const answer = this.answerData[cellMetadata.id];
        if (!answer) return '';

        const fieldSpec = cellMetadata.field;
        const tableFieldSpec = cellMetadata.tableField;

        // Handle pipe-separated field names (e.g., "source|language|origin")
        // Display format: first two values joined with ": ", remaining values joined with " "
        // Example: "Current-L2: Bulgarian Inherited"
        if (fieldSpec && fieldSpec.includes('|')) {
          const fieldNames = fieldSpec.split('|').map((f: string) => f.trim());
          const fieldValues = fieldNames
            .map((f: string) => answer[f])
            .filter((v: any) => v !== null && v !== undefined && v !== '' && v !== 'null');

          if (fieldValues.length === 0) return '';
          if (fieldValues.length <= 2) {
            return fieldValues.join(': ');
          }
          // Join first two with ": ", then append rest with ", "
          const firstPart = fieldValues.slice(0, 2).join(': ');
          const restPart = fieldValues.slice(2).join(', ');
          return `${firstPart}, ${restPart}`;
        }

        // Single field name
        if (answer[fieldSpec] !== undefined) {
          const value = answer[fieldSpec];

          if (value === null || value === 'null') {
            return '';
          }

          // Handle nested object with tableField (e.g., field: origin, tableField: source|language)
          if (typeof value === 'object' && !Array.isArray(value) && tableFieldSpec) {
            const nestedFieldNames = tableFieldSpec.split('|').map((f: string) => f.trim());
            const nestedValues = nestedFieldNames
              .map((f: string) => value[f])
              .filter((v: any) => v !== null && v !== undefined && v !== '' && v !== 'null');
            return nestedValues.length > 0 ? nestedValues.join(': ') : '';
          }

          // Handle arrays of primitives (e.g., ["anglal", "anglal k-"])
          if (Array.isArray(value)) {
            return value.join(', ');
          }

          return String(value);
        }

        return '';
      }
    } else if (cellMetadata.type === 'foreach-div') {
      // Handle multiple answers displayed vertically in divs
      if (!this.selectedSample) {
        return '';
      }

      const answer = this.answerData[cellMetadata.id];
      if (!answer) return '';

      const fieldSpec = cellMetadata.field;
      const tableFieldSpec = cellMetadata.tableField;

      // Helper to get nested property value using dot notation (e.g., "origin.source")
      const getNestedValue = (obj: any, path: string): any => {
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
          if (current === null || current === undefined) return undefined;
          current = current[part];
        }
        return current;
      };

      // Helper to extract value from a single object using tableFieldSpec
      const extractFromObject = (obj: any): string => {
        if (tableFieldSpec) {
          const fieldPaths = tableFieldSpec.split('|').map((f: string) => f.trim());
          const fieldValues = fieldPaths
            .map((path: string) => getNestedValue(obj, path))
            .filter((v: any) => v !== null && v !== undefined && v !== '' && v !== 'null');
          return fieldValues.length > 0 ? fieldValues.join(': ') : '';
        }
        if (typeof obj === 'object') {
          return ''; // Don't display [object Object]
        }
        return String(obj);
      };

      // Helper to extract value from an answer object
      const extractValue = (answerObj: any): string => {
        // Get the field value from the answer
        const fieldValue = answerObj[fieldSpec];
        if (fieldValue === null || fieldValue === undefined || fieldValue === 'null') {
          return '';
        }

        // If field value is an array, extract from each element using tableFieldSpec
        if (Array.isArray(fieldValue)) {
          const values = fieldValue
            .map((item: any) => extractFromObject(item))
            .filter((v: string) => v !== '');
          return values.join(', ');
        }

        // If field value is an object, extract using tableFieldSpec
        if (typeof fieldValue === 'object') {
          return extractFromObject(fieldValue);
        }

        return String(fieldValue);
      };

      // For combined answers, use the raw _answers array to get individual values
      if (answer._isCombined && answer._answers) {
        const values = answer._answers
          .map((a: any) => extractValue(a))
          .filter((v: string) => v !== '');

        if (values.length === 0) return '';

        const html = values.map((v: string) => `<div>${v}</div>`).join('');
        return { type: 'html', content: html };
      }

      // Single answer case
      const value = extractValue(answer);
      if (!value) {
        return '';
      }

      return { type: 'html', content: `<div>${value}</div>` };
    } else if (cellMetadata.type === 'foreach' && cell.type === 'nested') {
      // Update nested table cells
      const updatedNestedRows = cell.rows.map((nestedRow: any, nestedRowIndex: number) => {
        const nestedMetadata = cellMetadata.nestedMetadata[nestedRowIndex];
        const updatedNestedCells = nestedRow.cells.map((nestedCell: any, nestedCellIndex: number) => {
          return this.updateCellWithAnswers(nestedCell, nestedMetadata.cells[nestedCellIndex]);
        });
        return { ...nestedRow, cells: updatedNestedCells };
      });
      
      return {
        ...cell,
        rows: updatedNestedRows
      };
    }
    
    // Return original cell content for static cells
    return cell;
  }

  private loadCategoryDataForHeaders(): void {
    // Collect category IDs that are used for headers (question fields)
    const headerCategoryIds: number[] = [];
    this.collectHeaderCategoryIds(this.cellMetadata, headerCategoryIds);

    // Filter to only IDs not already cached
    const uncachedIds = headerCategoryIds.filter(id => !this.categoryData[id]);
    if (uncachedIds.length === 0) return;

    this.dataService.getCategoriesByIds(uncachedIds).subscribe({
      next: (categories) => {
        categories.forEach((category: any) => {
          if (category && !category.has_children) {
            this.categoryData[category.id] = category;
            this.searchStateService.setCategoryCache(category.id, category);
          }
        });
        this.updateTableWithAnswers();
      },
      error: (err) => {
        console.error('Error loading categories for headers:', err);
      }
    });
  }

  private collectHeaderCategoryIds(metadata: any[], categoryIds: number[]): void {
    metadata.forEach(section => {
      if (section.type === 'section-group' && section.metadata) {
        section.metadata.forEach((tableMetadata: any) => {
          if (tableMetadata.type === 'table' && tableMetadata.metadata) {
            tableMetadata.metadata.forEach((item: any) => {
              if (item.type === 'data' && item.cells) {
                item.cells.forEach((cell: any) => {
                  if (cell.type === 'simple' && cell.id && cell.field === 'question' && !isNaN(Number(cell.id))) {
                    const id = Number(cell.id);
                    if (!categoryIds.includes(id)) {
                      categoryIds.push(id);
                    }
                  } else if (cell.type === 'foreach' && cell.nestedMetadata) {
                    this.collectNestedHeaderCategoryIds(cell.nestedMetadata, categoryIds);
                  }
                });
              }
            });
          }
        });
      }
    });
  }

  private collectNestedHeaderCategoryIds(nestedMetadata: any[], categoryIds: number[]): void {
    nestedMetadata.forEach(item => {
      if (item.type === 'data' && item.cells) {
        item.cells.forEach((cell: any) => {
          if (cell.type === 'simple' && cell.id && cell.field === 'question' && !isNaN(Number(cell.id))) {
            const id = Number(cell.id);
            if (!categoryIds.includes(id)) {
              categoryIds.push(id);
            }
          }
        });
      }
    });
  }

  private pendingCategoryLoads = new Set<number>();

  private loadCategoryForHeader(categoryId: number): void {
    if (this.pendingCategoryLoads.has(categoryId)) return;
    this.pendingCategoryLoads.add(categoryId);
    // Load category data for header cells even without sample selection
    this.dataService.getCategoryById(categoryId).subscribe({
      next: (category) => {
        this.pendingCategoryLoads.delete(categoryId);
        if (category && !category.has_children) {
          this.categoryData[categoryId] = category;
          this.searchStateService.setCategoryCache(categoryId, category);
          this.updateTableWithAnswers();
        }
      },
      error: (err) => {
        this.pendingCategoryLoads.delete(categoryId);
        console.error(`Error loading category ${categoryId} for header:`, err);
      }
    });
  }

  // Edit mode methods
  /** Whether the current user is allowed to edit the selected sample —
   *  drives both the Edit Mode button's visibility and a guard against
   *  entering/staying in edit mode via stale state. */
  canEditSelectedSample(): boolean {
    return !!this.selectedSample?.sample_ref && this.userService.canEditSample(this.selectedSample.sample_ref);
  }

  toggleEditMode(): void {
    if (!this.editMode && !this.canEditSelectedSample()) return;
    this.editMode = !this.editMode;
    if (this.editMode) {
      this.searchMode = false;
      this.masterEditMode = false;
    }
  }

  /** Master Edit Mode gate — the reverse of canEditSelectedSample: only
   *  available with no sample selected (it edits the shared phrase concept,
   *  not any one sample's data), and only to global admins, same privilege
   *  as the Phrases page's master editor. */
  canEnterMasterEditMode(): boolean {
    return !this.selectedSample && this.userService.isGlobalAdmin();
  }

  toggleMasterEditMode(): void {
    if (!this.masterEditMode && !this.canEnterMasterEditMode()) return;
    this.masterEditMode = !this.masterEditMode;
    if (this.masterEditMode) {
      this.editMode = false;
      this.searchMode = false;
    }
  }

  /** Same cell-resolution as isEditableCell, minus the per-sample
   *  CanEditSample gate (Master Edit Mode has no sample) — a cell is
   *  eligible whenever it's a genuine answer-field cell (leaf research
   *  question), matching the same metadata shape edit mode requires. */
  isMasterEditableCell(table: any, row: any, cellIndex: number): boolean {
    let metadata: any;
    if (row._questionId !== undefined) {
      metadata = this.getForeachRowCellMetadata(table, row, cellIndex);
    } else {
      metadata = this.getCellMetadata(table, row, cellIndex);
    }
    if (!metadata?.id || !metadata?.field) return false;
    if (metadata.type !== 'simple' && metadata.type !== 'foreach-div' && metadata.type !== 'foreach-row') return false;
    if (metadata.field === 'question') return false;
    return true;
  }

  onMasterEditCellClick(table: any, row: any, cellIndex: number): void {
    let metadata: any;
    if (row._questionId !== undefined) {
      metadata = this.getForeachRowCellMetadata(table, row, cellIndex);
    } else {
      metadata = this.getCellMetadata(table, row, cellIndex);
    }
    if (!metadata?.id) return;

    this.masterLinksQuestionId = Number(metadata.id);
    this.masterLinksQuestionName = this.getQuestionHierarchyForCriterion(Number(metadata.id));
    this.showMasterLinksModal = true;
  }

  closeMasterLinksModal(): void {
    this.showMasterLinksModal = false;
  }

  private showSaveError(err: any, fallback: string): void {
    this.saveErrorMessage = err?.status === 401 || err?.status === 403
      ? 'You are not logged in or do not have permission to make this change. Your edit was not saved.'
      : (err?.error?.error || err?.error?.detail || fallback);
    if (this.saveErrorTimeout) clearTimeout(this.saveErrorTimeout);
    this.saveErrorTimeout = setTimeout(() => this.saveErrorMessage = null, 6000);
  }

  /** Resolves the specific answer document a combined bucket's row
   *  corresponds to. Rows are displayed in sorted order (see
   *  expandForeachRow's grouping sort) while `bucket._answers` is in
   *  unsorted fetch order, so this must match by the answer's own _key
   *  (row._answerKey) rather than by position — matching by index against
   *  the differently-ordered array picks the wrong sibling answer whenever
   *  the two orders diverge (e.g. a 2-answer row where they're swapped). */
  private resolveCombinedAnswer(bucket: any, row: any): any {
    if (!bucket?._isCombined || !bucket?._answers) return bucket;
    if (row._answerKey !== undefined) {
      const found = bucket._answers.find((a: any) => a._key === row._answerKey);
      if (found) return found;
    }
    return bucket;
  }

  /** Resolves the answer a foreach-row expanded row's edit/edit-check
   *  should act on — mirrors isCellClickable's non-edit foreach-row
   *  handling (row._questionId, with _isCombined drill-down). */
  private getForeachRowAnswer(row: any): any {
    const answer = this.answerData[row._questionId];
    return this.resolveCombinedAnswer(answer, row);
  }

  isEditableCell(table: any, row: any, cellIndex: number): boolean {
    if (!this.canEditSelectedSample()) return false;
    let metadata: any;
    let answer: any;
    if (row._questionId !== undefined) {
      metadata = this.getForeachRowCellMetadata(table, row, cellIndex);
      answer = this.getForeachRowAnswer(row);
    } else {
      metadata = this.getCellMetadata(table, row, cellIndex);
      answer = metadata?.id ? this.answerData[metadata.id] : undefined;
    }
    if (!metadata?.id || !metadata?.field) return false;
    if (metadata.type !== 'simple' && metadata.type !== 'foreach-div' && metadata.type !== 'foreach-row') return false;
    if (metadata.field === 'question') return false;
    if (answer?._isCombined) return false;
    return true;
  }

  /** Splits a pipe-separated field spec (e.g. "source|language") into
   *  trimmed field names, or null if this isn't a combined field. */
  private splitCombinedField(fieldSpec: string): string[] | null {
    if (!fieldSpec || !fieldSpec.includes('|')) return null;
    return fieldSpec.split('|').map(f => f.trim()).filter(f => f.length > 0);
  }

  /** All field names belonging to one answer document within a row —
   *  unions every column in the row sharing the clicked cell's id
   *  (splitting any pipe-combined field spec per column too), in table
   *  column order. Lets one click edit every field of that answer at once
   *  (e.g. Base Origin's source|language plus a separate Base Example
   *  column, all on the same research-question id) instead of one
   *  cell/field at a time — see onEditCellClick. */
  private collectRowFieldNames(table: any, row: any, id: number): string[] {
    const cells = this.getRowCellsMetadata(table, row);
    const names: string[] = [];
    for (const m of cells) {
      if (!m || Number(m.id) !== id || !m.field || m.field === 'question') continue;
      for (const name of this.splitCombinedField(m.field) ?? [m.field]) {
        if (!names.includes(name)) names.push(name);
      }
    }
    return names;
  }

  onEditCellClick(table: any, row: any, cellIndex: number): void {
    if (!this.canEditSelectedSample()) return;
    let metadata: any;
    let answer: any;
    if (row._questionId !== undefined) {
      metadata = this.getForeachRowCellMetadata(table, row, cellIndex);
      answer = this.getForeachRowAnswer(row);
    } else {
      metadata = this.getCellMetadata(table, row, cellIndex);
      answer = metadata?.id ? this.answerData[metadata.id] : undefined;
    }
    if (!metadata?.id) return;

    this.editModalAnswerKey = answer?._key ?? '';
    this.editModalQuestionId = String(metadata.id);
    this.editModalQuestionName = this.getQuestionHierarchyForCriterion(Number(metadata.id));

    // Consolidate every field belonging to this same answer across the
    // whole row (not just the clicked cell/column) into one dialog — see
    // collectRowFieldNames. A row with only one field for this id behaves
    // exactly as before (single-field mode).
    const fieldNames = this.collectRowFieldNames(table, row, Number(metadata.id));
    if (fieldNames.length > 1) {
      this.editModalFieldName = '';
      this.editModalCurrentValue = '';
      this.editModalFields = fieldNames.map(name => ({ name, value: answer?.[name] ?? '' }));
    } else {
      const fieldName = fieldNames[0] ?? metadata.field;
      this.editModalFields = null;
      this.editModalFieldName = fieldName;
      this.editModalCurrentValue = answer?.[fieldName] ?? '';
    }
    this.showEditModal = true;

    const sampleRef = this.selectedSample.sample_ref;
    const categoryId = Number(metadata.id);
    const toPhraseList = (phrases: any[]): PhraseListItem[] =>
      (phrases ?? []).map((p: any) => ({ phrase_ref: p.phrase_ref, english: p.english, phrase: p.phrase }));

    this.pendingPhraseAssociationChanges = null;
    this.editModalStandardPhrases = [];
    this.editModalResolvedPhrases = [];
    this.editModalPhrasesLoading = true;
    forkJoin([
      // Master-only baseline (ignores question_overrides entirely) — lets
      // the dialog tell a naturally-linked phrase apart from one only
      // present via a question_overrides.include exception, which
      // otherwise look identical once persisted.
      this.dataService.getMasterPhrasesByCategory(categoryId, sampleRef),
      this.dataService.getRelatedContent(categoryId, sampleRef)
    ]).subscribe({
      next: ([standard, { phrases: resolved }]) => {
        this.editModalStandardPhrases = toPhraseList(standard);
        this.editModalResolvedPhrases = toPhraseList(resolved);
        this.editModalPhrasesLoading = false;
      },
      error: (err) => { console.error('Error loading associated phrases:', err); this.editModalPhrasesLoading = false; }
    });

    if (!this.allPhrasesCache.has(sampleRef)) {
      this.dataService.getAllPhrasesForSample(sampleRef).subscribe({
        next: (list) => { this.allPhrasesCache.set(sampleRef, list); },
        error: (err) => console.error('Error loading phrase list for sample:', err)
      });
    }
  }

  get editModalAllPhrases(): PhraseListItem[] {
    return this.allPhrasesCache.get(this.selectedSample?.sample_ref) ?? [];
  }

  onPhraseAssociationsConfirmed(changes: PhraseAssociationChange[] | null): void {
    this.pendingPhraseAssociationChanges = changes;
  }

  /** Applies phrase-association edits from the cell dialog's "Override"
   *  section — each targets a single SamplePhrase's own question_overrides
   *  (toggling this cell's question id in/out of include/exclude), not the
   *  Answer document: linking a phrase to a question for a sample is what
   *  question_overrides already does, and it requires the SamplePhrase to
   *  exist (which is also why the dialog only lets the user add phrases
   *  already recorded for this sample). Independent of the field/answer
   *  save above — needs only the sample and this cell's question id. */
  private applyPhraseAssociationChanges(changes: PhraseAssociationChange[], sampleRef: string, categoryId: number): void {
    changes.forEach(change => {
      const key = `${sampleRef}_${change.phrase_ref}`;
      this.dataService.getPhraseLinks(key).subscribe({
        next: (links) => {
          const overrides = links.question_overrides ?? { include: [], exclude: [] };
          const include = new Set(overrides.include ?? []);
          const exclude = new Set(overrides.exclude ?? []);
          switch (change.action) {
            case 'exclude': exclude.add(categoryId); include.delete(categoryId); break;
            case 'restore': exclude.delete(categoryId); break;
            case 'add': include.add(categoryId); exclude.delete(categoryId); break;
            case 'remove': include.delete(categoryId); break;
          }
          this.dataService.updatePhrase(key, { question_overrides: { include: [...include], exclude: [...exclude] } })
            .subscribe({
              next: () => this.dataService.invalidatePhrasesCache(sampleRef),
              error: (err) => {
                console.error(`Error saving phrase association for ${change.phrase_ref}:`, err);
                this.showSaveError(err, `Failed to save phrase association for ${change.phrase_ref}.`);
              }
            });
        },
        error: (err) => {
          console.error(`Error loading phrase links for ${change.phrase_ref}:`, err);
          this.showSaveError(err, `Failed to save phrase association for ${change.phrase_ref}.`);
        }
      });
    });
  }

  private readonly ANSWER_STRUCTURAL_FIELDS = new Set([
    '_key', '_id', '_rev', 'sample', 'question_id', 'category', 'tags'
  ]);

  private answerHasOtherFields(answer: any, excludeFields: string | string[]): boolean {
    const excluded = new Set(Array.isArray(excludeFields) ? excludeFields : [excludeFields]);
    return Object.keys(answer).some(k =>
      !excluded.has(k) &&
      !this.ANSWER_STRUCTURAL_FIELDS.has(k) &&
      answer[k] !== null && answer[k] !== undefined && answer[k] !== '' && answer[k] !== 'null'
    );
  }

  /** answerData[questionId] can be a single answer doc, OR a "combined"
   *  wrapper ({_isCombined, _answers: [...], plus derived display fields})
   *  when several answer documents share a question/sample (rowspan-grouped
   *  rows). Reads/writes below must act on the ONE specific document being
   *  edited (identified by its _key) — never on the derived wrapper itself,
   *  since its top-level fields are display strings combined across all
   *  sibling answers, not real values from any single document. */
  private getSpecificAnswer(questionId: string, answerKey: string): any {
    const bucket = this.answerData[questionId];
    if (!bucket) return undefined;
    if (bucket._isCombined && bucket._answers) {
      return bucket._answers.find((a: any) => a._key === answerKey);
    }
    return bucket;
  }

  /** Merges `updates` into the specific answer document (by _key) within
   *  answerData[questionId], recomputing the combined wrapper's derived
   *  display fields if this question has multiple answers — instead of
   *  overwriting the whole bucket with a single flattened value and
   *  silently discarding the other sibling answers. */
  private applyAnswerFieldsLocally(questionId: string, answerKey: string, updates: Record<string, any>): void {
    const bucket = this.answerData[questionId];
    if (!bucket) return;
    if (bucket._isCombined && bucket._answers) {
      const updatedAnswers = bucket._answers.map((a: any) => a._key === answerKey ? { ...a, ...updates } : a);
      this.answerData[questionId] = {
        _answers: updatedAnswers,
        _isCombined: true,
        question_id: updatedAnswers[0].question_id,
        category: updatedAnswers[0].category,
        sample: updatedAnswers[0].sample,
        ...this.createCombinedDisplayValues(updatedAnswers)
      };
    } else {
      this.answerData[questionId] = { ...bucket, ...updates };
    }
  }

  /** Removes the specific answer document (by _key) from answerData[questionId],
   *  collapsing the combined wrapper back down (or dropping the entry
   *  entirely) as siblings fall below two — instead of deleting the whole
   *  bucket regardless of how many sibling answers remain. */
  private removeAnswerLocally(questionId: string, answerKey: string): void {
    const bucket = this.answerData[questionId];
    if (!bucket) return;
    if (bucket._isCombined && bucket._answers) {
      const remaining = bucket._answers.filter((a: any) => a._key !== answerKey);
      if (remaining.length === 0) {
        delete this.answerData[questionId];
      } else if (remaining.length === 1) {
        this.answerData[questionId] = remaining[0];
      } else {
        this.answerData[questionId] = {
          _answers: remaining,
          _isCombined: true,
          question_id: remaining[0].question_id,
          category: remaining[0].category,
          sample: remaining[0].sample,
          ...this.createCombinedDisplayValues(remaining)
        };
      }
    } else {
      delete this.answerData[questionId];
    }
  }

  onEditConfirmed({ fieldName, newValue }: { fieldName: string; newValue: string }): void {
    this.showEditModal = false;
    const questionId = this.editModalQuestionId;
    const answerKey = this.editModalAnswerKey;
    const phraseChanges = this.pendingPhraseAssociationChanges;
    this.pendingPhraseAssociationChanges = null;
    if (phraseChanges) {
      this.applyPhraseAssociationChanges(phraseChanges, this.selectedSample.sample_ref, Number(questionId));
    }

    if (!answerKey) {
      // No existing document — only create if there's actually a value
      if (!newValue) return;
      this.dataService.createAnswer(Number(questionId), this.selectedSample.sample_ref, fieldName, newValue).subscribe({
        next: (created) => { this.answerData[questionId] = created; this.updateTableWithAnswers(); },
        error: (err) => { console.error('Error creating answer:', err); this.showSaveError(err, 'Failed to create answer.'); }
      });
      return;
    }

    if (!newValue) {
      // Clearing — delete document if this is its only meaningful field, otherwise just clear
      const existing = this.getSpecificAnswer(questionId, answerKey);
      if (existing && !this.answerHasOtherFields(existing, fieldName)) {
        this.dataService.deleteAnswer(answerKey).subscribe({
          next: () => { this.removeAnswerLocally(questionId, answerKey); this.updateTableWithAnswers(); },
          error: (err) => { console.error('Error deleting answer:', err); this.showSaveError(err, 'Failed to delete answer.'); }
        });
      } else {
        this.dataService.patchAnswer(answerKey, { [fieldName]: null }).subscribe({
          next: () => {
            this.applyAnswerFieldsLocally(questionId, answerKey, { [fieldName]: null });
            this.updateTableWithAnswers();
          },
          error: (err) => { console.error('Error clearing answer field:', err); this.showSaveError(err, 'Failed to clear answer field.'); }
        });
      }
      return;
    }

    this.dataService.patchAnswer(answerKey, { [fieldName]: newValue }).subscribe({
      next: () => {
        this.applyAnswerFieldsLocally(questionId, answerKey, { [fieldName]: newValue });
        this.updateTableWithAnswers();
      },
      error: (err) => { console.error('Error saving answer edit:', err); this.showSaveError(err, 'Failed to save answer edit.'); }
    });
  }

  /** Combined-field save (e.g. source + language): patches/creates all
   *  underlying fields together rather than one concatenated string. */
  onEditConfirmedMulti(fields: { name: string; newValue: string }[]): void {
    this.showEditModal = false;
    const questionId = this.editModalQuestionId;
    const answerKey = this.editModalAnswerKey;
    const fieldNames = fields.map(f => f.name);
    const phraseChanges = this.pendingPhraseAssociationChanges;
    this.pendingPhraseAssociationChanges = null;
    if (phraseChanges) {
      this.applyPhraseAssociationChanges(phraseChanges, this.selectedSample.sample_ref, Number(questionId));
    }

    if (!answerKey) {
      const nonEmpty = fields.filter(f => f.newValue);
      if (nonEmpty.length === 0) return;
      const [first, ...rest] = nonEmpty;
      this.dataService.createAnswer(Number(questionId), this.selectedSample.sample_ref, first.name, first.newValue).subscribe({
        next: (created) => {
          this.answerData[questionId] = created;
          if (rest.length === 0 || !created?._key) {
            this.updateTableWithAnswers();
            return;
          }
          const restUpdates: Record<string, string> = {};
          rest.forEach(f => restUpdates[f.name] = f.newValue);
          this.dataService.patchAnswer(created._key, restUpdates).subscribe({
            next: () => {
              this.answerData[questionId] = { ...created, ...restUpdates };
              this.updateTableWithAnswers();
            },
            error: (err) => { console.error('Error saving additional fields:', err); this.showSaveError(err, 'Failed to save additional fields.'); }
          });
        },
        error: (err) => { console.error('Error creating answer:', err); this.showSaveError(err, 'Failed to create answer.'); }
      });
      return;
    }

    const existing = this.getSpecificAnswer(questionId, answerKey);
    const allEmpty = fields.every(f => !f.newValue);
    if (allEmpty) {
      if (existing && !this.answerHasOtherFields(existing, fieldNames)) {
        this.dataService.deleteAnswer(answerKey).subscribe({
          next: () => { this.removeAnswerLocally(questionId, answerKey); this.updateTableWithAnswers(); },
          error: (err) => { console.error('Error deleting answer:', err); this.showSaveError(err, 'Failed to delete answer.'); }
        });
        return;
      }
    }

    const updates: Record<string, string | null> = {};
    fields.forEach(f => updates[f.name] = f.newValue || null);
    this.dataService.patchAnswer(answerKey, updates).subscribe({
      next: () => {
        this.applyAnswerFieldsLocally(questionId, answerKey, updates);
        this.updateTableWithAnswers();
      },
      error: (err) => { console.error('Error saving answer edit:', err); this.showSaveError(err, 'Failed to save answer edit.'); }
    });
  }

  onDeleteAnswer(): void {
    this.showEditModal = false;
    const questionId = this.editModalQuestionId;
    const answerKey = this.editModalAnswerKey;
    this.pendingPhraseAssociationChanges = null;
    if (!answerKey) return;
    this.dataService.deleteAnswer(answerKey).subscribe({
      next: () => { this.removeAnswerLocally(questionId, answerKey); this.updateTableWithAnswers(); },
      error: (err) => { console.error('Error deleting answer:', err); this.showSaveError(err, 'Failed to delete answer.'); }
    });
  }

  onEditCancelled(): void {
    this.showEditModal = false;
    this.pendingPhraseAssociationChanges = null;
    this.editModalStandardPhrases = [];
    this.editModalResolvedPhrases = [];
  }

  // Search mode methods
  toggleSearchMode(): void {
    this.searchMode = !this.searchMode;
    if (this.searchMode) {
      this.editMode = false;
      this.masterEditMode = false;
    }

    if (this.searchMode) {
      // Entering search mode - clear answer data so cells are empty, keep sample selected
      this.answerData = {};
      this.isLoadingAnswers = false;
      if (this.selectedView) {
        this.parseTableContent(this.selectedView.content);
      }
    } else {
      // Exiting search mode - clear search criteria and restore table data
      this.searchStateService.clearSearchCriteria();
      if (this.selectedView) {
        this.parseTableContent(this.selectedView.content);
        if (this.selectedSample && this.cellMetadata.length > 0) {
          this.fetchAnswersForTable();
        }
      }
    }
  }

  onSearchCellClick(table: any, row: any, cellIndex: number): void {
    let questionId: number;
    let fieldName: string;

    if (row._questionId !== undefined) {
      // Foreach-row expanded row: get metadata from the template row
      const cellMeta = this.getForeachRowCellMetadata(table, row, cellIndex);
      if (!cellMeta || !cellMeta.id || !cellMeta.field) return;
      questionId = Number(cellMeta.id);
      fieldName = cellMeta.field;
    } else {
      const metadata = this.getCellMetadata(table, row, cellIndex);
      if (!metadata || metadata.type !== 'simple' || !metadata.id || !metadata.field) {
        return;
      }
      // Don't allow searching on question fields (headers)
      if (metadata.field === 'question') {
        return;
      }
      questionId = Number(metadata.id);
      fieldName = metadata.field;
    }

    // Get full hierarchy breadcrumb for display
    const category = this.categoryData[questionId];
    let questionHierarchy = '';
    if (category && category.hierarchy && category.hierarchy.length > 0) {
      questionHierarchy = cleanHierarchy(category.hierarchy).join(' > ');
    } else if (category && category.name) {
      questionHierarchy = category.name;
    } else {
      // If category data isn't loaded, try to load it first
      questionHierarchy = `Question ${questionId}`;
      // Attempt to load the category data
      this.loadCategoryForSearchModal(questionId, fieldName);
      return;
    }
    
    this.showSearchValueModal(questionId, fieldName, questionHierarchy);
  }

  private loadCategoryForSearchModal(questionId: number, fieldName: string): void {
    this.dataService.getCategoryById(questionId).subscribe({
      next: (category) => {
        if (category) {
          this.categoryData[questionId] = category;
          // Store in shared cache for other components
          this.searchStateService.setCategoryCache(questionId, category);
          // Now show the modal with proper hierarchy
          let questionHierarchy = '';
          if (category.hierarchy && category.hierarchy.length > 0) {
            questionHierarchy = cleanHierarchy(category.hierarchy).join(' > ');
          } else {
            questionHierarchy = category.name || `Question ${questionId}`;
          }
          this.showSearchValueModal(questionId, fieldName, questionHierarchy);
        } else {
          // Fallback if category couldn't be loaded
          this.showSearchValueModal(questionId, fieldName, `Question ${questionId}`);
        }
      },
      error: (err) => {
        console.error(`Error loading category ${questionId} for search modal:`, err);
        // Fallback if there was an error
        this.showSearchValueModal(questionId, fieldName, `Question ${questionId}`);
      }
    });
  }

  showSearchValueModal(questionId: number, fieldName: string, questionName: string): void {
    this.searchModalQuestionId = questionId;
    this.searchModalFieldName = fieldName;
    this.searchModalQuestionName = questionName;
    
    const category = this.categoryData[questionId];
    this.searchModalHierarchy = (category && category.hierarchy) ? cleanHierarchy(category.hierarchy) : [];
    
    this.showSearchModal = true;
  }

  // New shared dialog handlers
  onSearchCriterionConfirmed(criterion: SearchCriterion): void {
    if (criterion.value === '') {
      // Empty value = "search all answers for this question" = category search
      // Add to selected questions instead of search criteria
      const category = this.categoryData[criterion.questionId];
      const questionObj = {
        id: criterion.questionId,
        name: category?.name || `Question ${criterion.questionId}`,
        hierarchy: category?.hierarchy || [],
        has_children: false
      };
      const current = this.searchStateService.getCurrentSelectedCategories();
      if (!current.some((c: any) => c.id === criterion.questionId)) {
        this.searchStateService.updateQuestionSelection([...current, questionObj]);
      }
    } else {
      this.searchStateService.addSearchCriterion(criterion);
      // Cache category data so ViewsComponent can display the hierarchy
      const category = this.categoryData[criterion.questionId];
      if (category) this.searchStateService.setCategoryCache(criterion.questionId, category);
    }
    this.closeSearchModal();
  }
  
  onSearchCriterionCancelled(): void {
    this.closeSearchModal();
  }

  closeSearchModal(): void {
    this.showSearchModal = false;
    this.searchModalQuestionId = 0;
    this.searchModalFieldName = '';
    this.searchModalQuestionName = '';
    this.searchModalHierarchy = [];
  }

  getSelectedSearchQuestions(): any[] {
    return this.searchStateService.getCurrentSelectedCategories();
  }

  removeSearchQuestion(index: number): void {
    const current = this.searchStateService.getCurrentSelectedCategories();
    const updated = current.filter((_: any, i: number) => i !== index);
    this.searchStateService.updateQuestionSelection(updated);
  }

  clearSearchCriteria(): void {
    this.searchStateService.clearSearchCriteria();
    this.searchStateService.updateQuestionSelection([]);
    this.searchOperator = 'OR';
  }

  removeSearchCriterion(index: number): void {
    this.searchStateService.removeSearchCriterion(index);
  }

  executeSearch(): void {
    const searchCriteria = this.searchContext.searches;
    const selectedQuestions = this.searchStateService.getCurrentSelectedCategories();

    if (searchCriteria.length === 0 && selectedQuestions.length === 0) {
      return;
    }

    // Store the current view context in the search context before executing
    const currentContext = this.searchStateService.getSearchContext();
    this.searchStateService.setSearchContext({
      ...currentContext,
      selectedView: this.selectedView,
      selectedCategory: this.selectedCategory
    });

    // Determine which search path to use
    const questionIds = selectedQuestions.map((q: any) => q.id);

    if (searchCriteria.length > 0 && questionIds.length === 0) {
      // Only value-based criteria → use searchAnswers
      this.dataService.searchAnswers(searchCriteria, this.searchOperator).subscribe({
        next: (results) => {
          const searchStatus = `Found ${results.length} answers for ${searchCriteria.length} search ${searchCriteria.length === 1 ? 'criterion' : 'criteria'}.`;
          this.searchStateService.updateSampleSelection([]);
          this.searchStateService.updateQuestionSelection([]);
          this.searchStateService.updateSearchCriteria(searchCriteria);
          this.searchStateService.updateSearchResults(results, searchStatus, 'searchAnswers');
          const searches = this.urlState.encodeSearches(searchCriteria);
          const op = this.searchOperator === 'AND' ? 'AND' : null;
          this.urlState.navigateMerge(['/search'], { searches, cats: null, samples: null, tab: 'results', page: null, op });
        },
        error: (error) => {
          console.error('Error executing search:', error);
          this.searchStateService.updateSearchResults([], 'Search failed. Please try again later.', null);
        }
      });
    } else if (questionIds.length > 0 && searchCriteria.length === 0) {
      // Only question selections → use getAnswers (category search path)
      this.dataService.getAnswers(questionIds, undefined, this.searchOperator).subscribe({
        next: (results) => {
          const questionText = questionIds.length === 1 ? `1 question` : `${questionIds.length} questions`;
          const uniqueSamples = [...new Set(results.map((r: any) => r.sample))];
          const searchStatus = `Found ${results.length} answers for ${questionText}. ${uniqueSamples.length} samples.`;
          this.searchStateService.updateSampleSelection([]);
          this.searchStateService.clearSearchCriteria();
          this.searchStateService.updateQuestionSelection(selectedQuestions);
          this.searchStateService.updateSearchResults(results, searchStatus, 'getAnswers');
          const op = this.searchOperator === 'AND' ? 'AND' : null;
          this.urlState.navigateMerge(
            ['/search'],
            { cats: questionIds.join(','), searches: null, samples: null, tab: 'results', page: null, op }
          );
        },
        error: (error) => {
          console.error('Error executing search:', error);
          this.searchStateService.updateSearchResults([], 'Search failed. Please try again later.', null);
        }
      });
    } else {
      // Mixed: both question selections and value-based criteria
      const searches$ = searchCriteria.length > 0 ? this.dataService.searchAnswers(searchCriteria, this.searchOperator) : null;
      const questions$ = this.dataService.getAnswers(questionIds, undefined, this.searchOperator);

      questions$.subscribe({
        next: (questionResults) => {
          if (searches$) {
            searches$.subscribe({
              next: (searchResults) => {
                const combined = [...questionResults, ...searchResults];
                const searchStatus = `Found ${combined.length} answers (${questionResults.length} from questions, ${searchResults.length} from criteria).`;
                this.searchStateService.updateSampleSelection([]);
                this.searchStateService.updateQuestionSelection(selectedQuestions);
                this.searchStateService.updateSearchCriteria(searchCriteria);
                this.searchStateService.updateSearchResults(combined, searchStatus, 'getAnswers');
                const searches = this.urlState.encodeSearches(searchCriteria);
                const op = this.searchOperator === 'AND' ? 'AND' : null;
                this.urlState.navigateMerge(
                  ['/search'],
                  { searches, cats: questionIds.join(','), samples: null, tab: 'results', page: null, op }
                );
              },
              error: (error) => {
                console.error('Error executing criteria search:', error);
                this.searchStateService.updateSearchResults([], 'Search failed. Please try again later.', null);
              }
            });
          } else {
            const searchStatus = `Found ${questionResults.length} answers.`;
            this.searchStateService.updateSampleSelection([]);
            this.searchStateService.updateQuestionSelection(selectedQuestions);
            this.searchStateService.updateSearchResults(questionResults, searchStatus, 'getAnswers');
            this.urlState.navigateMerge(
              ['/search'],
              { cats: questionIds.join(','), searches: null, samples: null, tab: 'results', page: null }
            );
          }
        },
        error: (error) => {
          console.error('Error executing search:', error);
          this.searchStateService.updateSearchResults([], 'Search failed. Please try again later.', null);
      }
    });
    }
  }

  private getQuestionNameForCriterion(questionId: number): string {
    const category = this.categoryData[questionId];
    if (category && category.hierarchy && category.hierarchy.length > 0) {
      return category.hierarchy.join(' > ');
    } else if (category) {
      return category.name;
    }
    return `Question ${questionId}`;
  }

  getQuestionHierarchyForCriterion(questionId: number): string {
    // First check local categoryData
    const category = this.categoryData[questionId];
    if (category && category.hierarchy && category.hierarchy.length > 0) {
      // Remove "RMS" from the beginning and join with " > "
      const hierarchyWithoutRMS = cleanHierarchy(category.hierarchy);
      return hierarchyWithoutRMS.join(' > ');
    } else if (category) {
      return category.name;
    }
    
    // Fallback to shared category cache
    const cachedCategory = this.searchStateService.getCategoryCache(questionId);
    if (cachedCategory && cachedCategory.hierarchy && cachedCategory.hierarchy.length > 0) {
      return cleanHierarchy(cachedCategory.hierarchy).join(' > ');
    } else if (cachedCategory) {
      return cachedCategory.name;
    }

    // Fallback to currently selected questions (populated from SearchComponent)
    const selectedQ = this.searchStateService.getCurrentSelectedCategories()
      .find((q: any) => Number(q.id) === Number(questionId));
    if (selectedQ && selectedQ.hierarchy && selectedQ.hierarchy.length > 0) {
      return cleanHierarchy(selectedQ.hierarchy).join(' > ');
    } else if (selectedQ) {
      return selectedQ.name;
    }

    return `Question ${questionId}`;
  }

  private cellToText(cell: any): string {
    if (cell === null || cell === undefined) return '';
    if (typeof cell === 'string') {
      // Strip HTML tags
      return cell.replace(/<[^>]+>/g, '').trim();
    }
    if (typeof cell === 'object') {
      if (cell.type === 'html' && cell.content) {
        return String(cell.content).replace(/<[^>]+>/g, '').trim();
      }
      if (cell.type === 'nested') {
        // Flatten nested table rows into semicolon-separated values
        return (cell.rows || [])
          .map((r: any) => (r.cells || []).map((c: any) => this.cellToText(c)).join(', '))
          .join('; ');
      }
    }
    return String(cell);
  }

  openExportModal(): void {
    this.exportModalComponent.open();
  }

  private expandHeaders(table: any): string[] {
    if (!table.headers || table.headers.length === 0) return [];
    const expanded: string[] = [];
    for (let i = 0; i < table.headers.length; i++) {
      const span = table.headerSpans?.[i];
      const colspan = span?.colspan || 1;
      expanded.push(table.headers[i]);
      for (let c = 1; c < colspan; c++) {
        expanded.push(table.headers[i]);
      }
    }
    return expanded;
  }

  confirmExport(format: ExportFormat): void {
    if (!this.tableData) return;

    const tables: { heading: string; columns: string[]; rows: Record<string, string>[] }[] = [];

    for (const section of this.tableData.sections) {
      const sectionHeading = section.heading || section.h2Heading || '';
      for (const table of section.tables) {
        const caption = table.caption || '';
        const heading = [sectionHeading, caption].filter(Boolean).join(' — ');
        const expandedHeaders = this.expandHeaders(table);

        // Determine max column count from data rows.
        // Rowspan-continuation cells (skip:true) occupy a grid column too, so count them.
        let maxCols = expandedHeaders.length;
        for (const row of table.rows) {
          let colCount = 0;
          for (let i = 0; i < row.cells.length; i++) {
            colCount += row.spans?.[i]?.colspan || 1;
          }
          maxCols = Math.max(maxCols, colCount);
        }

        // Build column names
        const columns: string[] = [];
        for (let i = 0; i < maxCols; i++) {
          if (i < expandedHeaders.length && expandedHeaders[i]) {
            let name = expandedHeaders[i];
            let count = columns.filter(c => c === name || c.startsWith(name + ' (')).length;
            if (count > 0) name = `${name} (${count + 1})`;
            columns.push(name);
          } else {
            columns.push(`col_${i + 1}`);
          }
        }

        const rows: Record<string, string>[] = [];

        for (const row of table.rows) {
          const rowData: Record<string, string> = {};
          let colIdx = 0;
          for (let i = 0; i < row.cells.length; i++) {
            if (colIdx >= columns.length) break;
            // Rowspan-continuation: the real cell lives in an earlier row.
            // Emit an empty cell here so the column alignment is preserved.
            if (row.spans?.[i]?.skip) {
              rowData[columns[colIdx]] = '';
              colIdx++;
              continue;
            }
            rowData[columns[colIdx]] = this.cellToText(row.cells[i]);
            // Fill implied empty cells for colspan
            const colspan = row.spans?.[i]?.colspan || 1;
            for (let c = 1; c < colspan && colIdx + c < columns.length; c++) {
              rowData[columns[colIdx + c]] = '';
            }
            colIdx += colspan;
          }
          // Fill any remaining columns
          for (let i = colIdx; i < columns.length; i++) {
            rowData[columns[i]] = rowData[columns[i]] ?? '';
          }
          rows.push(rowData);
        }

        tables.push({ heading, columns, rows });
      }
    }

    const filename = (this.tableData.mainHeading || this.selectedCategory?.name || 'table-export')
      .replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
    this.exportService.downloadTables(tables, format, filename);
  }

  getExportRowCount(): number {
    if (!this.tableData) return 0;
    let count = 0;
    for (const section of this.tableData.sections) {
      for (const table of section.tables) {
        count += table.rows.length;
      }
    }
    return count;
  }
}
