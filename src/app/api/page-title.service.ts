import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

const DEFAULT_TITLE = 'Romani MS Database';

/** Keeps the browser tab title distinguishable across navigations, so
 *  history/back-forward entries can be told apart. Resets to the current
 *  route's `data.title` only on a genuine path change — query-param-only
 *  navigations (most of this app's state) leave the title alone, since
 *  ActivatedRoute param subscriptions resolve before NavigationEnd fires
 *  and would otherwise race with a component's own setDetail() call. */
@Injectable({ providedIn: 'root' })
export class PageTitleService {
  private readonly titleService = inject(Title);
  private readonly router = inject(Router);
  private baseTitle = DEFAULT_TITLE;
  private lastPath = '';

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        const path = e.urlAfterRedirects.split('?')[0];
        if (path === this.lastPath) return;
        this.lastPath = path;
        this.baseTitle = this.readRouteTitle() ?? DEFAULT_TITLE;
        this.titleService.setTitle(this.baseTitle);
      });
  }

  private readRouteTitle(): string | undefined {
    let route: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;
    let title: string | undefined;
    while (route) {
      if (route.data?.['title']) title = route.data['title'];
      route = route.firstChild;
    }
    return title;
  }

  setDetail(detail?: string | null): void {
    this.titleService.setTitle(detail ? `${this.baseTitle}: ${detail}` : this.baseTitle);
  }
}
