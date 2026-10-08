import { PhoneInputDirective } from '../../../shared/forms/formatted-inputs';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { SalesService, actionKey } from '../../../core/services/sales.service';
import {
  BillingSummary, CatalogPrice, CatalogProduct, PaymentRequest, StripeCustomer, StripeStatus, Workspace,
} from '../../../core/models/sales.model';
import { MoneyPipe, money, termsLabel } from '../shared/sales-format';

interface CustomItem { name: string; amount: string; interval: '' | 'month' | 'year' }

const STATUS_LABELS: Record<string, { label: string; tone: string } | undefined> = {
  creating: { label: 'Creating…', tone: 'muted' },
  created: { label: 'Not sent yet', tone: 'warning' },
  sent: { label: 'Sent — awaiting payment', tone: 'info' },
  processing: { label: 'Payment processing', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  completed_no_payment: { label: 'Completed — no payment taken', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  expired: { label: 'Expired', tone: 'muted' },
  replaced: { label: 'Replaced', tone: 'muted' },
  deactivated: { label: 'Deactivated', tone: 'muted' },
};

/**
 * Offers & payments in the lead workspace (ADR 0011): the Stripe customer,
 * payment requests (real Payment Links or customer checkouts), payments
 * received and billing history.
 */
@Component({
  selector: 'app-offers',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink, MoneyPipe, PhoneInputDirective],
  templateUrl: './offers.component.html',
  styleUrl: './offers.component.scss',
})
export class OffersComponent implements OnInit {
  private readonly sales = inject(SalesService);

  readonly ws = input.required<Workspace>();
  readonly changed = output<void>();
  readonly compose = output<{ channel: 'email' | 'sms'; category: string }>();

  readonly statusLabels = STATUS_LABELS;
  readonly termsLabel = termsLabel;
  readonly status = signal<StripeStatus | null>(null);
  readonly catalog = signal<CatalogProduct[]>([]);
  readonly catalogError = signal('');
  readonly message = signal('');
  readonly error = signal('');
  readonly busy = signal<string | null>(null);

  // Customer
  readonly suggestions = signal<StripeCustomer[] | null>(null);
  readonly searchResults = signal<StripeCustomer[] | null>(null);
  readonly candidates = signal<StripeCustomer[]>([]);
  readonly showCustomerTools = signal(false);
  customerQuery = '';
  editingCustomer = false;
  customerEdit = { name: '', email: '', phone: '' };

  // Builder
  readonly showBuilder = signal(false);
  readonly selected = signal<Set<string>>(new Set());
  customItems: CustomItem[] = [];
  delivery: 'payment_link' | 'checkout' = 'payment_link';
  offerTitle = '';
  private createKey = actionKey();

  // Manual payment
  readonly showManual = signal(false);
  manual = { amount: '', method: 'check', paidAt: new Date().toISOString().slice(0, 10), reference: '', note: '' };

  // Billing
  readonly billing = signal<BillingSummary | null>(null);

  readonly prices = computed(() => this.catalog().flatMap((p) => p.prices));
  readonly selectedItems = computed(() => this.prices().filter((p) => this.selected().has(p.id)));
  readonly linked = computed(() => this.ws().stripe.link);
  readonly openRequests = computed(() => this.ws().paymentRequests.filter((r) => r.isOpen));
  readonly isWon = computed(() => this.ws().opportunity.stage === 'won');
  readonly otherModes = computed(() => this.ws().stripe.otherModes.map((m) => m.mode).join(', '));

  ngOnInit(): void {
    this.sales.stripeStatus().subscribe({
      next: (s) => {
        this.status.set(s);
        if (s.connected && this.ws().permissions.createPayment) this.loadCatalog();
      },
      error: () => this.status.set(null),
    });
  }

  loadCatalog(refresh = false): void {
    this.sales.catalog(refresh).subscribe({
      next: (c) => { this.catalog.set(c); this.catalogError.set(''); },
      error: (err) => this.catalogError.set(err.error?.message || 'The Stripe catalog could not be loaded.'),
    });
  }

  label(p: CatalogPrice): string {
    const amount = money(p.unitAmount, p.currency);
    return p.type === 'recurring' ? `${amount} / ${p.interval}` : `${amount} one-time`;
  }

  toggle(price: CatalogPrice): void {
    const next = new Set(this.selected());
    if (next.has(price.id)) next.delete(price.id);
    else next.add(price.id);
    this.selected.set(next);
  }

  addCustom(): void {
    this.customItems = [...this.customItems, { name: '', amount: '', interval: '' }];
  }

  removeCustom(index: number): void {
    this.customItems = this.customItems.filter((_, i) => i !== index);
  }

  summary(): { today: number; recurring: number; interval: string | null; currency: string; problem: string | null } {
    const items = [
      ...this.selectedItems().map((p) => ({ amount: p.unitAmount, interval: p.type === 'recurring' ? p.interval : null, currency: p.currency })),
      ...this.customItems.filter((c) => c.name && Number(c.amount) > 0).map((c) => ({ amount: Math.round(Number(c.amount) * 100), interval: c.interval || null, currency: this.selectedItems()[0]?.currency ?? this.status()?.defaultCurrency ?? 'usd' })),
    ];
    const intervals = new Set(items.filter((i) => i.interval).map((i) => i.interval));
    const currencies = new Set(items.map((i) => i.currency));
    return {
      today: items.reduce((s, i) => s + i.amount, 0),
      recurring: items.filter((i) => i.interval).reduce((s, i) => s + i.amount, 0),
      interval: [...intervals][0] ?? null,
      currency: [...currencies][0] ?? 'usd',
      problem: intervals.size > 1 ? 'Monthly and yearly prices can’t be combined — make two requests.' : currencies.size > 1 ? 'All items must use the same currency.' : null,
    };
  }

  openBuilder(): void {
    this.selected.set(new Set());
    this.customItems = [];
    this.offerTitle = '';
    this.delivery = this.linked() ? 'checkout' : 'payment_link';
    this.createKey = actionKey();
    this.error.set('');
    this.showBuilder.set(true);
  }

  create(): void {
    const s = this.summary();
    if (s.problem) { this.error.set(s.problem); return; }
    if (s.today <= 0) { this.error.set('Choose at least one product, or add a custom item.'); return; }
    this.busy.set('create');
    this.error.set('');
    this.sales.createPaymentRequest(this.ws().opportunity.id, {
      priceIds: [...this.selected()],
      customItems: this.customItems.filter((c) => c.name && Number(c.amount) > 0).map((c) => ({ name: c.name, amountCents: Math.round(Number(c.amount) * 100), interval: c.interval || null })),
      delivery: this.delivery,
      offerTitle: this.offerTitle || null,
      idempotencyKey: this.createKey,
    }).subscribe({
      next: () => {
        this.busy.set(null);
        this.showBuilder.set(false);
        this.message.set('Payment link created. Copy it or send it with the email/text buttons — it only counts as sent when you send it or mark it sent.');
        this.changed.emit();
      },
      error: (err) => { this.busy.set(null); this.error.set(err.error?.message || 'The payment link could not be created.'); },
    });
  }

  copy(request: PaymentRequest): void {
    if (!request.url) return;
    navigator.clipboard?.writeText(request.url).then(
      () => this.message.set('Link copied. Copying doesn’t mark it as sent — use “Mark as sent” once the customer has it.'),
      () => this.message.set('Copy failed — select the link and copy it manually.'),
    );
  }

  run(key: string, request: Observable<unknown>, success: string): void {
    this.busy.set(key);
    this.error.set('');
    request.subscribe({
      next: () => { this.busy.set(null); this.message.set(success); this.changed.emit(); },
      error: (err) => { this.busy.set(null); this.error.set(err.error?.message || 'That didn’t work.'); },
    });
  }

  markSent(request: PaymentRequest, via: string): void { this.run(`sent-${request.id}`, this.sales.markSent(request.id, via), 'Marked as sent.'); }
  deactivate(request: PaymentRequest): void { this.run(`off-${request.id}`, this.sales.deactivate(request.id), 'Link deactivated — it can no longer be paid.'); }
  regenerate(request: PaymentRequest): void { this.run(`regen-${request.id}`, this.sales.regenerate(request.id), 'A fresh checkout link was created. Send the new link.'); }
  refresh(request: PaymentRequest): void { this.run(`refresh-${request.id}`, this.sales.refreshRequest(request.id), 'Checked with Stripe.'); }
  simulate(request: PaymentRequest): void { this.run(`sim-${request.id}`, this.sales.simulatePayment(request.id), 'Simulated payment processed (mock mode — no money moved).'); }

  // ---- customer
  loadSuggestions(): void {
    this.showCustomerTools.set(true);
    this.sales.suggestCustomers(this.ws().business.id).subscribe({ next: (s) => this.suggestions.set(s), error: (err) => this.error.set(err.error?.message || 'Stripe could not be searched.') });
  }

  search(): void {
    if (!this.customerQuery.trim()) return;
    this.sales.searchCustomers(this.customerQuery.trim()).subscribe({ next: (r) => this.searchResults.set(r), error: (err) => this.error.set(err.error?.message || 'Stripe could not be searched.') });
  }

  link(customer: StripeCustomer): void {
    this.run('link', this.sales.linkCustomer(this.ws().business.id, customer.id), `Linked to Stripe customer ${customer.name || customer.email || customer.id}.`);
    this.showCustomerTools.set(false);
    this.candidates.set([]);
  }

  createCustomer(confirmNew = false): void {
    this.busy.set('customer');
    this.error.set('');
    this.sales.createCustomer(this.ws().business.id, { confirmNew }).subscribe({
      next: () => { this.busy.set(null); this.candidates.set([]); this.showCustomerTools.set(false); this.message.set('Stripe customer created and linked.'); this.changed.emit(); },
      error: (err) => {
        this.busy.set(null);
        if (err.status === 409 && err.error?.candidates) this.candidates.set(err.error.candidates);
        this.error.set(err.error?.message || 'The Stripe customer could not be created.');
      },
    });
  }

  startEditCustomer(): void {
    const link = this.linked();
    this.customerEdit = { name: link?.name ?? '', email: link?.email ?? '', phone: '' };
    this.editingCustomer = true;
  }

  saveCustomer(): void {
    const body: Record<string, string> = { name: this.customerEdit.name, email: this.customerEdit.email };
    if (this.customerEdit.phone) body['phone'] = this.customerEdit.phone;
    this.run('customer-edit', this.sales.updateCustomer(this.ws().business.id, body), 'Stripe customer updated.');
    this.editingCustomer = false;
  }

  unlink(): void {
    this.run('unlink', this.sales.unlinkCustomer(this.ws().business.id), 'Unlinked. Nothing was changed in Stripe.');
  }

  // ---- manual payment
  recordManual(): void {
    const cents = Math.round(Number(this.manual.amount) * 100);
    if (!cents || cents <= 0) { this.error.set('Enter the amount received.'); return; }
    this.busy.set('manual');
    this.error.set('');
    this.sales.recordManualPayment(this.ws().opportunity.id, {
      amountCents: cents, method: this.manual.method, paidAt: this.manual.paidAt, reference: this.manual.reference || null, note: this.manual.note || null, currency: this.ws().opportunity.currency,
    }).subscribe({
      next: (res) => {
        this.busy.set(null);
        this.showManual.set(false);
        this.message.set(res.converted ? 'Payment recorded. The deal is won and the client has been created — complete the handoff.' : 'Payment recorded.');
        this.changed.emit();
      },
      error: (err) => { this.busy.set(null); this.error.set(err.error?.message || 'The payment could not be recorded.'); },
    });
  }

  loadBilling(live: boolean): void {
    this.busy.set('billing');
    this.sales.billing(this.ws().business.id, live).subscribe({
      next: (b) => { this.busy.set(null); this.billing.set(b); },
      error: (err) => { this.busy.set(null); this.error.set(err.error?.message || 'Billing history could not be loaded.'); },
    });
  }

  modeLabel(mode: string | null | undefined): string {
    return mode === 'live' ? 'Live' : mode === 'test' ? 'Test' : mode === 'mock' ? 'Mock' : '';
  }
}
