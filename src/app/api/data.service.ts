import { environment } from '../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of, Subject } from 'rxjs';
import { map } from 'rxjs/operators';

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
  searchString: string;              // JSON representation
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
  private tablesResetSubject = new Subject<void>();
  tablesReset$ = this.tablesResetSubject.asObservable();

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
    return this.http.get<any[]>(this.base_url + '/samples/').pipe(
      map((samples: any[]) => samples.map(sample => ({
        ...sample,
        dialect_name: sample.dialect_name?.replace(/transcriptions/gi, 'connected speech')
      })))
    );
  }

  getSampleById(id: any): Observable <any> {
    return this.http.get(this.base_url + '/samples/' + id)
  }

  getCountryInfo(code: string): Observable<any> {
    return this.http.post(`${environment.countryApiUrl}`, { country: code }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Token ${environment.countryApiToken}`
      }})
  }

  getPhrases(sampleId: any): Observable<any> {
    return this.http.get(this.base_url + '/phrases/?sample=' + sampleId)
  }

  getPhrasesByAnswer(answerId: any): Observable<any> {
    return this.http.get(this.base_url + '/phrases/by-answer/?answer_key=' + answerId)
  }

  getTranscriptionsByAnswer(answerId: any): Observable<any> {
    return this.http.get(this.base_url + '/transcriptions/by-answer/?answer_key=' + answerId)
  }

  getTranscriptions(sampleRef: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base_url}/transcriptions/?sample=${sampleRef}`);
  }

  getAnswers(questionIds: number[], sampleRefs?: string[]): Observable<any> {
    if (!questionIds || questionIds.length === 0) {
      throw new Error('At least one question ID is required');
    }

    const body: any = { question_ids: questionIds };
    if (sampleRefs && sampleRefs.length > 0) {
      body.sample_refs = sampleRefs;
    }

    return this.http.post(this.base_url + '/answers/', body);
  }

  searchAnswers(searchCriteria: SearchCriterion[]): Observable<any> {
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
      // URL encode the value to handle special characters
      const encodedValue = encodeURIComponent(criterion.value);
      url += `search=${criterion.questionId},${criterion.fieldName},${encodedValue}&`;
    });
    
    // Remove trailing '&'
    url = url.slice(0, -1);
    
    return this.http.get(url);
  }


  getViews(): Observable<any> {
    return this.http.get(this.base_url + '/views/')
  }

  getSamplesWithTranscriptions(): Observable<any> {
    return this.http.get(this.base_url + '/samples/with-transcriptions/')
  }

}
