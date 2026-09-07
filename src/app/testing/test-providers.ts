import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

/**
 * Providers the CLI-generated "should create" specs need but don't declare:
 * HttpClient (dropped from the default test injector in Angular 15+, and most
 * of our components pull it in transitively via DataService / UserService) and
 * a stub Router for templates that use routerLink / ActivatedRoute.
 *
 * Usage:  TestBed.configureTestingModule({ imports: [Foo], providers: [...commonTestProviders()] })
 */
export function commonTestProviders() {
  return [provideHttpClient(), provideHttpClientTesting(), provideRouter([])];
}
