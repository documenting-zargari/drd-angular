import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { environment } from '../../environments/environment';
@Injectable({
  providedIn: 'root'
})
export class DataService {

  base_url = environment.apiUrl;

  constructor(private http: HttpClient) { }

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

  getChildCategories(parent: any): Observable<any> {
    return this.http.get(this.base_url + '/categories/?parent_id=' + parent)
  }

  getSamples(): Observable<any>{
    return this.http.get(this.base_url + '/samples/')
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

  getTranscriptions(sampleRef: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base_url}/transcriptions/?sample=${sampleRef}`);
  }

  getAnswers(questionIds: number[], sampleRefs?: string[]): Observable<any> {
    if (!questionIds || questionIds.length === 0) {
      throw new Error('At least one question ID is required');
    }
    
    let url = this.base_url + '/answers/?';
    
    // Add question IDs (required)
    questionIds.forEach(id => {
      url += 'q=' + id + '&';
    });
    
    // Add sample references (optional)
    if (sampleRefs && sampleRefs.length > 0) {
      sampleRefs.forEach(ref => {
        url += 's=' + ref + '&';
      });
    }
    
    // Remove trailing '&'
    url = url.slice(0, -1);
    
    return this.http.get(url)
  }


  getViews(): Observable<any> {
    return this.http.get(this.base_url + '/views/')
  }

  getSamplesWithTranscriptions(): Observable<any> {
    return this.http.get(this.base_url + '/samples/with-transcriptions/')
  }

}
