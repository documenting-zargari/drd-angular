import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { AuthGuard } from './auth.guard'
import { PhrasesComponent } from './phrases/phrases.component';

export const routes: Routes = [
  {
    path: 'users/me',
    loadComponent: () => import('./users/users.component').then(m => m.UsersComponent),
    canActivate: [AuthGuard],
    data: { title: 'Users' },
  },
  {
    path: 'users',
    loadComponent: () => import('./users/users.component').then(m => m.UsersComponent),
    canActivate: [AuthGuard],
    data: { requiredRole: 'admin', title: 'Users' }
  },
  {
    path: 'users/:id',
    loadComponent: () => import('./users/users.component').then(m => m.UsersComponent),
    canActivate: [AuthGuard],
    data: { requiredRole: 'admin', title: 'Users' }
  },
  {
    path: 'samples',
    loadComponent: () => import('./pages/samples-page/samples-page.component').then(m => m.SamplesPageComponent),
    data: { title: 'Samples' }
  },
  {
    path: 'samples/import',
    loadComponent: () => import('./samples/sample-import/sample-import.component').then(m => m.SampleImportComponent),
    canActivate: [AuthGuard],
    data: { requiredRole: 'admin', title: 'Import Sample' },
  },
  {
    path: 'samples/:id',
    loadComponent: () => import('./samples/sample-detail/sample-detail.component').then(m => m.SampleDetailComponent),
    data: { title: 'Sample' }
  },
  {
    path: 'categories',
    loadComponent: () => import('./categories/categories.component').then(m => m.CategoriesComponent),
    data: { title: 'Categories' }
  },
  {
    path: 'home',
    component: HomeComponent,
    data: { title: 'Home' }
  },
  {
    path: 'map',
    loadComponent: () => import('./pages/map/map.component').then(m => m.MapComponent),
    data: { title: 'Map' }
  },
  {
    path: 'search',
    loadComponent: () => import('./pages/search-page/search-page.component').then(m => m.SearchPageComponent),
    data: { title: 'Search' }
  },
  {
    path: 'tables',
    loadComponent: () => import('./tables/tables.component').then(m => m.TablesComponent),
    data: { title: 'Tables' }
  },
  { path: 'phrases', component: PhrasesComponent, data: { title: 'Phrases' } },
  {
    path: 'phrases/:sample',
    redirectTo: (route) =>
      inject(Router).createUrlTree(['/phrases'], {
        queryParams: { sample: route.params['sample'] },
      }),
    pathMatch: 'full',
  },
  {
    path: 'transcriptions',
    loadComponent: () => import('./pages/transcriptions/transcriptions.component').then(m => m.TranscriptionsComponent),
    data: { title: 'Transcriptions' }
  },
  {
    path: 'concordance',
    loadComponent: () => import('./pages/concordance/concordance.component').then(m => m.ConcordanceComponent),
    data: { title: 'Concordance' }
  },
  {
    path: 'transcriptions/:sample',
    redirectTo: (route) =>
      inject(Router).createUrlTree(['/transcriptions'], {
        queryParams: { sample: route.params['sample'] },
      }),
    pathMatch: 'full',
  },
  {
    path: 'login',
    loadComponent: () => import('./login/login.component').then(m => m.LoginComponent),
    data: { title: 'Login' }
  },
  {
    path: 'about/aims',
    loadComponent: () => import('./pages/about/about.component').then(m => m.AboutComponent),
    data: { title: 'About' }
  },
  {
    path: 'about/structure',
    loadComponent: () => import('./pages/about/about.component').then(m => m.AboutComponent),
    data: { title: 'About' }
  },
  {
    path: 'about/background',
    loadComponent: () => import('./pages/about/about.component').then(m => m.AboutComponent),
    data: { title: 'About' }
  },
  {
    path: 'about',
    redirectTo: 'about/aims',
    pathMatch: 'full'
  },
  {
    path: 'help',
    loadComponent: () => import('./pages/help/help.component').then(m => m.HelpComponent),
    data: { title: 'Help' }
  },
  {
    path: 'imprint',
    loadComponent: () => import('./pages/legal-page/legal-page.component').then(m => m.LegalPageComponent),
    data: { title: 'Legal' }
  },
  {
    path: 'data-protection',
    loadComponent: () => import('./pages/legal-page/legal-page.component').then(m => m.LegalPageComponent),
    data: { title: 'Legal' }
  },
  {
    path: 'privacy-settings',
    loadComponent: () => import('./pages/legal-page/legal-page.component').then(m => m.LegalPageComponent),
    data: { title: 'Legal' }
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full'
  }
];
  