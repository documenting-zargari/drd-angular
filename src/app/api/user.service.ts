import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class UserService {

  private api_url = `${environment.apiUrl}/users`
  private auth_url = `${environment.apiUrl}/api/token/`

  private loggedInSubject = new BehaviorSubject<boolean>(this.isLoggedIn())
  loggedIn$ = this.loggedInSubject.asObservable()

  constructor(private http: HttpClient) { }

  getUsers(): Observable<any> {
    return this.http.get(this.api_url+'/')
  }

  getUserById(id: any): Observable<any> {
    return this.http.get(`${this.api_url}/${id}`)
  }

  login(username: string, password: string): Observable<any> {
    return this.http.post(this.auth_url, { username, password })
  }

  saveToken(token: string): void {
    localStorage.setItem('authToken', token)
    this.loggedInSubject.next(true)
  }

  getToken(): string | null {
    return localStorage.getItem('authToken')
  }

  logout(): void {
    localStorage.removeItem('authToken')
    this.loggedInSubject.next(false)
  }

  isLoggedIn(): boolean {
    return !!this.getToken()
  }
}
