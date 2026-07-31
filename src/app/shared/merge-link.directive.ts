import { Directive, HostBinding, HostListener, Input, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SearchStateService } from '../api/search-state.service';

/**
 * [mergeLink] — navigate like `routerLink` but carry only an allowlist of
 * query params across the view boundary.
 *
 * The global nav-bar must strip view-local params (q, page, cat, etc.) when
 * moving between views — otherwise they leak and trigger unwanted refetches.
 * Plain `queryParamsHandling: 'merge'` inherits everything, which is the
 * wrong default for cross-view nav.
 *
 * This directive merges only keys in `propagate` (default: ['sample']).
 *
 * Usage:
 *   <a [mergeLink]="['/transcriptions']">Transcriptions</a>
 *   <a [mergeLink]="['/search']" [mergeLinkPatch]="{ searches: encodedSearches }">Search</a>
 */
@Directive({
  selector: '[mergeLink]',
  standalone: true,
})
export class MergeLinkDirective {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly searchStateService = inject(SearchStateService);

  @Input({ required: true, alias: 'mergeLink' })
  commands: unknown[] = [];

  /** Query-param keys carried across the nav. Default: ['sample']. */
  @Input('mergeLinkPropagate')
  propagate: string[] = ['sample'];

  /** Extra query params to merge on top of the propagated ones. */
  @Input('mergeLinkPatch')
  patch: Record<string, string | number | boolean | null | undefined> = {};

  @HostBinding('attr.href') readonly href = '';

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): boolean {
    // Let the browser handle modified clicks (cmd/ctrl/shift/middle-click).
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return true;
    }
    event.preventDefault();
    const snap = this.route.snapshot.queryParamMap;
    const carried: Record<string, string> = {};
    for (const key of this.propagate) {
      // `sample` is read from the synchronous, race-free SearchStateService
      // (seeded from the URL once at app boot in AppComponent, then kept in
      // sync by every select/clear) rather than the route snapshot: the
      // snapshot only updates once a navigation fully resolves, so a click
      // that follows a sample-select patch too quickly would otherwise read
      // a stale/pre-patch value.
      const v = key === 'sample'
        ? (this.searchStateService.getCurrentSample()?.sample_ref ?? null)
        : snap.get(key);
      if (v != null && v !== '') carried[key] = v;
    }
    const extra: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(this.patch)) {
      if (v === null || v === undefined || v === '') extra[k] = null;
      else if (typeof v === 'boolean') extra[k] = v ? '1' : null;
      else extra[k] = String(v);
    }
    this.router.navigate(this.commands as any[], {
      queryParams: { ...carried, ...extra },
    });
    return false;
  }
}
