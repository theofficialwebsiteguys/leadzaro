import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SalesService } from '../../../core/services/sales.service';
import { OrganizationContextService } from '../../../core/services/organization-context.service';
import { StripeCustomer, StripeCustomerLink } from '../../../core/models/sales.model';

/**
 * The client's Stripe customer (ADR 0013): which Stripe customer this
 * client is, with suggestions from its emails and name. Linking is always
 * a person's choice; a customer already linked to another business can't
 * be linked twice. Unlinking changes nothing in Stripe.
 */
@Component({
  selector: 'app-client-stripe-link',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <div class="link-box">
      @if (loading()) { <p class="text-sm text-muted">Checking Stripe link…</p> }
      @else if (state()) {
        @let s = state()!;
        @if (s.link) {
          <p class="text-sm">Linked to Stripe customer <strong>{{ s.link.name || s.link.email || s.link.stripeCustomerId }}</strong>
            <span class="text-muted">· {{ s.link.stripeCustomerId }} · {{ s.mode }} mode</span></p>
          <div class="actions">
            <a class="btn btn-ghost btn-sm" [href]="dashboardUrl(s.mode, s.link.stripeCustomerId)" target="_blank" rel="noopener">Open in Stripe ↗</a>
            @if (canLink()) { <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy()" (click)="unlink()">Unlink</button> }
          </div>
        } @else {
          <p class="text-sm text-muted">Not linked to a Stripe customer{{ s.mode !== 'live' ? ' in ' + s.mode + ' mode' : '' }}.
            Linking lets Leadzaro show this client’s subscriptions, invoices and payment problems.</p>
          @if (s.otherModes.length) { <p class="text-xs text-muted">Linked in {{ s.otherModes[0].mode }} mode only.</p> }
          @if (canLink()) {
            @if (!open()) {
              <button type="button" class="btn btn-outline btn-sm" (click)="findMatches()">Find in Stripe</button>
            } @else {
              <form class="search" (ngSubmit)="search()">
                <input class="form-control" name="q" [(ngModel)]="query" placeholder="Email, business name or cus_… ID" aria-label="Search Stripe customers" />
                <button type="submit" class="btn btn-outline btn-sm" [disabled]="busy() || !query.trim()">Search</button>
              </form>
              @if (searching()) { <p class="text-sm text-muted">Searching Stripe…</p> }
              @for (c of results(); track c.id) {
                <div class="cand">
                  <div><strong>{{ c.name || 'No name' }}</strong> · {{ c.email || 'no email' }}
                    <div class="text-xs text-muted">{{ c.id }}@if (c.created) { · created {{ c.created | date: 'MMM y' }} }@if (c.matchedOn) { · matched on {{ c.matchedOn }} }@if (c.sameWebsiteDomain) { · email on their website domain }</div>
                  </div>
                  @if (c.linkedTo) { <span class="text-xs text-muted">Linked to {{ c.linkedTo.name }}</span> }
                  @else { <button type="button" class="btn btn-primary btn-sm" [disabled]="busy()" (click)="link(c)">Link</button> }
                </div>
              } @empty { @if (!searching() && searched()) { <p class="text-sm text-muted">No matching Stripe customers. Try their billing email, or link them later.</p> } }
            }
          }
        }
      }
      @if (error()) { <p class="text-sm form-error">{{ error() }}</p> }
      @if (message()) { <p class="text-sm ok" role="status">{{ message() }}</p> }
    </div>
  `,
  styles: [`
    .link-box { display: flex; flex-direction: column; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--border-light); margin-bottom: 10px; }
    .actions, .search { display: flex; gap: 6px; flex-wrap: wrap; }
    .search input { flex: 1; min-width: 200px; }
    .cand { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 6px 8px; border: 1px solid var(--border-light); border-radius: var(--radius); font-size: .85rem; }
    .ok { color: var(--success-text); }
    p { margin: 0; }
  `],
})
export class ClientStripeLinkComponent implements OnInit {
  private readonly sales = inject(SalesService);
  private readonly org = inject(OrganizationContextService);

  readonly clientId = input.required<string>();
  readonly changed = output<void>();

  readonly state = signal<StripeCustomerLink | null>(null);
  readonly loading = signal(true);
  readonly open = signal(false);
  readonly results = signal<StripeCustomer[]>([]);
  readonly searching = signal(false);
  readonly searched = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  query = '';

  canLink(): boolean {
    return this.org.hasPermission('payments.create');
  }

  ngOnInit(): void {
    this.refresh();
  }

  private refresh(): void {
    this.sales.customerLink(this.clientId()).subscribe({
      next: (s) => { this.state.set(s); this.loading.set(false); },
      error: (err) => { this.loading.set(false); this.error.set(err.error?.message || 'The Stripe link couldn’t be checked.'); },
    });
  }

  dashboardUrl(mode: string, customerId: string): string {
    return `https://dashboard.stripe.com/${mode === 'test' ? 'test/' : ''}customers/${customerId}`;
  }

  findMatches(): void {
    this.open.set(true);
    this.searching.set(true);
    this.error.set('');
    this.sales.suggestCustomers(this.clientId()).subscribe({
      next: (list) => { this.results.set(list); this.searching.set(false); this.searched.set(true); },
      error: (err) => { this.searching.set(false); this.error.set(err.error?.message || 'Stripe couldn’t be searched.'); },
    });
  }

  search(): void {
    if (!this.query.trim()) return;
    this.searching.set(true);
    this.error.set('');
    this.sales.searchCustomers(this.query.trim()).subscribe({
      next: (list) => { this.results.set(list); this.searching.set(false); this.searched.set(true); },
      error: (err) => { this.searching.set(false); this.error.set(err.error?.message || 'Stripe couldn’t be searched.'); },
    });
  }

  link(customer: StripeCustomer): void {
    if (!confirm(`Link this client to Stripe customer ${customer.name || customer.email || customer.id}?`)) return;
    this.busy.set(true);
    this.error.set('');
    this.sales.linkCustomer(this.clientId(), customer.id).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.state.set(s);
        this.open.set(false);
        this.message.set('Linked. Use “Refresh from Stripe” below to pull in subscriptions and invoices.');
        this.changed.emit();
      },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not linked — try again.'); },
    });
  }

  unlink(): void {
    if (!confirm('Unlink this Stripe customer? Nothing is changed in Stripe, and payments already recorded stay.')) return;
    this.busy.set(true);
    this.sales.unlinkCustomer(this.clientId()).subscribe({
      next: (s) => { this.busy.set(false); this.state.set(s); this.message.set('Unlinked. Nothing was changed in Stripe.'); this.changed.emit(); },
      error: (err) => { this.busy.set(false); this.error.set(err.error?.message || 'Not unlinked — try again.'); },
    });
  }
}
