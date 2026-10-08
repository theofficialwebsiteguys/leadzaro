import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DialogComponent } from '../../../shared/dialog/dialog.component';
import { SalesService } from '../../../core/services/sales.service';
import { StripeClientMatch, StripeClientMatches } from '../../../core/models/sales.model';

const MATCHED_ON: Record<string, string> = { email: 'same email', website: 'email on their website domain', name: 'same name only' };

/**
 * Match clients with Stripe (ADR 0013). One read of the Stripe customer
 * list, matched on the server; a person confirms every link. Ambiguous and
 * name-only matches are shown as such, never pre-selected.
 */
@Component({
  selector: 'app-stripe-match-dialog',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, DialogComponent],
  template: `
    <app-dialog title="Match clients with Stripe" [open]="open()" (closed)="closed.emit()" [wide]="true">
      @if (loading()) {
        <div class="loading-state"><div class="spinner"></div><p class="text-sm text-muted">Reading your Stripe customers…</p></div>
      } @else if (error()) {
        <div class="alert alert-error">{{ error() }}</div>
        <button type="button" class="btn btn-outline btn-sm" (click)="load(true)">Try again</button>
      } @else if (data()) {
        @let d = data()!;
        <p class="text-sm summary">
          {{ d.linkedCount }} of {{ d.clientCount }} clients are linked in Stripe {{ d.mode === 'live' ? '' : '(' + d.mode + ' mode)' }}.
          Checked {{ d.customersScanned }} Stripe customer{{ d.customersScanned === 1 ? '' : 's' }} at {{ d.readAt | date: 'h:mm a' }}.
          <button type="button" class="linkish" (click)="load(true)">Re-read Stripe</button>
        </p>
        @if (d.truncated) { <div class="alert alert-warning">Only the first {{ d.customersScanned }} Stripe customers were checked. Link the rest from each client’s Billing tab.</div> }
        @if (d.mode !== 'live') { <div class="alert alert-info">Stripe is in {{ d.mode }} mode, so these are test customers. Links made now apply to {{ d.mode }} mode only.</div> }

        @if (reviewable().length === 0) {
          <p class="muted-box">No suggested matches right now. Clients without one can be linked by hand from their Billing tab.</p>
        }
        @for (c of reviewable(); track c.id) {
          <div class="row" [class.done]="linked().has(c.id)">
            <div class="row-head">
              <a [routerLink]="['/app/clients', c.id, 'billing']" (click)="closed.emit()"><strong>{{ c.name }}</strong></a>
              @if (linked().has(c.id)) { <span class="tag tag-success">Linked</span> }
              @else if (c.status === 'suggested') { <span class="tag tag-success">Likely match</span> }
              @else { <span class="tag tag-warning">Check carefully</span> }
            </div>
            @if (!linked().has(c.id)) {
              <div class="cands" role="radiogroup" [attr.aria-label]="'Stripe customers for ' + c.name">
                @for (cand of c.candidates; track cand.id) {
                  <label class="cand">
                    <input type="radio" [name]="'m-' + c.id" [value]="cand.id" [ngModel]="choice()[c.id]" (ngModelChange)="choose(c.id, $event)" />
                    <span><strong>{{ cand.name || 'No name' }}</strong> · {{ cand.email || 'no email' }}
                      <span class="text-xs text-muted">— {{ matchedOn(cand.matchedOn) }}@if (cand.created) { · created {{ cand.created | date: 'MMM y' }} } · {{ cand.id }}</span></span>
                  </label>
                }
              </div>
              <div class="row-actions">
                @if (rowError()[c.id]) { <span class="form-error">{{ rowError()[c.id] }}</span> }
                <button type="button" class="btn btn-primary btn-sm" [disabled]="!choice()[c.id] || busy() === c.id" (click)="link(c)">{{ busy() === c.id ? 'Linking…' : 'Link' }}</button>
              </div>
            }
          </div>
        }
        @if (unmatched().length) {
          <details class="none">
            <summary>{{ unmatched().length }} client{{ unmatched().length === 1 ? '' : 's' }} with no match in Stripe</summary>
            <p class="text-xs text-muted">They may pay another way, or use a different email in Stripe. Link or create their Stripe customer from the client’s Billing tab.</p>
            <ul>@for (c of unmatched(); track c.id) { <li><a [routerLink]="['/app/clients', c.id, 'billing']" (click)="closed.emit()">{{ c.name }}</a></li> }</ul>
          </details>
        }
      }
      <ng-container dialog-actions>
        <button type="button" class="btn btn-ghost" (click)="closed.emit()">Done</button>
      </ng-container>
    </app-dialog>
  `,
  styles: [`
    .summary { margin: 0 0 10px; color: var(--text-secondary); }
    .linkish { border: none; background: none; color: var(--primary); cursor: pointer; padding: 0; font-size: inherit; text-decoration: underline; }
    .row { border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; margin-bottom: 8px; &.done { opacity: .7; } }
    .row-head { display: flex; align-items: center; gap: 8px; a { color: var(--text-primary); text-decoration: none; } }
    .cands { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
    .cand { display: flex; gap: 8px; align-items: flex-start; font-size: .85rem; cursor: pointer; input { margin-top: 3px; } }
    .row-actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; }
    .none { margin-top: 10px; summary { cursor: pointer; font-size: .85rem; color: var(--text-secondary); } ul { margin: 6px 0 0; padding-left: 18px; font-size: .85rem; columns: 2; } }
  `],
})
export class StripeMatchDialogComponent {
  private readonly sales = inject(SalesService);

  readonly open = input(false);
  readonly closed = output<void>();
  readonly linkedAny = output<void>();

  readonly loading = signal(false);
  readonly error = signal('');
  readonly data = signal<StripeClientMatches | null>(null);
  readonly choice = signal<Record<string, string>>({});
  readonly linked = signal<Set<string>>(new Set());
  readonly busy = signal<string | null>(null);
  readonly rowError = signal<Record<string, string>>({});

  readonly reviewable = computed(() => (this.data()?.clients || []).filter((c) => c.status !== 'none'));
  readonly unmatched = computed(() => (this.data()?.clients || []).filter((c) => c.status === 'none'));

  constructor() {
    effect(() => {
      if (this.open()) this.load(false);
    });
  }

  matchedOn(key: string): string {
    return MATCHED_ON[key] || key;
  }

  load(refresh: boolean): void {
    this.loading.set(true);
    this.error.set('');
    this.sales.clientMatches(refresh).subscribe({
      next: (d) => {
        this.loading.set(false);
        this.data.set(d);
        this.linked.set(new Set());
        // Only a single strong match is pre-selected; ambiguous rows need a person's choice.
        const preset: Record<string, string> = {};
        for (const c of d.clients) if (c.status === 'suggested') preset[c.id] = c.candidates[0].id;
        this.choice.set(preset);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.message || 'Stripe couldn’t be read right now.');
      },
    });
  }

  choose(clientId: string, customerId: string): void {
    this.choice.set({ ...this.choice(), [clientId]: customerId });
  }

  link(c: StripeClientMatch): void {
    const customerId = this.choice()[c.id];
    if (!customerId) return;
    this.busy.set(c.id);
    this.rowError.set({ ...this.rowError(), [c.id]: '' });
    this.sales.linkCustomer(c.id, customerId).subscribe({
      next: () => {
        this.busy.set(null);
        this.linked.set(new Set([...this.linked(), c.id]));
        this.linkedAny.emit();
      },
      error: (err) => {
        this.busy.set(null);
        this.rowError.set({ ...this.rowError(), [c.id]: err.error?.message || 'Not linked — try again.' });
      },
    });
  }
}
