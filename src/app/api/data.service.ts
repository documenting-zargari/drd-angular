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

  getChildCategories(parent: any): Observable<any> {
    return this.http.get(this.base_url + '/categories/parent_id=' + parent)
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

}
