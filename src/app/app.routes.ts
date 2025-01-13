import { Routes } from '@angular/router';
import { UsersComponent } from './users/users.component';
import { DataComponent } from './data/data.component';
import { CategoriesComponent } from './categories/categories.component';

export const routes: Routes = [
    { path: 'users', component: UsersComponent },
    { path: 'users/:id', component: UsersComponent },
    { path: 'data', component: DataComponent },
    { path: 'categories', component: CategoriesComponent },
  ]
  