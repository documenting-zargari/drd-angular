import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, filter, map } from 'rxjs/operators';

/**
 * LargePayloadStore — short opaque key (qid) → arbitrary payload mapping
 * for cases where a view's state is too large for readable query params
 * (multi-sample + multi-category + complex search criteria).
 *
 * Persistence layers:
 *   1. In-memory Map (hot path)
 *   2. sessionStorage under `rms:qid:<id>` (survives route churn, dies with tab)
 *   3. window.history.state.payload (instant back/forward within the tab)
 *
 * Rehydration on navigation: when the URL carries ?qid=… and the store has
 * no entry, the service checks history.state for a matching { qid, payload }
 * and warms the cache. This makes back/forward feel instant even across
 * component teardowns.
 *
 * Server-persisted resolution (for cross-device shareable URLs) is a future
 * extension; deliberately not part of this service.
 */

const STORAGE_PREFIX = 'rms:qid:';
const ID_BYTES = 9; // 12 chars base64url

@Injectable({ providedIn: 'root' })
export class LargePayloadStore {
  private readonly router = inject(Router);

  private readonly cache = new Map<string, unknown>();
  private readonly missingSubject = new BehaviorSubject<Set<string>>(new Set());

  constructor() {
    // Warm the cache from history.state whenever a navigation completes.
    // This gives instant back/forward inside the tab.
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.warmFromHistoryState());
  }

  /**
   * Store a payload. Returns a short, URL-safe id. The caller is expected to
   * put the id into a query param (conventionally `qid`).
   */
  put<T>(payload: T): string {
    const qid = this.mintId();
    this.cache.set(qid, payload);
    this.writeToSession(qid, payload);
    return qid;
  }

  /**
   * Retrieve a previously stored payload by id. Returns null if not found.
   * Checks in-memory cache first, then sessionStorage.
   */
  get<T>(qid: string | null | undefined): T | null {
    if (!qid) return null;
    if (this.cache.has(qid)) return this.cache.get(qid) as T;
    const stored = this.readFromSession<T>(qid);
    if (stored !== null) {
      this.cache.set(qid, stored);
      this.clearMissing(qid);
      return stored;
    }
    this.markMissing(qid);
    return null;
  }

  has(qid: string | null | undefined): boolean {
    if (!qid) return false;
    if (this.cache.has(qid)) return true;
    return this.readFromSession(qid) !== null;
  }

  delete(qid: string): void {
    this.cache.delete(qid);
    try {
      sessionStorage.removeItem(STORAGE_PREFIX + qid);
    } catch {
      /* ignore storage errors */
    }
    this.clearMissing(qid);
  }

  /**
   * Observable that emits `true` when the given qid is known to be missing
   * from every storage tier. Views bind to this for the cold-start banner.
   */
  missing$(qid: string | null | undefined): Observable<boolean> {
    return this.missingSubject.pipe(
      map(set => !!qid && set.has(qid)),
      distinctUntilChanged()
    );
  }

  // --- internals ---

  private mintId(): string {
    const bytes = new Uint8Array(ID_BYTES);
    crypto.getRandomValues(bytes);
    // base64url without padding
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private writeToSession(qid: string, payload: unknown): void {
    try {
      sessionStorage.setItem(STORAGE_PREFIX + qid, JSON.stringify(payload));
    } catch {
      /* quota or unavailable — in-memory still works for this session */
    }
  }

  private readFromSession<T>(qid: string): T | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_PREFIX + qid);
      if (raw == null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private warmFromHistoryState(): void {
    const state = history.state as { payload?: { qid?: string } } | null;
    const payloadEntry = state?.payload;
    if (!payloadEntry || typeof payloadEntry !== 'object') return;
    const qid = (payloadEntry as { qid?: string }).qid;
    if (!qid) return;
    if (this.cache.has(qid)) return;
    const inner = (payloadEntry as { payload?: unknown }).payload;
    if (inner !== undefined) {
      this.cache.set(qid, inner);
      this.writeToSession(qid, inner);
      this.clearMissing(qid);
    }
  }

  private markMissing(qid: string): void {
    const cur = this.missingSubject.value;
    if (cur.has(qid)) return;
    const next = new Set(cur);
    next.add(qid);
    this.missingSubject.next(next);
  }

  private clearMissing(qid: string): void {
    const cur = this.missingSubject.value;
    if (!cur.has(qid)) return;
    const next = new Set(cur);
    next.delete(qid);
    this.missingSubject.next(next);
  }
}
