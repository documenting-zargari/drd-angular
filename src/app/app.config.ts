import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withRouterConfig,
} from '@angular/router';

import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './api/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      // No withInMemoryScrolling: it scrolls to top on every navigation,
      // including query-param-only patches (e.g. tables' `expand` toggle),
      // which yanks the viewport away from what the user just clicked.
      // AppComponent scrolls to top itself, only on real path changes.
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
      withComponentInputBinding(),
    ),
    provideHttpClient(withInterceptors([authInterceptor]))
  ],
};
