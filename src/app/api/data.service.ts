import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class DataService {

  base_url = 'http://localhost:8000/data';

  constructor(private http: HttpClient) { }

  getCategories(): Observable<any> {
    return this.http.get(this.base_url + '/categories')
  }

  getChildCategories(parent: any): Observable<any> {
    return this.http.get(this.base_url + '/categories?parent=' + parent)
  }

  getSamples(): Observable<any>{
    return this.http.get(this.base_url + '/samples')
  }

  getSampleById(id: any): Observable <any> {
    return this.http.get(this.base_url + '/samples/' + id)
  }
}
