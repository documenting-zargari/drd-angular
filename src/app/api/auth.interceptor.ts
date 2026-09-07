import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Only add auth headers to requests going to our own API
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }

  // inject() must run synchronously in the interceptor's own call frame —
  // captured here so it's available inside the async catchError below.
  const userService = inject(UserService);

  const token = localStorage.getItem('authToken');
  const authedReq = token
    ? req.clone({ setHeaders: { Authorization: `Token ${token}`, 'X-Project': 'rlb' } })
    : req.clone({ setHeaders: { 'X-Project': 'rlb' } });

  return next(authedReq).pipe(
    catchError((err: unknown) => {
      // A 401 with a token attached means the stored token is stale/invalid
      // (most endpoints are AllowAny server-side, but DRF's TokenAuthentication
      // rejects an unrecognized token before permission checks even run — so
      // an expired token actively breaks access an anonymous request would
      // have been granted). Clear it either way, so the app stops presenting
      // as "logged in" and the session-expired banner shows. A 401 with no
      // token was a real "login required" — nothing to clear, just surface it.
      if (token && err instanceof HttpErrorResponse && err.status === 401) {
        userService.clearInvalidToken();

        // Only auto-retry safe, idempotent reads (GET/HEAD/OPTIONS) — most
        // endpoints are AllowAny, so an anonymous retry recovers public data
        // transparently. Never silently re-fire a write (POST/PATCH/DELETE)
        // unauthenticated: on an AllowAny-with-optional-auth endpoint that
        // could submit the mutation anonymously, silently dropping the
        // user's attribution instead of failing loudly.
        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
          return next(req.clone({ setHeaders: { 'X-Project': 'rlb' } }));
        }
      }
      return throwError(() => err);
    }),
  );
};
