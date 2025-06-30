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
    return this.http.get(this.base_url + '/categories') // retrieves top categories
  }

  getCategoryById(id: any): Observable<any> {
    return this.http.get(this.base_url + '/categories/' + id)
  }

  searchCategories(searchString: string): Observable<any> {
    if (!searchString || searchString.trim() === '' || searchString.trim().length < 2) {
      return of([]); // return empty array if search string is empty
    }
    console.log('Calling the endpoint for categories with:', searchString);
    return this.http.get(this.base_url + '/categories/search?q=' + searchString)
  }

  getChildCategories(parent: any): Observable<any> {
    return this.http.get(this.base_url + '/categories/?parent_id=' + parent)
  }

  getSamples(): Observable<any>{
    return this.http.get(this.base_url + '/samples')
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
    return this.http.get(this.base_url + '/phrases/' + sampleId)
  }

  getTranscriptions(sampleId: any): Observable<any> {
    return of([])
  }

  getAnswers(questionId: any, sampleId: any): Observable<any> {
    var url = this.base_url + '/answers/' + questionId + "/"
    if (sampleId) {
      url += '?sample=' + sampleId
    }
    return this.http.get(url)
  }

}
