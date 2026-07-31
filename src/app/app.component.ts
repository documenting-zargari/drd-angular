import { Component } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { filter } from 'rxjs/operators';
import { UserService } from './api/user.service';
import { DataService } from './api/data.service';
import { PageTitleService } from './api/page-title.service';
import { SearchStateService } from './api/search-state.service';
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
    private route: ActivatedRoute,
    private viewportScroller: ViewportScroller,
    private searchStateService: SearchStateService,
    // Injected only to instantiate the root singleton eagerly, so its
    // NavigationEnd subscription (which sets the tab title) starts at boot.
    private pageTitleService: PageTitleService,
  ) {
    // Seed the synchronous "current sample" record from the initial URL, so
    // MergeLinkDirective has a race-free value to carry across navigations
    // from the very first click — see merge-link.directive.ts.
    const initialSample = this.route.snapshot.queryParamMap.get('sample');
    if (initialSample) {
      this.searchStateService.setCurrentSample({ sample_ref: initialSample });
    }

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
    // Local-state-only signal (see DataService.tablesReset$) — [mergeLink]
    // on this same link handles the actual navigation.
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
