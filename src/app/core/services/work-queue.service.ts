import { Injectable, computed, signal } from '@angular/core';
import { QueueItem } from '../models/sales.model';

interface QueueState {
  items: QueueItem[];
  index: number;
  filters: { reasons: string[]; stage: string };
  done: string[];
}

const KEY = 'lz.workQueue';

/**
 * "Work next lead" (ADR 0011): the ordered queue, the current position and
 * the filters it was built with, kept for the browser session so leaving
 * a lead and coming back never loses your place.
 */
@Injectable({ providedIn: 'root' })
export class WorkQueueService {
  private readonly state = signal<QueueState | null>(this.load());

  readonly active = computed(() => Boolean(this.state()?.items.length));
  readonly items = computed(() => this.state()?.items ?? []);
  readonly index = computed(() => this.state()?.index ?? 0);
  readonly current = computed(() => this.items()[this.index()] ?? null);
  readonly filters = computed(() => this.state()?.filters ?? { reasons: [], stage: '' });
  readonly doneCount = computed(() => this.state()?.done.length ?? 0);
  readonly remaining = computed(() => Math.max(0, this.items().length - this.index()));

  start(items: QueueItem[], filters: QueueState['filters']): QueueItem | null {
    this.save({
      items, index: 0, filters, done: [],
    });
    return items[0] ?? null;
  }

  /** Position of a lead in the queue, or -1 when it isn't part of it. */
  positionOf(opportunityId: string): number {
    return this.items().findIndex((item) => item.opportunityId === opportunityId);
  }

  /** Keeps the queue position in step when a lead is opened directly. */
  focus(opportunityId: string): void {
    const state = this.state();
    const position = this.positionOf(opportunityId);
    if (state && position >= 0 && position !== state.index) this.save({ ...state, index: position });
  }

  /** Marks the current lead handled and returns the next one. */
  next(markDone = true): QueueItem | null {
    const state = this.state();
    if (!state) return null;
    const current = state.items[state.index];
    const done = markDone && current && !state.done.includes(current.opportunityId) ? [...state.done, current.opportunityId] : state.done;
    const index = Math.min(state.index + 1, state.items.length);
    this.save({ ...state, index, done });
    return state.items[index] ?? null;
  }

  stop(): void {
    this.save(null);
  }

  private save(state: QueueState | null): void {
    this.state.set(state);
    try {
      if (state) sessionStorage.setItem(KEY, JSON.stringify(state));
      else sessionStorage.removeItem(KEY);
    } catch {
      // Session storage can be unavailable (private mode); the queue still works for this page.
    }
  }

  private load(): QueueState | null {
    try {
      const raw = sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) as QueueState : null;
    } catch {
      return null;
    }
  }
}
