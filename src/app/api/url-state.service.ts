import { Injectable, inject } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

/**
 * UrlStateService — transport layer for URL-as-source-of-truth view state.
 *
 * Semantic parsing (e.g. "what mode=foo means for phrases") belongs in the
 * view's own vm$ pipe. This service only moves data in and out of query
 * params; views own the meaning.
 *
 * Param naming convention (used across the app):
 *   sample      active sample ref — propagates cross-view
 *   qid         opaque key for large payloads in LargePayloadStore — propagates
 *   q           free-text filter
 *   page        1-indexed pagination
 *   mode        view-local mode (e.g. browse/search)
 *   view        display mode or table view id
 *   cat / cats  single / multi category id(s)
 *   samples     multi-sample CSV
 *   sort        sort column
 *   sortDir     asc/desc
 *   field       search field selector
 *   pub, migrant    boolean filters
 *   lat, lng, zoom  map viewport
 *   expand      CSV of expanded category IDs
 */

export type PatchValue = string | number | boolean | null | undefined;
export type PatchMap = Record<string, PatchValue>;

export interface PatchOpts {
  /** Replace current history entry instead of pushing a new one. Default: true. */
  replaceUrl?: boolean;
  preserveFragment?: boolean;
  /** Attach payload to history.state (used with LargePayloadStore for instant back/forward). */
  stateSnapshot?: unknown;
}

export interface NavigateMergeOpts {
  replaceUrl?: boolean;
  /** Query-param keys allowed to carry across view boundary. Default: ['sample','qid']. */
  propagate?: string[];
}

@Injectable({ providedIn: 'root' })
export class UrlStateService {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Raw stream of current query params. */
  readonly params$: Observable<ParamMap> = this.route.queryParamMap;

  /** Imperative snapshot of current query params. */
  snapshot(): ParamMap {
    return this.route.snapshot.queryParamMap;
  }

  /**
   * Observe one query-param key, transformed to a typed value.
   * Emits on distinct changes of the parsed value.
   */
  select<T>(key: string, parse: (raw: string | null) => T): Observable<T> {
    return this.params$.pipe(
      map(p => parse(p.get(key))),
      distinctUntilChanged<T>((a, b) => this.deepEqual(a, b))
    );
  }

  /**
   * Observe a set of query-param keys as a single typed object.
   * `spec` maps the desired output key to a parser over the raw string value.
   */
  selectMany<T extends object>(
    spec: { [K in keyof T]: (raw: string | null) => T[K] }
  ): Observable<T> {
    const keys = Object.keys(spec) as (keyof T)[];
    return this.params$.pipe(
      map(p => {
        const out = {} as T;
        for (const k of keys) {
          out[k] = spec[k](p.get(k as string));
        }
        return out;
      }),
      distinctUntilChanged<T>((a, b) => this.deepEqual(a, b))
    );
  }

  /**
   * Merge a delta into the current query params. Keys set to null/undefined
   * are removed. By default replaces the current history entry so that
   * incremental edits (typing, pagination) don't flood back/forward history.
   */
  patch(delta: PatchMap, opts: PatchOpts = {}): Promise<boolean> {
    const cleaned = this.cleanDelta(delta);
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: cleaned,
      queryParamsHandling: 'merge',
      replaceUrl: opts.replaceUrl ?? true,
      preserveFragment: opts.preserveFragment,
      state: opts.stateSnapshot ? { payload: opts.stateSnapshot } : undefined,
    });
  }

  /** Full replace: drops any params not present in `params`. */
  set(params: PatchMap, opts: PatchOpts = {}): Promise<boolean> {
    const cleaned = this.cleanDelta(params);
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: cleaned,
      replaceUrl: opts.replaceUrl ?? false,
      preserveFragment: opts.preserveFragment,
      state: opts.stateSnapshot ? { payload: opts.stateSnapshot } : undefined,
    });
  }

  /** Remove the named keys from the current URL. */
  clear(keys: string[], opts: PatchOpts = {}): Promise<boolean> {
    const delta: PatchMap = {};
    for (const k of keys) delta[k] = null;
    return this.patch(delta, opts);
  }

  /**
   * Navigate to a different view while carrying an allowlist of params across
   * (default: ['sample','qid']). Any keys in `patch` are applied on top.
   * Prevents view-local params (q, page, etc.) from leaking between views.
   */
  navigateMerge(
    commands: unknown[],
    patch: PatchMap = {},
    opts: NavigateMergeOpts = {}
  ): Promise<boolean> {
    const propagate = opts.propagate ?? ['sample', 'qid'];
    const snap = this.snapshot();
    const carried: Record<string, string> = {};
    for (const key of propagate) {
      const v = snap.get(key);
      if (v != null && v !== '') carried[key] = v;
    }
    const merged = { ...carried, ...this.cleanDelta(patch) };
    return this.router.navigate(commands as any[], {
      queryParams: merged,
      replaceUrl: opts.replaceUrl ?? false,
    });
  }

  // --- Parse helpers (views use these in their vm$ specs) ---

  parseCSV(raw: string | null): string[] {
    if (!raw) return [];
    return raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
  }

  toCSV(list: readonly string[] | null | undefined): string | null {
    if (!list || list.length === 0) return null;
    return list.join(',');
  }

  parseInt(raw: string | null, fallback: number): number {
    if (raw == null || raw === '') return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  parseFloat(raw: string | null, fallback: number): number {
    if (raw == null || raw === '') return fallback;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  /** '1' | 'true' | 'yes' → true; '0' | 'false' | 'no' → false; else fallback. */
  parseBool(raw: string | null, fallback = false): boolean {
    if (raw == null) return fallback;
    const s = raw.toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes') return true;
    if (s === '0' || s === 'false' || s === 'no') return false;
    return fallback;
  }

  // --- internals ---

  private cleanDelta(delta: PatchMap): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(delta)) {
      if (v === null || v === undefined || v === '') {
        out[k] = null;
      } else if (typeof v === 'boolean') {
        out[k] = v ? '1' : null;
      } else {
        out[k] = String(v);
      }
    }
    return out;
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      const av = (a as Record<string, unknown>)[k];
      const bv = (b as Record<string, unknown>)[k];
      if (Array.isArray(av) && Array.isArray(bv)) {
        if (av.length !== bv.length) return false;
        for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
      } else if (av !== bv) {
        return false;
      }
    }
    return true;
  }
}
