import { Component } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { UserService } from './api/user.service';
import { DataService } from './api/data.service';
import { MergeLinkDirective } from './shared/merge-link.directive';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MergeLinkDirective,
    CommonModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  isLoggedIn = false;
  isAdmin = false;
  userName = '';
  title = 'roma-client';
  activeRoute = '';

  constructor(
    private userService: UserService,
    private dataService: DataService,
    private router: Router,
  ) {
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: NavigationEnd) => {
        this.activeRoute = e.urlAfterRedirects.split('?')[0];
      });

    this.userService.loggedIn$.subscribe((status) => {
      this.isLoggedIn = status;
      this.isAdmin = status ? this.userService.isAdmin() : false;
      const info = status ? this.userService.getUserInfo() : null;
      this.userName = info?.name || info?.username || '';
    });
  }

  isActive(path: string): boolean {
    return this.activeRoute.startsWith(path);
  }

  onTablesClick() {
    this.dataService.resetTablesView();
    this.collapseNavbar();
  }

  logout() {
    this.userService.logout();
    this.collapseNavbar();
    this.router.navigate(['home']);
  }

  collapseNavbar() {
    const navbarCollapse = document.getElementById('navbarSupportedContent');
    if (navbarCollapse && navbarCollapse.classList.contains('show')) {
      navbarCollapse.classList.remove('show');
    }
  }
}
