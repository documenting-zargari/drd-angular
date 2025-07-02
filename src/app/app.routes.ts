import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { AuthGuard } from './auth.guard'
import { PhrasesComponent } from './phrases/phrases.component';

export const routes: Routes = [
  { 
    path: 'users', 
    loadComponent: () => import('./users/users.component').then(m => m.UsersComponent), 
    canActivate: [AuthGuard] 
  },
  { 
    path: 'users/:id', 
    loadComponent: () => import('./users/users.component').then(m => m.UsersComponent),
    canActivate: [AuthGuard] 
  },
  { 
    path: 'data', 
    loadComponent: () => import('./data/data.component').then(m => m.DataComponent) 
  },
  { 
    path: 'samples', 
    loadComponent: () => import('./pages/samples-page/samples-page.component').then(m => m.SamplesPageComponent) 
  },
  { 
    path: 'samples/:id', 
    loadComponent: () => import('./samples/sample-detail/sample-detail.component').then(m => m.SampleDetailComponent) 
  },
  { 
    path: 'categories', 
    loadComponent: () => import('./categories/categories.component').then(m => m.CategoriesComponent) 
  },
  { 
    path: 'home', 
    component: HomeComponent,
  },
  { 
    path: 'search', 
    loadComponent: () => import('./search/search.component').then(m => m.SearchComponent) 
  },
  { 
    path: 'views', 
    loadComponent: () => import('./views/views.component').then(m => m.ViewsComponent) 
  },
  { 
    path: 'tables', 
    loadComponent: () => import('./tables/tables.component').then(m => m.TablesComponent) 
  },
  { path: 'phrases', component: PhrasesComponent },
  { path: 'phrases/:sample', component: PhrasesComponent },
  { 
    path: 'transcriptions', 
    loadComponent: () => import('./pages/transcriptions/transcriptions.component').then(m => m.TranscriptionsComponent) 
  },
  {
    path: 'transcriptions/:sample',
    loadComponent: () => import('./pages/transcriptions/transcriptions.component').then(m => m.TranscriptionsComponent)
  },
  { 
    path: 'login', 
    loadComponent: () => import('./login/login.component').then(m => m.LoginComponent) 
  },
  { 
    path: 'help', 
    loadComponent: () => import('./pages/help/help.component').then(m => m.HelpComponent) 
  },
  { 
    path: '', 
    redirectTo: 'home', 
    pathMatch: 'full' 
  }
];
  