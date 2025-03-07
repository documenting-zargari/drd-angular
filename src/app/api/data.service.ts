import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
@Injectable({
  providedIn: 'root'
})
export class DataService {

  base_url = 'http://localhost:8000';

  constructor(private http: HttpClient) { }

  getCategories(): Observable<any> {
    return this.http.get(this.base_url + '/categories')
  }

  getChildCategories(parent: any): Observable<any> {
    return this.http.get(this.base_url + '/categories?parent=' + parent)
  }

  getSamples(): Observable<any>{
    return this.http.get(this.base_url + '/dialects')
  }

  getSampleById(id: any): Observable <any> {
    return this.http.get(this.base_url + '/samples/' + id)
  }

  getCountryInfo(code: string): Observable<any> {
    return this.http.post("https://aaapis.com/api/v1/info/country/", { country: code }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Token ${environment.countryApiToken}`
      }})
  }

  getPhrases(sampleId: any): Observable<any> {
    return this.http.get(this.base_url + '/phrases/' + sampleId)
  }
}
