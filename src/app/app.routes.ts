import { Routes } from '@angular/router';
import { UsersComponent } from './users/users.component';
import { DataComponent } from './data/data.component';
import { CategoriesComponent } from './categories/categories.component';
import { HomeComponent } from './pages/home/home.component';
import { BrowseComponent } from './pages/browse/browse.component';
import { TranscriptionsComponent } from './pages/transcriptions/transcriptions.component';
import { LoginComponent } from './login/login.component';
import { HelpComponent } from './pages/help/help.component';
import { AuthGuard } from './auth.guard'
import { SamplesListComponent } from './samples/samples-list/samples-list.component';
import { SampleDetailComponent } from './samples/sample-detail/sample-detail.component';

export const routes: Routes = [
    { path: 'users', component: UsersComponent, canActivate: [AuthGuard] },
    { path: 'users/:id', component: UsersComponent },
    { path: 'data', component: DataComponent },
    { path: 'samples', component: SamplesListComponent },
    { path: 'samples/:id', component: SampleDetailComponent },
    { path: 'categories', component: CategoriesComponent },
    { path: 'home', component: HomeComponent },
    { path: 'search', component: CategoriesComponent },
    { path: 'browse', component: BrowseComponent },
    { path: 'transcriptions', component: TranscriptionsComponent },
    { path: 'login', component: LoginComponent },
    { path: 'help', component: HelpComponent },
  ]
  