import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class UsersService {

  private api_url = 'http://localhost:8000/users';

  constructor(private http: HttpClient) { }

  getUsers(): Observable<any> {
    return this.http.get(this.api_url+'/');
  }

  getUserById(id: any): Observable<any> {
    return this.http.get(`${this.api_url}/${id}`);
  }
}
