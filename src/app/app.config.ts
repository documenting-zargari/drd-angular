import { ApplicationConfig, provideZoneChangeDetection, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';

export function initializeApp() {
  return () => {
    return new Promise<void>((resolve) => {
      // Load external config file
      fetch('/assets/config.json')
        .then(response => response.json())
        .then(config => {
          // Replace environment variables with config values
          if (config.apiUrl) {
            environment.apiUrl = config.apiUrl;
          }
          resolve();
        })
        .catch(() => {
          console.warn('Could not load external config, using defaults');
          resolve();
        });
    });
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }), 
    provideRouter(routes),
    provideHttpClient(),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeApp,
      multi: true
    }
  ],
};
