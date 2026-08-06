import { environment } from '../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of, Subject } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

export interface PhraseListItem {
  phrase_ref: string;
  english: string;
  /** Romani text for a specific sample, when fetched via
   *  getAllPhrasesForSample()/getRelatedContent() — null/undefined when
   *  the phrase has no SamplePhrase row for that sample yet, or when this
   *  item came from getPhraseList() (no sample scope). */
  phrase?: string | null;
  has_recording?: boolean;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/**
 * Fields that carry the primary answer value in a result record.
 * First match wins. Used for comparison table display and export ordering.
 */
export const ANSWER_VALUE_FIELDS = ['form', 'marker', 'inflection'];

export interface AnswerSuggestion {
  value: string;
  count: number;
}

export interface SearchCriterion {
  questionId: number;
  fieldName: string;
  value: string;
}

export interface SearchContext {
  // Search Configuration
  selectedQuestions: any[];           // Traditional question selection
  selectedSamples: any[];            // Traditional sample selection  
  searches: SearchCriterion[];       // Advanced search criteria
  
  // Search Execution State
  searchResults: any[];              // Unified results from any search type
  searchStatus: string;              // Status messages
  isLoading: boolean;               // Search in progress
  
  // Search Type & Context
  searchType: 'questions' | 'criteria' | 'mixed' | 'none';
  lastSearchMethod: 'getAnswers' | 'searchAnswers' | null;
  
  // Table Context (for navigation)
  selectedView?: any;
  selectedCategory?: any;
  currentSample?: any;
}
@Injectable({
  providedIn: 'root'
})
export class DataService {
  base_url: string = environment.apiUrl;

  /** Fired when the "Tables" nav-bar link is clicked. Navigation itself is
   *  handled by [mergeLink] on that link (it already drops view/cat, leaving
   *  only `sample`); this is purely a signal for TablesComponent to reset its
   *  own local hierarchy-nav bookkeeping (scroll position, etc.) — it must
   *  NOT trigger a second router.navigate, which previously raced with
   *  mergeLink's navigation and could drop the `sample` query param. */
  private tablesResetSubject = new Subject<void>();
  tablesReset$ = this.tablesResetSubject.asObservable();

  /** Request-keyed cache for getPhrases(sampleRef). Replaces the old
   *  SearchStateService.phrasesCache so the data layer owns request caching. */
  private phrasesBySampleRef = new Map<string, Observable<any[]>>();

  /** Cached view documents by filename. Replaces SearchStateService.viewsCache. */
  private viewsByFilename = new Map<string, Observable<any>>();

  /** Request-keyed cache for getTranscriptions(sampleRef). Replaces the old
   *  SearchStateService.transcriptionsCache so the data layer owns request caching. */
  private transcriptionsBySampleRef = new Map<string, Observable<any[]>>();

  constructor(private http: HttpClient) {}

  resetTablesView(): void {
    this.tablesResetSubject.next();
  }

  getCategories(): Observable<any> {
    return this.http.get(this.base_url + '/categories/') // retrieves top categories
  }

  getCategoryById(id: any): Observable<any> {
    return this.http.get(this.base_url + '/categories/' + id)
  }

  getCategoriesByIds(ids: number[]): Observable<any[]> {
    if (!ids || ids.length === 0) return of([]);
    return this.http.get<any[]>(this.base_url + '/categories/batch/?ids=' + ids.join(','));
  }

  searchCategories(searchString: string): Observable<any> {
    if (!searchString || searchString.trim() === '' || searchString.trim().length < 2) {
      return of([]); // return empty array if search string is empty
    }
    return this.http.get(this.base_url + '/categories/search?q=' + searchString)
  }

  getViewCategories(): Observable<any> {
    return this.http.get(this.base_url + '/categories/search-views/')
  }

  getChildCategories(parent: any): Observable<any> {
    return this.http.get(this.base_url + '/categories/?parent_id=' + parent)
  }

  getSamples(): Observable<any>{
    return this.http.get<any[]>(this.base_url + '/samples/')
  }

  getSampleById(id: any): Observable <any> {
    return this.http.get(this.base_url + '/samples/' + id)
  }

  updateSample(sampleRef: string, data: Record<string, any>): Observable<any> {
    return this.http.patch(`${this.base_url}/samples/${sampleRef}/`, data);
  }

  checkSampleRef(ref: string): Observable<any> {
    return this.http.get(`${this.base_url}/samples/check/?ref=${encodeURIComponent(ref)}`);
  }

  downloadImportTemplate(): void {
    this.http.get(`${this.base_url}/samples/import-template/`, { responseType: 'blob' }).subscribe(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sample_import_template.csv';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  importSample(formData: FormData): Observable<any> {
    return this.http.post(`${this.base_url}/samples/import/`, formData);
  }

  rollbackImportBatch(batchId: string): Observable<any> {
    return this.http.delete(`${this.base_url}/samples/import-batch/${batchId}/`);
  }

  getImportHistory(): Observable<any[]> {
    return this.http.get<any[]>(`${this.base_url}/samples/import-history/`);
  }

  private static readonly LEGACY_COUNTRIES: Record<string, { name: string; flag: string }> = {
    'YU': { name: 'Yugoslavia', flag: '' },
  };

  getCountryInfo(code: string): Observable<any> {
    const legacy = DataService.LEGACY_COUNTRIES[code];
    if (legacy) {
      return of(legacy);
    }
    return this.http.post(`${environment.countryApiUrl}`, { country: code }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Token ${environment.countryApiToken}`
      }})
  }

  getPhrases(sampleId: any): Observable<any> {
    return this.http.get(this.base_url + '/phrases/?sample=' + sampleId)
  }

  /** Cached variant of getPhrases. Multiple subscribers for the same sample
   *  share one HTTP request and its replayed result. */
  getPhrasesCached(sampleRef: string): Observable<any[]> {
    const existing = this.phrasesBySampleRef.get(sampleRef);
    if (existing) return existing;
    const stream = this.http.get<any[]>(`${this.base_url}/phrases/?sample=${sampleRef}`).pipe(
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.phrasesBySampleRef.set(sampleRef, stream);
    return stream;
  }

  /** Updates the per-sample phrase text. key is a SamplePhrase._key,
   *  i.e. "{sample}_{phrase_ref}" (already the shape returned by the
   *  phrase list/search/by-answer endpoints). Only `phrase` is accepted
   *  server-side. */
  /** phrase: the per-sample Romani text. question_overrides: rare,
   *  sample-scoped exceptions to the MasterPhrase's linked research
   *  questions ({include, exclude} arrays of research question ids). */
  updatePhrase(key: string, payload: { phrase?: string; question_overrides?: { include: number[]; exclude: number[] } }): Observable<any> {
    return this.http.patch(`${this.base_url}/phrases/${key}/`, payload);
  }

  /** Adds a per-sample recording of an existing phrase concept — phrase_ref
   *  must already name a MasterPhrase (createMasterPhrase makes new ones).
   *  Requires editor+ role for the target sample; server 409s a duplicate
   *  (sample, phrase_ref) pair. */
  createPhrase(payload: { sample: string; phrase_ref: string; phrase?: string }): Observable<any> {
    return this.http.post(`${this.base_url}/phrases/`, payload);
  }

  /** Deletes one sample's recording of a phrase (not the shared phrase
   *  concept — see deleteMasterPhrase for that). key is a SamplePhrase._key
   *  ("{sample}_{phrase_ref}"). Requires editor+ role for that sample. */
  deletePhrase(key: string): Observable<void> {
    return this.http.delete<void>(`${this.base_url}/phrases/${key}/`);
  }

  /** Updates fields shared across every sample's recording of a phrase
   *  (english, conjugated, question_ids, category_ids), keyed by
   *  phrase_ref. Requires global admin role (meta-editor territory). */
  updateMasterPhrase(phraseRef: string, payload: {
    english?: string;
    conjugated?: boolean;
    question_ids?: number[];
    category_ids?: number[];
  }): Observable<any> {
    return this.http.patch(`${this.base_url}/master-phrases/${phraseRef}/`, payload);
  }

  /** Reads english/conjugated/question_ids/category_ids for one phrase
   *  concept — the counterpart to updateMasterPhrase's write. Public read. */
  getMasterPhrase(phraseRef: string): Observable<any> {
    return this.http.get(`${this.base_url}/master-phrases/${phraseRef}/`);
  }

  /** Creates a new phrase concept. phrase_ref becomes its permanent key —
   *  server rejects duplicates with 409. Requires global admin role. */
  createMasterPhrase(payload: {
    phrase_ref: string;
    english: string;
    conjugated?: boolean;
    question_ids?: number[];
    category_ids?: number[];
  }): Observable<any> {
    return this.http.post(`${this.base_url}/master-phrases/`, payload);
  }

  /** How many samples have recorded this phrase concept, and which ones —
   *  fetched by the delete-confirmation dialog before it lets the admin
   *  actually delete. */
  getMasterPhraseImpact(phraseRef: string): Observable<{ phrase_ref: string; count: number; samples: string[] }> {
    return this.http.get<{ phrase_ref: string; count: number; samples: string[] }>(
      `${this.base_url}/master-phrases/${phraseRef}/impact/`
    );
  }

  /** Permanently deletes a phrase concept AND every sample's recording of
   *  it (server-side cascade). Requires global admin role. */
  deleteMasterPhrase(phraseRef: string): Observable<void> {
    return this.http.delete<void>(`${this.base_url}/master-phrases/${phraseRef}/`);
  }

  /** All MasterPhrase docs (phrase_ref/english/conjugated/question_ids/
   *  category_ids), sample-agnostic — backs the admin "Edit Master Phrases"
   *  list view. Public read, unpaginated. */
  getAllMasterPhrases(): Observable<any[]> {
    return this.http.get<any[]>(`${this.base_url}/master-phrases/`);
  }

  /** Linking data for one SamplePhrase (resolved question_ids/category_ids
   *  + its raw question_overrides), omitted from list/search/by-answer/
   *  by-category/related responses since they're bulky and unused there —
   *  fetch on demand when an edit modal needs them for one phrase. key is a
   *  SamplePhrase._key ("{sample}_{phrase_ref}"). */
  getPhraseLinks(key: string): Observable<{ question_ids: number[]; category_ids: number[]; question_overrides: { include: number[]; exclude: number[] } }> {
    return this.http.get<{ question_ids: number[]; category_ids: number[]; question_overrides: { include: number[]; exclude: number[] } }>(`${this.base_url}/phrases/${key}/links/`);
  }

  searchResearchQuestions(query: string): Observable<any[]> {
    if (!query || query.trim().length < 2) return of([]);
    return this.http.get<any[]>(`${this.base_url}/research-questions/search/?q=${encodeURIComponent(query.trim())}`);
  }

  getResearchQuestionsByIds(ids: number[]): Observable<any[]> {
    if (!ids || ids.length === 0) return of([]);
    return this.http.get<any[]>(`${this.base_url}/research-questions/batch/?ids=${ids.join(',')}`);
  }

  invalidatePhrasesCache(sampleRef: string): void {
    this.phrasesBySampleRef.delete(sampleRef);
  }

  getPhraseList(): Observable<PhraseListItem[]> {
    return this.http.get<PhraseListItem[]>(`${this.base_url}/phrases/list/`);
  }

  /** Phrases whose MasterPhrase naturally links to this category/question,
   *  ignoring any per-sample question_overrides entirely — the master-only
   *  baseline. Used by the Tables cell edit dialog to tell a naturally
   *  linked phrase apart from one only present via a question_overrides
   *  exception, which otherwise look identical once persisted (the
   *  exception applies unconditionally, so a plain by-category/related call
   *  can't distinguish them). */
  getMasterPhrasesByCategory(categoryId: number, sampleRef: string): Observable<PhraseListItem[]> {
    return this.http.get<PhraseListItem[]>(
      `${this.base_url}/phrases/by-category/?category_id=${categoryId}&sample=${encodeURIComponent(sampleRef)}&ignore_overrides=true`
    );
  }

  /** Every MasterPhrase, with this sample's Romani text where a SamplePhrase
   *  exists for it (phrase: null otherwise) — for pickers that need to show
   *  actual phrase text rather than just the English gloss. */
  getAllPhrasesForSample(sampleRef: string): Observable<PhraseListItem[]> {
    return this.http.get<PhraseListItem[]>(`${this.base_url}/phrases/all-for-sample/?sample=${encodeURIComponent(sampleRef)}`);
  }

  exportPhrases(query: string, sampleRefs?: string[], sort: string = 'phrase_ref', field: string = 'both', phraseRef?: string): Observable<any[]> {
    const body: any = { query, sort, field };
    if (sampleRefs && sampleRefs.length > 0) body.sample_refs = sampleRefs;
    if (phraseRef) body.phrase_ref = phraseRef;
    return this.http.post<any[]>(this.base_url + '/phrases/export/', body);
  }

  searchPhrases(query: string, sampleRefs?: string[], page: number = 1, sort: string = 'phrase_ref', field: string = 'both', phraseRef?: string): Observable<any> {
    const body: any = { query, page, sort, field };
    if (sampleRefs && sampleRefs.length > 0) body.sample_refs = sampleRefs;
    if (phraseRef) body.phrase_ref = phraseRef;
    return this.http.post(this.base_url + '/phrases/search/', body);
  }

  getBackups(): Observable<any> {
    return this.http.get(this.base_url + '/backups/');
  }

  createBackup(label: string = 'manual'): Observable<any> {
    return this.http.post(this.base_url + '/backups/', { label });
  }

  restoreBackup(id: string): Observable<any> {
    return this.http.post(`${this.base_url}/backups/${id}/restore/`, {});
  }

  deleteBackup(id: string): Observable<any> {
    return this.http.delete(`${this.base_url}/backups/${id}/`);
  }

  /** Combined phrases+transcriptions lookup for the "click a table cell"
   *  hot path — one request instead of two, and (when answerKey is given)
   *  one shared Answer lookup for both overrides checks instead of two.
   *  answerKey is optional; omit it when there's no answer in play (e.g.
   *  no phrase_overrides/transcription_overrides could apply). */
  getRelatedContent(categoryId: number, sample: string, answerKey?: string): Observable<{ phrases: any[]; transcriptions: any[] }> {
    let url = `${this.base_url}/related/?category_id=${categoryId}&sample=${encodeURIComponent(sample)}`;
    if (answerKey) url += `&answer_key=${encodeURIComponent(answerKey)}`;
    return this.http.get<{ phrases: any[]; transcriptions: any[] }>(url);
  }

  /** Distinct previously-entered values for a question+field across all
   *  samples, most-frequent first — backs the value-suggestion dropdown in
   *  the cell editor and search-criteria builder. */
  getAnswerSuggestions(questionId: number, field: string, query: string): Observable<AnswerSuggestion[]> {
    let url = `${this.base_url}/answers/suggestions/?question_id=${questionId}&field=${encodeURIComponent(field)}`;
    if (query) url += `&q=${encodeURIComponent(query)}`;
    return this.http.get<AnswerSuggestion[]>(url);
  }

  getTranscriptions(sampleRef: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base_url}/transcriptions/?sample=${sampleRef}`);
  }

  /** Cached variant of getTranscriptions. Multiple subscribers for the same
   *  sample share one HTTP request and its replayed result. */
  getTranscriptionsCached(sampleRef: string): Observable<any[]> {
    const existing = this.transcriptionsBySampleRef.get(sampleRef);
    if (existing) return existing;
    const stream = this.http.get<any[]>(`${this.base_url}/transcriptions/?sample=${sampleRef}`).pipe(
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.transcriptionsBySampleRef.set(sampleRef, stream);
    return stream;
  }

  patchAnswer(key: string, updates: Record<string, any>): Observable<any> {
    return this.http.patch(`${this.base_url}/answers/${key}/`, updates);
  }

  deleteAnswer(key: string): Observable<any> {
    return this.http.delete(`${this.base_url}/answers/${key}/`);
  }

  createAnswer(questionId: number, sample: string, field: string, value: string): Observable<any> {
    return this.http.put(`${this.base_url}/answers/create/`, { question_id: questionId, sample, field, value });
  }

  updateTranscription(key: string, payload: any): Observable<any> {
    return this.http.patch(`${this.base_url}/transcriptions/${key}/`, payload);
  }

  invalidateTranscriptionsCache(sampleRef: string): void {
    this.transcriptionsBySampleRef.delete(sampleRef);
  }

  searchTranscriptions(query: string, sampleRefs?: string[], page: number = 1, sort: string = 'segment_no', field: string = 'both'): Observable<any> {
    const body: any = { query, page, sort, field };
    if (sampleRefs && sampleRefs.length > 0) {
      body.sample_refs = sampleRefs;
    }
    return this.http.post(this.base_url + '/transcriptions/search/', body);
  }

  exportTranscriptions(query: string, sampleRefs?: string[], sort: string = 'segment_no', field: string = 'both'): Observable<any[]> {
    const body: any = { query, sort, field };
    if (sampleRefs && sampleRefs.length > 0) {
      body.sample_refs = sampleRefs;
    }
    return this.http.post<any[]>(this.base_url + '/transcriptions/export/', body);
  }

  getAnswers(questionIds: number[], sampleRefs?: string[], operator: 'AND' | 'OR' = 'OR'): Observable<any> {
    if (!questionIds || questionIds.length === 0) {
      throw new Error('At least one question ID is required');
    }

    const body: any = { question_ids: questionIds };
    if (sampleRefs && sampleRefs.length > 0) {
      body.sample_refs = sampleRefs;
    }
    if (operator === 'AND') {
      body.operator = 'AND';
    }

    return this.http.post(this.base_url + '/answers/', body);
  }

  searchAnswers(searchCriteria: SearchCriterion[], operator: 'AND' | 'OR' = 'OR'): Observable<any> {
    if (!searchCriteria || searchCriteria.length === 0) {
      throw new Error('At least one search criterion is required');
    }

    // Validate each search criterion
    for (const criterion of searchCriteria) {
      if (!criterion.questionId || !criterion.fieldName || criterion.value === undefined || criterion.value === null) {
        throw new Error('Each search criterion must have questionId, fieldName, and value');
      }
    }

    let url = this.base_url + '/answers/?';

    // Build search parameters: each criterion becomes search=questionId,fieldName,value
    searchCriteria.forEach(criterion => {
      const encodedValue = encodeURIComponent(criterion.value);
      url += `search=${criterion.questionId},${criterion.fieldName},${encodedValue}&`;
    });

    if (operator === 'AND') {
      url += 'operator=AND&';
    }

    // Remove trailing '&'
    url = url.slice(0, -1);

    return this.http.get(url);
  }


  getViews(): Observable<any> {
    return this.http.get(this.base_url + '/views/')
  }

  getViewByFilename(filename: string): Observable<any> {
    return this.http.get(this.base_url + '/views/?filename=' + encodeURIComponent(filename))
  }

  /** Cached variant: shares a single HTTP request per filename across subscribers. */
  getViewByFilenameCached(filename: string): Observable<any> {
    const existing = this.viewsByFilename.get(filename);
    if (existing) return existing;
    const stream = this.getViewByFilename(filename).pipe(
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.viewsByFilename.set(filename, stream);
    return stream;
  }

  getSamplesWithTranscriptions(): Observable<any> {
    return this.http.get(this.base_url + '/samples/with-transcriptions/')
  }

}
