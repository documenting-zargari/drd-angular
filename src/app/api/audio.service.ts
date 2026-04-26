import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/**
 * AudioService — global singleton for audio playback.
 *
 * Ensures only one clip plays at a time across all views.
 * Exposes `currentUrl$` so any component can highlight the
 * currently-playing item without polling.
 *
 * Designed to grow: timestamp-driven text-following, segment
 * queuing, and playback-rate control can be added here without
 * touching callers.
 */
@Injectable({ providedIn: 'root' })
export class AudioService {
  private current: HTMLAudioElement | null = null;
  private readonly urlSubject = new BehaviorSubject<string | null>(null);
  private readonly playingSubject = new BehaviorSubject<boolean>(false);

  /** URL of the clip currently playing, or null. */
  readonly currentUrl$: Observable<string | null> = this.urlSubject.asObservable();

  /** True while audio is playing. */
  readonly isPlaying$: Observable<boolean> = this.playingSubject.asObservable();

  get currentUrl(): string | null { return this.urlSubject.value; }
  get isPlaying(): boolean { return this.playingSubject.value; }

  /** Play a URL. Stops any currently-playing clip first. */
  play(url: string): Promise<void> {
    this.stop();
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      this.current = audio;
      this.urlSubject.next(url);

      audio.onloadstart = () => this.playingSubject.next(true);
      audio.onended = () => { this.clear(); resolve(); };
      audio.onerror = () => { this.clear(); reject(new Error('Audio failed to load')); };

      audio.play().catch(err => { this.clear(); reject(err); });
    });
  }

  /** Stop the currently-playing clip, if any. */
  stop(): void {
    if (!this.current) return;
    this.current.pause();
    this.current.currentTime = 0;
    this.current = null;
    this.clear();
  }

  private clear(): void {
    this.current = null;
    this.playingSubject.next(false);
    this.urlSubject.next(null);
  }
}
