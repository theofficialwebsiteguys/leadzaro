import { signal } from '@angular/core';
import { DomainService } from '../../core/services/domain.service';
import { LookupResult } from '../../core/models/domain.model';

/**
 * Checks a website address typed into a client/project form against the
 * connected Namecheap account before saving (ADR 0009). Call check() on
 * blur; the server refreshes a stale inventory itself, within the API's
 * rate limits. Nothing is linked until the form is saved.
 */
export class DomainLookupState {
  readonly result = signal<LookupResult | null>(null);
  readonly checking = signal(false);
  readonly failed = signal(false);
  private lastInput = '';

  constructor(private readonly domainService: DomainService) {}

  check(url: string | null | undefined, clientId?: string | null): void {
    const value = (url ?? '').trim();
    if (!value) {
      this.reset();
      return;
    }
    if (value === this.lastInput && (this.result() || this.checking())) return;
    this.lastInput = value;
    this.checking.set(true);
    this.failed.set(false);
    this.domainService.lookup(value, clientId).subscribe({
      next: (res) => {
        if (this.lastInput !== value) return;
        this.result.set(res.data.match);
        this.checking.set(false);
      },
      error: () => {
        if (this.lastInput !== value) return;
        this.result.set(null);
        this.failed.set(true);
        this.checking.set(false);
      },
    });
  }

  reset(): void {
    this.lastInput = '';
    this.result.set(null);
    this.checking.set(false);
    this.failed.set(false);
  }
}
