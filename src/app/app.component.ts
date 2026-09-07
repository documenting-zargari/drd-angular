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
  sessionExpired = false;
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
          // Bootstrap modals are opened imperatively in several routed
          // components (search, phrases, transcriptions, ...) but their JS
          // instances are not disposed when Angular tears the component down
          // on navigation. A modal that was open — or mid-transition — at
          // that moment leaves its <div class="modal-backdrop"> attached to
          // <body> (which is outside Angular's view tree), plus body.modal-open
          // and the scroll-lock inline styles. The orphaned backdrop is
          // position:fixed over the whole viewport and silently swallows every
          // click on the next page. Clear any such leftovers on a real path
          // change, unless a modal is genuinely still visible.
          this.clearOrphanedModalState();
        }
        this.activeRoute = path;
      });

    this.userService.loggedIn$.subscribe((status) => {
      this.isLoggedIn = status;
      this.isAdmin = status ? this.userService.isAdmin() : false;
      const info = status ? this.userService.getUserInfo() : null;
      this.userName = info?.name || info?.username || '';
    });

    this.userService.sessionExpired$.subscribe((expired) => {
      this.sessionExpired = expired;
    });
  }

  dismissSessionExpired() {
    this.userService.acknowledgeSessionExpired();
  }

  /** Remove Bootstrap modal leftovers stranded on <body> after a component
   *  that owned a modal was destroyed by navigation. No-op when a modal is
   *  still on screen. */
  private clearOrphanedModalState(): void {
    if (document.querySelector('.modal.show')) return;
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
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
