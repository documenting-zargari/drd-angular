import { Routes } from '@angular/router';
import { UsersComponent } from './users/users.component';
import { DataComponent } from './data/data.component';

export const routes: Routes = [
    { path: 'users', component: UsersComponent },
    { path: 'data', component: DataComponent },
  ]
  