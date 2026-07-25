import { Component } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ViewportScroller } from '@angular/common';
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
    private viewportScroller: ViewportScroller,
  ) {
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: NavigationEnd) => {
        const path = e.urlAfterRedirects.split('?')[0];
        // Router config has no scroll restoration (see app.config.ts), so we
        // scroll to top ourselves — but only on a real path change. Views
        // that patch query params in place (e.g. tables' `expand` toggle)
        // stay on the same path and must not be scrolled.
        if (path !== this.activeRoute) {
          this.viewportScroller.scrollToPosition([0, 0]);
        }
        this.activeRoute = path;
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
