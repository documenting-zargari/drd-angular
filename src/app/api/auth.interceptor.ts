import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Only add auth headers to requests going to our own API
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }
  const token = localStorage.getItem('authToken');
  if (token) {
    req = req.clone({
      setHeaders: {
        Authorization: `Token ${token}`,
        'X-Project': 'rlb',
      },
    });
  }
  return next(req);
};
