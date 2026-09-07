import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ProjectRole {
  project: string;
  role: 'viewer' | 'editor' | 'admin';
  allowed_samples: string[];
}

export interface UserInfo {
  user_id: number;
  username: string;
  email: string;
  name: string;
  is_global_admin: boolean;
  show_hidden_samples: boolean;
  project_roles: ProjectRole[];
}

export interface UserDetail {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  name: string;
  is_global_admin: boolean;
  show_hidden_samples: boolean;
  project_roles: ProjectRole[];
}

export interface UserWriteData {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_global_admin: boolean;
  show_hidden_samples?: boolean;
  password?: string;
  project_roles?: { project: string; role: string; allowed_samples?: string[] }[];
}

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private api_url = `${environment.apiUrl}/users`;
  private auth_url = `${environment.apiUrl}/api/token/`;
  private logout_url = `${environment.apiUrl}/api/logout/`;

  private loggedInSubject = new BehaviorSubject<boolean>(this.isLoggedIn());
  loggedIn$ = this.loggedInSubject.asObservable();

  // Fired when authInterceptor discovers our stored token is no longer
  // valid server-side (401 on a token'd request) and clears it. Distinct
  // from a plain logout so the UI can explain *why* the user was signed
  // out instead of silently dropping them to "logged out" state.
  private sessionExpiredSubject = new BehaviorSubject<boolean>(false);
  sessionExpired$ = this.sessionExpiredSubject.asObservable();

  private userInfoSubject = new BehaviorSubject<UserInfo | null>(this.loadUserInfo());
  userInfo$ = this.userInfoSubject.asObservable();

  constructor(private http: HttpClient) {}

  getUsers(): Observable<UserDetail[]> {
    return this.http.get<UserDetail[]>(this.api_url + '/');
  }

  getUserById(id: number): Observable<UserDetail> {
    return this.http.get<UserDetail>(`${this.api_url}/${id}/`);
  }

  getMe(): Observable<UserDetail> {
    return this.http.get<UserDetail>(`${this.api_url}/me/`);
  }

  createUser(data: UserWriteData): Observable<UserDetail> {
    return this.http.post<UserDetail>(this.api_url + '/', data);
  }

  updateUser(id: number, data: Partial<UserWriteData>): Observable<UserDetail> {
    return this.http.patch<UserDetail>(`${this.api_url}/${id}/`, data);
  }

  deleteUser(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api_url}/${id}/`);
  }

  changePassword(oldPassword: string, newPassword: string): Observable<{ token: string; message: string }> {
    return this.http.post<{ token: string; message: string }>(`${this.api_url}/me/change-password/`, {
      old_password: oldPassword,
      new_password: newPassword,
    }).pipe(
      tap((response) => {
        this.saveToken(response.token);
      })
    );
  }

  login(username: string, password: string): Observable<any> {
    return this.http.post(this.auth_url, { username, password }).pipe(
      tap((response: any) => {
        const userInfo: UserInfo = {
          user_id: response.id,
          username: response.username,
          email: response.email,
          name: response.name,
          is_global_admin: response.is_global_admin,
          show_hidden_samples: !!response.show_hidden_samples,
          project_roles: response.project_roles || [],
        };
        localStorage.setItem('userInfo', JSON.stringify(userInfo));
        this.userInfoSubject.next(userInfo);
        // Save token after userInfo so loggedIn$ subscribers can read the role
        this.saveToken(response.token);
        this.sessionExpiredSubject.next(false);
      })
    );
  }

  saveToken(token: string): void {
    localStorage.setItem('authToken', token);
    this.loggedInSubject.next(true);
  }

  getToken(): string | null {
    return localStorage.getItem('authToken');
  }

  logout(): void {
    const token = this.getToken();
    if (token) {
      this.http.post(this.logout_url, {}).subscribe({
        complete: () => {},
        error: () => {},
      });
    }
    localStorage.removeItem('authToken');
    localStorage.removeItem('userInfo');
    this.loggedInSubject.next(false);
    this.userInfoSubject.next(null);
  }

  /** Client-side-only session clear for when the server has already
   *  rejected our token as invalid/expired (401) — no server round-trip
   *  needed, unlike logout(), since the token is already dead server-side.
   *  Called from authInterceptor; also surfaces sessionExpired$ so the UI
   *  can tell the user why they were signed out. */
  clearInvalidToken(): void {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userInfo');
    this.loggedInSubject.next(false);
    this.userInfoSubject.next(null);
    this.sessionExpiredSubject.next(true);
  }

  /** Dismiss the "your session expired" notice once the UI has shown it. */
  acknowledgeSessionExpired(): void {
    this.sessionExpiredSubject.next(false);
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  getUserInfo(): UserInfo | null {
    return this.userInfoSubject.value;
  }

  getRoleForProject(project: string = 'rlb'): string | null {
    const info = this.getUserInfo();
    if (!info) return null;
    if (info.is_global_admin) return 'admin';
    const pr = info.project_roles.find((r) => r.project === project);
    return pr ? pr.role : null;
  }

  isAdmin(project: string = 'rlb'): boolean {
    return this.getRoleForProject(project) === 'admin';
  }

  /** True global admin (meta-editor territory: MasterPhrase/hierarchy edits
   *  that affect every sample of a phrase at once) — stricter than
   *  project-scoped isAdmin(). */
  isGlobalAdmin(): boolean {
    return !!this.getUserInfo()?.is_global_admin;
  }

  isEditor(project: string = 'rlb'): boolean {
    const role = this.getRoleForProject(project);
    return role === 'editor' || role === 'admin';
  }

  canEditSample(sampleRef: string, project: string = 'rlb'): boolean {
    if (!this.isEditor(project)) return false;
    if (this.isAdmin(project)) return true;
    const info = this.getUserInfo();
    if (!info) return false;
    const pr = info.project_roles.find((r) => r.project === project);
    if (!pr || !pr.allowed_samples || pr.allowed_samples.length === 0) return true;
    return pr.allowed_samples.includes(sampleRef);
  }

  /** Refresh the cached userInfo from the server */
  refreshUserInfo(): void {
    this.getMe().subscribe((user) => {
      this.cacheUserInfo(user);
    });
  }

  private cacheUserInfo(user: UserDetail): UserInfo {
    const userInfo: UserInfo = {
      user_id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      is_global_admin: user.is_global_admin,
      show_hidden_samples: !!user.show_hidden_samples,
      project_roles: user.project_roles || [],
    };
    localStorage.setItem('userInfo', JSON.stringify(userInfo));
    this.userInfoSubject.next(userInfo);
    return userInfo;
  }

  showsHiddenSamples(): boolean {
    const info = this.getUserInfo();
    return !!(info?.is_global_admin && info?.show_hidden_samples);
  }

  setShowHiddenSamples(enabled: boolean): Observable<UserDetail> {
    const info = this.getUserInfo();
    if (!info) {
      throw new Error('Not logged in');
    }
    return this.updateUser(info.user_id, { show_hidden_samples: enabled }).pipe(
      tap((user) => this.cacheUserInfo(user))
    );
  }

  private loadUserInfo(): UserInfo | null {
    const stored = localStorage.getItem('userInfo');
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
}
